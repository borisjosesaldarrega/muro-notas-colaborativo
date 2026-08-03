'use strict';

const socket = io();
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const board = $('#board');
const state = { token: sessionStorage.getItem('muroToken') || '', user: null, walls: [], currentWall: null, members: [], notes: new Map(), filter: 'all', online: 0, admin: null, avatarDraft: '', editingWallId: null, restoring: false };

function create(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function emitAck(event, payload = {}) { return new Promise((resolve) => socket.emit(event, payload, resolve)); }
function initials(name = 'Usuario') { return name.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]).join('').toUpperCase() || 'U'; }
function setBusy(button, busy) { if (button) { button.disabled = busy; button.setAttribute('aria-busy', String(busy)); } }
function toast(message, force = false) {
  if (!force && state.user?.settings?.notifications === false) return;
  const item = $('#toast'); item.textContent = message; item.classList.add('show'); clearTimeout(toast.timer); toast.timer = setTimeout(() => item.classList.remove('show'), 3000);
}
function formatDate(value) { return new Intl.DateTimeFormat('es-EC', { dateStyle: 'long' }).format(new Date(value)); }
function applyTheme(theme) { const safe = ['light', 'dark', 'system'].includes(theme) ? theme : 'light'; document.documentElement.dataset.theme = safe; localStorage.setItem('muroTheme', safe); }

function showAuth(view = 'login') {
  $('#authView').classList.remove('hidden'); $('#appView').classList.add('hidden');
  $$('[data-auth-form]').forEach((item) => item.classList.toggle('hidden', item.dataset.authForm !== view));
  setTimeout(() => $(`[data-auth-form="${view}"] input`)?.focus(), 0);
}
function showAppView(view) {
  $('#dashboardView').classList.toggle('hidden', view !== 'dashboard');
  $('#boardView').classList.toggle('hidden', view !== 'board');
  $('#screenView').classList.toggle('hidden', view !== 'screen');
  closeUserMenu();
}
function renderAvatar(target, user = state.user) {
  target.replaceChildren(); target.style.backgroundImage = '';
  if (user?.avatar) { target.style.backgroundImage = `url(${user.avatar})`; target.classList.add('has-image'); }
  else { target.classList.remove('has-image'); target.textContent = initials(user?.name); }
}
function hydrateUser(user, token = state.token) {
  state.user = user; state.token = token; sessionStorage.setItem('muroToken', token); applyTheme(user.settings?.theme || 'light');
  renderAvatar($('#avatarImage')); renderAvatar($('#menuAvatar')); $('#menuName').textContent = user.name; $('#menuEmail').textContent = user.email;
  $('#menuAdmin').classList.toggle('hidden', user.role !== 'superadmin');
  $('#authView').classList.add('hidden'); $('#appView').classList.remove('hidden'); showDashboard();
}
function clearSession() { state.token = ''; state.user = null; state.currentWall = null; sessionStorage.removeItem('muroToken'); showAuth('login'); }

$$('[data-auth-view]').forEach((button) => button.addEventListener('click', () => showAuth(button.dataset.authView)));
$('#loginForm').addEventListener('submit', async (event) => {
  event.preventDefault(); const button = event.currentTarget.querySelector('[type="submit"]'); setBusy(button, true);
  const result = await emitAck('auth:login', { email: $('#loginEmail').value, password: $('#loginPassword').value }); setBusy(button, false);
  if (!result?.ok) return toast(result?.error || 'No se pudo iniciar sesión.', true); hydrateUser(result.user, result.token); toast(`Bienvenido, ${result.user.name}.`);
});
$('#registerForm').addEventListener('submit', async (event) => {
  event.preventDefault(); const button = event.currentTarget.querySelector('[type="submit"]'); setBusy(button, true);
  const password = $('#registerPassword').value; const passwordConfirmation = $('#registerPasswordConfirmation').value;
  if (password !== passwordConfirmation) { $('#registerPasswordConfirmation').setCustomValidity('Las contraseñas deben coincidir.'); $('#registerPasswordConfirmation').reportValidity(); setBusy(button, false); return; }
  $('#registerPasswordConfirmation').setCustomValidity('');
  const result = await emitAck('auth:register', { name: $('#registerName').value, email: $('#registerEmail').value, password, passwordConfirmation }); setBusy(button, false);
  if (!result?.ok) return toast(result?.error || 'No se pudo crear la cuenta.', true); hydrateUser(result.user, result.token); toast(result.user.role === 'superadmin' ? 'Cuenta creada: eres superadministrador.' : 'Cuenta creada correctamente.');
});
$('#registerPasswordConfirmation').addEventListener('input', (event) => event.currentTarget.setCustomValidity(''));
$('#recoverForm').addEventListener('submit', async (event) => { event.preventDefault(); await emitAck('auth:recover', { email: $('#recoverEmail').value }); showAuth('success'); });

