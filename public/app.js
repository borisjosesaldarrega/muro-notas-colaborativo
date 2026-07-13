'use strict';

const socket = io();
const $ = (selector) => document.querySelector(selector);
const board = $('#board');
const state = { notes: new Map(), filter: 'all', online: 0, user: null };

function readJson(storage, key, fallback) {
  try { return JSON.parse(storage.getItem(key) || JSON.stringify(fallback)); }
  catch { storage.removeItem(key); return fallback; }
}
function loadUsers() { return readJson(localStorage, 'muroUsers', []); }
function saveUsers(users) { localStorage.setItem('muroUsers', JSON.stringify(users)); }
function toast(message) {
  const item = $('#toast');
  item.textContent = message;
  item.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => item.classList.remove('show'), 2800);
}
function initials(name = 'Usuario') {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]).join('').toUpperCase() || 'U';
}
function setBusy(button, busy) {
  button.disabled = busy;
  button.setAttribute('aria-busy', String(busy));
}

function showAuth(view = 'login') {
  $('#authView').classList.remove('hidden');
  $('#appView').classList.add('hidden');
  ['login', 'register', 'recover'].forEach((name) => $(`#${name}Form`).classList.toggle('hidden', name !== view));
  const firstField = $(`#${view}Form input`);
  setTimeout(() => firstField?.focus(), 0);
}

function enterApp(user) {
  state.user = user;
  sessionStorage.setItem('muroSession', JSON.stringify(user));
  $('#authView').classList.add('hidden');
  $('#appView').classList.remove('hidden');
  $('#profileName').textContent = user.name;
  $('#profileEmail').textContent = user.email;
  $('#profileRole').textContent = user.role === 'superadmin' ? 'Superadministrador' : 'Usuario';
  $('#profileButton').textContent = initials(user.name);
  $('#adminButton').classList.toggle('hidden', user.role !== 'superadmin');
}

document.querySelectorAll('[data-view]').forEach((button) => button.addEventListener('click', () => showAuth(button.dataset.view)));

$('#loginForm').addEventListener('submit', (event) => {
  event.preventDefault();
  const button = event.currentTarget.querySelector('[type="submit"]');
  setBusy(button, true);
  const email = $('#loginEmail').value.trim().toLowerCase();
  const password = $('#loginPassword').value;
  const user = loadUsers().find((item) => item.email === email && item.password === password);
  setBusy(button, false);
  if (!user) return toast('Correo o contraseña incorrectos. Revisa tus datos.');
  enterApp(user);
  return toast(`Bienvenido, ${user.name}.`);
});

$('#registerForm').addEventListener('submit', (event) => {
  event.preventDefault();
  const button = event.currentTarget.querySelector('[type="submit"]');
  setBusy(button, true);
  const users = loadUsers();
  const name = $('#registerName').value.trim().slice(0, 40);
  const email = $('#registerEmail').value.trim().toLowerCase();
  const password = $('#registerPassword').value;
  if (!name) { setBusy(button, false); return toast('Escribe tu nombre.'); }
  if (users.some((item) => item.email === email)) { setBusy(button, false); return toast('Ese correo ya está registrado.'); }
  const user = { id: crypto.randomUUID(), name, email, password, role: users.length ? 'usuario' : 'superadmin' };
  users.push(user);
  saveUsers(users);
  setBusy(button, false);
  enterApp(user);
  return toast(user.role === 'superadmin' ? 'Cuenta creada: eres superadministrador.' : 'Cuenta creada correctamente.');
});

$('#recoverForm').addEventListener('submit', (event) => {
  event.preventDefault();
  const email = $('#recoverEmail').value.trim().toLowerCase();
  const exists = loadUsers().some((item) => item.email === email);
  toast(exists ? 'Enlace de recuperación simulado y enviado.' : 'Si la cuenta existe, recibirás un enlace simulado.');
  showAuth('login');
});

function colorClass(color) {
  return { amarillo: 'yellow', rosa: 'pink', azul: 'blue', verde: 'green', lila: 'purple' }[color] || 'yellow';
}

function updateStats() { $('#notesStat').textContent = state.notes.size; }

function clampPosition(element, x, y) {
  const maxX = Math.max(0, board.clientWidth - element.offsetWidth);
  const maxY = Math.max(0, board.clientHeight - element.offsetHeight);
  return { x: Math.min(Math.max(0, Number(x) || 0), maxX), y: Math.min(Math.max(0, Number(y) || 0), maxY) };
}

