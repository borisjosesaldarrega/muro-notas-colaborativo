'use strict';

const assert = require('node:assert/strict');
const { after, before, test } = require('node:test');
const { io: createClient } = require('socket.io-client');
const { createMuroServer } = require('../server');

let instance;
let baseUrl;
const clients = [];

function once(socket, event) {
  return new Promise((resolve) => socket.once(event, resolve));
}

function emitAck(socket, event, payload) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Sin respuesta para ${event}`)), 2000);
    socket.emit(event, payload, (result) => { clearTimeout(timer); resolve(result); });
  });
}

async function connectClient() {
  const socket = createClient(baseUrl, { transports: ['websocket'], forceNew: true });
  clients.push(socket);
  await Promise.all([once(socket, 'connect'), once(socket, 'notes:init')]);
  return socket;
}

before(async () => {
  instance = createMuroServer();
  await new Promise((resolve) => instance.httpServer.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${instance.httpServer.address().port}`;
});

after(async () => {
  clients.forEach((socket) => socket.disconnect());
  await new Promise((resolve) => instance.io.close(resolve));
  await new Promise((resolve) => instance.httpServer.close(resolve));
});

test('GET /api/health y la página principal responden', async () => {
  const health = await fetch(`${baseUrl}/api/health`);
  assert.equal(health.status, 200);
  assert.equal((await health.json()).ok, true);
  const page = await fetch(baseUrl);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Ideas que se mueven juntas/);
});

test('dos clientes sincronizan crear, editar, mover y eliminar sin duplicados', async () => {
  const first = await connectClient();
  const second = await connectClient();

  const createdOnFirst = once(first, 'note:created');
  const createdOnSecond = once(second, 'note:created');
  const createResult = await emitAck(first, 'note:create', { texto: '<b>Idea segura</b>', color: 'lila', x: 25, y: 30, autor: 'Ada' });
  assert.equal(createResult.ok, true);
  const [createdA, createdB] = await Promise.all([createdOnFirst, createdOnSecond]);
  assert.equal(createdA.id, createdB.id);
  assert.equal(createdA.texto, '<b>Idea segura</b>');

  const updateOnSecond = once(second, 'note:updated');
  assert.equal((await emitAck(first, 'note:update', { id: createdA.id, texto: 'Idea editada', color: 'verde' })).ok, true);
  assert.equal((await updateOnSecond).texto, 'Idea editada');

  const moveOnSecond = once(second, 'note:moved');
  assert.equal((await emitAck(first, 'note:move', { id: createdA.id, x: -50, y: 99999 })).ok, true);
  const moved = await moveOnSecond;
  assert.equal(moved.x, 0);
  assert.equal(moved.y, 4000);

  const deleteOnSecond = once(second, 'note:deleted');
  assert.equal((await emitAck(first, 'note:delete', { id: createdA.id })).ok, true);
  assert.equal(await deleteOnSecond, createdA.id);
});

test('el servidor rechaza datos inválidos y protege la acción administrativa demostrativa', async () => {
  const client = await connectClient();
  assert.equal((await emitAck(client, 'note:create', { texto: '   ', color: 'amarillo' })).ok, false);
  assert.equal((await emitAck(client, 'note:create', { texto: 'válida', color: 'negro' })).ok, false);
  assert.equal((await emitAck(client, 'admin:clear', { role: 'usuario' })).ok, false);

  const cleared = once(client, 'board:cleared');
  const result = await emitAck(client, 'admin:clear', { role: 'superadmin' });
  assert.equal(result.ok, true);
  assert.equal(typeof (await cleared).removed, 'number');
});