async function showDashboard() {
  showAppView('dashboard'); $('#headerContext').textContent = 'Mis muros';
  const result = await emitAck('walls:list'); if (!result?.ok) return toast(result?.error || 'No se pudieron cargar los muros.', true);
  state.walls = result.walls; renderWalls();
}
function renderWalls() {
  const grid = $('#wallsGrid'); grid.replaceChildren();
  if (!state.walls.length) {
    const empty = create('section', 'empty-state'); empty.append(create('div', 'empty-sticky', '＋'), create('h2', '', 'Todavía no tienes muros'), create('p', 'muted', 'Crea tu primer espacio para comenzar a colaborar.'));
    const button = create('button', 'primary-button', 'Crear nuevo muro'); button.type = 'button'; button.addEventListener('click', () => openWallDialog()); empty.append(button); grid.append(empty); return;
  }
  state.walls.forEach((wall, index) => {
    const card = create('article', `wall-card accent-${index % 5}`); card.tabIndex = 0;
    const tape = create('i', 'tape'); const role = create('span', 'role-chip', wall.role); const title = create('h2', '', wall.name); const description = create('p', 'muted', wall.description || 'Sin descripción');
    const stats = create('div', 'wall-stats'); stats.append(create('span', '', `${wall.notesCount} notas`), create('span', '', `${wall.membersCount} miembros`));
    const actions = create('div', 'wall-actions'); const open = create('button', 'primary-button compact', 'Abrir muro'); open.type = 'button'; open.addEventListener('click', () => selectWall(wall.id)); actions.append(open);
    if (wall.role === 'propietario') {
      const edit = create('button', 'wall-card-action', 'Editar'); edit.type = 'button'; edit.addEventListener('click', () => openWallDialog(wall)); actions.append(edit);
      if (wall.id !== 'general') { const remove = create('button', 'wall-card-action danger', 'Eliminar'); remove.type = 'button'; remove.addEventListener('click', () => deleteWall(wall)); actions.append(remove); }
    }
    card.append(tape, role, title, description, stats, actions); card.addEventListener('keydown', (event) => { if (event.key === 'Enter' && event.target === card) selectWall(wall.id); }); grid.append(card);
  });
  const add = create('button', 'wall-card create-wall-card'); add.type = 'button'; add.append(create('strong', '', '＋'), create('span', '', 'Crear nuevo muro')); add.addEventListener('click', () => openWallDialog()); grid.append(add);
}
function openWallDialog(wall = null) { state.editingWallId = wall?.id || null; $('#wallForm').reset(); $('#wallDialogTitle').textContent = wall ? 'Editar muro' : 'Crear muro'; $('#wallName').value = wall?.name || ''; $('#wallDescription').value = wall?.description || ''; $('#wallForm [type="submit"]').textContent = wall ? 'Guardar cambios' : 'Crear muro'; $('#wallDialog').showModal(); setTimeout(() => $('#wallName').focus(), 20); }
async function deleteWall(wall) { if (!(await confirmAction(`¿Eliminar “${wall.name}” y todas sus notas?`))) return; const result = await emitAck('wall:delete', { id: wall.id }); if (!result?.ok) return toast(result?.error, true); toast('Muro eliminado.'); showDashboard(); }
$('#createWallButton').addEventListener('click', () => openWallDialog()); $('#closeWallDialog').addEventListener('click', () => $('#wallDialog').close()); $('#cancelWall').addEventListener('click', () => $('#wallDialog').close());
$('#wallForm').addEventListener('submit', async (event) => { event.preventDefault(); const button = event.currentTarget.querySelector('[type="submit"]'); setBusy(button, true); const eventName = state.editingWallId ? 'wall:update' : 'wall:create'; const result = await emitAck(eventName, { id: state.editingWallId, name: $('#wallName').value, description: $('#wallDescription').value }); setBusy(button, false); if (!result?.ok) return toast(result?.error, true); $('#wallDialog').close(); toast(state.editingWallId ? 'Muro actualizado.' : 'Muro creado.'); state.editingWallId = null; showDashboard(); });