function createNoteElement(note) {
  const element = document.createElement('article');
  element.className = 'note';
  element.dataset.noteId = note.id;
  element.setAttribute('aria-label', `Nota de ${note.autor || 'Invitado'}`);

  const textarea = document.createElement('textarea');
  textarea.maxLength = 280;
  textarea.setAttribute('aria-label', 'Contenido de la nota');
  const footer = document.createElement('div');
  footer.className = 'note-footer';
  const author = document.createElement('span');
  const remove = document.createElement('button');
  remove.className = 'note-delete';
  remove.type = 'button';
  remove.title = 'Eliminar nota';
  remove.setAttribute('aria-label', 'Eliminar nota');
  remove.textContent = '×';
  footer.append(author, remove);
  element.append(textarea, footer);
  board.appendChild(element);
  setupDrag(element);

  textarea.addEventListener('change', (event) => {
    const previous = state.notes.get(note.id);
    const texto = event.target.value.trim();
    if (!texto) { event.target.value = previous?.texto || ''; return toast('La nota no puede quedar vacía.'); }
    socket.emit('note:update', { id: note.id, texto, color: previous?.color }, (result) => {
      if (!result?.ok) { event.target.value = previous?.texto || ''; toast(result?.error || 'No se pudo editar la nota.'); }
      else toast('Nota actualizada.');
    });
  });
  remove.addEventListener('click', () => {
    if (!confirm('¿Eliminar esta nota? Esta acción no se puede deshacer.')) return;
    setBusy(remove, true);
    socket.emit('note:delete', { id: note.id }, (result) => {
      if (!result?.ok) { setBusy(remove, false); toast(result?.error || 'No se pudo eliminar la nota.'); }
    });
  });
  return element;
}

function renderNote(note) {
  if (!note?.id) return;
  state.notes.set(note.id, note);
  let element = document.querySelector(`[data-note-id="${CSS.escape(note.id)}"]`);
  if (!element) element = createNoteElement(note);
  element.className = `note ${colorClass(note.color)}${state.filter !== 'all' && state.filter !== note.color ? ' filtered' : ''}`;
  const textarea = element.querySelector('textarea');
  if (document.activeElement !== textarea) textarea.value = note.texto;
  element.querySelector('.note-footer span').textContent = note.autor || 'Invitado';
  const position = clampPosition(element, note.x, note.y);
  element.style.left = `${position.x}px`;
  element.style.top = `${position.y}px`;
  updateStats();
}

function setupDrag(element) {
  let drag = null;
  element.addEventListener('pointerdown', (event) => {
    if (event.target.matches('textarea, button')) return;
    const rect = element.getBoundingClientRect();
    drag = { dx: event.clientX - rect.left, dy: event.clientY - rect.top, pointerId: event.pointerId };
    element.setPointerCapture(event.pointerId);
    element.classList.add('dragging');
  });
  element.addEventListener('pointermove', (event) => {
    if (!drag) return;
    const bounds = board.getBoundingClientRect();
    const position = clampPosition(element, event.clientX - bounds.left + board.scrollLeft - drag.dx, event.clientY - bounds.top + board.scrollTop - drag.dy);
    element.style.left = `${position.x}px`;
    element.style.top = `${position.y}px`;
  });
  const endDrag = () => {
    if (!drag) return;
    drag = null;
    element.classList.remove('dragging');
    socket.emit('note:move', { id: element.dataset.noteId, x: parseFloat(element.style.left), y: parseFloat(element.style.top) }, (result) => {
      if (!result?.ok) toast(result?.error || 'No se pudo mover la nota.');
    });
  };
  element.addEventListener('pointerup', endDrag);
  element.addEventListener('pointercancel', endDrag);
}

function setConnection(label, connected) {
  const status = $('#connectionStatus');
  status.lastChild.textContent = ` ${label}`;
  status.classList.toggle('connected', connected);
}

