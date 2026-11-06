/**
 * Muro de Notas Adhesivas Colaborativo - Módulo de Tablero y Salas (Pierina - Bloque A)
 * Soporta múltiples muros/salas, enlace compartible en el modal de invitación, reportes y Socket.io.
 */

window.MuroBoard = (function () {
  const socket = typeof io !== 'undefined' ? io() : null;
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => document.querySelectorAll(selector);
  const escapeHTML = (value = '') => String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);

  const board = $('#board');
  const boardStage = $('#boardStage');
  const boardSurface = $('#boardSurface');
  const BOARD_WIDTH = 1800;
  const BOARD_HEIGHT = 1200;
  const noteSaveTimers = new Map();
  const state = {
    notes: new Map(),
    walls: [],
    filter: 'all',
    online: 1,
    user: null,
    currentWall: null,
    sessionVersion: 0,
    editingWallId: null,
    reportingUserId: null,
    boardScale: window.matchMedia('(max-width: 800px)').matches ? 0.55 : 1
  };

  function setBoardScale(nextScale) {
    const scale = Math.max(0.2, Math.min(1.25, Number(nextScale) || 1));
    state.boardScale = scale;
    if (boardSurface) boardSurface.style.transform = `scale(${scale})`;
    if (boardStage) {
      boardStage.style.width = `${BOARD_WIDTH * scale}px`;
      boardStage.style.height = `${BOARD_HEIGHT * scale}px`;
    }
    if ($('#boardZoomLabel')) $('#boardZoomLabel').textContent = `${Math.round(scale * 100)}%`;
  }

  function toast(message, tone = 'info') {
    if (window.MuroUI) return window.MuroUI.toast(message, tone);
    const item = $('#toast');
    if (!item) return;
    item.textContent = message;
    item.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => item.classList.remove('show'), 2600);
  }

  function emitWithTimeout(event, payload, timeout = 12_000) {
    return new Promise((resolve) => {
      if (!socket) return resolve({ ok: false, error: 'No hay conexión con el servidor.' });
      let settled = false;
      const timer = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        resolve({ ok: false, error: 'El servidor tardó demasiado en responder.' });
      }, timeout);
      socket.emit(event, payload, (response) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        resolve(response);
      });
    });
  }

  async function persistNoteEdit(noteId, textarea, color) {
    window.clearTimeout(noteSaveTimers.get(noteId));
    noteSaveTimers.delete(noteId);
    const current = state.notes.get(noteId);
    const element = textarea.closest('.note');
    const texto = textarea.value.trim();
    if (!current) return;
    if (!texto) {
      textarea.value = current.texto || '';
      return toast('La nota no puede quedar vacía.', 'error');
    }
    const nextColor = color || current.color;
    if (texto === current.texto && nextColor === current.color) return;
    element?.classList.add('is-saving');
    const response = await emitWithTimeout('note:update', { id: noteId, texto, color: nextColor });
    element?.classList.remove('is-saving');
    if (!response?.ok) {
      textarea.value = current.texto || '';
      resizeNoteToContent(element, textarea, textarea.value);
      renderNote(current);
      return toast(response?.error || 'No se pudo guardar la edición.', 'error');
    }
    renderNote(response.note || { ...current, texto, color: nextColor, updatedAt: Date.now() });
  }

  function colorClass(color) {
    const map = { amarillo: 'yellow', rosa: 'pink', azul: 'blue', verde: 'green', lila: 'purple' };
    return map[color] || 'yellow';
  }

  function noteSizeClass(text = '') {
    const length = String(text).trim().length;
    if (length <= 70) return 'size-sm';
    if (length >= 180) return 'size-lg';
    return '';
  }

  function canCreateNote() {
    return ['propietario', 'editor', 'comunitario'].includes(state.currentWall?.role);
  }

  function canModifyNote(note) {
    const role = state.currentWall?.role;
    return role === 'propietario' || role === 'editor' || (role === 'comunitario' && note?.authorId === state.user?.id);
  }

  function applyWallPermissions() {
    const role = state.currentWall?.role || 'lector';
    const canEdit = canCreateNote();
    const canManage = role === 'propietario';
    const newNote = $('#newNoteButton');
    const invite = $('#inviteButton');
    const leaveWall = $('#leaveWallBtn');
    const deleteWall = $('#deleteWallBtn');
    if (newNote) { newNote.disabled = !canEdit; newNote.title = canEdit ? 'Crear una nota' : 'Tu permiso es de solo lectura'; }
    if (invite) invite.classList.toggle('hidden', !canManage);
    if (leaveWall) leaveWall.classList.toggle('hidden', !['editor', 'lector'].includes(role));
    if (deleteWall) deleteWall.classList.toggle('hidden', !canManage);
    state.notes.forEach(renderNote);
  }

  function resizeNoteToContent(element, textarea, text = '') {
    const sizeClass = noteSizeClass(text);
    const minimum = sizeClass === 'size-sm' ? 46 : sizeClass === 'size-lg' ? 96 : 68;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.max(minimum, textarea.scrollHeight)}px`;
    element.dataset.noteSize = sizeClass || 'medium';
  }

  function updateNoteCount() {
    const countSpan = $('#notesStat');
    if (countSpan) countSpan.textContent = state.notes.size;
  }

  function reset(user = null) {
    state.sessionVersion += 1;
    state.user = user;
    state.walls = [];
    state.notes.clear();
    state.currentWall = null;
    state.editingWallId = null;
    state.reportingUserId = null;
    state.filter = 'all';
    noteSaveTimers.forEach((timer) => window.clearTimeout(timer));
    noteSaveTimers.clear();
    if (boardSurface) boardSurface.innerHTML = '';
    if ($('#wallsGrid')) $('#wallsGrid').innerHTML = '<div class="muted walls-loading">Cargando tus muros…</div>';
    $$('[data-filter]').forEach((item) => item.classList.toggle('active', item.dataset.filter === 'all'));
    updateNoteCount();
  }

  function timeAgo(timestamp) {
    if (!timestamp) return 'ahora';
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return 'hace un momento';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `hace ${minutes} min`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `hace ${hours} h`;
    return 'hace días';
  }

  /* ==========================================
     RENDERIZADO Y EDICIÓN DE NOTAS (CORE PIERINA)
     ========================================== */

  function renderNote(note) {
    if (!note || !note.id || note.id === 'bienvenida') return;
    state.notes.set(note.id, note);

    let element = document.querySelector(`[data-note-id="${CSS.escape(note.id)}"]`);

    if (!element) {
      element = document.createElement('article');
      element.className = `note ${colorClass(note.color)}`;
      element.dataset.noteId = note.id;

      element.innerHTML = `
        <div class="note-header">
          <div class="color-picker-mini" title="Cambiar color">
            <button class="dot yellow" data-color="amarillo"></button>
            <button class="dot pink" data-color="rosa"></button>
            <button class="dot blue" data-color="azul"></button>
            <button class="dot green" data-color="verde"></button>
            <button class="dot purple" data-color="lila"></button>
          </div>
          <div style="display:flex; gap:4px; align-items:center;">
            <button class="note-delete" title="Eliminar nota">&times;</button>
          </div>
        </div>
        <textarea maxlength="280" aria-label="Contenido de la nota" placeholder="Escribe tu idea..."></textarea>
        <div class="note-footer">
          <span class="note-credits"><span class="author-tag"></span><small class="editor-tag"></small></span>
          <small class="time-tag"></small>
        </div>
      `;

      if (boardSurface) boardSurface.appendChild(element);
      setupDrag(element);

      const textarea = element.querySelector('textarea');
      textarea.addEventListener('input', () => {
        const current = state.notes.get(note.id);
        const sizeClass = noteSizeClass(textarea.value);
        element.className = `note ${colorClass(current?.color)}${sizeClass ? ` ${sizeClass}` : ''}${state.filter !== 'all' && state.filter !== current?.color ? ' filtered' : ''}`;
        resizeNoteToContent(element, textarea, textarea.value);
        window.clearTimeout(noteSaveTimers.get(note.id));
        noteSaveTimers.set(note.id, window.setTimeout(() => persistNoteEdit(note.id, textarea), 700));
      });
      textarea.addEventListener('change', () => persistNoteEdit(note.id, textarea));

      element.querySelector('.note-delete').addEventListener('click', async (e) => {
        e.stopPropagation();
        const mustConfirm = window.MuroApp?.getSettings()?.confirmDelete !== false;
        const accepted = mustConfirm ? await window.MuroUI.confirmAction({ title: 'Eliminar nota', message: 'La nota desaparecerá para todas las personas del muro.', confirmText: 'Eliminar nota', tone: 'danger' }) : true;
        if (accepted) {
          if (socket) {
            socket.emit('note:delete', { id: note.id }, (res) => {
              if (!res?.ok) toast(res?.error || 'No se pudo eliminar la nota.');
            });
          } else {
            state.notes.delete(note.id);
            element.remove();
            updateNoteCount();
          }
        }
      });

      element.querySelectorAll('.dot').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const selectedColor = btn.dataset.color;
          const current = state.notes.get(note.id);
          if (current && current.color !== selectedColor) {
            const sizeClass = noteSizeClass(textarea.value);
            element.className = `note ${colorClass(selectedColor)}${sizeClass ? ` ${sizeClass}` : ''}${state.filter !== 'all' && state.filter !== selectedColor ? ' filtered' : ''}`;
            persistNoteEdit(note.id, textarea, selectedColor);
          }
        });
      });
    }

    const sizeClass = noteSizeClass(note.texto);
    element.className = `note ${colorClass(note.color)}${sizeClass ? ` ${sizeClass}` : ''}${state.filter !== 'all' && state.filter !== note.color ? ' filtered' : ''}`;
    const textarea = element.querySelector('textarea');
    const canEdit = canModifyNote(note);
    textarea.readOnly = !canEdit;
    element.querySelector('.note-delete').classList.toggle('hidden', !canEdit);
    element.querySelector('.color-picker-mini').classList.toggle('hidden', !canEdit);
    element.classList.toggle('read-only', !canEdit);
    if (document.activeElement !== textarea) {
      textarea.value = note.texto || '';
    }
    resizeNoteToContent(element, textarea, note.texto);

    const authorTag = element.querySelector('.author-tag');
    if (authorTag) authorTag.textContent = `Creada por ${note.autor || 'Invitado'}`;

    const editorTag = element.querySelector('.editor-tag');
    if (editorTag) {
      const editedByAnotherPerson = note.editor && note.editorId && note.editorId !== note.authorId;
      editorTag.textContent = editedByAnotherPerson ? `Editada por ${note.editor}` : '';
      editorTag.hidden = !editedByAnotherPerson;
    }

    const timeTag = element.querySelector('.time-tag');
    if (timeTag) timeTag.textContent = timeAgo(note.updatedAt);

    element.style.left = `${note.x ?? 40}px`;
    element.style.top = `${note.y ?? 50}px`;

    updateNoteCount();
  }

  /* ==========================================
     ARRASTRE & DROP (HU-15)
     ========================================== */

  function setupDrag(element) {
    let drag = null;
    let lastPreviewAt = 0;

    element.addEventListener('pointerdown', (event) => {
      if (!canModifyNote(state.notes.get(element.dataset.noteId))) return;
      if (event.target.matches('textarea, button, .dot')) return;

      const rect = element.getBoundingClientRect();
      drag = {
        dx: (event.clientX - rect.left) / state.boardScale,
        dy: (event.clientY - rect.top) / state.boardScale
      };

      element.setPointerCapture(event.pointerId);
      element.classList.add('dragging');
    });

    element.addEventListener('pointermove', (event) => {
      if (!drag || !boardSurface) return;
      const bounds = boardSurface.getBoundingClientRect();

      const newX = Math.max(0, Math.min((event.clientX - bounds.left) / state.boardScale - drag.dx, BOARD_WIDTH - 120));
      const newY = Math.max(0, Math.min((event.clientY - bounds.top) / state.boardScale - drag.dy, BOARD_HEIGHT - 90));

      element.style.left = `${newX}px`;
      element.style.top = `${newY}px`;
      const now = performance.now();
      if (socket && now - lastPreviewAt >= 70) {
        lastPreviewAt = now;
        socket.volatile.emit('note:preview-move', { id: element.dataset.noteId, x: newX, y: newY });
      }
    });

    element.addEventListener('pointerup', () => {
      if (!drag) return;
      drag = null;
      element.classList.remove('dragging');

      const id = element.dataset.noteId;
      const x = parseFloat(element.style.left);
      const y = parseFloat(element.style.top);

      const current = state.notes.get(id);
      if (current) {
        current.x = x;
        current.y = y;
      }

      if (socket) {
        socket.emit('note:move', { id, x, y });
      }
    });
  }

  /* ==========================================
     GESTIÓN DE MUROS Y SALAS (DASHBOARD)
     ========================================== */

  function renderWallsList(walls) {
    state.walls = (walls || []).filter((wall) => Boolean(wall.role) || wall.isPublic === true);
    const grid = $('#wallsGrid');
    if (!grid) return;
    grid.innerHTML = '';

    if (!state.walls.length) {
      grid.innerHTML = `<div class="muted" style="grid-column: 1/-1; text-align: center; padding: 40px;">No tienes muros asignados. ¡Crea el primero!</div>`;
      return;
    }

    state.walls.forEach((wall) => {
      const card = document.createElement('article');
      card.className = `wall-card wall-color-${colorClass(wall.color)}`;
      const roleText = wall.role === 'propietario' ? 'Propietario/a' : wall.role === 'comunitario' ? 'Comunitario' : wall.role ? 'Colaborador/a' : 'Sin acceso';
      const canManage = wall.role === 'propietario' && wall.id !== 'general';

      card.innerHTML = `
        <div class="wall-card-head">
          <span class="wall-card-badge">${roleText}</span>
          ${canManage ? `<div class="wall-card-menu">
            <button class="wall-card-menu-trigger" type="button" aria-label="Opciones de ${escapeHTML(wall.name || 'muro')}" aria-haspopup="menu" aria-expanded="false">
              <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>
            </button>
            <div class="wall-card-menu-popover hidden" role="menu">
              <button type="button" data-wall-action="edit" role="menuitem">Editar</button>
              <button type="button" data-wall-action="delete" class="danger" role="menuitem">Eliminar</button>
            </div>
          </div>` : ''}
        </div>
        <div>
          <h3>${escapeHTML(wall.name || 'Muro sin título')}</h3>
          <p>${escapeHTML(wall.description || 'Sin descripción')}</p>
        </div>
        <div class="wall-card-footer">
          <span class="wall-card-meta"><svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3h10l4 4v14H5V3Zm9 2v3h3l-3-3ZM8 12h8v-2H8v2Zm0 4h8v-2H8v2Z"/></svg>${wall.notesCount ?? 0} notas</span>
          <button class="primary-button compact enter-wall-btn">Entrar al Muro →</button>
        </div>
      `;

      card.querySelector('.enter-wall-btn').addEventListener('click', () => {
        selectWall(wall.id, wall.name, wall.role);
      });

      const menuTrigger = card.querySelector('.wall-card-menu-trigger');
      const menu = card.querySelector('.wall-card-menu-popover');
      menuTrigger?.addEventListener('click', (event) => {
        event.stopPropagation();
        document.querySelectorAll('.wall-card-menu-popover').forEach((item) => {
          if (item !== menu) item.classList.add('hidden');
        });
        const willOpen = menu.classList.contains('hidden');
        menu.classList.toggle('hidden', !willOpen);
        menuTrigger.setAttribute('aria-expanded', String(willOpen));
      });
      menu?.querySelector('[data-wall-action="edit"]')?.addEventListener('click', () => openWallDialog(wall));
      menu?.querySelector('[data-wall-action="delete"]')?.addEventListener('click', () => deleteWallFromDashboard(wall));

      grid.appendChild(card);
    });
  }

  document.addEventListener('click', (event) => {
    if (event.target.closest('.wall-card-menu')) return;
    document.querySelectorAll('.wall-card-menu-popover').forEach((menu) => menu.classList.add('hidden'));
    document.querySelectorAll('.wall-card-menu-trigger').forEach((button) => button.setAttribute('aria-expanded', 'false'));
  });

  function openWallDialog(wall = null) {
    state.editingWallId = wall?.id || null;
    $('#wallForm')?.reset();
    if ($('#wallDialogEyebrow')) $('#wallDialogEyebrow').textContent = wall ? 'Tu espacio' : 'Nuevo espacio';
    if ($('#wallDialogTitle')) $('#wallDialogTitle').textContent = wall ? 'Editar muro' : 'Crear un muro';
    if ($('#saveWallBtn')) $('#saveWallBtn').textContent = wall ? 'Guardar cambios' : 'Crear muro';
    if ($('#wallNameInput')) $('#wallNameInput').value = wall?.name || '';
    if ($('#wallDescInput')) $('#wallDescInput').value = wall?.description || '';
    const selectedColor = document.querySelector(`input[name="wallColor"][value="${wall?.color || 'amarillo'}"]`);
    if (selectedColor) selectedColor.checked = true;
    $('#wallDialog')?.showModal();
  }

  async function deleteWallFromDashboard(wall) {
    const mustConfirm = window.MuroApp?.getSettings()?.confirmDelete !== false;
    const accepted = mustConfirm ? await window.MuroUI.confirmAction({ title: 'Eliminar muro', message: `Se eliminará “${wall.name}” con sus notas y dejará de aparecer para todas las personas.`, confirmText: 'Eliminar muro', tone: 'danger' }) : true;
    if (!accepted) return;
    if (!socket) return toast('No hay conexión con el servidor.', 'error');
    socket.emit('wall:delete', { id: wall.id }, (res) => {
      if (!res?.ok) return toast(res?.error || 'No se pudo eliminar el muro.', 'error');
      state.walls = state.walls.filter((item) => item.id !== wall.id);
      renderWallsList(state.walls);
      toast('Muro eliminado para todas las personas.', 'success');
    });
  }

  function fetchWalls() {
    if (!state.user?.id) return;
    const requestVersion = state.sessionVersion;
    const requestUserId = state.user.id;
    if (socket) {
      socket.emit('walls:list', {}, (res) => {
        if (requestVersion !== state.sessionVersion || state.user?.id !== requestUserId) return;
        if (res && res.ok && Array.isArray(res.walls)) {
          renderWallsList(res.walls);
          const requestedId = new URLSearchParams(window.location.hash.replace(/^#/, '')).get('wall');
          const requestedWall = requestedId && res.walls.find((wall) => wall.id === requestedId);
          if (requestedWall && $('#appView')?.classList.contains('hidden')) selectWall(requestedWall.id, requestedWall.name, requestedWall.role);
        }
      });
    } else {
      const localWalls = JSON.parse(localStorage.getItem('muroWalls') || 'null') || [
        { id: 'general', name: 'Muro de ideas', description: 'Espacio principal para tormenta de ideas del equipo.', role: 'propietario', notesCount: state.notes.size }
      ];
      renderWallsList(localWalls);
    }
  }

  function selectWall(wallId, wallName, role = 'propietario') {
    if (!state.user?.id) return;
    const requestVersion = state.sessionVersion;
    const requestUserId = state.user.id;
    state.currentWall = { id: wallId, name: wallName, role };
    window.location.hash = `wall=${wallId}`;

    $('#wallsView')?.classList.add('hidden');
    $('#appView')?.classList.remove('hidden');
    if ($('#currentWallTitle')) $('#currentWallTitle').textContent = wallName || 'Muro de ideas';

    // El botón de eliminar sala solo aparece si la persona es la dueña del muro
    const deleteBtn = $('#deleteWallBtn');
    if (deleteBtn) {
      deleteBtn.classList.toggle('hidden', role !== 'propietario' && wallId !== 'general');
    }

    state.notes.clear();
    if (boardSurface) boardSurface.innerHTML = '';

    if (socket) {
      socket.emit('wall:select', { id: wallId }, (res) => {
        if (requestVersion !== state.sessionVersion || state.user?.id !== requestUserId || state.currentWall?.id !== wallId) return;
        if (res && res.ok) {
          state.currentWall = {
            id: res.wall.id,
            name: res.wall.name,
            description: res.wall.description,
            ownerId: res.wall.ownerId,
            role: res.wall.role,
            color: res.wall.color,
            community: Boolean(res.wall.community),
            members: res.members || []
          };
          applyWallPermissions();
          if (res.notes) {
            res.notes.forEach(renderNote);
          }
          toast(`Entraste a la sala: ${res.wall.name}`);
        } else {
          toast(res?.error || 'No se pudo cargar la sala.', 'error');
          if (requestVersion === state.sessionVersion) showWallsView(false);
        }
      });
    } else {
      toast(`Entraste a la sala: ${wallName}`);
    }
  }

  /* ==========================================
     SOCKET.IO HANDLERS
     ========================================== */

  if (socket) {
    socket.on('connect', () => {
      const status = $('#connectionStatus');
      if (status) status.textContent = 'Conectado';
    });

    socket.on('disconnect', () => {
      const status = $('#connectionStatus');
      if (status) status.textContent = 'Reconectando…';
    });

    socket.on('notes:init', (notes) => {
      if (Array.isArray(notes)) {
        state.notes.clear();
        if (boardSurface) boardSurface.innerHTML = '';
        notes.forEach(renderNote);
      }
    });

    socket.on('note:created', (data) => renderNote(data.note || data));
    socket.on('note:updated', (data) => renderNote(data.note || data));

    socket.on('note:moved', (data) => {
      const existing = state.notes.get(data.id);
      if (existing) {
        existing.x = data.x;
        existing.y = data.y;
        if (data.updatedAt) existing.updatedAt = data.updatedAt;
        renderNote(existing);
      }
    });

    socket.on('note:preview-moved', (data) => {
      const element = document.querySelector(`[data-note-id="${CSS.escape(data.id)}"]`);
      if (!element || element.classList.contains('dragging')) return;
      requestAnimationFrame(() => {
        element.style.left = `${data.x}px`;
        element.style.top = `${data.y}px`;
      });
    });

    socket.on('note:deleted', (data) => {
      const id = typeof data === 'object' ? data.id : data;
      state.notes.delete(id);
      document.querySelector(`[data-note-id="${CSS.escape(id)}"]`)?.remove();
      updateNoteCount();
    });

    socket.on('wall:updated', (wall) => {
      const index = state.walls.findIndex((item) => item.id === wall.id);
      if (index >= 0) state.walls[index] = { ...state.walls[index], ...wall };
      if (state.currentWall?.id === wall.id) {
        state.currentWall = { ...state.currentWall, ...wall };
        if ($('#currentWallTitle')) $('#currentWallTitle').textContent = wall.name;
      }
      if (!$('#wallsView')?.classList.contains('hidden')) renderWallsList(state.walls);
    });

    socket.on('wall:deleted', (wallId) => {
      state.walls = state.walls.filter((wall) => wall.id !== wallId);
      if (state.currentWall?.id === wallId) {
        state.currentWall = { id: 'general', name: 'Muro de ideas', role: 'propietario' };
        $('#appView')?.classList.add('hidden');
        $('#wallsView')?.classList.remove('hidden');
        history.replaceState(null, '', `${location.pathname}${location.search}`);
        toast('Este muro fue eliminado por su propietario/a.', 'info');
      }
      renderWallsList(state.walls);
      fetchWalls();
    });

    socket.on('members:changed', async ({ wallId, userId, removed, members }) => {
      if (state.currentWall?.id !== wallId) return;
      if (removed && userId === state.user?.id) {
        state.currentWall = { id: 'general', name: 'Muro de ideas', role: 'propietario' };
        $('#inviteDialog')?.close();
        $('#appView')?.classList.add('hidden');
        $('#wallsView')?.classList.remove('hidden');
        history.replaceState(null, '', `${location.pathname}${location.search}`);
        toast('La persona propietaria revocó tu acceso a este muro.', 'info');
        return fetchWalls();
      }
      const result = members ? { ok: true, members } : await emitWithTimeout('wall:select', { id: wallId });
      if (!result?.ok) {
        $('#appView')?.classList.add('hidden');
        $('#wallsView')?.classList.remove('hidden');
        toast('Tu acceso a este muro cambió.', 'info');
        return fetchWalls();
      }
      state.currentWall.members = result.members || [];
      const ownMembership = state.currentWall.members.find((member) => member.id === state.user?.id);
      if (ownMembership) state.currentWall.role = ownMembership.roleInWall;
      applyWallPermissions();
      renderWallMembers(state.currentWall.members);
      if (userId === state.user?.id) toast(`Tu permiso cambió a ${state.currentWall.role === 'lector' ? 'Lector/a' : 'Editor/a'}.`, 'info');
    });

    socket.on('walls:changed', fetchWalls);

    socket.on('users:count', (count) => {
      state.online = count;
      if ($('#onlineCount')) $('#onlineCount').textContent = count;
      const label = $('.presence-label');
      if (label) label.textContent = Number(count) === 1 ? 'persona' : 'personas';
      if ($('#usersStat')) $('#usersStat').textContent = count;
    });

    socket.on('account:moderated', ({ action, message }) => {
      const title = action === 'advertir' ? 'Advertencia de soporte' : action === 'reactivar' ? 'Cuenta reactivada' : 'Medida aplicada a tu cuenta';
      window.MuroUI.confirmAction({ title, message, confirmText: 'Entendido', tone: action === 'advertir' ? 'primary' : 'danger', icon: action === 'reactivar' ? '💜' : '⚠️' });
    });
  }

  $$('[data-board-zoom]').forEach((button) => button.addEventListener('click', () => {
    const action = button.dataset.boardZoom;
    if (action === 'fit') {
      const available = Math.max(320, board?.clientWidth || window.innerWidth);
      setBoardScale(Math.min(1, available / BOARD_WIDTH));
    } else setBoardScale(state.boardScale + (action === 'in' ? 0.1 : -0.1));
  }));
  setBoardScale(state.boardScale);

  /* ==========================================
     EVENTOS DE MODALES
     ========================================== */

  // Modal Eliminar Muro (Dueño del Muro)
  $('#deleteWallBtn')?.addEventListener('click', async () => {
    const mustConfirm = window.MuroApp?.getSettings()?.confirmDelete !== false;
    const accepted = mustConfirm ? await window.MuroUI.confirmAction({ title: 'Eliminar muro', message: `Se eliminará “${state.currentWall.name}” y sus notas para todas las personas.`, confirmText: 'Eliminar muro', tone: 'danger' }) : true;
    if (!accepted) return;

    if (socket) {
      socket.emit('wall:delete', { id: state.currentWall.id }, (res) => {
        if (res && res.ok) {
          toast('Muro eliminado con éxito.');
          $('#appView')?.classList.add('hidden');
          $('#wallsView')?.classList.remove('hidden');
          fetchWalls();
        } else {
          toast(res?.error || 'No se pudo eliminar el muro.');
        }
      });
    } else {
      let localWalls = JSON.parse(localStorage.getItem('muroWalls') || '[]') || [];
      localWalls = localWalls.filter((w) => w.id !== state.currentWall.id);
      localStorage.setItem('muroWalls', JSON.stringify(localWalls));
      toast('Muro eliminado localmente.');
      $('#appView')?.classList.add('hidden');
      $('#wallsView')?.classList.remove('hidden');
      fetchWalls();
    }
  });

  $('#leaveWallBtn')?.addEventListener('click', async () => {
    const wall = state.currentWall;
    if (!wall || !['editor', 'lector'].includes(wall.role)) return;
    const accepted = await window.MuroUI.confirmAction({
      title: 'Dejar de participar',
      message: `Dejarás de tener acceso a “${wall.name}”. Para volver necesitarás usar otra invitación.`,
      confirmText: 'Dejar de participar',
      tone: 'danger'
    });
    if (!accepted) return;
    const response = await emitWithTimeout('wall:member:leave', { wallId: wall.id });
    if (!response?.ok) return toast(response?.error || 'No se pudo salir del muro.', 'error');
    state.walls = state.walls.filter((item) => item.id !== wall.id);
    showWallsView(true);
    toast('Ya no participas en ese muro.', 'success');
  });

  // Modal Nueva Nota
  function openNewNoteDialog() {
    $('#noteForm')?.reset();
    if ($('#characterCount')) $('#characterCount').textContent = '0 / 280';
    $('#noteDialog')?.showModal();
    setTimeout(() => $('#noteText')?.focus(), 50);
  }

  $('#newNoteButton')?.addEventListener('click', openNewNoteDialog);
  $('#closeNoteModal')?.addEventListener('click', () => $('#noteDialog')?.close());
  $('#cancelNoteModal')?.addEventListener('click', () => $('#noteDialog')?.close());
  board?.addEventListener('dblclick', (event) => {
    if (event.target.closest('.note, button, textarea')) return;
    openNewNoteDialog();
  });

  $('#noteText')?.addEventListener('input', (e) => {
    const counter = $('#characterCount');
    if (counter) counter.textContent = `${e.target.value.length} / 280`;
  });

  $('#noteForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const text = $('#noteText').value.trim();
    const colorInput = document.querySelector('input[name="color"]:checked');
    const color = colorInput ? colorInput.value : 'amarillo';

    if (!text) return toast('Ingresa el contenido de la nota.');

    const saveBtn = $('#saveNote');
    if (saveBtn) saveBtn.disabled = true;

    const payload = {
      texto: text,
      color,
      autor: state.user?.name || 'Invitado',
      x: 40 + Math.random() * 260,
      y: 60 + Math.random() * 200
    };

    if (socket) {
      const res = await emitWithTimeout('note:create', payload);
      if (saveBtn) saveBtn.disabled = false;
      if (res?.ok) {
        $('#noteDialog')?.close();
        toast('Nota publicada en el muro.', 'success');
      } else {
        toast(res?.error || 'No se pudo publicar la nota.', 'error');
      }
    } else {
      if (saveBtn) saveBtn.disabled = false;
      const localNote = { id: crypto.randomUUID(), ...payload, updatedAt: Date.now() };
      renderNote(localNote);
      $('#noteDialog')?.close();
      toast('Nota creada localmente.');
    }
  });

  // Modal Crear Muro / Sala
  $('#createWallBtn')?.addEventListener('click', () => openWallDialog());
  $('#closeWallModal')?.addEventListener('click', () => { state.editingWallId = null; $('#wallDialog')?.close(); });
  $('#cancelWallModal')?.addEventListener('click', () => { state.editingWallId = null; $('#wallDialog')?.close(); });

  $('#wallForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = $('#wallNameInput').value.trim();
    const description = $('#wallDescInput').value.trim();
    const color = document.querySelector('input[name="wallColor"]:checked')?.value || 'amarillo';

    if (!name) return toast('Escribe el nombre del muro.');

    if (socket) {
      const eventName = state.editingWallId ? 'wall:update' : 'wall:create';
      socket.emit(eventName, { id: state.editingWallId, name, description, color }, (res) => {
        if (res && res.ok) {
          $('#wallDialog')?.close();
          toast(state.editingWallId ? 'Muro actualizado.' : `¡Muro "${name}" creado!`, 'success');
          state.editingWallId = null;
          fetchWalls();
        } else {
          toast(res?.error || 'No se pudo crear el muro.');
        }
      });
    } else {
      const localWalls = JSON.parse(localStorage.getItem('muroWalls') || 'null') || [
        { id: 'general', name: 'Muro de ideas', description: 'Espacio principal', role: 'propietario', notesCount: 0 }
      ];
      if (state.editingWallId) {
        const index = localWalls.findIndex((wall) => wall.id === state.editingWallId);
        if (index >= 0) localWalls[index] = { ...localWalls[index], name, description, color };
      } else localWalls.push({ id: crypto.randomUUID(), name, description, color, role: 'propietario', notesCount: 0 });
      localStorage.setItem('muroWalls', JSON.stringify(localWalls));
      renderWallsList(localWalls);
      $('#wallDialog')?.close();
      toast(state.editingWallId ? 'Muro actualizado localmente.' : `Muro "${name}" creado localmente.`);
      state.editingWallId = null;
    }
  });

  // Renderizar miembros de la sala (Datos reales devueltos por el backend)
  function renderWallMembers(members = []) {
    const list = $('#wallMembersList');
    const count = $('#wallMembersCount');
    if (count) count.textContent = `${members.length} miembro${members.length === 1 ? '' : 's'}`;
    if (!list) return;

    list.innerHTML = '';
    if (!members.length) {
      list.innerHTML = '<p class="muted" style="font-size:0.82rem; padding:8px 0; text-align:center;">No hay miembros registrados en esta sala.</p>';
      return;
    }

    const isCurrentUserOwner = state.currentWall?.role === 'propietario';

    members.forEach((m) => {
      const item = document.createElement('div');
      item.className = 'member-item';
      const role = m.roleInWall || 'editor';
      const isTargetOwner = role === 'propietario';
      const roleLabel = isTargetOwner ? 'Propietario/a' : role === 'lector' ? 'Lector/a' : 'Editor/a';

      item.innerHTML = `
        <div class="member-item-info">
          <div class="member-item-avatar">${escapeHTML((m.name || 'U').slice(0, 2).toUpperCase())}</div>
          <div>
            <strong>${escapeHTML(m.name || 'Usuario')}</strong>
            <small class="muted" style="display:block;">${escapeHTML(m.email || '')}</small>
          </div>
        </div>
        <div style="display:flex; align-items:center; gap:8px;">
          ${isCurrentUserOwner && !isTargetOwner ? `<select class="member-role-select" aria-label="Permiso de ${escapeHTML(m.name || 'miembro')}"><option value="editor"${role === 'editor' ? ' selected' : ''}>Editor/a</option><option value="lector"${role === 'lector' ? ' selected' : ''}>Lector/a</option></select>` : `<span class="member-role-tag ${role}">${roleLabel}</span>`}
          ${m.id !== state.user?.id ? `<button type="button" class="report-member-btn" title="Reportar usuario">Reportar</button>` : ''}
          ${isCurrentUserOwner && !isTargetOwner ? `<button type="button" class="remove-member-btn" data-user-id="${m.id}" title="Quitar miembro">&times;</button>` : ''}
        </div>
      `;

      item.querySelector('.report-member-btn')?.addEventListener('click', () => {
        state.reportingUserId = m.id;
        $('#reportForm')?.reset();
        if ($('#reportedUserId')) $('#reportedUserId').value = m.id;
        if ($('#reportedUserName')) $('#reportedUserName').textContent = m.name || m.email || 'Usuario';
        $('#reportDialog')?.showModal();
      });

      if (isCurrentUserOwner && !isTargetOwner) {
        item.querySelector('.member-role-select')?.addEventListener('change', async (event) => {
          const select = event.currentTarget;
          const previousRole = role;
          select.disabled = true;
          const response = await emitWithTimeout('wall:member:update', { wallId: state.currentWall.id, userId: m.id, role: select.value });
          select.disabled = false;
          if (!response?.ok) {
            select.value = previousRole;
            return toast(response?.error || 'No se pudo cambiar el permiso.', 'error');
          }
          state.currentWall.members = response.members || state.currentWall.members;
          renderWallMembers(state.currentWall.members);
          toast(`${m.name || 'El miembro'} ahora tiene permiso de ${select.value === 'lector' ? 'Lector/a' : 'Editor/a'}.`, 'success');
        });

        item.querySelector('.remove-member-btn')?.addEventListener('click', async () => {
          const accepted = await window.MuroUI.confirmAction({ title: 'Quitar del muro', message: `${m.name || m.email} perderá el acceso a este muro.`, confirmText: 'Quitar acceso', tone: 'danger', icon: '👋' });
          if (accepted) {
            if (socket) {
              socket.emit('wall:member:remove', { wallId: state.currentWall.id, userId: m.id }, (res) => {
                if (res && res.ok) {
                  state.currentWall.members = res.members || [];
                  renderWallMembers(state.currentWall.members);
                  toast('Miembro retirado de la sala.');
                } else {
                  toast(res?.error || 'No se pudo quitar al miembro.');
                }
              });
            }
          }
        });
      }

      list.appendChild(item);
    });
  }

  // Modal Compartir e Invitar (Unificado según reglas del Backend)
  $('#inviteButton')?.addEventListener('click', async () => {
    $('#inviteForm')?.reset();

    // El enlace y el código se completan únicamente después de crear una invitación.
    const shareInput = $('#shareLinkInput');
    if (shareInput) shareInput.value = '';
    if ($('#inviteCodeOutput')) $('#inviteCodeOutput').value = '';
    if ($('#copyShareLinkBtn')) $('#copyShareLinkBtn').disabled = true;
    if ($('#inviteCodeStatus')) $('#inviteCodeStatus').textContent = 'Buscando el código activo…';

    // Regla estricta del backend: Solo la persona propietaria puede invitar miembros
    const isOwner = state.currentWall?.role === 'propietario';
    const ownerNotice = $('#inviteOwnerOnlyNotice');
    const roleSelect = $('#inviteRoleSelect');
    const sendBtn = $('#sendInviteBtn');

    if (ownerNotice) ownerNotice.classList.toggle('hidden', isOwner);
    if (roleSelect) roleSelect.disabled = !isOwner;
    if (sendBtn) sendBtn.disabled = !isOwner;

    // Renderizar miembros reales de la sala
    renderWallMembers(state.currentWall?.members || []);

    $('#inviteDialog')?.showModal();

    if (isOwner && socket) {
      const response = await emitWithTimeout('invitations:list', {});
      const active = response?.ok ? response.invitations.find((item) => item.owner && item.wallId === state.currentWall.id && item.status === 'pendiente' && item.expiresAt > Date.now()) : null;
      if (active?.code) {
        if ($('#inviteCodeOutput')) $('#inviteCodeOutput').value = active.code;
        if ($('#inviteRoleSelect')) $('#inviteRoleSelect').value = active.role;
        if ($('#copyShareLinkBtn')) $('#copyShareLinkBtn').disabled = false;
        if ($('#sendInviteBtn')) $('#sendInviteBtn').textContent = 'Generar otro código';
        if ($('#inviteCodeStatus')) $('#inviteCodeStatus').textContent = `Código activo hasta ${new Date(active.expiresAt).toLocaleString('es-EC')}.`;
      } else if (active) {
        if ($('#inviteCodeOutput')) $('#inviteCodeOutput').placeholder = 'Código anterior no recuperable';
        if ($('#sendInviteBtn')) $('#sendInviteBtn').textContent = 'Generar código nuevo';
        if ($('#inviteCodeStatus')) $('#inviteCodeStatus').textContent = 'Este código se creó antes de poder recuperarlo. Continúa funcionando si lo guardaste; genera uno nuevo solo si lo perdiste.';
      } else {
        if ($('#sendInviteBtn')) $('#sendInviteBtn').textContent = 'Generar código';
        if ($('#inviteCodeStatus')) $('#inviteCodeStatus').textContent = 'Todavía no hay un código activo para este muro.';
      }
    }
  });

  $('#copyShareLinkBtn')?.addEventListener('click', () => {
    const codeOutput = $('#inviteCodeOutput');
    if (codeOutput?.value) {
      navigator.clipboard.writeText(codeOutput.value).then(() => {
        toast('Código copiado al portapapeles.');
      }).catch(() => {
        codeOutput.select();
        toast('Código seleccionado para copiar.');
      });
    } else toast('Primero genera un código.');
  });

  $('#closeInviteModal')?.addEventListener('click', () => $('#inviteDialog')?.close());
  $('#cancelInviteModal')?.addEventListener('click', () => $('#inviteDialog')?.close());

  $('#inviteForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const role = $('#inviteRoleSelect').value;

    if ($('#inviteCodeOutput')?.value) {
      const replace = await window.MuroUI.confirmAction({ title: 'Generar otro código', message: 'El código actual dejará de funcionar y será reemplazado por uno nuevo.', confirmText: 'Reemplazar código', tone: 'warning' });
      if (!replace) return;
    }

    if (socket) {
      socket.emit('wall:invite', { wallId: state.currentWall.id, role }, (res) => {
        if (res && res.ok) {
          state.currentWall.members = res.members || state.currentWall.members;
          renderWallMembers(state.currentWall.members);
          const shareInput = $('#shareLinkInput'); const codeOutput = $('#inviteCodeOutput');
          if (shareInput) shareInput.value = res.link || shareInput.value;
          if (codeOutput) codeOutput.value = res.code || '';
          if ($('#copyShareLinkBtn')) $('#copyShareLinkBtn').disabled = !res.code;
          if ($('#sendInviteBtn')) $('#sendInviteBtn').textContent = 'Generar otro código';
          if ($('#inviteCodeStatus')) $('#inviteCodeStatus').textContent = 'Este código seguirá disponible después de cerrar o recargar la página.';
          toast(`Código ${res.code} creado. Compártelo con quien quieras invitar.`);
        } else {
          toast(res?.error || 'No se pudo enviar la invitación.');
        }
      });
    } else {
      toast('Conexión con el servidor no disponible.');
    }
  });

  let invitationPreviewTimer;
  $('#acceptInvitationCode')?.addEventListener('input', (event) => {
    const field = event.currentTarget;
    const compact = field.value.trim();
    if (/^[a-z0-9]{0,8}$/i.test(compact)) field.value = compact.toUpperCase();
    const preview = $('#acceptInvitationPreview');
    if (preview) { preview.textContent = ''; preview.classList.remove('field-error'); }
    clearTimeout(invitationPreviewTimer);
    if (!compact || !socket) return;
    if (!/^[a-z0-9]+$/i.test(compact)) {
      if (preview) { preview.textContent = 'Usa únicamente letras y números.'; preview.classList.add('field-error'); }
      return;
    }
    if (compact.length < 8) {
      if (preview) preview.textContent = `Faltan ${8 - compact.length} caracteres.`;
      return;
    }
    const requestedSecret = field.value.trim();
    invitationPreviewTimer = setTimeout(() => {
      socket.emit('invitation:preview', { secret: requestedSecret }, (res) => {
        if (!preview || field.value.trim() !== requestedSecret) return;
        preview.textContent = res?.ok
          ? `Muro: ${res.invitation.wallName} · Invita: ${res.invitation.invitedBy} · Rol: ${res.invitation.role}`
          : (res?.error || 'El código no existe, caducó o ya no está disponible.');
        preview.classList.toggle('field-error', !res?.ok);
      });
    }, 350);
  });

  $('#acceptInvitationForm')?.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!socket) return toast('Conexión con el servidor no disponible.');
    const secret = $('#acceptInvitationCode')?.value.trim();
    const preview = $('#acceptInvitationPreview');
    if (!/^[A-Z0-9]{8}$/.test(secret || '')) {
      if (preview) { preview.textContent = 'Escribe el código completo de 8 letras y números.'; preview.classList.add('field-error'); }
      return;
    }
    const answer = 'aceptar';
    socket.emit('invitation:answer', { secret, answer }, (res) => {
      if (!res?.ok) {
        if (preview) { preview.textContent = 'Sala no encontrada. El código puede ser incorrecto o haber caducado.'; preview.classList.add('field-error'); }
        return toast('Sala no encontrada.', 'error');
      }
      $('#acceptInvitationForm')?.reset();
      if ($('#acceptInvitationPreview')) $('#acceptInvitationPreview').textContent = '';
      toast(`Te uniste a ${res.wallName}. Código creado por ${res.invitedBy}.`);
      fetchWalls();
    });
  });

  let cachedReports = [];
  function loadReports() { return cachedReports; }

  // Modal Reportar Usuario
  $('#closeReportModal')?.addEventListener('click', () => $('#reportDialog')?.close());
  $('#cancelReportModal')?.addEventListener('click', () => $('#reportDialog')?.close());

  $('#reportForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const reason = $('#reportReasonSelect').value;
    const detail = $('#reportDetailInput')?.value.trim() || '';
    const userId = $('#reportedUserId')?.value || state.reportingUserId;
    if (!socket) return toast('Conexión con el servidor no disponible.');
    socket.emit('report:user:create', { reason, detail, userId, wallId: state.currentWall?.id || null }, (res) => {
      if (!res?.ok) return toast(res?.error || 'No se pudo registrar el reporte.', 'error');
      cachedReports.unshift(res.report); toast('Reporte enviado. Soporte revisará la cuenta.', 'success'); $('#reportDialog')?.close();
    });
  });

  // Botón Volver a Mis Muros (Salir de la sala)
  function showWallsView(updateAddress = true) {
    socket?.emit('wall:leave', {}, () => {});
    state.currentWall = null;
    state.notes.clear();
    if (boardSurface) boardSurface.innerHTML = '';
    $('#appView')?.classList.add('hidden');
    $('#wallsView')?.classList.remove('hidden');
    if (updateAddress) history.replaceState(null, '', `${location.pathname}${location.search}`);
    fetchWalls();
  }

  $('#backToWallsButton')?.addEventListener('click', () => showWallsView(true));

  window.addEventListener('hashchange', () => {
    if (!state.user) return;
    const wallId = new URLSearchParams(window.location.hash.replace(/^#/, '')).get('wall');
    if (!wallId && !$('#appView')?.classList.contains('hidden')) showWallsView(false);
    else if (wallId && !state.walls.some((wall) => wall.id === wallId)) fetchWalls();
    else if (wallId && $('#appView')?.classList.contains('hidden')) {
      const wall = state.walls.find((item) => item.id === wallId);
      if (wall) selectWall(wall.id, wall.name, wall.role);
    }
  });

  // Filtros de color
  $$('[data-filter]').forEach((button) => {
    button.addEventListener('click', () => {
      state.filter = button.dataset.filter;
      $$('[data-filter]').forEach((item) => item.classList.toggle('active', item === button));
      state.notes.forEach(renderNote);
    });
  });

  return {
    resetSession() {
      reset(null);
    },
    init(user) {
      if (!user?.id) return;
      if (state.user?.id !== user?.id) reset(user);
      else state.user = user;
      const invitation = new URLSearchParams(window.location.search).get('invitacion');
      if (invitation && socket) socket.emit('invitation:answer', { secret: invitation, answer: 'aceptar' }, (res) => {
        if (res?.ok) { history.replaceState({}, '', window.location.pathname); toast(`Invitación aceptada: ${res.wallName}, de ${res.invitedBy}.`); }
        else toast(res?.error || 'No se pudo aceptar la invitación.');
        fetchWalls();
      }); else fetchWalls();
    },
    reset,
    selectWall,
    fetchWalls,
    getSocket: () => socket,
    getAllNotes: () => Array.from(state.notes.values()),
    getWalls: () => state.walls,
    getReports: loadReports,
    getState: () => state
  };
})();