async function selectWall(id) {
  const result = await emitAck('wall:select', { id }); if (!result?.ok) return toast(result?.error || 'No se pudo abrir el muro.', true);
  state.currentWall = result.wall; state.members = result.members; state.notes.clear(); board.replaceChildren(); result.notes.forEach(renderNote); updateBoardPermissions();
  $('#headerContext').textContent = result.wall.name; showAppView('board');
}
function updateBoardPermissions() {
  const editable = ['propietario', 'editor'].includes(state.currentWall?.role); $('#newNoteButton').disabled = !editable; $('#newNoteButton').title = editable ? '' : 'Tu permiso es de solo lectura'; $('#membersButton').textContent = `Miembros (${state.members.length})`; updateStats();
}
$('#homeButton').addEventListener('click', showDashboard); $('#backToWalls').addEventListener('click', showDashboard);

function colorClass(color) { return { amarillo: 'yellow', rosa: 'pink', azul: 'blue', verde: 'green', lila: 'purple' }[color] || 'yellow'; }
function updateStats() { const total = $('#adminNotesStat'); if (total) total.textContent = state.notes.size; }
function clampPosition(element, x, y) { const maxX = Math.max(0, board.clientWidth - element.offsetWidth); const maxY = Math.max(0, board.clientHeight - element.offsetHeight); return { x: Math.min(Math.max(0, Number(x) || 0), maxX), y: Math.min(Math.max(0, Number(y) || 0), maxY) }; }
function createNoteElement(note) {
  const element = create('article', 'note'); element.dataset.noteId = note.id; element.setAttribute('aria-label', `Nota de ${note.autor || 'Invitado'}`);
  const textarea = create('textarea'); textarea.maxLength = 280; textarea.setAttribute('aria-label', 'Contenido de la nota'); textarea.readOnly = state.currentWall?.role === 'lector';
  const footer = create('div', 'note-footer'); const author = create('span'); const remove = create('button', 'note-delete', '×'); remove.type = 'button'; remove.setAttribute('aria-label', 'Eliminar nota'); remove.hidden = state.currentWall?.role === 'lector'; footer.append(author, remove); element.append(textarea, footer); board.append(element); setupDrag(element);
  textarea.addEventListener('change', async () => { const previous = state.notes.get(note.id); const texto = textarea.value.trim(); if (!texto) { textarea.value = previous?.texto || ''; return toast('La nota no puede quedar vacía.', true); } const result = await emitAck('note:update', { id: note.id, texto, color: previous?.color }); if (!result?.ok) { textarea.value = previous?.texto || ''; toast(result?.error, true); } });
  remove.addEventListener('click', async () => { if (state.user.settings.confirmDelete && !(await confirmAction('¿Eliminar esta nota? Esta acción no se puede deshacer.'))) return; setBusy(remove, true); const result = await emitAck('note:delete', { id: note.id }); if (!result?.ok) { setBusy(remove, false); toast(result?.error, true); } });
  return element;
}
function renderNote(note) {
  if (!note?.id) return; state.notes.set(note.id, note); let element = document.querySelector(`[data-note-id="${CSS.escape(note.id)}"]`); if (!element) element = createNoteElement(note);
  element.className = `note ${colorClass(note.color)}${state.filter !== 'all' && state.filter !== note.color ? ' filtered' : ''}`; const textarea = element.querySelector('textarea'); textarea.readOnly = state.currentWall?.role === 'lector'; if (document.activeElement !== textarea) textarea.value = note.texto;
  element.querySelector('.note-footer span').textContent = note.autor || 'Invitado'; const position = clampPosition(element, note.x, note.y); element.style.left = `${position.x}px`; element.style.top = `${position.y}px`;
}
function setupDrag(element) {
  let drag = null; element.addEventListener('pointerdown', (event) => { if (state.currentWall?.role === 'lector' || event.target.matches('textarea, button')) return; const rect = element.getBoundingClientRect(); drag = { dx: event.clientX - rect.left, dy: event.clientY - rect.top }; element.setPointerCapture(event.pointerId); element.classList.add('dragging'); });
  element.addEventListener('pointermove', (event) => { if (!drag) return; const bounds = board.getBoundingClientRect(); const position = clampPosition(element, event.clientX - bounds.left - drag.dx, event.clientY - bounds.top - drag.dy); element.style.left = `${position.x}px`; element.style.top = `${position.y}px`; });
  const end = async () => { if (!drag) return; drag = null; element.classList.remove('dragging'); const result = await emitAck('note:move', { id: element.dataset.noteId, x: parseFloat(element.style.left), y: parseFloat(element.style.top) }); if (!result?.ok) toast(result?.error, true); }; element.addEventListener('pointerup', end); element.addEventListener('pointercancel', end);
}
$('#newNoteButton').addEventListener('click', () => { $('#noteForm').reset(); $('#characterCount').textContent = '0 / 280'; $('#noteDialog').showModal(); setTimeout(() => $('#noteText').focus(), 20); }); $('#closeNoteDialog').addEventListener('click', () => $('#noteDialog').close()); $('#cancelNote').addEventListener('click', () => $('#noteDialog').close()); $('#noteText').addEventListener('input', (event) => { $('#characterCount').textContent = `${event.target.value.length} / 280`; });
$('#noteForm').addEventListener('submit', async (event) => { event.preventDefault(); const data = new FormData(event.currentTarget); const button = $('#saveNote'); setBusy(button, true); const result = await emitAck('note:create', { texto: $('#noteText').value, color: data.get('color'), x: 40 + Math.random() * 240, y: 50 + Math.random() * 180 }); setBusy(button, false); if (!result?.ok) return toast(result?.error, true); $('#noteDialog').close(); toast('Nota publicada.'); });
$$('[data-filter]').forEach((button) => button.addEventListener('click', () => { state.filter = button.dataset.filter; $$('[data-filter]').forEach((item) => { const active = item === button; item.classList.toggle('active', active); item.setAttribute('aria-pressed', String(active)); }); state.notes.forEach(renderNote); }));

