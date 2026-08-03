const socket = io();
const $ = (selector) => document.querySelector(selector);
const board = $('#board');
const state = { notes: new Map(), filter: 'all', online: 1, user: null };

function loadUsers() { return JSON.parse(localStorage.getItem('muroUsers') || '[]'); }
function saveUsers(users) { localStorage.setItem('muroUsers', JSON.stringify(users)); }
function toast(message) { const item = $('#toast'); item.textContent = message; item.classList.add('show'); clearTimeout(toast.timer); toast.timer = setTimeout(() => item.classList.remove('show'), 2600); }
function initials(name = 'Usuario') { return name.split(/\s+/).slice(0, 2).map((word) => word[0]).join('').toUpperCase(); }

function showAuth(view = 'login') {
  $('#authView').classList.remove('hidden'); $('#appView').classList.add('hidden');
  ['login', 'register', 'recover'].forEach((name) => $(`#${name}Form`).classList.toggle('hidden', name !== view));
}
function enterApp(user) {
  state.user = user; sessionStorage.setItem('muroSession', JSON.stringify(user));
  $('#authView').classList.add('hidden'); $('#appView').classList.remove('hidden');
  $('#profileName').textContent = user.name; $('#profileEmail').textContent = user.email;
  $('#profileButton').textContent = initials(user.name);
}
document.querySelectorAll('[data-view]').forEach((button) => button.addEventListener('click', () => showAuth(button.dataset.view)));
$('#loginForm').addEventListener('submit', (event) => {
  event.preventDefault(); const email = $('#loginEmail').value.trim().toLowerCase(); const password = $('#loginPassword').value;
  const user = loadUsers().find((item) => item.email === email && item.password === password);
  if (!user) return toast('Correo o contraseña incorrectos.'); enterApp(user);
});
$('#registerForm').addEventListener('submit', (event) => {
  event.preventDefault(); const users = loadUsers(); const email = $('#registerEmail').value.trim().toLowerCase();
  if (users.some((item) => item.email === email)) return toast('Ese correo ya está registrado.');
  const user = { id: crypto.randomUUID(), name: $('#registerName').value.trim(), email, password: $('#registerPassword').value, role: users.length ? 'usuario' : 'superadmin' };
  users.push(user); saveUsers(users); enterApp(user); toast('Cuenta creada correctamente.');
});
$('#recoverForm').addEventListener('submit', (event) => { event.preventDefault(); toast('Enlace de recuperación simulado y enviado.'); showAuth('login'); });

function colorClass(color) { return { amarillo: 'yellow', rosa: 'pink', azul: 'blue', verde: 'green', lila: 'purple' }[color] || 'yellow'; }
function renderNote(note) {
  state.notes.set(note.id, note); let element = document.querySelector(`[data-note-id="${CSS.escape(note.id)}"]`);
  if (!element) {
    element = document.createElement('article'); element.className = `note ${colorClass(note.color)}`; element.dataset.noteId = note.id;
    element.innerHTML = `<textarea maxlength="280" aria-label="Contenido de la nota"></textarea><div class="note-footer"><span></span><button class="note-delete" title="Eliminar">×</button></div>`;
    board.appendChild(element); setupDrag(element);
    element.querySelector('textarea').addEventListener('change', (event) => socket.emit('note:update', { id: note.id, texto: event.target.value, color: state.notes.get(note.id)?.color }));
    element.querySelector('.note-delete').addEventListener('click', () => { if (confirm('¿Eliminar esta nota?')) socket.emit('note:delete', note.id); });
  }
  element.className = `note ${colorClass(note.color)}${state.filter !== 'all' && state.filter !== note.color ? ' filtered' : ''}`;
  if (document.activeElement !== element.querySelector('textarea')) element.querySelector('textarea').value = note.texto;
  element.querySelector('.note-footer span').textContent = note.autor || 'Invitado'; element.style.left = `${note.x}px`; element.style.top = `${note.y}px`;
  $('#notesStat').textContent = state.notes.size;
}
function setupDrag(element) {
  let drag = null;
  element.addEventListener('pointerdown', (event) => {
    if (event.target.matches('textarea,button')) return; const rect = element.getBoundingClientRect();
    drag = { dx: event.clientX - rect.left, dy: event.clientY - rect.top }; element.setPointerCapture(event.pointerId); element.classList.add('dragging');
  });
  element.addEventListener('pointermove', (event) => {
    if (!drag) return; const bounds = board.getBoundingClientRect(); element.style.left = `${Math.max(0, event.clientX - bounds.left + board.scrollLeft - drag.dx)}px`; element.style.top = `${Math.max(0, event.clientY - bounds.top + board.scrollTop - drag.dy)}px`;
  });
  element.addEventListener('pointerup', () => {
    if (!drag) return; drag = null; element.classList.remove('dragging'); socket.emit('note:move', { id: element.dataset.noteId, x: parseFloat(element.style.left), y: parseFloat(element.style.top) });
  });
}

