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
  server = createMuroServer();
  await new Promise((resolve) => server.httpServer.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.httpServer.address().port}`;
});

after(async () => {
  clients.forEach((client) => client.close());
  await new Promise((resolve) => server.io.close(resolve));
  await new Promise((resolve) => server.httpServer.close(resolve));
});

test('sirve la aplicación y un estado de salud', async () => {
  const page = await fetch(baseUrl).then((response) => response.text());
  const health = await fetch(`${baseUrl}/api/health`).then((response) => response.json());
  assert.match(page, /Muro/);
  assert.deepEqual(health, { ok: true, notes: 1, walls: 1, users: 0 });
});

test('registra, restaura y valida cuentas y roles en el servidor', async () => {
  const admin = await connect();
  const member = await connect();
  const first = await ack(admin, 'auth:register', { name: 'Ada Admin', email: 'ada@example.com', password: 'clave123' });
  const second = await ack(member, 'auth:register', { name: 'Brenda Editora', email: 'brenda@example.com', password: 'clave456' });
  assert.equal(first.ok, true);
  assert.equal(first.user.role, 'superadmin');
  assert.equal(second.user.role, 'usuario');
  assert.equal(second.user.password, undefined);
  assert.equal((await ack(member, 'auth:login', { email: 'brenda@example.com', password: 'mal' })).ok, false);

  const restored = await connect();
  const restore = await ack(restored, 'auth:restore', { token: first.token });
  assert.equal(restore.ok, true);
  assert.equal(restore.user.id, first.user.id);
});

test('sincroniza el ciclo de vida de notas entre clientes', async () => {
  const admin = clients[0];
  const member = clients[1];
  assert.equal((await ack(admin, 'wall:select', { id: 'general' })).ok, true);
  assert.equal((await ack(member, 'wall:select', { id: 'general' })).ok, true);

  const createdEvent = once(member, 'note:created');
  const created = await ack(admin, 'note:create', { texto: 'Idea compartida', color: 'rosa', x: 120, y: 85 });
  assert.equal(created.ok, true);
  assert.equal((await createdEvent).note.texto, 'Idea compartida');
  assert.equal((await ack(admin, 'note:create', { texto: '   ', color: 'rosa' })).ok, false);
  assert.equal((await ack(admin, 'note:create', { texto: 'Color inválido', color: 'negro' })).ok, false);

  const updatedEvent = once(member, 'note:updated');
  const updated = await ack(admin, 'note:update', { id: created.note.id, texto: 'Idea refinada', color: 'azul' });
  assert.equal(updated.ok, true);
  assert.equal((await updatedEvent).note.color, 'azul');

  const movedEvent = once(member, 'note:moved');
  assert.equal((await ack(admin, 'note:move', { id: created.note.id, x: -30, y: 99999 })).ok, true);
  const moved = await movedEvent;
  assert.equal(moved.x, 0);
  assert.equal(moved.y, 4000);

  const deletedEvent = once(member, 'note:deleted');
  assert.equal((await ack(admin, 'note:delete', { id: created.note.id })).ok, true);
  assert.equal((await deletedEvent).id, created.note.id);
});

test('persiste perfil, tema y preferencias del usuario en el servidor', async () => {
  const member = clients[1];
  const profile = await ack(member, 'profile:update', { name: 'Brenda González', avatar: '' });
  assert.equal(profile.user.name, 'Brenda González');
  const settings = await ack(member, 'settings:update', { theme: 'dark', confirmDelete: false, compactNotes: true, notifications: false });
  assert.deepEqual(settings.settings, { theme: 'dark', confirmDelete: false, compactNotes: true, notifications: false });
  const login = await ack(member, 'auth:login', { email: 'brenda@example.com', password: 'clave456' });
  assert.equal(login.user.settings.theme, 'dark');
});

test('crea muros, invita miembros y aplica permisos de lectura', async () => {
  const admin = clients[0];
  const member = clients[1];
  const created = await ack(admin, 'wall:create', { name: 'Sprint web', description: 'Ideas del equipo' });
  assert.equal(created.wall.role, 'propietario');
  const wallId = created.wall.id;
  const invited = await ack(admin, 'wall:invite', { wallId, email: 'brenda@example.com', role: 'lector' });
  assert.equal(invited.members.find((item) => item.email === 'brenda@example.com').roleInWall, 'lector');
  assert.equal((await ack(member, 'wall:select', { id: wallId })).wall.role, 'lector');
  assert.equal((await ack(member, 'note:create', { texto: 'No permitido', color: 'verde' })).ok, false);

  const memberId = server.users.find((user) => user.email === 'brenda@example.com').id;
  assert.equal((await ack(admin, 'wall:member:update', { wallId, userId: memberId, role: 'editor' })).ok, true);
  assert.equal((await ack(member, 'wall:select', { id: wallId })).wall.role, 'editor');
  assert.equal((await ack(member, 'note:create', { texto: 'Ahora sí', color: 'verde' })).ok, true);
  assert.equal((await ack(admin, 'wall:update', { id: wallId, name: 'Sprint actualizado', description: '' })).wall.name, 'Sprint actualizado');
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
  assert.equal(snapshot.users.length, 2);
  assert.equal(snapshot.walls.length, 2);
  const cleared = await ack(admin, 'admin:clear', { wallId });
  assert.equal(cleared.ok, true);
  assert.equal(cleared.removed, 1);
});