function openUserMenu() { const menu = $('#userMenu'); menu.classList.remove('hidden'); $('#avatarButton').classList.add('open'); $('#avatarButton').setAttribute('aria-expanded', 'true'); setTimeout(() => menu.querySelector('[role="menuitem"]')?.focus(), 0); }
function closeUserMenu() { $('#userMenu').classList.add('hidden'); $('#avatarButton').classList.remove('open'); $('#avatarButton').setAttribute('aria-expanded', 'false'); }
$('#avatarButton').addEventListener('click', (event) => { event.stopPropagation(); $('#userMenu').classList.contains('hidden') ? openUserMenu() : closeUserMenu(); }); document.addEventListener('click', (event) => { if (!event.target.closest('.avatar-wrap')) closeUserMenu(); }); document.addEventListener('keydown', (event) => { if (event.key === 'Escape') { closeUserMenu(); [$('#noteDialog'), $('#wallDialog'), $('#membersDialog')].forEach((dialog) => { if (dialog.open) dialog.close(); }); } });
$$('[data-open-screen]').forEach((button) => button.addEventListener('click', () => openScreen(button.dataset.openScreen))); $('#closeScreen').addEventListener('click', showDashboard);
function openScreen(kind) {
  if (kind === 'admin' && state.user.role !== 'superadmin') return toast('El servidor no autorizó el acceso administrativo.', true);
  showAppView('screen'); $('#profileScreen').classList.toggle('hidden', kind !== 'profile'); $('#settingsScreen').classList.toggle('hidden', kind !== 'settings'); $('#adminScreen').classList.toggle('hidden', kind !== 'admin');
  const titles = { profile: ['Tu cuenta', 'Mi perfil'], settings: ['Preferencias', 'Configuración'], admin: ['Superadmin', 'Panel administrativo'] }; $('#screenEyebrow').textContent = titles[kind][0]; $('#screenTitle').textContent = titles[kind][1];
  if (kind === 'profile') renderProfile(); if (kind === 'settings') renderSettings(); if (kind === 'admin') loadAdmin();
}
function renderProfile() { state.avatarDraft = state.user.avatar || ''; $('#profileNameInput').value = state.user.name; $('#profileEmailInput').value = state.user.email; $('#profileCreatedInput').value = formatDate(state.user.createdAt); renderAvatar($('#profileAvatarPreview'), { ...state.user, avatar: state.avatarDraft }); }
$('#profileAvatarInput').addEventListener('change', () => { const file = $('#profileAvatarInput').files[0]; if (!file) return; if (file.size > 180_000) { $('#profileAvatarInput').value = ''; return toast('La imagen debe pesar menos de 180 KB.', true); } const reader = new FileReader(); reader.onload = () => { state.avatarDraft = String(reader.result); renderAvatar($('#profileAvatarPreview'), { ...state.user, avatar: state.avatarDraft }); }; reader.readAsDataURL(file); }); $('#removeAvatar').addEventListener('click', () => { state.avatarDraft = ''; renderAvatar($('#profileAvatarPreview'), { ...state.user, avatar: '' }); });
$('#profileForm').addEventListener('submit', async (event) => { event.preventDefault(); const button = event.currentTarget.querySelector('[type="submit"]'); setBusy(button, true); const result = await emitAck('profile:update', { name: $('#profileNameInput').value, avatar: state.avatarDraft }); setBusy(button, false); if (!result?.ok) return toast(result?.error, true); hydrateUserElements(result.user); toast('Perfil actualizado.'); });
function hydrateUserElements(user) { state.user = user; renderAvatar($('#avatarImage')); renderAvatar($('#menuAvatar')); $('#menuName').textContent = user.name; $('#menuEmail').textContent = user.email; $('#menuAdmin').classList.toggle('hidden', user.role !== 'superadmin'); }

