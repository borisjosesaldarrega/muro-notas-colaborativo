/**
 * Muro de Notas Adhesivas Colaborativo - Módulo de Tablero y Salas (Pierina - Bloque A)
 * Soporta múltiples muros/salas, enlace compartible en el modal de invitación, reportes y Socket.io.
 */

window.MuroBoard = (function () {
  const socket = typeof io !== 'undefined' ? io() : null;
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => document.querySelectorAll(selector);

  const board = $('#board');
  const state = {
    notes: new Map(),
    walls: [],
    filter: 'all',
    online: 1,
    user: null,
    currentWall: { id: 'general', name: 'Muro de ideas', role: 'propietario' },
    reportingNoteId: null
  };

  function toast(message) {
    const item = $('#toast');
    if (!item) return;
    item.textContent = message;
    item.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => item.classList.remove('show'), 2600);
  }

  function colorClass(color) {
    const map = { amarillo: 'yellow', rosa: 'pink', azul: 'blue', verde: 'green', lila: 'purple' };
    return map[color] || 'yellow';
  }

  function updateNoteCount() {
    const countSpan = $('#notesStat');
    if (countSpan) countSpan.textContent = state.notes.size;
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
            <button class="note-report" title="Reportar contenido indebido" style="border:0; background:none; cursor:pointer; font-size:0.9rem;">🚩</button>
            <button class="note-delete" title="Eliminar nota">&times;</button>
          </div>
        </div>
        <textarea maxlength="280" aria-label="Contenido de la nota" placeholder="Escribe tu idea..."></textarea>
        <div class="note-footer">
          <span class="author-tag"></span>
          <small class="time-tag"></small>
        </div>
      `;

      if (board) board.appendChild(element);
      setupDrag(element);

      const textarea = element.querySelector('textarea');
      textarea.addEventListener('change', (event) => {
        const newText = event.target.value.trim();
        const current = state.notes.get(note.id);
        if (!newText) {
          textarea.value = current?.texto || '';
          return toast('La nota no puede quedar vacía.');
        }
        if (socket) {
          socket.emit('note:update', { id: note.id, texto: newText, color: current?.color });
        }
      });

      element.querySelector('.note-delete').addEventListener('click', (e) => {
        e.stopPropagation();
        if (confirm('¿Deseas eliminar esta nota adhesiva?')) {
          if (socket) {
            socket.emit('note:delete', { id: note.id });
          } else {
            state.notes.delete(note.id);
            element.remove();
            updateNoteCount();
          }
        }
      });

      element.querySelector('.note-report').addEventListener('click', (e) => {
        e.stopPropagation();
        state.reportingNoteId = note.id;
        $('#reportForm')?.reset();
        $('#reportDialog')?.showModal();
      });

      element.querySelectorAll('.dot').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const selectedColor = btn.dataset.color;
          const current = state.notes.get(note.id);
          if (current && current.color !== selectedColor) {
            current.color = selectedColor;
            element.className = `note ${colorClass(selectedColor)}${state.filter !== 'all' && state.filter !== selectedColor ? ' filtered' : ''}`;
            if (socket) {
              socket.emit('note:update', { id: note.id, texto: textarea.value, color: selectedColor });
            }
          }
        });
      });
    }

    element.className = `note ${colorClass(note.color)}${state.filter !== 'all' && state.filter !== note.color ? ' filtered' : ''}`;
    const textarea = element.querySelector('textarea');
    if (document.activeElement !== textarea) {
      textarea.value = note.texto || '';
    }

    const authorTag = element.querySelector('.author-tag');
    if (authorTag) authorTag.textContent = note.autor || 'Invitado';

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

    element.addEventListener('pointerdown', (event) => {
      if (event.target.matches('textarea, button, .dot, .note-report')) return;

      const rect = element.getBoundingClientRect();
      drag = {
        dx: event.clientX - rect.left,
        dy: event.clientY - rect.top
      };

      element.setPointerCapture(event.pointerId);
      element.classList.add('dragging');
    });

    element.addEventListener('pointermove', (event) => {
      if (!drag || !board) return;
      const bounds = board.getBoundingClientRect();

      const newX = Math.max(0, Math.min(event.clientX - bounds.left + board.scrollLeft - drag.dx, bounds.width + 1200));
      const newY = Math.max(0, Math.min(event.clientY - bounds.top + board.scrollTop - drag.dy, bounds.height + 1200));

      element.style.left = `${newX}px`;
      element.style.top = `${newY}px`;
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
    state.walls = walls || [];
    const grid = $('#wallsGrid');
    if (!grid) return;
    grid.innerHTML = '';

    if (!state.walls.length) {
      grid.innerHTML = `<div class="muted" style="grid-column: 1/-1; text-align: center; padding: 40px;">No tienes muros asignados. ¡Crea el primero!</div>`;
      return;
    }

    state.walls.forEach((wall) => {
      const card = document.createElement('article');
      card.className = 'wall-card';
      const roleText = wall.role ? (wall.role === 'propietario' ? 'Propietaria' : 'Colaboradora') : 'Público';

      card.innerHTML = `
        <div class="wall-card-head">
          <span class="wall-card-badge">${roleText}</span>
        </div>
        <div>
          <h3>${wall.name || 'Muro sin título'}</h3>
          <p>${wall.description || 'Sin descripción'}</p>
        </div>
        <div class="wall-card-footer">
          <span class="wall-card-meta">📝 ${wall.notesCount ?? 0} notas</span>
          <button class="primary-button compact enter-wall-btn">Entrar al Muro →</button>
        </div>
      `;

      card.querySelector('.enter-wall-btn').addEventListener('click', () => {
        selectWall(wall.id, wall.name, wall.role);
      });

      grid.appendChild(card);
    });
  }

  function fetchWalls() {
    if (socket) {
      socket.emit('walls:list', {}, (res) => {
        if (res && res.ok && Array.isArray(res.walls)) {
          renderWallsList(res.walls);
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
    if (board) board.innerHTML = '';

    if (socket) {
      socket.emit('wall:select', { id: wallId }, (res) => {
        if (res && res.ok) {
          state.currentWall = {
            id: res.wall.id,
            name: res.wall.name,
            description: res.wall.description,
            ownerId: res.wall.ownerId,
            role: res.wall.role,
            members: res.members || []
          };
          if (res.notes) {
            res.notes.forEach(renderNote);
          }
          toast(`Entraste a la sala: ${res.wall.name}`);
        } else {
          toast(res?.error || 'No se pudo cargar la sala.');
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
      if (status) status.textContent = '🟢 Sincronizado';
    });

    socket.on('disconnect', () => {
      const status = $('#connectionStatus');
      if (status) status.textContent = '🔴 Reconectando…';
    });

    socket.on('notes:init', (notes) => {
      if (Array.isArray(notes)) {
        state.notes.clear();
        if (board) board.innerHTML = '';
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

    socket.on('note:deleted', (data) => {
      const id = typeof data === 'object' ? data.id : data;
      state.notes.delete(id);
      document.querySelector(`[data-note-id="${CSS.escape(id)}"]`)?.remove();
      updateNoteCount();
    });

    socket.on('users:count', (count) => {
      state.online = count;
      if ($('#onlineCount')) $('#onlineCount').textContent = count;
      if ($('#usersStat')) $('#usersStat').textContent = count;
    });
  }

  /* ==========================================
     EVENTOS DE MODALES
     ========================================== */

  // Modal Eliminar Muro (Dueño del Muro)
  $('#deleteWallBtn')?.addEventListener('click', () => {
    if (!confirm(`¿Estás segura de eliminar el muro "${state.currentWall.name}"? Esta acción no se puede deshacer.`)) return;

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

  // Modal Nueva Nota
  $('#newNoteButton')?.addEventListener('click', () => {
    $('#noteForm')?.reset();
    if ($('#characterCount')) $('#characterCount').textContent = '0 / 280';
    $('#noteDialog')?.showModal();
    setTimeout(() => $('#noteText')?.focus(), 50);
  });

  $('#noteText')?.addEventListener('input', (e) => {
    const counter = $('#characterCount');
    if (counter) counter.textContent = `${e.target.value.length} / 280`;
  });

  $('#noteForm')?.addEventListener('submit', (event) => {
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
      socket.emit('note:create', payload, (res) => {
        if (saveBtn) saveBtn.disabled = false;
        if (res && res.ok) {
          $('#noteDialog')?.close();
          toast('Nota publicada en el muro.');
        } else {
          toast(res?.error || 'No se pudo publicar la nota.');
        }
      });
    } else {
      if (saveBtn) saveBtn.disabled = false;
      const localNote = { id: crypto.randomUUID(), ...payload, updatedAt: Date.now() };
      renderNote(localNote);
      $('#noteDialog')?.close();
      toast('Nota creada localmente.');
    }
  });

  // Modal Crear Muro / Sala
  $('#createWallBtn')?.addEventListener('click', () => {
    $('#wallForm')?.reset();
    $('#wallDialog')?.showModal();
  });
  $('#closeWallModal')?.addEventListener('click', () => $('#wallDialog')?.close());
  $('#cancelWallModal')?.addEventListener('click', () => $('#wallDialog')?.close());

  $('#wallForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = $('#wallNameInput').value.trim();
    const description = $('#wallDescInput').value.trim();

    if (!name) return toast('Escribe el nombre del muro.');

    if (socket) {
      socket.emit('wall:create', { name, description }, (res) => {
        if (res && res.ok) {
          $('#wallDialog')?.close();
          toast(`¡Muro "${name}" creado!`);
          fetchWalls();
        } else {
          toast(res?.error || 'No se pudo crear el muro.');
        }
      });
    } else {
      const localWalls = JSON.parse(localStorage.getItem('muroWalls') || 'null') || [
        { id: 'general', name: 'Muro de ideas', description: 'Espacio principal', role: 'propietario', notesCount: 0 }
      ];
      const newWall = { id: crypto.randomUUID(), name, description, role: 'propietario', notesCount: 0 };
      localWalls.push(newWall);
      localStorage.setItem('muroWalls', JSON.stringify(localWalls));
      renderWallsList(localWalls);
      $('#wallDialog')?.close();
      toast(`Muro "${name}" creado localmente.`);
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

      item.innerHTML = `
        <div class="member-item-info">
          <div class="member-item-avatar">${(m.name || 'U').slice(0, 2).toUpperCase()}</div>
          <div>
            <strong>${m.name || 'Usuario'}</strong>
            <small class="muted" style="display:block;">${m.email || ''}</small>
          </div>
        </div>
        <div style="display:flex; align-items:center; gap:8px;">
          <span class="member-role-tag ${role}">${role}</span>
          ${isCurrentUserOwner && !isTargetOwner ? `<button type="button" class="remove-member-btn" data-user-id="${m.id}" title="Quitar miembro" style="border:0; background:none; color:#ef4444; cursor:pointer; font-size:1.1rem; padding:0 4px;">&times;</button>` : ''}
        </div>
      `;

      if (isCurrentUserOwner && !isTargetOwner) {
        item.querySelector('.remove-member-btn')?.addEventListener('click', () => {
          if (confirm(`¿Quitar a ${m.name || m.email} de esta sala?`)) {
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
  $('#inviteButton')?.addEventListener('click', () => {
    $('#inviteForm')?.reset();
    
    // Rellenar automáticamente el enlace directo de la sala
    const shareInput = $('#shareLinkInput');
    if (shareInput) {
      shareInput.value = `${window.location.origin}${window.location.pathname}#wall=${state.currentWall.id}`;
    }

    // Regla estricta del backend: Solo la persona propietaria puede invitar miembros
    const isOwner = state.currentWall?.role === 'propietario';
    const ownerNotice = $('#inviteOwnerOnlyNotice');
    const emailInput = $('#inviteEmailInput');
    const roleSelect = $('#inviteRoleSelect');
    const sendBtn = $('#sendInviteBtn');

    if (ownerNotice) ownerNotice.classList.toggle('hidden', isOwner);
    if (emailInput) emailInput.disabled = !isOwner;
    if (roleSelect) roleSelect.disabled = !isOwner;
    if (sendBtn) sendBtn.disabled = !isOwner;

    // Renderizar miembros reales de la sala
    renderWallMembers(state.currentWall?.members || []);

    $('#inviteDialog')?.showModal();
  });

  $('#copyShareLinkBtn')?.addEventListener('click', () => {
    const shareInput = $('#shareLinkInput');
    if (shareInput && shareInput.value) {
      navigator.clipboard.writeText(shareInput.value).then(() => {
        toast('📋 ¡Enlace de la sala copiado al portapapeles!');
      }).catch(() => {
        shareInput.select();
        toast('Enlace seleccionado para copiar.');
      });
    }
  });

  $('#closeInviteModal')?.addEventListener('click', () => $('#inviteDialog')?.close());
  $('#cancelInviteModal')?.addEventListener('click', () => $('#inviteDialog')?.close());

  $('#inviteForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const email = $('#inviteEmailInput').value.trim().toLowerCase();
    const role = $('#inviteRoleSelect').value;

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email) return toast('Ingresa el correo del invitado.');
    if (!emailRegex.test(email)) return toast('Ingresa un correo electrónico válido.');

    if (socket) {
      socket.emit('wall:invite', { wallId: state.currentWall.id, email, role }, (res) => {
        if (res && res.ok) {
          state.currentWall.members = res.members || [];
          renderWallMembers(state.currentWall.members);
          $('#inviteEmailInput').value = '';
          toast(`¡Invitación exitosa! ${email} ahora es ${role}.`);
        } else {
          toast(res?.error || 'No se pudo enviar la invitación.');
        }
      });
    } else {
      toast('Conexión con el servidor no disponible.');
    }
  });

  function loadReports() {
    return JSON.parse(localStorage.getItem('muroReports') || '[]');
  }

  function saveReport(rep) {
    const reports = loadReports();
    reports.unshift(rep);
    localStorage.setItem('muroReports', JSON.stringify(reports));
  }

  // Modal Reportar Contenido
  $('#closeReportModal')?.addEventListener('click', () => $('#reportDialog')?.close());
  $('#cancelReportModal')?.addEventListener('click', () => $('#reportDialog')?.close());

  $('#reportForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const reason = $('#reportReasonSelect').value;
    const detail = $('#reportDetailInput')?.value.trim() || 'Sin detalles adicionales';
    const rep = {
      id: 'rep-' + crypto.randomUUID().slice(0, 8),
      reason,
      detail,
      wallName: state.currentWall?.name || 'Muro de ideas',
      noteId: state.reportingNoteId || 'N/A',
      createdAt: Date.now(),
      status: 'Pendiente'
    };
    saveReport(rep);
    toast(`🚩 Reporte registrado para supervisión (${reason})`);
    $('#reportDialog')?.close();
  });

  // Botón Volver a Mis Muros (Salir de la sala)
  $('#backToWallsButton')?.addEventListener('click', () => {
    $('#appView')?.classList.add('hidden');
    $('#wallsView')?.classList.remove('hidden');
    window.location.hash = '';
    fetchWalls();
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
    init(user) {
      state.user = user;
      fetchWalls();
    },
    selectWall,
    fetchWalls,
    getSocket: () => socket,
    getAllNotes: () => Array.from(state.notes.values()),
    getWalls: () => state.walls,
    getReports: loadReports,
    getState: () => state
  };
})();
