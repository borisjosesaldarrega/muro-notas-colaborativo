'use strict';

const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const DEFAULT_PORT = 3000;
const COLORS = new Set(['amarillo', 'rosa', 'azul', 'verde', 'lila']);
const MAX_COORDINATE = 4000;

function cleanText(value, max = 280) {
  return String(value ?? '').replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, max);
}

function safeCoordinate(value, fallback = 40) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(number, MAX_COORDINATE)) : fallback;
}

function createInitialNotes() {
  return [{
    id: 'bienvenida',
    texto: '¡Bienvenidos! Crea una nota y muévela por el muro.',
    color: 'amarillo',
    x: 80,
    y: 100,
    autor: 'Equipo',
    updatedAt: Date.now()
  }];
}

function createMuroServer() {
  const app = express();
  const httpServer = http.createServer(app);
  const io = new Server(httpServer);
  const notes = createInitialNotes();

  app.disable('x-powered-by');
  app.use(express.static(path.join(__dirname, 'public')));
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, notes: notes.length, users: io.engine.clientsCount });
  });

  const acknowledgeError = (acknowledge, error) => acknowledge({ ok: false, error });

  io.on('connection', (socket) => {
    socket.emit('notes:init', notes);
    io.emit('users:count', io.engine.clientsCount);

    socket.on('note:create', (payload = {}, acknowledge = () => {}) => {
      const texto = cleanText(payload.texto);
      if (!texto) return acknowledgeError(acknowledge, 'La nota no puede estar vacía.');
      if (!COLORS.has(payload.color)) return acknowledgeError(acknowledge, 'Selecciona un color válido.');

      const note = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        texto,
        color: payload.color,
        x: safeCoordinate(payload.x, 50 + Math.random() * 220),
        y: safeCoordinate(payload.y, 80 + Math.random() * 160),
        autor: cleanText(payload.autor, 40) || 'Invitado',
        updatedAt: Date.now()
      };
      notes.push(note);
      io.emit('note:created', note);
      return acknowledge({ ok: true, note });
    });

    socket.on('note:update', (payload = {}, acknowledge = () => {}) => {
      const note = notes.find((item) => item.id === cleanText(payload.id, 100));
      if (!note) return acknowledgeError(acknowledge, 'La nota ya no existe.');
      const texto = cleanText(payload.texto);
      if (!texto) return acknowledgeError(acknowledge, 'La nota no puede estar vacía.');
      if (payload.color !== undefined && !COLORS.has(payload.color)) {
        return acknowledgeError(acknowledge, 'El color no es válido.');
      }
      note.texto = texto;
      if (payload.color) note.color = payload.color;
      note.updatedAt = Date.now();
      io.emit('note:updated', note);
      return acknowledge({ ok: true, note });
    });

    socket.on('note:move', (payload = {}, acknowledge = () => {}) => {
      const note = notes.find((item) => item.id === cleanText(payload.id, 100));
      if (!note) return acknowledgeError(acknowledge, 'La nota ya no existe.');
      note.x = safeCoordinate(payload.x, note.x);
      note.y = safeCoordinate(payload.y, note.y);
      note.updatedAt = Date.now();
      io.emit('note:moved', { id: note.id, x: note.x, y: note.y, updatedAt: note.updatedAt });
      return acknowledge({ ok: true });
    });

    socket.on('note:delete', (payload, acknowledge = () => {}) => {
      const id = cleanText(typeof payload === 'object' ? payload?.id : payload, 100);
      const index = notes.findIndex((item) => item.id === id);
      if (index === -1) return acknowledgeError(acknowledge, 'La nota ya no existe.');
      notes.splice(index, 1);
      io.emit('note:deleted', id);
      return acknowledge({ ok: true });
    });

    socket.on('admin:clear', (payload = {}, acknowledge = () => {}) => {
      // Control demostrativo: el rol viene del navegador y no reemplaza autenticación real.
      if (payload.role !== 'superadmin') {
        return acknowledgeError(acknowledge, 'No tienes permiso para limpiar el muro.');
      }
      const removed = notes.length;
      notes.splice(0, notes.length);
      io.emit('board:cleared', { removed, clearedAt: Date.now() });
      return acknowledge({ ok: true, removed });
    });

    socket.on('disconnect', () => io.emit('users:count', io.engine.clientsCount));
  });

  return { app, httpServer, io, notes };
}

if (require.main === module) {
  const { httpServer } = createMuroServer();
  const port = Number(process.env.PORT) || DEFAULT_PORT;
  httpServer.listen(port, () => console.log(`Muro disponible en http://localhost:${port}`));
}

module.exports = { COLORS, cleanText, createMuroServer, safeCoordinate };
