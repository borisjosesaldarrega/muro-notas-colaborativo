'use strict';

const assert = require('node:assert/strict');
const { after, before, test } = require('node:test');
const { io: Client } = require('socket.io-client');
const { createMuroServer } = require('../server');

let server;
let baseUrl;
const clients = [];

function ack(socket, event, payload = {}) {
  return new Promise((resolve) => socket.emit(event, payload, resolve));
}

function once(socket, event) {
  return new Promise((resolve) => socket.once(event, resolve));
}

async function connect() {
  const socket = Client(baseUrl, { transports: ['websocket'], forceNew: true });
  clients.push(socket);
  if (!socket.connected) await once(socket, 'connect');
  return socket;
}

before(async () => {
  server = createMuroServer({ persistence: false, env: {} });
  await new Promise((resolve) => server.httpServer.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.httpServer.address().port}`;
});

after(async () => {
  clients.forEach((client) => client.close());
  await new Promise((resolve) => server.io.close(resolve));
  await new Promise((resolve) => server.httpServer.close(resolve));
});

test('sirve la aplicación y un estado de salud', async () => {
  const pageResponse = await fetch(baseUrl);
  const page = await pageResponse.text();
  const health = await fetch(`${baseUrl}/api/health`).then((response) => response.json());
  assert.match(page, /Muro/);
  assert.equal(pageResponse.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(pageResponse.headers.get('x-frame-options'), 'DENY');
  assert.match(pageResponse.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal(health.ok, true);
  assert.equal(health.notes, 1);
  assert.equal(health.walls, 1);
  assert.equal(health.users, 0);
  assert.equal(health.storage.mode, 'memory');
});

test('registra, restaura y valida cuentas y roles en el servidor', async () => {
  const admin = await connect();
  const member = await connect();
  const first = await ack(admin, 'auth:register', { name: 'Boris Admin', email: 'saldavargasboris@gmail.com', password: 'clave12345', passwordConfirmation: 'clave12345' });
  const second = await ack(member, 'auth:register', { name: 'Brenda Editora', email: 'brenda@example.com', password: 'clave45678', passwordConfirmation: 'clave45678' });
  assert.equal(first.ok, true);
  assert.equal(first.user.role, 'superadmin');
  assert.equal(second.user.role, 'usuario');
  assert.equal(second.user.password, undefined);
  assert.equal((await ack(await connect(), 'auth:register', { name: 'Error', email: 'error@example.com', password: 'clave78901', passwordConfirmation: 'otra789012' })).ok, false);
  assert.equal((await ack(member, 'auth:login', { email: 'brenda@example.com', password: 'mal' })).ok, false);

  const restored = await connect();
  const restore = await ack(restored, 'auth:restore', { token: first.token });
  assert.equal(restore.ok, true);
  assert.equal(restore.user.id, first.user.id);
  assert.equal((await ack(restored, 'auth:logout', { token: first.token })).ok, true);
  assert.equal((await ack(await connect(), 'auth:restore', { token: first.token })).ok, false);
  // La misma credencial se revoco para todas las conexiones que la compartian.
  assert.equal((await ack(admin, 'walls:list')).ok, false);
  // La cuenta de otra persona debe conservar su sesion independiente.
  assert.equal((await ack(member, 'walls:list')).ok, true);
  // Para las pruebas siguientes, el administrador inicia una sesion nueva.
  const adminLoginNuevo = await ack(admin, 'auth:login', { email: 'saldavargasboris@gmail.com', password: 'clave12345' });
  assert.equal(adminLoginNuevo.ok, true);
});

test('actualiza el correo solo después de verificar la contraseña actual', async () => {
  const socket = await connect();
  const registered = await ack(socket, 'auth:register', {
    name: 'Cuenta Configuración',
    email: 'configuracion@example.com',
    password: 'clave78901',
    passwordConfirmation: 'clave78901'
  });
  assert.equal(registered.ok, true);

  const rejected = await ack(socket, 'auth:email', { email: 'nuevo@example.com', currentPassword: 'incorrecta' });
  assert.equal(rejected.ok, false);

  const changed = await ack(socket, 'auth:email', { email: 'nuevo@example.com', currentPassword: 'clave78901' });
  assert.deepEqual(changed, { ok: true, email: 'nuevo@example.com' });

  const login = await ack(await connect(), 'auth:login', { email: 'nuevo@example.com', password: 'clave78901' });
  assert.equal(login.ok, true);
  assert.equal(login.user.email, 'nuevo@example.com');

  const password = await ack(socket, 'auth:password', { currentPassword: 'clave78901', newPassword: 'clave-mas-segura-10' });
  assert.equal(password.ok, true);
  assert.equal((await ack(await connect(), 'auth:login', { email: 'nuevo@example.com', password: 'clave78901' })).ok, false);
  assert.equal((await ack(await connect(), 'auth:login', { email: 'nuevo@example.com', password: 'clave-mas-segura-10' })).ok, true);
});

test('reserva un nombre de usuario único sin distinguir mayúsculas', async () => {
  const firstSocket = await connect();
  const secondSocket = await connect();
  const first = await ack(firstSocket, 'auth:register', { name: 'NombreUnico', email: 'nombre1@example.com', password: 'clave-segura-10', passwordConfirmation: 'clave-segura-10' });
  assert.equal(first.ok, true);
  const duplicate = await ack(secondSocket, 'auth:register', { name: 'nombreunico', email: 'nombre2@example.com', password: 'clave-segura-10', passwordConfirmation: 'clave-segura-10' });
  assert.equal(duplicate.ok, false);
  assert.match(duplicate.error, /nombre de usuario ya está en uso/i);

  const second = await ack(secondSocket, 'auth:register', { name: 'NombreAlterno', email: 'nombre2@example.com', password: 'clave-segura-10', passwordConfirmation: 'clave-segura-10' });
  assert.equal(second.ok, true);
  const rename = await ack(secondSocket, 'profile:update', { name: 'NOMBREUNICO' });
  assert.equal(rename.ok, false);
  assert.match(rename.error, /nombre de usuario ya está en uso/i);
});

test('sincroniza el ciclo de vida de notas entre clientes', async () => {
  const admin = clients[0];
  const member = clients[1];
  const adminPresence = once(admin, 'users:count');
  assert.equal((await ack(admin, 'wall:select', { id: 'general' })).ok, true);
  assert.equal(await adminPresence, 1);
  const memberPresence = once(member, 'users:count');
  assert.equal((await ack(member, 'wall:select', { id: 'general' })).ok, true);
  assert.equal(await memberPresence, 2);

  const duplicateMember = await connect();
  assert.equal((await ack(duplicateMember, 'auth:login', { email: 'brenda@example.com', password: 'clave45678' })).ok, true);
  const duplicatePresence = once(duplicateMember, 'users:count');
  assert.equal((await ack(duplicateMember, 'wall:select', { id: 'general' })).ok, true);
  assert.equal(await duplicatePresence, 2, 'dos pestañas de la misma cuenta cuentan como una persona');
  assert.equal((await ack(duplicateMember, 'wall:leave')).ok, true);
  duplicateMember.close();

  const createdEvent = once(member, 'note:created');
  const created = await ack(admin, 'note:create', { texto: 'Idea compartida', color: 'rosa', x: 120, y: 85 });
  assert.equal(created.ok, true);
  assert.equal((await createdEvent).note.texto, 'Idea compartida');
  assert.equal((await ack(admin, 'note:create', { texto: '   ', color: 'rosa' })).ok, false);
  assert.equal((await ack(admin, 'note:create', { texto: 'Color inválido', color: 'negro' })).ok, false);

  const updatedEvent = once(admin, 'note:updated');
  const updated = await ack(member, 'note:update', { id: created.note.id, texto: 'Idea refinada', color: 'azul' });
  assert.equal(updated.ok, true);
  const updatedNote = (await updatedEvent).note;
  assert.equal(updatedNote.color, 'azul');
  assert.equal(updatedNote.authorId, created.note.authorId);
  assert.equal(updatedNote.autor, created.note.autor);
  assert.equal(updatedNote.editorId, server.users.find((user) => user.email === 'brenda@example.com').id);
  assert.equal(updatedNote.editor, 'Brenda Editora');

  const movedEvent = once(member, 'note:moved');
  assert.equal((await ack(admin, 'note:move', { id: created.note.id, x: -30, y: 99999 })).ok, true);
  const moved = await movedEvent;
  assert.equal(moved.x, 0);
  assert.equal(moved.y, 4000);

  const previewEvent = once(member, 'note:preview-moved');
  admin.emit('note:preview-move', { id: created.note.id, x: 640, y: 420 });
  const preview = await previewEvent;
  assert.equal(preview.x, 640);
  assert.equal(preview.y, 420);

  const deletedEvent = once(member, 'note:deleted');
  assert.equal((await ack(admin, 'note:delete', { id: created.note.id })).ok, true);
  assert.equal((await deletedEvent).id, created.note.id);
});

test('persiste perfil, tema y preferencias del usuario en el servidor', async () => {
  const member = clients[1];
  await ack(member, 'wall:select', { id: 'general' });
  const note = await ack(member, 'note:create', { texto: 'Idea de Brenda', color: 'azul', x: 80, y: 90 });
  const authorChanged = once(clients[0], 'note:updated');
  const profile = await ack(member, 'profile:update', { name: 'Brenda González', avatar: '' });
  assert.equal(profile.user.name, 'Brenda González');
  assert.equal((await authorChanged).note.autor, 'Brenda González');
  await ack(member, 'note:delete', { id: note.note.id });
  const settings = await ack(member, 'settings:update', { theme: 'dark', confirmDelete: false, compactNotes: true, notifications: false });
  assert.deepEqual(settings.settings, { theme: 'dark', confirmDelete: false, compactNotes: true, notifications: false });
  const login = await ack(member, 'auth:login', { email: 'brenda@example.com', password: 'clave45678' });
  assert.equal(login.user.settings.theme, 'dark');
});

test('crea un código de sala reutilizable y agrega cada membresía al unirse', async () => {
  const admin = clients[0];
  const member = clients[1];
  const created = await ack(admin, 'wall:create', { name: 'Sprint web', description: 'Ideas del equipo', color: 'azul' });
  assert.equal(created.wall.role, 'propietario');
  assert.equal(created.wall.color, 'azul');
  const wallId = created.wall.id;
  const invited = await ack(admin, 'wall:invite', { wallId, role: 'lector' });
  assert.equal(invited.invitation.status, 'pendiente');
  assert.match(invited.code, /^[A-Z0-9]{8}$/);
  const activeInvitations = await ack(admin, 'invitations:list');
  assert.equal(activeInvitations.invitations.find((item) => item.wallId === wallId && item.status === 'pendiente').code, invited.code);
  assert.equal((await ack(member, 'wall:select', { id: wallId })).ok, false);
  const preview = await ack(member, 'invitation:preview', { secret: invited.code.toLowerCase() });
  assert.equal(preview.invitation.wallName, 'Sprint web');
  assert.equal(preview.invitation.invitedBy, 'Boris Admin');
  const accepted = await ack(member, 'invitation:answer', { secret: invited.code, answer: 'aceptar' });
  assert.equal(accepted.status, 'aceptada');
  assert.equal((await ack(member, 'invitation:answer', { secret: invited.code, answer: 'aceptar' })).ok, false);
  const secondMember = await connect();
  const secondRegistration = await ack(secondMember, 'auth:register', { name: 'Carla Invitada', email: 'carla@example.com', password: 'clave78901', passwordConfirmation: 'clave78901' });
  const secondMemberId = secondRegistration.user.id;
  assert.equal((await ack(secondMember, 'invitation:answer', { secret: invited.code.toLowerCase() })).status, 'aceptada');
  assert.equal((await ack(admin, 'wall:member:update', { wallId, userId: secondMemberId, role: 'editor' })).ok, true);
  assert.equal((await ack(secondMember, 'wall:select', { id: wallId })).wall.role, 'editor');
  assert.equal((await ack(admin, 'wall:member:update', { wallId, userId: secondMemberId, role: 'lector' })).ok, true);
  assert.equal((await ack(secondMember, 'wall:select', { id: wallId })).wall.role, 'lector');
  assert.equal((await ack(admin, 'wall:member:remove', { wallId, userId: secondMemberId })).ok, true);
  assert.equal((await ack(secondMember, 'wall:select', { id: wallId })).ok, false);
  assert.equal((await ack(member, 'invitation:preview', { secret: 'NOEXISTE' })).error, 'Sala no encontrada.');
  assert.equal((await ack(member, 'wall:select', { id: wallId })).wall.role, 'lector');
  assert.equal((await ack(member, 'note:create', { texto: 'No permitido', color: 'verde' })).ok, false);

  const memberId = server.users.find((user) => user.email === 'brenda@example.com').id;
  assert.equal((await ack(admin, 'wall:member:update', { wallId, userId: memberId, role: 'editor' })).ok, true);
  assert.equal((await ack(member, 'wall:select', { id: wallId })).wall.role, 'editor');
  assert.equal((await ack(member, 'note:create', { texto: 'Ahora sí', color: 'verde' })).ok, true);
  const updatedWall = await ack(admin, 'wall:update', { id: wallId, name: 'Sprint actualizado', description: '', color: 'rosa' });
  assert.equal(updatedWall.wall.name, 'Sprint actualizado');
  assert.equal(updatedWall.wall.color, 'rosa');

  const disposable = await ack(admin, 'wall:create', { name: 'Muro temporal', description: '', color: 'verde' });
  const disposableInvite = await ack(admin, 'wall:invite', { wallId: disposable.wall.id, role: 'editor' });
  await ack(member, 'invitation:answer', { secret: disposableInvite.code, answer: 'aceptar' });
  const wallDeletedForMember = once(member, 'wall:deleted');
  assert.equal((await ack(admin, 'wall:delete', { id: disposable.wall.id })).ok, true);
  assert.equal(await wallDeletedForMember, disposable.wall.id);
  assert.equal((await ack(member, 'walls:list')).walls.some((wall) => wall.id === disposable.wall.id), false);
});

test('mantiene reportes privados y permite que el superadmin responda al mismo autor', async () => {
  const admin = clients[0]; const member = clients[1];
  const created = await ack(member, 'report:create', { reason: 'fallo_aplicacion', detail: 'La pantalla no carga correctamente.' });
  assert.equal(created.report.status, 'pendiente');
  assert.equal(server.reports[0].reporterId, server.users.find((user) => user.email === 'brenda@example.com').id);
  const own = await ack(member, 'reports:list'); assert.equal(own.reports.length, 1);
  const adminList = await ack(admin, 'admin:reports:list'); assert.equal(adminList.reports.length, 1); assert.equal(adminList.reports[0].wallName, undefined);
  assert.equal((await ack(admin, 'admin:report:take', { id: created.report.id })).ok, true);
  assert.equal((await ack(admin, 'admin:report:respond', { id: created.report.id, status: 'resuelto', decision: 'Se corrigió la carga.' })).ok, true);
  const answered = await ack(member, 'reports:list'); assert.equal(answered.reports[0].decision, 'Se corrigió la carga.');
  const outsider = await connect();
  await ack(outsider, 'auth:register', { name: 'Persona externa', email: 'externa@example.com', password: 'clave99901', passwordConfirmation: 'clave99901' });
  assert.equal((await ack(outsider, 'reports:list')).reports.length, 0);
});

test('reporta a una cuenta compartida y reserva las sanciones al superadmin', async () => {
  const admin = clients[0]; const member = clients[1];
  const wall = server.walls.find((item) => item.name === 'Sprint actualizado');
  const adminId = server.users.find((user) => user.email === 'saldavargasboris@gmail.com').id;
  const memberId = server.users.find((user) => user.email === 'brenda@example.com').id;
  const report = await ack(member, 'report:user:create', { wallId: wall.id, userId: adminId, reason: 'acoso', detail: 'Mensajes insistentes dentro del grupo compartido.' });
  assert.equal(report.ok, true);
  const listed = await ack(admin, 'admin:reports:list');
  assert.equal(listed.reports.find((item) => item.id === report.report.id).reportedUserId, adminId);
  const closed = await ack(admin, 'admin:report:respond', { id: report.report.id, status: 'rechazado', decision: 'Reporte revisado y cerrado sin aplicar una medida.' });
  assert.equal(closed.ok, true);
  assert.equal((await ack(member, 'reports:list')).reports.find((item) => item.id === report.report.id).status, 'rechazado');
  assert.equal((await ack(member, 'admin:user:discipline', { userId: adminId, action: 'advertir', message: 'No permitido.' })).ok, false);
  assert.equal((await ack(admin, 'admin:user:discipline', { userId: memberId, action: 'advertir', message: 'Evita repetir esta conducta.' })).ok, true);
});

test('rechaza roles simulados en el navegador y autoriza solo al superadmin real', async () => {
  const admin = clients[0];
  const member = clients[1];
  const wallId = server.walls.find((wall) => wall.name === 'Sprint actualizado').id;
  const spoofed = await ack(member, 'admin:clear', { wallId, role: 'superadmin' });
  assert.equal(spoofed.ok, false);
  assert.match(spoofed.error, /superadministradores/);

  const snapshot = await ack(admin, 'admin:snapshot');
  assert.equal(snapshot.ok, true);
  assert.ok(snapshot.users.length >= 2);
  assert.equal(snapshot.walls.length, 2);
  const memberId = snapshot.users.find((user) => user.email === 'brenda@example.com').id;
  const ownerId = snapshot.users.find((user) => user.email === 'saldavargasboris@gmail.com').id;
  assert.equal((await ack(admin, 'admin:user:role', { userId: memberId, role: 'superadmin' })).ok, false);
  assert.equal((await ack(admin, 'admin:user:role', { userId: ownerId, role: 'usuario' })).ok, false);
  const cleared = await ack(admin, 'admin:clear', { wallId });
  assert.equal(cleared.ok, true);
  assert.equal(cleared.removed, 1);
});

test('bloquea un IDOR aunque el atacante tenga rol global de superadmin', async () => {
  const admin = clients[0];
  const member = clients[1];
  const privateWall = await ack(member, 'wall:create', { name: 'Privado de Brenda', description: 'Solo invitadas' });
  assert.equal(privateWall.ok, true);

  const guessedId = privateWall.wall.id;
  const readAttempt = await ack(admin, 'wall:select', { id: guessedId });
  const updateAttempt = await ack(admin, 'wall:update', { id: guessedId, name: 'Tomado', description: '' });
  const deleteAttempt = await ack(admin, 'wall:delete', { id: guessedId });

  assert.equal(readAttempt.ok, false);
  assert.match(readAttempt.error, /No tienes acceso/);
  assert.equal(updateAttempt.ok, false);
  assert.match(updateAttempt.error, /propietaria/);
  assert.equal(deleteAttempt.ok, false);
  assert.match(deleteAttempt.error, /propietaria/);
  assert.equal(server.walls.find((wall) => wall.id === guessedId).name, 'Privado de Brenda');
});

test('expone solo el muro comunitario y limita cada aporte a su autor', async () => {
  const owner = clients[0];
  const community = (await ack(owner, 'wall:create', { name: 'Comunidad de pruebas', description: 'Aportes de todas las cuentas' })).wall;
  const storedWall = server.walls.find((wall) => wall.id === community.id);
  storedWall.community = true;

  const visitor = await connect();
  const registration = await ack(visitor, 'auth:register', { name: 'Visitante Comunidad', email: 'visitante@example.com', password: 'clave-segura-10', passwordConfirmation: 'clave-segura-10' });
  assert.equal(registration.ok, true);
  const visibleWalls = await ack(visitor, 'walls:list');
  assert.equal(visibleWalls.walls.find((wall) => wall.id === community.id)?.role, 'comunitario');

  const selected = await ack(visitor, 'wall:select', { id: community.id });
  assert.equal(selected.wall.role, 'comunitario');
  assert.deepEqual(selected.members, [], 'el acceso comunitario no expone la lista privada de miembros');
  const contribution = await ack(visitor, 'note:create', { texto: 'Mi aporte comunitario', color: 'lila', x: 100, y: 120 });
  assert.equal(contribution.ok, true);
  assert.equal((await ack(visitor, 'note:update', { id: contribution.note.id, texto: 'Mi aporte corregido', color: 'lila' })).ok, true);

  await ack(owner, 'wall:select', { id: community.id });
  assert.equal((await ack(owner, 'wall:update', { id: community.id, name: 'Comunidad de pruebas', description: 'Sigue bajo su propietario' })).ok, true);
  assert.equal((await ack(visitor, 'wall:delete', { id: community.id })).ok, false);

  const otherVisitor = await connect();
  await ack(otherVisitor, 'auth:register', { name: 'Otra Visitante', email: 'otra-visitante@example.com', password: 'clave-segura-10', passwordConfirmation: 'clave-segura-10' });
  await ack(otherVisitor, 'wall:select', { id: community.id });
  const unauthorizedEdit = await ack(otherVisitor, 'note:update', { id: contribution.note.id, texto: 'No debo cambiarla', color: 'rosa' });
  assert.equal(unauthorizedEdit.ok, false);
  assert.match(unauthorizedEdit.error, /tus propias notas/);
});
