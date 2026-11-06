'use strict';

const crypto = require('crypto');
const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { createSupabaseServices } = require('./lib/supabase');
const { SupabaseStore } = require('./lib/supabase-store');

const DEFAULT_PORT = 3000;
const COLORS = new Set(['amarillo', 'rosa', 'azul', 'verde', 'lila']);
const MEMBER_ROLES = new Set(['propietario', 'editor', 'lector']);
const SUPERADMIN_EMAIL = 'saldavargasboris@gmail.com';
const THEMES = new Set(['light', 'dark', 'system']);
const MAX_COORDINATE = 4000;
const GENERAL_WALL_ID = '00000000-0000-0000-0000-000000000001';
const REPORT_REASONS = new Set(['fallo_aplicacion', 'contenido_ofensivo', 'spam', 'enlace_inseguro', 'acoso', 'otro']);
const DISCIPLINE_ACTIONS = new Set(['advertir', 'suspender_24h', 'suspender_7d', 'reactivar', 'eliminar']);
const INVITATION_TTL = 24 * 60 * 60 * 1000;
const INVITATION_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function invitationSecrets() {
  const token = crypto.randomBytes(32).toString('base64url');
  const code = Array.from({ length: 8 }, () => INVITATION_ALPHABET[crypto.randomInt(0, INVITATION_ALPHABET.length)]).join('');
  return { token, code, tokenHash: sha256(token), codeHash: sha256(code), expiresAt: Date.now() + INVITATION_TTL };
}

function normalizeInvitationSecret(value) {
  const secret = cleanText(value, 200);
  return /^[a-z0-9]{8}$/i.test(secret) ? secret.toUpperCase() : secret;
}

function cleanText(value, max = 280) {
  return String(value ?? '').replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, max);
}

function safeCoordinate(value, fallback = 40) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(number, MAX_COORDINATE)) : fallback;
}

function validEmail(value) {
  const email = cleanText(value, 120).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
}

async function sendModerationEmail(accessToken, payload) {
  const baseUrl = String(process.env.MAILER_URL || 'https://muro-ideasquesemueven.netlify.app').replace(/\/$/, '');
  const response = await fetch(`${baseUrl}/hooks/moderation`, {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal: globalThis.AbortSignal.timeout(6_000)
  });
  if (!response.ok) throw new Error('moderation_email_failed');
}

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    avatar: user.avatar,
    createdAt: user.createdAt,
    settings: { ...user.settings }
  };
}

function createWelcomeNote() {
  return {
    id: 'bienvenida',
    texto: '¡Bienvenidos! Crea una nota y muévela por el muro.',
    color: 'amarillo',
    x: 80,
    y: 100,
    autor: 'Equipo',
    updatedAt: Date.now()
  };
}

