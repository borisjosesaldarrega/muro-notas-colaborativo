'use strict';

(function installSupabaseSocketAdapter() {
  const dateValue = (value) => value ? Date.parse(value) : Date.now();
  const noteValue = (row) => ({ id: row.id, titulo: row.titulo, texto: row.contenido, color: row.color, x: Number(row.posicion_x), y: Number(row.posicion_y), autor: row.nombre_autor, authorId: row.autor_id, updatedAt: dateValue(row.actualizado_en) });
  const settingsValue = (row = {}) => ({ theme: row.tema || 'light', confirmDelete: row.confirmar_eliminacion ?? true, compactNotes: row.notas_compactas ?? false, notifications: row.notificaciones ?? true });
  const profileValue = (row, settings) => ({ id: row.id, name: row.nombre, email: row.correo, role: row.rol, avatar: row.avatar || '', createdAt: dateValue(row.creado_en), settings: settingsValue(settings) });
  const rawError = (error) => String(error?.message || error || 'No se pudo completar la operación.').replace(/^.*?:\s*/, '');
  const publicError = (error, event) => {
    const message = rawError(error);
    const code = String(error?.code || '');
    const wait = message.match(/only request this after\s+(\d+)\s+seconds?/i);
    if (wait) return `Espera ${wait[1]} segundos antes de volver a solicitar el correo.`;
    if (/email rate limit exceeded/i.test(message)) return 'Se alcanzó temporalmente el límite de correos. Espera unos minutos y vuelve a intentarlo.';
    if (/user already registered/i.test(message)) return 'Ese correo ya está registrado. Inicia sesión o recupera tu contraseña.';
    if (/invalid login credentials/i.test(message)) return 'Correo o contraseña incorrectos.';
    if (/password should|weak password/i.test(message)) return 'La contraseña no cumple los requisitos de seguridad.';
    if (/email not confirmed/i.test(message)) return 'Confirma tu correo antes de iniciar sesión.';
    if (/debes iniciar sesión|sesión expiró|se requiere una sesion|jwt/i.test(message) || code === 'PGRST301' || code === '28000') return 'Tu sesión no es válida. Inicia sesión nuevamente.';
    if (event === 'wall:create' && (code === '22023' || code === '23514')) return 'Revisa el nombre y la descripción del muro.';

    const expected = [
      /^La contraseña (actual )?no es correcta\.$/,
      /^No eres miembro de este muro\.$/,
      /^No se pudo sincronizar el muro en tiempo real\.$/,
      /^La sincronización respondió (CHANNEL_ERROR|TIMED_OUT)\.$/,
      /^El superadmin no puede borrar notas de muros ajenos\.$/,
      /^Operación no disponible:/
    ];
    if (expected.some((pattern) => pattern.test(message))) return message;

    const fallback = {
      'wall:create': 'No se pudo crear el muro. Inténtalo de nuevo.',
      'wall:update': 'No se pudo actualizar el muro.',
      'wall:delete': 'No se pudo eliminar el muro.',
      'wall:invite': 'No se pudo completar la invitación.',
      'note:create': 'No se pudo crear la nota.',
      'note:update': 'No se pudo actualizar la nota.',
      'note:move': 'No se pudo mover la nota.',
      'note:delete': 'No se pudo eliminar la nota.'
    };
    if (fallback[event]) return fallback[event];
    if (event?.startsWith('auth:')) return 'No se pudo completar la operación de acceso.';
    return 'No se pudo completar la operación. Inténtalo de nuevo.';
  };

  class SupabaseSocketAdapter {
    constructor() {
      this.handlers = new Map(); this.connected = false; this.client = null; this.currentWallId = null; this.online = 1; this.realtimeChannel = null;
      this.io = { on: (event, handler) => this.on(`io:${event}`, handler) };
      this.initialize();
    }
    on(event, handler) { if (!this.handlers.has(event)) this.handlers.set(event, new Set()); this.handlers.get(event).add(handler); return this; }
    trigger(event, value) { for (const handler of this.handlers.get(event) || []) handler(value); }
    async emit(event, payload = {}, acknowledge = () => {}) {
      try { acknowledge(await this.dispatch(event, payload || {})); }
      catch (error) {
        acknowledge({ ok: false, error: publicError(error, event) });
      }
    }
    async initialize() {
      this.client = await window.muroSupabaseReady;
      if (!this.client) { this.trigger('disconnect'); return; }
      this.connected = true; this.trigger('connect');
      this.client.auth.onAuthStateChange(() => this.trigger('admin:changed'));
    }
    async installRealtime(wallId) {
      if (this.realtimeChannel) await this.client.removeChannel(this.realtimeChannel);
      await this.identity();
      const channel = this.client.channel(`cambios-sala:${wallId}:${crypto.randomUUID()}`);
      this.realtimeChannel = channel;
      const filter = `sala_id=eq.${wallId}`;
      channel
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'muro_notas', filter }, ({ new: row }) => this.trigger('note:created', { wallId: row.sala_id, note: noteValue(row) }))
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'muro_notas', filter }, ({ new: row }) => this.trigger('note:updated', { wallId: row.sala_id, note: noteValue(row) }))
        .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'muro_notas', filter }, ({ old: row }) => this.trigger('note:deleted', { wallId: row.sala_id, id: row.id }))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'muro_sala_miembros', filter }, () => this.trigger('members:changed', { wallId }));
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('No se pudo sincronizar el muro en tiempo real.')), 12_000);
        channel.subscribe((status) => {
          if (status === 'SUBSCRIBED') { clearTimeout(timer); resolve(undefined); }
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') { clearTimeout(timer); reject(new Error(`La sincronización respondió ${status}.`)); }
        });
      });
    }
    async session() { const { data, error } = await this.client.auth.getSession(); if (error) throw error; return data.session; }
    async identity() { const session = await this.session(); if (!session?.user) throw new Error('Debes iniciar sesión.'); return { session, user: session.user }; }
    async userProfile(id) {
      const [{ data: profile, error: profileError }, { data: settings, error: settingsError }] = await Promise.all([
        this.client.from('muro_usuarios').select('*').eq('id', id).single(),
        this.client.from('muro_configuraciones_usuario').select('*').eq('usuario_id', id).single()
      ]);
      if (profileError) throw profileError; if (settingsError) throw settingsError; return profileValue(profile, settings);
    }
    async wallMembers(wallId) {
      const { data: rows, error } = await this.client.from('muro_sala_miembros').select('usuario_id,rol').eq('sala_id', wallId); if (error) throw error;
      const ids = (rows || []).map((row) => row.usuario_id); if (!ids.length) return [];
      const { data: profiles, error: profilesError } = await this.client.from('muro_usuarios').select('id,nombre,correo,rol,avatar,creado_en').in('id', ids); if (profilesError) throw profilesError;
      const byId = new Map((profiles || []).map((profile) => [profile.id, profile]));
      return rows.map((row) => ({ ...profileValue(byId.get(row.usuario_id), {}), roleInWall: row.rol }));
    }
    async selectWall(id) {
      const [{ data: wall, error: wallError }, { data: role, error: roleError }, { data: notes, error: notesError }, members] = await Promise.all([
        this.client.from('muro_salas').select('*').eq('id', id).single(), this.client.rpc('muro_rol_en_sala', { sala_objetivo: id }),
        this.client.from('muro_notas').select('*').eq('sala_id', id).order('creado_en'), this.wallMembers(id)
      ]);
      if (wallError) throw wallError; if (roleError) throw roleError; if (notesError) throw notesError; if (!role) throw new Error('No eres miembro de este muro.');
      this.currentWallId = id; await this.installRealtime(id);
      return { wall: { id: wall.id, name: wall.nombre, description: wall.descripcion, ownerId: wall.propietario_id, role }, members, notes: (notes || []).map(noteValue) };
    }
    async dispatch(event, payload) {
      switch (event) {
        case 'auth:register': {
          const { data, error } = await this.client.auth.signUp({ email: payload.email.trim().toLowerCase(), password: payload.password, options: { data: { name: payload.name.trim() }, emailRedirectTo: location.origin } }); if (error) throw error;
          if (!data.session) return { ok: true, requiresConfirmation: true };
          return { ok: true, token: data.session.access_token, user: await this.userProfile(data.user.id) };
        }
        case 'auth:login': { const { data, error } = await this.client.auth.signInWithPassword({ email: payload.email.trim().toLowerCase(), password: payload.password }); if (error) throw error; return { ok: true, token: data.session.access_token, user: await this.userProfile(data.user.id) }; }
        case 'auth:restore': { const session = await this.session(); if (!session) return { ok: false, error: 'La sesión expiró.' }; return { ok: true, token: session.access_token, user: await this.userProfile(session.user.id) }; }
        case 'auth:logout': { if (this.realtimeChannel) await this.client.removeChannel(this.realtimeChannel); this.realtimeChannel = null; const { error } = await this.client.auth.signOut(); if (error) throw error; return { ok: true }; }
        case 'auth:recover': { const { error } = await this.client.auth.resetPasswordForEmail(payload.email.trim().toLowerCase(), { redirectTo: location.origin }); if (error) throw error; return { ok: true }; }
        case 'auth:verify-code': {
          const type = payload.type === 'signup' ? 'signup' : 'recovery'; const { data, error } = await this.client.auth.verifyOtp({ email: payload.email.trim().toLowerCase(), token: payload.token.trim(), type }); if (error) throw error;
          if (type === 'recovery') return { ok: true, token: data.session?.access_token || '' };
          return { ok: true, token: data.session.access_token, user: await this.userProfile(data.user.id) };
        }
        case 'auth:resend-code': {
          const email = payload.email.trim().toLowerCase();
          if (payload.type === 'signup') { const { error } = await this.client.auth.resend({ type: 'signup', email, options: { emailRedirectTo: location.origin } }); if (error) throw error; }
          else { const { error } = await this.client.auth.resetPasswordForEmail(email, { redirectTo: location.origin }); if (error) throw error; }
          return { ok: true };
        }
        case 'auth:recovery-password': { const { error } = await this.client.auth.updateUser({ password: payload.password }); if (error) throw error; return { ok: true }; }
        case 'auth:password': { const { user } = await this.identity(); const { error: loginError } = await this.client.auth.signInWithPassword({ email: user.email, password: payload.currentPassword }); if (loginError) throw new Error('La contraseña actual no es correcta.'); const { error } = await this.client.auth.updateUser({ password: payload.newPassword }); if (error) throw error; return { ok: true }; }
        case 'auth:delete': { const { user } = await this.identity(); const { error: loginError } = await this.client.auth.signInWithPassword({ email: user.email, password: payload.password }); if (loginError) throw new Error('La contraseña no es correcta.'); const { error } = await this.client.rpc('muro_eliminar_cuenta_propia'); if (error) throw error; await this.client.auth.signOut(); return { ok: true }; }
        case 'walls:list': {
          const { user } = await this.identity();
          const [{ data: walls, error: wallsError }, { data: memberships, error: membersError }, { data: notes, error: notesError }] = await Promise.all([
            this.client.from('muro_salas').select('*').order('actualizado_en', { ascending: false }), this.client.from('muro_sala_miembros').select('sala_id,usuario_id,rol'), this.client.from('muro_notas').select('id,sala_id')
          ]);
          if (wallsError) throw wallsError; if (membersError) throw membersError; if (notesError) throw notesError;
          return { ok: true, walls: (walls || []).map((wall) => ({ id: wall.id, name: wall.nombre, description: wall.descripcion, ownerId: wall.propietario_id, role: memberships.find((item) => item.sala_id === wall.id && item.usuario_id === user.id)?.rol, notesCount: notes.filter((note) => note.sala_id === wall.id).length, membersCount: memberships.filter((member) => member.sala_id === wall.id).length })) };
        }
        case 'wall:select': { const result = await this.selectWall(payload.id); return { ok: true, ...result }; }
        case 'wall:create': { await this.identity(); const { data: id, error } = await this.client.rpc('muro_crear_sala', { nombre_nuevo: payload.name.trim(), descripcion_nueva: payload.description?.trim() || '' }); if (error) throw error; return { ok: true, id }; }
        case 'wall:update': { const { error } = await this.client.from('muro_salas').update({ nombre: payload.name.trim(), descripcion: payload.description?.trim() || '', actualizado_en: new Date().toISOString() }).eq('id', payload.id); if (error) throw error; return { ok: true }; }
        case 'wall:delete': { const { error } = await this.client.from('muro_salas').delete().eq('id', payload.id); if (error) throw error; this.trigger('wall:deleted', payload.id); return { ok: true }; }
        case 'wall:invite': { const { session } = await this.identity(); const response = await fetch('/.netlify/functions/invite-member', { method: 'POST', headers: { authorization: `Bearer ${session.access_token}`, 'content-type': 'application/json' }, body: JSON.stringify({ wallId: payload.wallId, email: payload.email.trim().toLowerCase(), role: payload.role }) }); const result = await response.json(); if (!response.ok) throw new Error(result.error || 'No se pudo enviar la invitación.'); return { ok: true, members: (await this.selectWall(payload.wallId)).members }; }
        case 'wall:member:update': { const { error } = await this.client.from('muro_sala_miembros').update({ rol: payload.role }).eq('sala_id', payload.wallId).eq('usuario_id', payload.userId); if (error) throw error; return { ok: true, members: (await this.selectWall(payload.wallId)).members }; }
        case 'wall:member:remove': { const { error } = await this.client.from('muro_sala_miembros').delete().eq('sala_id', payload.wallId).eq('usuario_id', payload.userId); if (error) throw error; return { ok: true, members: (await this.selectWall(payload.wallId)).members }; }
        case 'note:create': { const { user } = await this.identity(); const profile = await this.userProfile(user.id); const row = { id: crypto.randomUUID(), sala_id: this.currentWallId, titulo: String(payload.titulo || payload.texto).trim().slice(0, 80), contenido: payload.texto.trim(), color: payload.color, posicion_x: payload.x, posicion_y: payload.y, autor_id: user.id, nombre_autor: profile.name }; const { data, error } = await this.client.from('muro_notas').insert(row).select().single(); if (error) throw error; this.trigger('note:created', { wallId: this.currentWallId, note: noteValue(data) }); return { ok: true }; }
        case 'note:update': { const { data, error } = await this.client.from('muro_notas').update({ contenido: payload.texto.trim(), color: payload.color, actualizado_en: new Date().toISOString() }).eq('id', payload.id).select().single(); if (error) throw error; this.trigger('note:updated', { wallId: data.sala_id, note: noteValue(data) }); return { ok: true }; }
        case 'note:preview-move': { const { error } = await this.client.from('muro_notas').update({ posicion_x: payload.x, posicion_y: payload.y }).eq('id', payload.id).eq('sala_id', this.currentWallId); if (error) throw error; return { ok: true }; }
        case 'note:move': { const { data, error } = await this.client.from('muro_notas').update({ posicion_x: payload.x, posicion_y: payload.y, actualizado_en: new Date().toISOString() }).eq('id', payload.id).select().single(); if (error) throw error; this.trigger('note:moved', { wallId: data.sala_id, id: data.id, x: Number(data.posicion_x), y: Number(data.posicion_y), updatedAt: dateValue(data.actualizado_en) }); return { ok: true }; }
        case 'note:delete': { const { data, error } = await this.client.from('muro_notas').delete().eq('id', payload.id).select('id,sala_id').single(); if (error) throw error; this.trigger('note:deleted', { wallId: data.sala_id, id: data.id }); return { ok: true }; }
        case 'profile:update': { const { user } = await this.identity(); const { error } = await this.client.from('muro_usuarios').update({ nombre: payload.name.trim(), avatar: payload.avatar || '', actualizado_en: new Date().toISOString() }).eq('id', user.id); if (error) throw error; const profile = await this.userProfile(user.id); this.trigger('profile:changed', profile); return { ok: true, user: profile }; }
        case 'settings:update': { const { user } = await this.identity(); const row = { tema: payload.theme, confirmar_eliminacion: payload.confirmDelete, notas_compactas: payload.compactNotes, notificaciones: payload.notifications, actualizado_en: new Date().toISOString() }; const { data, error } = await this.client.from('muro_configuraciones_usuario').update(row).eq('usuario_id', user.id).select().single(); if (error) throw error; return { ok: true, settings: settingsValue(data) }; }
        case 'admin:snapshot': {
          const { data, error } = await this.client.rpc('muro_resumen_administrativo'); if (error) throw error;
          return { ok: true, totals: data, connected: this.online };
        }
        case 'admin:clear': throw new Error('El superadmin no puede borrar notas de muros ajenos.');
        default: throw new Error(`Operación no disponible: ${event}`);
      }
    }
  }

  window.io = () => new SupabaseSocketAdapter();
})();