function renderSettings() { const settings = state.user.settings; $$('[name="theme"]').forEach((radio) => { radio.checked = radio.value === settings.theme; }); $('#confirmDeleteSetting').checked = settings.confirmDelete; $('#compactNotesSetting').checked = settings.compactNotes; $('#notificationsSetting').checked = settings.notifications; document.body.classList.toggle('compact-notes', settings.compactNotes); }
$$('[data-settings-tab]').forEach((button) => button.addEventListener('click', () => { $$('[data-settings-tab]').forEach((item) => item.classList.toggle('active', item === button)); $$('[data-settings-panel]').forEach((panel) => panel.classList.toggle('hidden', panel.dataset.settingsPanel !== button.dataset.settingsTab)); }));
async function saveSettings(patch) { const result = await emitAck('settings:update', { ...state.user.settings, ...patch }); if (!result?.ok) return toast(result?.error, true); state.user.settings = result.settings; applyTheme(result.settings.theme); document.body.classList.toggle('compact-notes', result.settings.compactNotes); toast('Preferencias guardadas.'); }
$$('[name="theme"]').forEach((radio) => radio.addEventListener('change', () => saveSettings({ theme: radio.value }))); ['confirmDeleteSetting', 'compactNotesSetting', 'notificationsSetting'].forEach((id) => $(`#${id}`).addEventListener('change', () => saveSettings({ confirmDelete: $('#confirmDeleteSetting').checked, compactNotes: $('#compactNotesSetting').checked, notifications: $('#notificationsSetting').checked })));
$('#passwordForm').addEventListener('submit', async (event) => { event.preventDefault(); const result = await emitAck('auth:password', { currentPassword: $('#currentPassword').value, newPassword: $('#newPassword').value }); if (!result?.ok) return toast(result?.error, true); event.currentTarget.reset(); toast('Contraseña actualizada.'); });
$('#deleteAccountButton').addEventListener('click', async () => { const password = await confirmAction('Escribe tu contraseña para eliminar la cuenta.', { input: true }); if (!password) return; const result = await emitAck('auth:delete', { password }); if (!result?.ok) return toast(result?.error, true); clearSession(); toast('Cuenta eliminada.', true); });