socket.on('connect', () => setConnection('Sincronizado', true));
socket.on('disconnect', () => setConnection('Reconectando…', false));
socket.io.on('reconnect_attempt', () => setConnection('Reconectando…', false));
socket.on('notes:init', (notes) => {
  state.notes.clear();
  board.replaceChildren();
  notes.forEach(renderNote);
  updateStats();
});
socket.on('note:created', renderNote);
socket.on('note:updated', renderNote);
socket.on('note:moved', ({ id, x, y, updatedAt }) => {
  const note = state.notes.get(id);
  if (note) renderNote({ ...note, x, y, updatedAt });
});
socket.on('note:deleted', (id) => {
  state.notes.delete(id);
  document.querySelector(`[data-note-id="${CSS.escape(id)}"]`)?.remove();
  updateStats();
});
socket.on('board:cleared', ({ removed }) => {
  state.notes.clear();
  board.replaceChildren();
  updateStats();
  toast(`Muro limpiado: ${removed} nota${removed === 1 ? '' : 's'} eliminada${removed === 1 ? '' : 's'}.`);
});
socket.on('users:count', (count) => {
  state.online = Number(count) || 0;
  $('#onlineCount').textContent = state.online;
  $('#usersStat').textContent = state.online;
  $('#onlineLabel').textContent = state.online === 1 ? 'conectado' : 'conectados';
});

$('#newNoteButton').addEventListener('click', () => {
  $('#noteForm').reset();
  $('#characterCount').textContent = '0 / 280';
  $('#noteDialog').showModal();
  setTimeout(() => $('#noteText').focus(), 50);
});
$('#closeNoteDialog').addEventListener('click', () => $('#noteDialog').close());
$('#cancelNote').addEventListener('click', () => $('#noteDialog').close());
$('#noteText').addEventListener('input', (event) => { $('#characterCount').textContent = `${event.target.value.length} / 280`; });
$('#noteForm').addEventListener('submit', (event) => {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const texto = $('#noteText').value.trim();
  if (!texto) return toast('Escribe el contenido de la nota.');
  setBusy($('#saveNote'), true);
  socket.emit('note:create', { texto, color: data.get('color'), autor: state.user?.name, x: 40 + Math.random() * 240, y: 50 + Math.random() * 180 }, (result) => {
    setBusy($('#saveNote'), false);
    if (!result?.ok) return toast(result?.error || 'No se pudo publicar la nota.');
    $('#noteDialog').close();
    return toast('Nota publicada.');
  });
});

document.querySelectorAll('[data-filter]').forEach((button) => button.addEventListener('click', () => {
  state.filter = button.dataset.filter;
  document.querySelectorAll('[data-filter]').forEach((item) => {
    const active = item === button;
    item.classList.toggle('active', active);
    item.setAttribute('aria-pressed', String(active));
  });
  state.notes.forEach(renderNote);
}));

function closePanel() {
  $('#sidePanel').classList.remove('open');
  $('#sidePanel').setAttribute('aria-hidden', 'true');
  $('#panelBackdrop').classList.add('hidden');
}
function openPanel(kind) {
  $('#sidePanel').classList.add('open');
  $('#sidePanel').setAttribute('aria-hidden', 'false');
  $('#panelBackdrop').classList.remove('hidden');
  $('#profilePanel').classList.toggle('hidden', kind !== 'profile');
  $('#adminPanel').classList.toggle('hidden', kind !== 'admin');
  setTimeout(() => $('#closePanel').focus(), 0);
}

$('#profileButton').addEventListener('click', () => openPanel('profile'));
$('#adminButton').addEventListener('click', () => {
  if (state.user?.role !== 'superadmin') return toast('Panel reservado para el superadministrador.');
  return openPanel('admin');
});
$('#closePanel').addEventListener('click', closePanel);
$('#panelBackdrop').addEventListener('click', closePanel);
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closePanel(); });
$('#logoutButton').addEventListener('click', () => {
  sessionStorage.removeItem('muroSession');
  state.user = null;
  closePanel();
  showAuth('login');
  toast('Sesión cerrada.');
});
$('#clearBoardButton').addEventListener('click', () => {
  if (state.user?.role !== 'superadmin') return toast('No tienes permiso para limpiar el muro.');
  if (!confirm('¿Eliminar todas las notas del muro? Esta acción afectará a todas las personas conectadas.')) return;
  const button = $('#clearBoardButton');
  setBusy(button, true);
  socket.emit('admin:clear', { role: state.user.role }, (result) => {
    setBusy(button, false);
    if (!result?.ok) return toast(result?.error || 'No se pudo limpiar el muro.');
    closePanel();
    return undefined;
  });
});

window.addEventListener('resize', () => state.notes.forEach(renderNote));
const session = readJson(sessionStorage, 'muroSession', null);
session ? enterApp(session) : showAuth('login');