function createMuroServer(options = {}) {
  const app = express();
  const httpServer = http.createServer(app);
  const io = new Server(httpServer, { maxHttpBufferSize: 300_000 });
  const services = createSupabaseServices(options.env || process.env);
  const store = options.persistence === false || !services.adminConfigured ? null : new SupabaseStore(services);
  const storage = { mode: 'memory', publicConnection: false, adminConnection: false, schemaReady: false, reason: store ? 'initializing' : 'not_configured' };
  const users = [];
  const sessions = new Map();
  const invitations = [];
  const reports = [];
  const walls = [{
    id: 'general',
    name: 'Muro de ideas',
    description: 'Un espacio compartido para las ideas del equipo.',
    color: 'amarillo',
    ownerId: null,
    members: {},
    notes: [createWelcomeNote()],
    createdAt: Date.now(),
    updatedAt: Date.now()
  }];

  const replaceState = (state) => {
    users.splice(0, users.length, ...state.users);
    walls.splice(0, walls.length, ...state.walls);
  };
  const ready = (async () => {
    if (!store) return;
    const [publicCheck, adminCheck] = await Promise.all([store.checkPublicConnection(), store.checkAdminConnection()]);
    storage.publicConnection = publicCheck.ok;
    storage.adminConnection = adminCheck.ok;
    if (!adminCheck.ok) { storage.reason = adminCheck.reason; return; }
    try {
      replaceState(await store.loadState());
      storage.mode = 'supabase';
      storage.schemaReady = true;
      storage.reason = 'ready';
    } catch {
      storage.reason = 'migration_required';
    }
  })();

  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.set({
      'Content-Security-Policy': "default-src 'self'; base-uri 'self'; connect-src 'self' https://zdyljsfnnbqcrqaivwqa.supabase.co wss://zdyljsfnnbqcrqaivwqa.supabase.co; font-src 'self' https://fonts.gstatic.com data:; form-action 'self'; frame-ancestors 'none'; img-src 'self' data: blob:; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; upgrade-insecure-requests",
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Resource-Policy': 'same-origin',
      'Permissions-Policy': 'camera=(), geolocation=(), microphone=(), payment=(), usb=()',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY'
    });
    if (req.secure || req.get('x-forwarded-proto') === 'https') {
      res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    next();
  });
  const supabaseBrowserBundle = path.join(path.dirname(require.resolve('@supabase/supabase-js')), 'umd', 'supabase.js');
  app.get('/vendor/supabase.js', (_req, res) => res.sendFile(supabaseBrowserBundle));
  app.get('/api/supabase/config', (_req, res) => {
    const config = services.browserConfig();
    if (!config) return res.status(503).json({ ok: false, error: 'Supabase público no está configurado.' });
    return res.json(config);
  });
  // Render publica la actualización visual de Pierina desde Frontend/. El
  // backend y las rutas de salud permanecen en esta misma aplicación.
  app.use(express.static(path.join(__dirname, 'Frontend')));
  app.get('/api/health', async (_req, res) => {
    await ready;
    let database = storage.schemaReady ? 'ready' : 'unavailable';
    if (storage.schemaReady) {
      try { await store.ping(); } catch { database = 'unreachable'; }
    }
    res.json({
      ok: database !== 'unreachable',
      notes: walls.reduce((sum, wall) => sum + wall.notes.length, 0),
      walls: walls.length,
      users: connectedUserCount(),
      storage: { ...storage, database }
    });
  });

  const fail = (acknowledge, error) => acknowledge({ ok: false, error });
  const findUser = (socket) => users.find((user) => user.id === socket.data.userId);
  const findWall = (id) => walls.find((wall) => wall.id === cleanText(id, 100));
  // El rol global administra la plataforma, pero no concede acceso implícito al
  // contenido privado de los muros. La membresía siempre se comprueba por muro.
  const wallRole = (wall, user) => wall?.members[user?.id];
  const canEdit = (wall, user) => ['propietario', 'editor'].includes(wallRole(wall, user));
  const canOwn = (wall, user) => wallRole(wall, user) === 'propietario';
  const requireUser = (socket, acknowledge) => {
    const user = findUser(socket);
    if (!user) fail(acknowledge, 'Tu sesión no es válida. Vuelve a iniciar sesión.');
    return user;
  };
  const requireAdmin = (socket, acknowledge) => {
    const user = requireUser(socket, acknowledge);
    if (!user || user.role !== 'superadmin') {
      if (user) fail(acknowledge, 'Acción reservada para superadministradores.');
      return null;
    }
    return user;
  };
  const wallSummary = (wall, user) => ({
    id: wall.id,
    name: wall.name,
    description: wall.description,
    color: wall.color || 'amarillo',
    ownerId: wall.ownerId,
    role: wallRole(wall, user),
    notesCount: wall.notes.length,
    membersCount: Object.keys(wall.members).length,
    createdAt: wall.createdAt,
    updatedAt: wall.updatedAt
  });
  const wallMembers = (wall) => Object.entries(wall.members).map(([id, role]) => ({ ...publicUser(users.find((user) => user.id === id)), roleInWall: role })).filter((item) => item.id);
  const emitWallSummaryToMembers = (wall) => {
    for (const client of io.sockets.sockets.values()) {
      const member = users.find((item) => item.id === client.data.userId);
      if (member && wallRole(wall, member)) client.emit('wall:updated', wallSummary(wall, member));
    }
  };
  const emitWallDeletionToMembers = (wall) => {
    for (const client of io.sockets.sockets.values()) {
      if (client.data.userId && wall.members[client.data.userId]) client.emit('wall:deleted', wall.id);
    }
  };
  const invitationView = (invitation, user) => ({
    id: invitation.id, wallId: invitation.wallId, wallName: findWall(invitation.wallId)?.name || 'Muro',
    email: invitation.email, role: invitation.role, status: invitation.status,
    owner: invitation.invitedBy === user.id,
    code: invitation.invitedBy === user.id && invitation.status === 'pendiente' && invitation.expiresAt > Date.now() ? invitation.code : null,
    expiresAt: invitation.expiresAt, createdAt: invitation.createdAt
  });
  const reportView = (report, admin = false) => ({
    id: report.id, reason: report.reason, detail: report.detail, status: report.status,
    decision: report.decision || '', createdAt: report.createdAt, reviewedAt: report.reviewedAt || null,
    answeredAt: report.answeredAt || null,
    ...(admin ? {
      reporterId: report.reporterId,
      reporterName: users.find((item) => item.id === report.reporterId)?.name || 'Usuario',
      reportedUserId: report.reportedUserId || null,
      reportedUserName: users.find((item) => item.id === report.reportedUserId)?.name || 'Usuario no disponible',
      reportedUserEmail: users.find((item) => item.id === report.reportedUserId)?.email || ''
    } : {})
  });

  /** @param {string | { token?: string, refreshToken?: string, expiresAt?: number } | null} suppliedSession */
  function establishSession(socket, user, suppliedSession = null) {
    const session = typeof suppliedSession === 'string' ? { token: suppliedSession } : (suppliedSession || {});
    const token = session.token || crypto.randomUUID();
    if (socket.data.userId && socket.data.userId !== user.id) leaveCurrentWall(socket);
    sessions.set(token, user.id);
    socket.data.userId = user.id;
    socket.data.accessToken = token;
    socket.data.refreshToken = session.refreshToken || '';
    socket.data.expiresAt = Number(session.expiresAt || 0);
    return { token, refreshToken: session.refreshToken || '', expiresAt: socket.data.expiresAt, user: publicUser(user) };
  }

  async function refreshSocketSession(socket) {
    if (!storage.schemaReady || !socket.data.userId || !socket.data.refreshToken) return;
    if (socket.data.expiresAt && socket.data.expiresAt > Date.now() + 60_000) return;
    const previousToken = socket.data.accessToken;
    const previousRefreshToken = socket.data.refreshToken;
    const previousUserId = socket.data.userId;
    const previousEpoch = socket.data.authEpoch || 0;
    let refreshed;
    try { refreshed = await store.refreshSession(previousRefreshToken); }
    catch (error) {
      // Una renovación de la cuenta anterior no puede invalidar la cuenta nueva.
      if ((socket.data.authEpoch || 0) !== previousEpoch || socket.data.userId !== previousUserId || socket.data.refreshToken !== previousRefreshToken) return;
      throw error;
    }
    if ((socket.data.authEpoch || 0) !== previousEpoch || socket.data.userId !== previousUserId || socket.data.refreshToken !== previousRefreshToken) return;
    if (refreshed.user?.id !== previousUserId) throw new Error('auth_identity_mismatch');
    if (previousToken) sessions.delete(previousToken);
    sessions.set(refreshed.token, refreshed.user.id);
    socket.data.accessToken = refreshed.token;
    socket.data.refreshToken = refreshed.refreshToken;
    socket.data.expiresAt = refreshed.expiresAt;
    socket.emit('auth:token-refreshed', {
      userId: previousUserId,
      token: refreshed.token,
      refreshToken: refreshed.refreshToken,
      expiresAt: refreshed.expiresAt
    });
  }

  function connectedUserCount(wallId = null, excludedSocketId = '') {
    const userIds = new Set();
    for (const client of io.sockets.sockets.values()) {
      if (client.id === excludedSocketId || !client.data.userId) continue;
      if (wallId && client.data.wallId !== wallId) continue;
      userIds.add(client.data.userId);
    }
    return userIds.size;
  }

  function emitWallPresence(wallId, excludedSocketId = '') {
    if (wallId) io.to(`wall:${wallId}`).emit('users:count', connectedUserCount(wallId, excludedSocketId));
  }

  function leaveCurrentWall(socket) {
    const previousWallId = socket.data.wallId;
    if (previousWallId) socket.leave(`wall:${previousWallId}`);
    socket.data.wallId = null;
    emitWallPresence(previousWallId);
  }

  function joinWall(socket, wall) {
    leaveCurrentWall(socket);
    socket.data.wallId = wall.id;
    socket.join(`wall:${wall.id}`);
    emitWallPresence(wall.id);
  }

  function emitAdminSnapshot() {
    for (const socket of io.sockets.sockets.values()) {
      const user = findUser(socket);
      if (user?.role === 'superadmin') socket.emit('admin:changed');
    }
  }

  io.on('connection', (socket) => {
    socket.data.authEpoch = 0;
    socket.use(async (packet, next) => {
      try {
        await ready;
        if (!['auth:logout', 'auth:login', 'auth:restore'].includes(packet[0])) await refreshSocketSession(socket);
        next();
      } catch {
        socket.data.authEpoch += 1;
        leaveCurrentWall(socket);
        socket.data.userId = null;
        socket.data.accessToken = '';
        socket.data.refreshToken = '';
        socket.data.expiresAt = 0;
        socket.emit('auth:expired');
        next();
      }
    });
    socket.emit('auth:required');

    socket.on('auth:register', async (payload = {}, acknowledge = () => {}) => {
      const name = cleanText(payload.name, 40);
      const email = validEmail(payload.email);
      const password = String(payload.password ?? '');
      const passwordConfirmation = String(payload.passwordConfirmation ?? '');
      if (!name) return fail(acknowledge, 'Escribe tu nombre.');
      if (users.some((user) => user.name.toLocaleLowerCase() === name.toLocaleLowerCase())) return fail(acknowledge, 'Ese nombre de usuario ya está en uso.');
      if (!email) return fail(acknowledge, 'Escribe un correo válido.');
      if (password.length < 10 || password.length > 128) return fail(acknowledge, 'La contraseña debe tener entre 10 y 128 caracteres.');
      if (password !== passwordConfirmation) return fail(acknowledge, 'Las contraseñas deben coincidir.');
      if (users.some((user) => user.email === email)) return fail(acknowledge, 'Ese correo ya está registrado.');
      if (storage.schemaReady) {
        try {
          const result = await store.register({ name, email, password, redirectTo: process.env.APP_URL || (process.env.NODE_ENV === 'production' ? 'https://muro-colaborativo.onrender.com' : 'http://localhost:3000') });
          return acknowledge({ ok: true, ...result });
        } catch (error) {
          if (/confirmation_disabled/i.test(String(error?.message))) return fail(acknowledge, 'La confirmación por correo no está disponible. Inténtalo más tarde.');
          return fail(acknowledge, 'No se pudo crear la cuenta. Revisa los datos e inténtalo nuevamente.');
        }
      }
      const user = {
        id: crypto.randomUUID(),
        name,
        email,
        password,
        role: email === SUPERADMIN_EMAIL ? 'superadmin' : 'usuario',
        avatar: '',
        createdAt: Date.now(),
        settings: { theme: 'light', confirmDelete: true, compactNotes: false, notifications: true }
      };
      users.push(user);
      const general = walls[0];
      if (!general.ownerId) {
        general.ownerId = user.id;
        general.members[user.id] = 'propietario';
      } else {
        general.members[user.id] = 'editor';
      }
      return acknowledge({ ok: true, ...establishSession(socket, user) });
    });

    socket.on('auth:verify-code', async (payload = {}, acknowledge = () => {}) => {
      const email = validEmail(payload.email);
      const token = cleanText(payload.token, 16);
      if (!email || !/^\d{8}$/.test(token)) return fail(acknowledge, 'Ingresa los 8 dígitos del código.');
      if (!storage.schemaReady) return fail(acknowledge, 'La verificación por correo no está disponible en este entorno.');
      try {
        const verificationType = payload.type === 'recovery' ? 'recovery' : 'signup';
        const session = verificationType === 'recovery'
          ? await store.verifyRecovery({ email, token })
          : await store.verifySignup({ email, token });
        if (verificationType === 'recovery') {
          return acknowledge({ ok: true, token: session.token });
        }
        replaceState(await store.loadState());
        const user = users.find((item) => item.id === session.user.id) || session.user;
        return acknowledge({ ok: true, ...establishSession(socket, user, session) });
      } catch {
        return fail(acknowledge, 'El código es incorrecto, caducó o ya fue utilizado. Solicita uno nuevo.');
      }
    });

    socket.on('auth:resend-code', async (payload = {}, acknowledge = () => {}) => {
      const email = validEmail(payload.email);
      if (!email) return fail(acknowledge, 'No encontramos un registro pendiente.');
      if (!storage.schemaReady) return fail(acknowledge, 'El reenvío no está disponible en este entorno.');
      try {
        if (payload.type === 'recovery') {
          await store.recover(email, process.env.APP_URL || (process.env.NODE_ENV === 'production' ? 'https://muro-colaborativo.onrender.com' : 'http://localhost:3000'));
        } else {
          await store.resendSignup(email, process.env.APP_URL || (process.env.NODE_ENV === 'production' ? 'https://muro-colaborativo.onrender.com' : 'http://localhost:3000'));
        }
        return acknowledge({ ok: true });
      } catch (error) {
        const wait = String(error?.message || '').match(/(\d+)\s+seconds?/i);
        return fail(acknowledge, wait ? `Espera ${wait[1]} segundos antes de solicitar otro código.` : 'No se pudo reenviar el código. Espera un momento e inténtalo nuevamente.');
      }
    });

    socket.on('auth:login', async (payload = {}, acknowledge = () => {}) => {
      const authEpoch = ++socket.data.authEpoch;
      const email = validEmail(payload.email);
      if (storage.schemaReady) {
        try {
          const session = await store.login({ email, password: String(payload.password ?? '') });
          if (socket.data.authEpoch !== authEpoch) return fail(acknowledge, 'La solicitud fue cancelada.');
          const index = users.findIndex((item) => item.id === session.user.id);
          if (index >= 0) users[index] = session.user; else users.push(session.user);
          return acknowledge({ ok: true, ...establishSession(socket, session.user, session) });
        } catch (error) {
          const suspended = /banned|suspend/i.test(String(error?.message));
          return fail(acknowledge, suspended ? 'Tu cuenta está suspendida. Revisa el correo enviado por moderación.' : 'Correo o contraseña incorrectos.');
        }
      }
      const user = users.find((item) => item.email === email && item.password === String(payload.password ?? ''));
      if (socket.data.authEpoch !== authEpoch) return fail(acknowledge, 'La solicitud fue cancelada.');
      if (!user) return fail(acknowledge, 'Correo o contraseña incorrectos.');
      return acknowledge({ ok: true, ...establishSession(socket, user) });
    });

    socket.on('auth:restore', async (payload = {}, acknowledge = () => {}) => {
      const authEpoch = ++socket.data.authEpoch;
      const token = cleanText(payload.token, 4096);
      const refreshToken = cleanText(payload.refreshToken, 4096);
      if (!token && !refreshToken) {
        leaveCurrentWall(socket);
        socket.data.userId = null;
        socket.data.accessToken = '';
        socket.data.refreshToken = '';
        socket.data.expiresAt = 0;
        return fail(acknowledge, 'Inicia sesión para continuar.');
      }
      if (storage.schemaReady) {
        try {
          const session = await store.restore(token, refreshToken);
          if (socket.data.authEpoch !== authEpoch) return fail(acknowledge, 'La solicitud fue cancelada.');
          const index = users.findIndex((item) => item.id === session.user.id);
          if (index >= 0) users[index] = session.user; else users.push(session.user);
          return acknowledge({ ok: true, ...establishSession(socket, session.user, session) });
        } catch (error) {
          const suspended = /banned|suspend/i.test(String(error?.message));
          return fail(acknowledge, suspended ? 'Tu cuenta está suspendida. Revisa el correo enviado por moderación.' : 'Tu sesión expiró. Inicia sesión nuevamente.');
        }
      }
      const user = users.find((item) => item.id === sessions.get(token));
      if (socket.data.authEpoch !== authEpoch) return fail(acknowledge, 'La solicitud fue cancelada.');
      if (!user) return fail(acknowledge, 'La sesión expiró al reiniciarse el servidor.');
      socket.data.userId = user.id;
      socket.data.accessToken = token;
      return acknowledge({ ok: true, token, user: publicUser(user) });
    });

    socket.on('auth:logout', async (_payload = {}, acknowledge = () => {}) => {
      // Nunca aceptar un token provisto por el navegador para revocar a otro usuario.
      const token = socket.data.accessToken || '';
      const userId = socket.data.userId;
      ++socket.data.authEpoch;
      if (token) sessions.delete(token);
      // Revocar también sockets de otras pestañas que comparten ESTE JWT.
      // No tocar sockets de otras cuentas ni de otras sesiones.
      for (const client of io.sockets.sockets.values()) {
        if (client === socket || !token || client.data.accessToken !== token) continue;
        client.data.authEpoch = (client.data.authEpoch || 0) + 1;
        leaveCurrentWall(client);
        client.data.userId = null;
        client.data.accessToken = '';
        client.data.refreshToken = '';
        client.data.expiresAt = 0;
        client.emit('auth:expired');
      }
      leaveCurrentWall(socket);
      socket.data.userId = null;
      socket.data.accessToken = '';
      socket.data.refreshToken = '';
      socket.data.expiresAt = 0;
      if (storage.schemaReady && userId && token) {
        try { await store.logout(token); }
        catch { return fail(acknowledge, 'Se cerró la sesión local, pero no se confirmó su revocación.'); }
      }
      acknowledge({ ok: true });
    });

    socket.on('auth:recover', async (payload = {}, acknowledge = () => {}) => {
      const email = validEmail(payload.email);
      if (storage.schemaReady && email) {
        try { await store.recover(email, process.env.APP_URL || (process.env.NODE_ENV === 'production' ? 'https://muro-colaborativo.onrender.com' : 'http://localhost:3000')); } catch { /* respuesta uniforme para no filtrar cuentas */ }
      }
      acknowledge({ ok: true, message: 'Si la cuenta existe, se envió un código de 8 dígitos.' });
    });

    socket.on('auth:recovery-password', async (payload = {}, acknowledge = () => {}) => {
      const token = cleanText(payload.token, 4096);
      const password = String(payload.password ?? '');
      if (!token) return fail(acknowledge, 'Verifica primero el código enviado a tu correo.');
      if (password.length < 10 || password.length > 128) return fail(acknowledge, 'La nueva contraseña debe tener entre 10 y 128 caracteres.');
      if (!storage.schemaReady) return fail(acknowledge, 'La recuperación de contraseña no está disponible en este entorno.');
      try {
        await store.completeRecovery(token, password);
        return acknowledge({ ok: true });
      } catch {
        return fail(acknowledge, 'El código de recuperación caducó. Solicita uno nuevo.');
      }
    });

    socket.on('auth:password', async (payload = {}, acknowledge = () => {}) => {
      const user = requireUser(socket, acknowledge);
      if (!user) return;
      const next = String(payload.newPassword ?? '');
      if (next.length < 10 || next.length > 128) return fail(acknowledge, 'La nueva contraseña debe tener entre 10 y 128 caracteres.');
      if (storage.schemaReady) {
        try { await store.changePassword(user, String(payload.currentPassword ?? ''), next); }
        catch { return fail(acknowledge, 'La contraseña actual es incorrecta.'); }
        return acknowledge({ ok: true });
      }
      if (user.password !== String(payload.currentPassword ?? '')) return fail(acknowledge, 'La contraseña actual es incorrecta.');
      user.password = next;
      acknowledge({ ok: true });
    });

    socket.on('auth:email', async (payload = {}, acknowledge = () => {}) => {
      const user = requireUser(socket, acknowledge);
      if (!user) return;
      const email = validEmail(payload.email);
      if (!email) return fail(acknowledge, 'Escribe un correo válido.');
      if (email === user.email) return acknowledge({ ok: true, email });
      if (users.some((item) => item.id !== user.id && item.email === email)) return fail(acknowledge, 'Ese correo ya está registrado.');
      if (storage.schemaReady) {
        try { await store.changeEmail(user, String(payload.currentPassword ?? ''), email); }
        catch { return fail(acknowledge, 'No se pudo cambiar el correo. Revisa tu contraseña y vuelve a intentarlo.'); }
      } else {
        if (user.password !== String(payload.currentPassword ?? '')) return fail(acknowledge, 'La contraseña actual es incorrecta.');
      }
      user.email = email;
      acknowledge({ ok: true, email });
      emitAdminSnapshot();
    });

    socket.on('profile:update', async (payload = {}, acknowledge = () => {}) => {
      const user = requireUser(socket, acknowledge);
      if (!user) return;
      const name = cleanText(payload.name, 40);
      if (!name) return fail(acknowledge, 'El nombre no puede estar vacío.');
      if (users.some((item) => item.id !== user.id && item.name.toLocaleLowerCase() === name.toLocaleLowerCase())) return fail(acknowledge, 'Ese nombre de usuario ya está en uso.');
      const avatar = String(payload.avatar ?? '');
      if (avatar && (!avatar.startsWith('data:image/') || avatar.length > 250_000)) return fail(acknowledge, 'La imagen debe ser válida y menor de 180 KB.');
      user.name = name;
      user.avatar = avatar;
      if (storage.schemaReady) {
        try { await store.saveProfile(user, socket.data.accessToken); } catch { return fail(acknowledge, 'No se pudo actualizar el perfil. Inténtalo nuevamente.'); }
      }
      walls.forEach((wall) => {
        wall.notes.forEach((note) => {
          let changed = false;
          if (note.authorId === user.id && note.autor !== user.name) {
            note.autor = user.name;
            changed = true;
          }
          if (note.editorId === user.id && note.editor !== user.name) {
            note.editor = user.name;
            changed = true;
          }
          if (changed) io.to(`wall:${wall.id}`).emit('note:updated', { wallId: wall.id, note });
        });
      });
      acknowledge({ ok: true, user: publicUser(user) });
      io.emit('profile:changed', publicUser(user));
    });

    socket.on('settings:update', async (payload = {}, acknowledge = () => {}) => {
      const user = requireUser(socket, acknowledge);
      if (!user) return;
      const theme = THEMES.has(payload.theme) ? payload.theme : user.settings.theme;
      user.settings = {
        theme,
        confirmDelete: payload.confirmDelete === undefined ? user.settings.confirmDelete : Boolean(payload.confirmDelete),
        compactNotes: payload.compactNotes === undefined ? user.settings.compactNotes : Boolean(payload.compactNotes),
        notifications: payload.notifications === undefined ? user.settings.notifications : Boolean(payload.notifications)
      };
      if (storage.schemaReady) {
        try { await store.saveSettings(user, socket.data.accessToken); } catch { return fail(acknowledge, 'No se pudieron guardar las preferencias. Inténtalo nuevamente.'); }
      }
      acknowledge({ ok: true, settings: { ...user.settings } });
    });

    socket.on('auth:delete', async (payload = {}, acknowledge = () => {}) => {
      const user = requireUser(socket, acknowledge);
      if (!user) return;
      if (user.role === 'superadmin' && users.filter((item) => item.role === 'superadmin').length === 1) return fail(acknowledge, 'No puedes eliminar la única cuenta superadministradora.');
      if (storage.schemaReady) {
        try {
          await store.login({ email: user.email, password: String(payload.password ?? '') });
          await store.deleteUser(user.id);
        } catch { return fail(acknowledge, 'La contraseña no coincide.'); }
      } else if (user.password !== String(payload.password ?? '')) return fail(acknowledge, 'La contraseña no coincide.');
      const index = users.findIndex((item) => item.id === user.id);
      users.splice(index, 1);
      for (const [token, id] of sessions) if (id === user.id) sessions.delete(token);
      walls.forEach((wall) => delete wall.members[user.id]);
      socket.data.userId = null;
      acknowledge({ ok: true });
      emitAdminSnapshot();
    });

    socket.on('walls:list', (_payload = {}, acknowledge = () => {}) => {
      const user = requireUser(socket, acknowledge);
      if (!user) return;
      acknowledge({ ok: true, walls: walls.filter((wall) => wallRole(wall, user)).map((wall) => wallSummary(wall, user)) });
    });

    socket.on('wall:create', async (payload = {}, acknowledge = () => {}) => {
      const user = requireUser(socket, acknowledge);
      if (!user) return;
      const name = cleanText(payload.name, 60);
      if (!name) return fail(acknowledge, 'Escribe el nombre del muro.');
      const color = COLORS.has(payload.color) ? payload.color : 'amarillo';
      const wall = {
        id: crypto.randomUUID(),
        name,
        description: cleanText(payload.description, 160),
        color,
        ownerId: user.id,
        members: { [user.id]: 'propietario' },
        notes: [],
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      if (storage.schemaReady) {
        try {
          wall.id = await store.createWall(wall, socket.data.accessToken);
        } catch {
          return fail(acknowledge, 'No se pudo crear el muro. Inténtalo nuevamente.');
        }
      }
      walls.push(wall);
      acknowledge({ ok: true, wall: wallSummary(wall, user) });
      emitAdminSnapshot();
    });

    socket.on('wall:select', (payload = {}, acknowledge = () => {}) => {
      const user = requireUser(socket, acknowledge);
      const wall = findWall(payload.id);
      if (!user || !wall) return user && fail(acknowledge, 'El muro no existe.');
      if (!wallRole(wall, user)) return fail(acknowledge, 'No tienes acceso a este muro.');
      joinWall(socket, wall);
      acknowledge({ ok: true, wall: wallSummary(wall, user), notes: wall.notes, members: wallMembers(wall) });
    });

    socket.on('wall:leave', (_payload = {}, acknowledge = () => {}) => {
      leaveCurrentWall(socket);
      acknowledge({ ok: true });
    });

    socket.on('wall:update', async (payload = {}, acknowledge = () => {}) => {
      const user = requireUser(socket, acknowledge);
      const wall = findWall(payload.id);
      if (!user || !wall) return user && fail(acknowledge, 'El muro no existe.');
      if (!canOwn(wall, user)) return fail(acknowledge, 'Solo la persona propietaria puede editar el muro.');
      const name = cleanText(payload.name, 60);
      if (!name) return fail(acknowledge, 'El nombre no puede quedar vacío.');
      const color = payload.color === undefined ? (wall.color || 'amarillo') : payload.color;
      if (!COLORS.has(color)) return fail(acknowledge, 'Selecciona un color válido para el muro.');
      wall.name = name;
      wall.description = cleanText(payload.description, 160);
      wall.color = color;
      wall.updatedAt = Date.now();
      if (storage.schemaReady) {
        try { await store.updateWall(wall, socket.data.accessToken); } catch { return fail(acknowledge, 'No se pudo actualizar el muro. Inténtalo nuevamente.'); }
      }
      emitWallSummaryToMembers(wall);
      acknowledge({ ok: true, wall: wallSummary(wall, user) });
    });

    socket.on('wall:delete', async (payload = {}, acknowledge = () => {}) => {
      const user = requireUser(socket, acknowledge);
      const wall = findWall(payload.id);
      if (!user || !wall) return user && fail(acknowledge, 'El muro no existe.');
      if (!canOwn(wall, user)) return fail(acknowledge, 'Solo la persona propietaria puede eliminar el muro.');
      if (wall.id === 'general' || wall.id === GENERAL_WALL_ID) return fail(acknowledge, 'El muro general no se puede eliminar.');
      if (storage.schemaReady) {
        try { await store.deleteWall(wall.id, socket.data.accessToken); } catch { return fail(acknowledge, 'No se pudo eliminar el muro. Inténtalo nuevamente.'); }
      }
      emitWallDeletionToMembers(wall);
      walls.splice(walls.indexOf(wall), 1);
      acknowledge({ ok: true });
      emitAdminSnapshot();
    });

    socket.on('wall:invite', async (payload = {}, acknowledge = () => {}) => {
      const user = requireUser(socket, acknowledge);
      const wall = findWall(payload.wallId);
      if (!user || !wall) return user && fail(acknowledge, 'El muro no existe.');
      if (!canOwn(wall, user)) return fail(acknowledge, 'Solo la persona propietaria puede invitar miembros.');
      const role = MEMBER_ROLES.has(payload.role) && payload.role !== 'propietario' ? payload.role : 'editor';
      invitations.filter((item) => item.wallId === wall.id && item.status === 'pendiente').forEach((item) => { item.status = 'cancelada'; });
      const secrets = invitationSecrets();
      const invitation = { id: crypto.randomUUID(), wallId: wall.id, email: null, role, invitedBy: user.id, status: 'pendiente', createdAt: Date.now(), ...secrets };
      if (storage.schemaReady) {
        try {
          const saved = await store.createInvitation(invitation, socket.data.accessToken);
          invitation.id = saved.id;
        } catch { return fail(acknowledge, 'No se pudo crear la invitación.'); }
      }
      invitations.push(invitation);
      const link = `${process.env.APP_URL || (process.env.NODE_ENV === 'production' ? 'https://muro-colaborativo.onrender.com' : 'http://localhost:3000')}/?invitacion=${encodeURIComponent(secrets.token)}`;
      acknowledge({ ok: true, invitation: invitationView(invitation, user), code: secrets.code, link, members: wallMembers(wall) });
    });

    socket.on('invitations:list', async (_payload = {}, acknowledge = () => {}) => {
      const user = requireUser(socket, acknowledge); if (!user) return;
      if (storage.schemaReady) {
        try {
          const rows = await store.listInvitations(socket.data.accessToken);
          return acknowledge({ ok: true, invitations: rows.map((row) => ({ id: row.id, wallId: row.sala_id, wallName: row.sala_nombre, email: row.correo, role: row.rol, status: row.estado, owner: row.es_propietario, code: row.codigo || null, expiresAt: Date.parse(row.vence_en), createdAt: Date.parse(row.creado_en) })) });
        } catch { return fail(acknowledge, 'No se pudieron cargar las invitaciones.'); }
      }
      invitations.forEach((item) => { if (item.status === 'pendiente' && item.expiresAt <= Date.now()) item.status = 'vencida'; });
      acknowledge({ ok: true, invitations: invitations.filter((item) => item.invitedBy === user.id).map((item) => invitationView(item, user)) });
    });

    socket.on('invitation:answer', async (payload = {}, acknowledge = () => {}) => {
      const user = requireUser(socket, acknowledge); if (!user) return;
      const secret = normalizeInvitationSecret(payload.secret); const answer = 'aceptar';
      if (!secret) return fail(acknowledge, 'Escribe el código o abre el enlace de invitación.');
      const secretHash = sha256(secret);
      if (storage.schemaReady) {
        try {
          const result = await store.answerInvitation(secretHash, answer, socket.data.accessToken);
          replaceState(await store.loadState());
          return acknowledge({ ok: true, wallId: result.sala_id, wallName: result.sala_nombre, invitedBy: result.invitado_por_nombre, status: result.estado });
        } catch { return fail(acknowledge, 'Sala no encontrada.'); }
      }
      const invitation = invitations.find((item) => item.tokenHash === secretHash || item.codeHash === secretHash);
      if (!invitation || invitation.status !== 'pendiente' || invitation.expiresAt <= Date.now()) return fail(acknowledge, 'Sala no encontrada.');
      const wall = findWall(invitation.wallId); if (!wall || wall.members[user.id]) return fail(acknowledge, 'Sala no encontrada.');
      wall.members[user.id] = invitation.role;
      acknowledge({ ok: true, wallId: invitation.wallId, wallName: wall.name, invitedBy: users.find((item) => item.id === invitation.invitedBy)?.name || 'Propietario', status: 'aceptada' });
    });

    socket.on('invitation:preview', async (payload = {}, acknowledge = () => {}) => {
      const user = requireUser(socket, acknowledge); if (!user) return;
      const secret = normalizeInvitationSecret(payload.secret);
      if (!secret) return fail(acknowledge, 'Escribe el código de invitación.');
      const secretHash = sha256(secret);
      if (storage.schemaReady) {
        try {
          const result = await store.previewInvitation(secretHash, socket.data.accessToken);
          return acknowledge({ ok: true, invitation: { wallId: result.sala_id, wallName: result.sala_nombre, invitedBy: result.invitado_por_nombre, role: result.rol, expiresAt: Date.parse(result.vence_en) } });
        } catch { return fail(acknowledge, 'Sala no encontrada.'); }
      }
      const invitation = invitations.find((item) => item.tokenHash === secretHash || item.codeHash === secretHash);
      if (!invitation || invitation.status !== 'pendiente' || invitation.expiresAt <= Date.now()) return fail(acknowledge, 'Sala no encontrada.');
      acknowledge({ ok: true, invitation: { wallId: invitation.wallId, wallName: findWall(invitation.wallId)?.name || 'Muro', invitedBy: users.find((item) => item.id === invitation.invitedBy)?.name || 'Propietario', role: invitation.role, expiresAt: invitation.expiresAt } });
    });

    socket.on('invitation:cancel', async (payload = {}, acknowledge = () => {}) => {
      const user = requireUser(socket, acknowledge); if (!user) return;
      if (storage.schemaReady) {
        try { await store.cancelInvitation(payload.id, socket.data.accessToken); return acknowledge({ ok: true }); }
        catch { return fail(acknowledge, 'La invitación no se puede cancelar.'); }
      }
      const invitation = invitations.find((item) => item.id === payload.id && item.invitedBy === user.id && item.status === 'pendiente');
      if (!invitation) return fail(acknowledge, 'La invitación no se puede cancelar.'); invitation.status = 'cancelada'; acknowledge({ ok: true });
    });

    socket.on('invitation:resend', async (payload = {}, acknowledge = () => {}) => {
      const user = requireUser(socket, acknowledge); if (!user) return;
      const secrets = invitationSecrets();
      if (storage.schemaReady) {
        try {
          const saved = await store.resendInvitation({ id: payload.id, ...secrets }, socket.data.accessToken);
          return acknowledge({ ok: true, invitation: saved, code: secrets.code, link: `${process.env.APP_URL || (process.env.NODE_ENV === 'production' ? 'https://muro-colaborativo.onrender.com' : 'http://localhost:3000')}/?invitacion=${encodeURIComponent(secrets.token)}` });
        } catch { return fail(acknowledge, 'La invitación no se puede reenviar.'); }
      }
      const invitation = invitations.find((item) => item.id === payload.id && item.invitedBy === user.id && !['aceptada', 'cancelada'].includes(item.status));
      if (!invitation) return fail(acknowledge, 'La invitación no se puede reenviar.'); Object.assign(invitation, secrets, { status: 'pendiente' });
      acknowledge({ ok: true, invitation: invitationView(invitation, user), code: secrets.code, link: `${process.env.APP_URL || (process.env.NODE_ENV === 'production' ? 'https://muro-colaborativo.onrender.com' : 'http://localhost:3000')}/?invitacion=${encodeURIComponent(secrets.token)}` });
    });

    socket.on('wall:member:update', async (payload = {}, acknowledge = () => {}) => {
      const user = requireUser(socket, acknowledge);
      const wall = findWall(payload.wallId);
      if (!user || !wall) return user && fail(acknowledge, 'El muro no existe.');
      if (!canOwn(wall, user)) return fail(acknowledge, 'Solo la persona propietaria puede cambiar permisos.');
      if (payload.userId === wall.ownerId) return fail(acknowledge, 'No puedes cambiar el rol de la persona propietaria.');
      if (!['editor', 'lector'].includes(payload.role) || !wall.members[payload.userId]) return fail(acknowledge, 'Miembro o permiso no válido.');
      if (storage.schemaReady) {
        try { await store.updateMember(wall.id, payload.userId, payload.role, socket.data.accessToken); } catch { return fail(acknowledge, 'No se pudo guardar el permiso. Inténtalo nuevamente.'); }
      }
      wall.members[payload.userId] = payload.role;
      const members = wallMembers(wall);
      acknowledge({ ok: true, members });
      io.to(`wall:${wall.id}`).emit('members:changed', { wallId: wall.id, userId: payload.userId, role: payload.role, members });
    });

    socket.on('wall:member:remove', async (payload = {}, acknowledge = () => {}) => {
      const user = requireUser(socket, acknowledge);
      const wall = findWall(payload.wallId);
      if (!user || !wall) return user && fail(acknowledge, 'El muro no existe.');
      if (!canOwn(wall, user)) return fail(acknowledge, 'Solo la persona propietaria puede quitar miembros.');
      if (payload.userId === wall.ownerId) return fail(acknowledge, 'No puedes quitar a la persona propietaria.');
      if (storage.schemaReady) {
        try { await store.deleteMember(wall.id, payload.userId, socket.data.accessToken); } catch { return fail(acknowledge, 'No se pudo quitar al miembro. Inténtalo nuevamente.'); }
      }
      delete wall.members[payload.userId];
      const members = wallMembers(wall);
      acknowledge({ ok: true, members });
      io.to(`wall:${wall.id}`).emit('members:changed', { wallId: wall.id, userId: payload.userId, removed: true, members });
    });

    socket.on('note:create', async (payload = {}, acknowledge = () => {}) => {
      const user = requireUser(socket, acknowledge);
      const wall = findWall(socket.data.wallId);
      if (!user || !wall) return user && fail(acknowledge, 'Selecciona un muro.');
      if (!canEdit(wall, user)) return fail(acknowledge, 'Tu permiso es de solo lectura.');
      const texto = cleanText(payload.texto);
      if (!texto) return fail(acknowledge, 'La nota no puede estar vacía.');
      if (!COLORS.has(payload.color)) return fail(acknowledge, 'Selecciona un color válido.');
      const note = {
        id: crypto.randomUUID(),
        texto,
        color: payload.color,
        x: safeCoordinate(payload.x, 50 + Math.random() * 220),
        y: safeCoordinate(payload.y, 80 + Math.random() * 160),
        autor: user.name,
        authorId: user.id,
        updatedAt: Date.now()
      };
      if (storage.schemaReady) {
        try { await store.createNote(wall.id, note, socket.data.accessToken); } catch { return fail(acknowledge, 'No se pudo guardar la nota. Inténtalo nuevamente.'); }
      }
      wall.notes.push(note);
      wall.updatedAt = Date.now();
      io.to(`wall:${wall.id}`).emit('note:created', { wallId: wall.id, note });
      acknowledge({ ok: true, note });
    });

    socket.on('note:update', async (payload = {}, acknowledge = () => {}) => {
      const user = requireUser(socket, acknowledge);
      const wall = findWall(socket.data.wallId);
      if (!user || !wall) return user && fail(acknowledge, 'Selecciona un muro.');
      if (!canEdit(wall, user)) return fail(acknowledge, 'Tu permiso es de solo lectura.');
      const note = wall.notes.find((item) => item.id === cleanText(payload.id, 100));
      if (!note) return fail(acknowledge, 'La nota ya no existe.');
      const texto = cleanText(payload.texto);
      if (!texto) return fail(acknowledge, 'La nota no puede estar vacía.');
      if (payload.color !== undefined && !COLORS.has(payload.color)) return fail(acknowledge, 'El color no es válido.');
      const nextNote = {
        ...note,
        texto,
        color: payload.color || note.color,
        editor: user.name,
        editorId: user.id,
        updatedAt: Date.now()
      };
      if (storage.schemaReady) {
        try { await store.updateNote(wall.id, nextNote, socket.data.accessToken); } catch { return fail(acknowledge, 'No se pudo actualizar la nota. Inténtalo nuevamente.'); }
      }
      Object.assign(note, nextNote);
      io.to(`wall:${wall.id}`).emit('note:updated', { wallId: wall.id, note });
      acknowledge({ ok: true, note });
    });

    socket.on('note:move', async (payload = {}, acknowledge = () => {}) => {
      const user = requireUser(socket, acknowledge);
      const wall = findWall(socket.data.wallId);
      if (!user || !wall) return user && fail(acknowledge, 'Selecciona un muro.');
      if (!canEdit(wall, user)) return fail(acknowledge, 'Tu permiso es de solo lectura.');
      const note = wall.notes.find((item) => item.id === cleanText(payload.id, 100));
      if (!note) return fail(acknowledge, 'La nota ya no existe.');
      const nextNote = { ...note, x: safeCoordinate(payload.x, note.x), y: safeCoordinate(payload.y, note.y), updatedAt: Date.now() };
      if (storage.schemaReady) {
        try { await store.updateNote(wall.id, nextNote, socket.data.accessToken); } catch { return fail(acknowledge, 'No se pudo mover la nota. Inténtalo nuevamente.'); }
      }
      Object.assign(note, nextNote);
      io.to(`wall:${wall.id}`).emit('note:moved', { wallId: wall.id, id: note.id, x: note.x, y: note.y, updatedAt: note.updatedAt });
      acknowledge({ ok: true });
    });

    socket.on('note:preview-move', (payload = {}) => {
      const user = findUser(socket);
      const wall = findWall(socket.data.wallId);
      if (!user || !wall || !canEdit(wall, user)) return;
      const note = wall.notes.find((item) => item.id === cleanText(payload.id, 100));
      if (!note) return;
      socket.to(`wall:${wall.id}`).volatile.emit('note:preview-moved', {
        wallId: wall.id,
        id: note.id,
        x: safeCoordinate(payload.x, note.x),
        y: safeCoordinate(payload.y, note.y)
      });
    });

    socket.on('note:delete', async (payload = {}, acknowledge = () => {}) => {
      const user = requireUser(socket, acknowledge);
      const wall = findWall(socket.data.wallId);
      if (!user || !wall) return user && fail(acknowledge, 'Selecciona un muro.');
      if (!canEdit(wall, user)) return fail(acknowledge, 'Tu permiso es de solo lectura.');
      const id = cleanText(payload.id, 100);
      const index = wall.notes.findIndex((item) => item.id === id);
      if (index === -1) return fail(acknowledge, 'La nota ya no existe.');
      if (storage.schemaReady) {
        try { await store.deleteNote(id, socket.data.accessToken); } catch { return fail(acknowledge, 'No se pudo eliminar la nota. Inténtalo nuevamente.'); }
      }
      wall.notes.splice(index, 1);
      io.to(`wall:${wall.id}`).emit('note:deleted', { wallId: wall.id, id });
      acknowledge({ ok: true });
    });

    socket.on('report:create', async (payload = {}, acknowledge = () => {}) => {
      const user = requireUser(socket, acknowledge); if (!user) return;
      const reason = REPORT_REASONS.has(payload.reason) ? payload.reason : ''; const detail = cleanText(payload.detail, 1000);
      const wall = payload.wallId ? findWall(payload.wallId) : null;
      if (!reason || detail.length < 10) return fail(acknowledge, 'Describe el problema con al menos 10 caracteres.');
      if (payload.wallId && (!wall || !wallRole(wall, user))) return fail(acknowledge, 'No puedes reportar contenido de un muro al que no perteneces.');
      const report = { id: crypto.randomUUID(), reporterId: user.id, wallId: wall?.id || null, noteId: cleanText(payload.noteId, 100) || null, reason, detail, status: 'pendiente', decision: '', createdAt: Date.now() };
      if (storage.schemaReady) {
        try { const saved = await store.createReport(report, socket.data.accessToken); report.id = saved.id; report.createdAt = Date.parse(saved.creado_en); }
        catch { return fail(acknowledge, 'No se pudo registrar el reporte.'); }
      }
      reports.push(report);
      for (const peer of io.sockets.sockets.values()) if (findUser(peer)?.role === 'superadmin') peer.emit('report:received');
      acknowledge({ ok: true, report: reportView(report) }); emitAdminSnapshot();
    });

    socket.on('report:user:create', async (payload = {}, acknowledge = () => {}) => {
      const user = requireUser(socket, acknowledge); if (!user) return;
      const wall = findWall(payload.wallId || socket.data.wallId);
      const reportedUserId = cleanText(payload.userId, 100);
      const reason = REPORT_REASONS.has(payload.reason) && payload.reason !== 'fallo_aplicacion' ? payload.reason : '';
      const detail = cleanText(payload.detail, 1000);
      if (!wall || !wallRole(wall, user) || !wall.members[reportedUserId]) return fail(acknowledge, 'Solo puedes reportar a una persona que comparte este muro.');
      if (reportedUserId === user.id) return fail(acknowledge, 'No puedes reportar tu propia cuenta.');
      if (!reason || detail.length < 10) return fail(acknowledge, 'Describe lo ocurrido con al menos 10 caracteres.');
      const report = { id: crypto.randomUUID(), reporterId: user.id, reportedUserId, wallId: wall.id, noteId: null, reason, detail, status: 'pendiente', decision: '', createdAt: Date.now() };
      if (storage.schemaReady) {
        try { const saved = await store.reportUser(report, socket.data.accessToken); report.id = saved.id; report.createdAt = Date.parse(saved.creado_en); }
        catch { return fail(acknowledge, 'No se pudo registrar el reporte de usuario.'); }
      }
      reports.push(report);
      for (const peer of io.sockets.sockets.values()) if (findUser(peer)?.role === 'superadmin') peer.emit('report:received');
      acknowledge({ ok: true, report: reportView(report) }); emitAdminSnapshot();
    });

    socket.on('reports:list', async (_payload = {}, acknowledge = () => {}) => {
      const user = requireUser(socket, acknowledge); if (!user) return;
      if (storage.schemaReady) {
        try { const rows = await store.listOwnReports(socket.data.accessToken); return acknowledge({ ok: true, reports: rows.map((row) => ({ id: row.id, reason: row.motivo, detail: row.detalle, status: row.estado, decision: row.decision, createdAt: Date.parse(row.creado_en), reviewedAt: row.revisado_en ? Date.parse(row.revisado_en) : null, answeredAt: row.respondido_en ? Date.parse(row.respondido_en) : null })) }); }
        catch { return fail(acknowledge, 'No se pudieron cargar tus reportes.'); }
      }
      acknowledge({ ok: true, reports: reports.filter((item) => item.reporterId === user.id).map((item) => reportView(item)) });
    });

    socket.on('admin:reports:list', async (_payload = {}, acknowledge = () => {}) => {
      const admin = requireAdmin(socket, acknowledge); if (!admin) return;
      if (storage.schemaReady) {
        try { const rows = await store.listAdminReports(socket.data.accessToken); return acknowledge({ ok: true, reports: rows.map((row) => ({ id: row.id, reporterId: row.reportante_id, reporterName: row.reportante_nombre, reportedUserId: row.reportado_id, reportedUserName: row.reportado_nombre, reportedUserEmail: row.reportado_correo, reason: row.motivo, detail: row.detalle, status: row.estado, decision: row.decision, createdAt: Date.parse(row.creado_en), reviewedAt: row.revisado_en ? Date.parse(row.revisado_en) : null, answeredAt: row.respondido_en ? Date.parse(row.respondido_en) : null })) }); }
        catch { return fail(acknowledge, 'No se pudieron cargar los reportes.'); }
      }
      acknowledge({ ok: true, reports: reports.map((item) => reportView(item, true)) });
    });

    socket.on('admin:report:take', async (payload = {}, acknowledge = () => {}) => {
      const admin = requireAdmin(socket, acknowledge); if (!admin) return;
      if (storage.schemaReady) { try { await store.takeReport(payload.id, socket.data.accessToken); return acknowledge({ ok: true }); } catch { return fail(acknowledge, 'El reporte ya no está disponible.'); } }
      const report = reports.find((item) => item.id === payload.id && item.status === 'pendiente'); if (!report) return fail(acknowledge, 'El reporte ya no está disponible.');
      Object.assign(report, { status: 'en_revision', reviewerId: admin.id, reviewedAt: Date.now() }); acknowledge({ ok: true });
    });

    socket.on('admin:report:respond', async (payload = {}, acknowledge = () => {}) => {
      const admin = requireAdmin(socket, acknowledge); if (!admin) return;
      const status = ['resuelto', 'rechazado'].includes(payload.status) ? payload.status : ''; const decision = cleanText(payload.decision, 1000);
      if (!status || decision.length < 3) return fail(acknowledge, 'Escribe una respuesta válida.');
      if (storage.schemaReady) {
        try { const reporterId = await store.answerReport(payload.id, status, decision, socket.data.accessToken); for (const peer of io.sockets.sockets.values()) if (findUser(peer)?.id === reporterId) peer.emit('report:answered'); acknowledge({ ok: true }); emitAdminSnapshot(); return; }
        catch { return fail(acknowledge, 'No se pudo responder el reporte.'); }
      }
      const report = reports.find((item) => item.id === payload.id && ['pendiente', 'en_revision'].includes(item.status)); if (!report) return fail(acknowledge, 'El reporte ya no está disponible.');
      Object.assign(report, { status, decision, reviewerId: admin.id, reviewedAt: report.reviewedAt || Date.now(), answeredAt: Date.now() });
      for (const peer of io.sockets.sockets.values()) if (findUser(peer)?.id === report.reporterId) peer.emit('report:answered');
      acknowledge({ ok: true }); emitAdminSnapshot();
    });

    socket.on('admin:clear', async (payload = {}, acknowledge = () => {}) => {
      const user = requireAdmin(socket, acknowledge);
      const wall = findWall(payload.wallId || socket.data.wallId);
      if (!user || !wall) return user && fail(acknowledge, 'El muro no existe.');
      const removed = wall.notes.length;
      if (storage.schemaReady) {
        try { await store.clearNotes(wall.id); } catch { return fail(acknowledge, 'No se pudieron eliminar las notas. Inténtalo nuevamente.'); }
      }
      wall.notes.splice(0, wall.notes.length);
      io.to(`wall:${wall.id}`).emit('board:cleared', { wallId: wall.id, removed, clearedAt: Date.now() });
      acknowledge({ ok: true, removed });
    });

    socket.on('admin:snapshot', async (_payload = {}, acknowledge = () => {}) => {
      const user = requireAdmin(socket, acknowledge);
      if (!user) return;
      if (storage.schemaReady) {
        try {
          const [summaryResult, adminUsers] = await Promise.all([
            store.userClient(socket.data.accessToken).rpc('muro_resumen_administrativo'),
            store.listAdminUsers()
          ]);
          if (summaryResult.error) return fail(acknowledge, 'No se pudo cargar el resumen administrativo.');
          acknowledge({ ok: true, users: adminUsers, totals: summaryResult.data, connected: connectedUserCount() });
        } catch { return fail(acknowledge, 'No se pudo cargar el directorio de usuarios.'); }
      } else acknowledge({ ok: true, users: users.map(publicUser), walls: walls.map((wall) => ({ ...wallSummary(wall, user), members: wallMembers(wall) })), totals: { usuarios: users.length, salas: walls.length, notas: walls.reduce((sum, wall) => sum + wall.notes.length, 0), reportes_pendientes: reports.filter((item) => ['pendiente', 'en_revision'].includes(item.status)).length }, connected: connectedUserCount() });
    });

    socket.on('admin:user:discipline', async (payload = {}, acknowledge = () => {}) => {
      const admin = requireAdmin(socket, acknowledge); if (!admin) return;
      const userId = cleanText(payload.userId, 100);
      const action = DISCIPLINE_ACTIONS.has(payload.action) ? payload.action : '';
      const message = cleanText(payload.message, 1000);
      const target = users.find((item) => item.id === userId);
      if (!target || !action || message.length < 3) return fail(acknowledge, 'Selecciona una medida y escribe el mensaje para el usuario.');
      if (target.id === admin.id || target.role === 'superadmin') return fail(acknowledge, 'No se puede sancionar la cuenta superadministradora.');
      try {
        let notificationWarning = '';
        if (storage.schemaReady) await store.disciplineUser({ userId, reportId: cleanText(payload.reportId, 100) || null, action, message, adminId: admin.id });
        if (storage.schemaReady) {
          try {
            await sendModerationEmail(socket.data.accessToken, { email: target.email, name: target.name, action, message });
          } catch {
            notificationWarning = 'La medida se aplicó, pero no se pudo enviar el correo de notificación.';
          }
        }
        if (action === 'eliminar') {
          const index = users.findIndex((item) => item.id === userId);
          if (index >= 0) users.splice(index, 1);
          walls.forEach((wall) => delete wall.members[userId]);
        }
        if (['suspender_24h', 'suspender_7d', 'eliminar'].includes(action)) {
          for (const [token, id] of sessions) if (id === userId) sessions.delete(token);
          for (const peer of io.sockets.sockets.values()) {
            if (peer.data.userId === userId) {
              peer.emit('account:moderated', { action, message });
              peer.disconnect(true);
            }
          }
        } else {
          for (const peer of io.sockets.sockets.values()) if (peer.data.userId === userId) peer.emit('account:moderated', { action, message });
        }
        acknowledge({ ok: true, notificationWarning }); emitAdminSnapshot();
      } catch { return fail(acknowledge, 'No se pudo aplicar la medida a la cuenta.'); }
    });

    socket.on('admin:user:role', async (payload = {}, acknowledge = () => {}) => {
      const admin = requireAdmin(socket, acknowledge);
      if (!admin) return;
      const target = users.find((user) => user.id === payload.userId);
      if (!target || !['usuario', 'superadmin'].includes(payload.role)) return fail(acknowledge, 'Usuario o rol no válido.');
      if (target.email === SUPERADMIN_EMAIL && payload.role !== 'superadmin') return fail(acknowledge, 'La cuenta propietaria debe conservar el rol superadmin.');
      if (target.email !== SUPERADMIN_EMAIL && payload.role === 'superadmin') return fail(acknowledge, 'El rol superadmin está reservado a la cuenta propietaria.');
      target.role = payload.role;
      if (storage.schemaReady) {
        try { await store.saveRole(target); } catch { return fail(acknowledge, 'No se pudo guardar el rol. Inténtalo nuevamente.'); }
      }
      acknowledge({ ok: true, user: publicUser(target) });
      io.emit('role:changed', publicUser(target));
      emitAdminSnapshot();
    });

    socket.on('disconnect', () => emitWallPresence(socket.data.wallId, socket.id));
  });

  return { app, httpServer, io, users, sessions, walls, invitations, reports, ready, storage };
}

if (require.main === module) {
  const { httpServer } = createMuroServer();
  const port = Number(process.env.PORT) || DEFAULT_PORT;
  httpServer.listen(port, () => console.log(`Muro disponible en http://localhost:${port}`));
}

module.exports = { COLORS, cleanText, createMuroServer, invitationSecrets, safeCoordinate, sha256, validEmail };