socket.on('connect', () => { $('#connectionStatus').textContent = 'Sincronizado'; });
socket.on('disconnect', () => { $('#connectionStatus').textContent = 'Reconectando…'; });
socket.on('notes:init', (notes) => notes.forEach(renderNote));
socket.on('note:created', renderNote); socket.on('note:updated', renderNote);
socket.on('note:moved', ({ id, x, y }) => { const note = state.notes.get(id); if (note) renderNote({ ...note, x, y }); });
socket.on('note:deleted', (id) => { state.notes.delete(id); document.querySelector(`[data-note-id="${CSS.escape(id)}"]`)?.remove(); $('#notesStat').textContent = state.notes.size; });
socket.on('users:count', (count) => { state.online = count; $('#onlineCount').textContent = count; $('#usersStat').textContent = count; });

$('#newNoteButton').addEventListener('click', () => { $('#noteForm').reset(); $('#noteDialog').showModal(); setTimeout(() => $('#noteText').focus(), 50); });
$('#noteForm').addEventListener('submit', (event) => {
  event.preventDefault(); const data = new FormData(event.currentTarget); $('#saveNote').disabled = true;
  socket.emit('note:create', { texto: $('#noteText').value, color: data.get('color'), autor: state.user?.name, x: 40 + Math.random() * 240, y: 50 + Math.random() * 180 }, (result) => { $('#saveNote').disabled = false; if (!result.ok) return toast(result.error); $('#noteDialog').close(); toast('Nota publicada.'); });
});
document.querySelectorAll('[data-filter]').forEach((button) => button.addEventListener('click', () => { state.filter = button.dataset.filter; document.querySelectorAll('[data-filter]').forEach((item) => item.classList.toggle('active', item === button)); state.notes.forEach(renderNote); }));
function openPanel(kind) { $('#sidePanel').classList.add('open'); $('#sidePanel').setAttribute('aria-hidden', 'false'); $('#profilePanel').classList.toggle('hidden', kind !== 'profile'); $('#adminPanel').classList.toggle('hidden', kind !== 'admin'); }
$('#profileButton').addEventListener('click', () => openPanel('profile')); $('#adminButton').addEventListener('click', () => { if (state.user?.role !== 'superadmin') return toast('Panel reservado para el superadministrador.'); openPanel('admin'); });
$('#closePanel').addEventListener('click', () => $('#sidePanel').classList.remove('open'));
$('#logoutButton').addEventListener('click', () => { sessionStorage.removeItem('muroSession'); state.user = null; $('#sidePanel').classList.remove('open'); showAuth('login'); });
$('#clearBoardButton').addEventListener('click', () => { if (!confirm('¿Eliminar todas las notas del muro?')) return; [...state.notes.keys()].forEach((id) => socket.emit('note:delete', id)); });

const session = JSON.parse(sessionStorage.getItem('muroSession') || 'null'); session ? enterApp(session) : showAuth('login');