$('#membersButton').addEventListener('click', () => { renderMembers(); $('#membersDialog').showModal(); }); $('#closeMembersDialog').addEventListener('click', () => $('#membersDialog').close());
function renderMembers() {
  const list = $('#membersList'); list.replaceChildren(); const canManage = state.currentWall?.role === 'propietario'; $('#inviteMemberForm').classList.toggle('hidden', !canManage);
  state.members.forEach((member) => { const row = create('article', 'member-row'); const face = create('span', 'avatar-face'); renderAvatar(face, member); const info = create('div'); info.append(create('strong', '', member.name), create('small', '', member.email)); const role = create('select'); ['propietario', 'editor', 'lector'].forEach((value) => { const option = create('option', '', value); option.value = value; option.selected = member.roleInWall === value; role.append(option); }); role.disabled = !canManage || member.roleInWall === 'propietario'; role.addEventListener('change', async () => { const result = await emitAck('wall:member:update', { wallId: state.currentWall.id, userId: member.id, role: role.value }); if (!result?.ok) { toast(result?.error, true); return renderMembers(); } state.members = result.members; renderMembers(); }); const remove = create('button', 'icon-danger', '×'); remove.type = 'button'; remove.title = 'Quitar miembro'; remove.hidden = !canManage || member.roleInWall === 'propietario'; remove.addEventListener('click', async () => { if (!(await confirmAction(`¿Quitar a ${member.name} del muro?`))) return; const result = await emitAck('wall:member:remove', { wallId: state.currentWall.id, userId: member.id }); if (!result?.ok) return toast(result?.error, true); state.members = result.members; renderMembers(); }); row.append(face, info, role, remove); list.append(row); });
}
$('#inviteMemberForm').addEventListener('submit', async (event) => { event.preventDefault(); const result = await emitAck('wall:invite', { wallId: state.currentWall.id, email: $('#memberEmail').value, role: $('#memberRole').value }); if (!result?.ok) return toast(result?.error, true); state.members = result.members; event.currentTarget.reset(); renderMembers(); updateBoardPermissions(); toast('Miembro añadido.'); });

$$('[data-admin-tab]').forEach((button) => button.addEventListener('click', () => { $$('[data-admin-tab]').forEach((item) => item.classList.toggle('active', item === button)); $$('[data-admin-panel]').forEach((panel) => panel.classList.toggle('hidden', panel.dataset.adminPanel !== button.dataset.adminTab)); }));
async function loadAdmin() { const result = await emitAck('admin:snapshot'); if (!result?.ok) { toast(result?.error, true); return showDashboard(); } state.admin = result; renderAdmin(); }
function renderAdmin() {
  const summary = $('#adminSummary'); summary.replaceChildren(); const stats = create('div', 'admin-stats'); [['Usuarios', state.admin.users.length], ['Muros', state.admin.walls.length], ['Notas', state.admin.walls.reduce((sum, wall) => sum + wall.notesCount, 0)], ['Conectados', state.admin.connected]].forEach(([label, value], index) => { const card = create('article', `admin-stat tone-${index}`); card.append(create('small', '', label), create('strong', '', String(value))); stats.append(card); }); summary.append(stats, create('section', 'screen-card admin-note', 'El acceso superadmin está reservado a la cuenta propietaria y se valida siempre en el servidor.'));
  const users = $('#adminUsers'); users.replaceChildren(); const userTools = create('div', 'table-tools'); const search = create('input'); search.placeholder = 'Buscar usuario'; userTools.append(search); const table = create('div', 'data-list'); users.append(userTools, table);
  function drawUsers(query = '') { table.replaceChildren(); state.admin.users.filter((user) => `${user.name} ${user.email}`.toLowerCase().includes(query.toLowerCase())).forEach((user) => { const row = create('article', 'data-row'); const info = create('div'); info.append(create('strong', '', user.name), create('small', '', user.email)); const role = create('span', 'role-chip', user.role === 'superadmin' ? 'Superadmin propietario' : 'Usuario'); row.append(info, create('span', 'date-cell', formatDate(user.createdAt)), role); table.append(row); }); } search.addEventListener('input', () => drawUsers(search.value)); drawUsers();
  const walls = $('#adminWalls'); walls.replaceChildren(); state.admin.walls.forEach((wall) => { const card = create('article', 'admin-wall-card'); const head = create('div'); head.append(create('h3', '', wall.name), create('p', 'muted', `${wall.notesCount} notas · ${wall.membersCount} miembros`)); const clear = create('button', 'danger-button', 'Vaciar notas'); clear.type = 'button'; clear.disabled = wall.notesCount === 0; clear.addEventListener('click', async () => { if (!(await confirmAction(`¿Vaciar todas las notas de “${wall.name}”?`))) return; const result = await emitAck('admin:clear', { wallId: wall.id }); if (!result?.ok) return toast(result?.error, true); toast(`${result.removed} notas eliminadas.`); await loadAdmin(); }); head.append(clear); const list = create('div', 'mini-members'); wall.members.forEach((member) => list.append(create('span', '', `${member.name} · ${member.roleInWall}`))); card.append(head, list); walls.append(card); });
}

