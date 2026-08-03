const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

const COLORS = new Set(['amarillo', 'rosa', 'azul', 'verde', 'lila']);
const notes = [
  { id: 'bienvenida', texto: '¡Bienvenidos! Crea una nota y muévela por el muro.', color: 'amarillo', x: 80, y: 100, autor: 'Equipo', updatedAt: Date.now() }
];

app.use(express.static(path.join(__dirname, '..', 'Frontend')));
app.get('/api/health', (_req, res) => res.json({ ok: true, notes: notes.length }));

function cleanText(value, max = 280) {
  return String(value ?? '').trim().slice(0, max);
}

function safeCoordinate(value, fallback = 40) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(number, 4000)) : fallback;
}

io.on('connection', (socket) => {
  socket.emit('notes:init', notes);
  io.emit('users:count', io.engine.clientsCount);

  socket.on('note:create', (payload = {}, acknowledge = () => {}) => {
    const texto = cleanText(payload.texto);
    if (!texto) return acknowledge({ ok: false, error: 'La nota no puede estar vacía.' });

    const note = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      texto,
      color: COLORS.has(payload.color) ? payload.color : 'amarillo',
      x: safeCoordinate(payload.x, 50 + Math.random() * 220),
      y: safeCoordinate(payload.y, 80 + Math.random() * 160),
      autor: cleanText(payload.autor, 40) || 'Invitado',
      updatedAt: Date.now()
    };
    notes.push(note);
    io.emit('note:created', note);
    acknowledge({ ok: true, note });
  });

  socket.on('note:update', (payload = {}) => {
    const note = notes.find((item) => item.id === payload.id);
    if (!note) return;
    const texto = cleanText(payload.texto);
    if (!texto) return;
    note.texto = texto;
    if (COLORS.has(payload.color)) note.color = payload.color;
    note.updatedAt = Date.now();
    socket.broadcast.emit('note:updated', note);
  });

  socket.on('note:move', (payload = {}) => {
    const note = notes.find((item) => item.id === payload.id);
    if (!note) return;
    note.x = safeCoordinate(payload.x, note.x);
    note.y = safeCoordinate(payload.y, note.y);
    note.updatedAt = Date.now();
    socket.broadcast.emit('note:moved', { id: note.id, x: note.x, y: note.y });
  });

  socket.on('note:delete', (id) => {
    const index = notes.findIndex((item) => item.id === id);
    if (index === -1) return;
    notes.splice(index, 1);
    io.emit('note:deleted', id);
  });

  socket.on('disconnect', () => io.emit('users:count', io.engine.clientsCount));
});

server.listen(PORT, () => console.log(`Muro disponible en http://localhost:${PORT}`));