$('#logoutButton').addEventListener('click', async () => { await emitAck('auth:logout', { token: state.token }); clearSession(); toast('Sesión cerrada.', true); });
function confirmAction(message, options = {}) {
  return new Promise((resolve) => { $('#confirmMessage').textContent = message; $('#confirmInputWrap').classList.toggle('hidden', !options.input); $('#confirmInput').classList.toggle('hidden', !options.input); $('#confirmInput').value = ''; $('#confirmDialog').showModal(); const finish = () => { $('#confirmDialog').removeEventListener('close', finish); if ($('#confirmDialog').returnValue !== 'confirm') resolve(false); else resolve(options.input ? $('#confirmInput').value : true); }; $('#confirmDialog').addEventListener('close', finish); });
}

function setConnection(label, connected) { const status = $('#connectionStatus'); status.lastChild.textContent = ` ${label}`; status.classList.toggle('connected', connected); }
async function restoreSession() { if (!state.token || state.restoring) return; state.restoring = true; const result = await emitAck('auth:restore', { token: state.token }); state.restoring = false; if (result?.ok) hydrateUser(result.user, result.token); else { clearSession(); toast(result?.error || 'La sesión expiró.', true); } }
socket.on('connect', async () => { setConnection('Sincronizado', true); await restoreSession(); });
socket.on('disconnect', () => setConnection('Reconectando…', false)); socket.io.on('reconnect_attempt', () => setConnection('Reconectando…', false));
socket.on('users:count', (count) => { state.online = Number(count) || 0; $('#onlineCount').textContent = state.online; $('#onlineLabel').textContent = state.online === 1 ? 'conectado' : 'conectados'; });
socket.on('note:created', ({ wallId, note }) => { if (wallId === state.currentWall?.id) renderNote(note); }); socket.on('note:updated', ({ wallId, note }) => { if (wallId === state.currentWall?.id) renderNote(note); }); socket.on('note:moved', ({ wallId, id, x, y, updatedAt }) => { if (wallId !== state.currentWall?.id) return; const note = state.notes.get(id); if (note) renderNote({ ...note, x, y, updatedAt }); }); socket.on('note:deleted', ({ wallId, id }) => { if (wallId !== state.currentWall?.id) return; state.notes.delete(id); document.querySelector(`[data-note-id="${CSS.escape(id)}"]`)?.remove(); }); socket.on('board:cleared', ({ wallId, removed }) => { if (wallId !== state.currentWall?.id) return; state.notes.clear(); board.replaceChildren(); toast(`Muro limpiado: ${removed} notas eliminadas.`); });
socket.on('profile:changed', (user) => { if (user.id === state.user?.id) hydrateUserElements({ ...state.user, ...user }); state.members = state.members.map((member) => member.id === user.id ? { ...member, ...user } : member); }); socket.on('role:changed', (user) => { if (user.id === state.user?.id) { hydrateUserElements({ ...state.user, ...user }); if (user.role !== 'superadmin' && !$('#adminScreen').classList.contains('hidden')) showDashboard(); } }); socket.on('admin:changed', () => { if (!$('#adminScreen').classList.contains('hidden')) loadAdmin(); }); socket.on('wall:deleted', (id) => { if (state.currentWall?.id === id) { toast('Este muro fue eliminado.', true); showDashboard(); } });
window.addEventListener('resize', () => state.notes.forEach(renderNote)); applyTheme(localStorage.getItem('muroTheme') || 'light'); if (!state.token) showAuth('login'); else if (socket.connected) restoreSession();
