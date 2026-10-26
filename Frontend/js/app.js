/**
 * Muro de Notas Adhesivas Colaborativo - Controlador Principal de la Aplicación
 * Incluye:
 * 1. Flujo de verificación de cuenta por código de 6 dígitos enviado al correo
 * 2. Panel de Superadministrador en Modo Espectador (Monitoreo sin alteración)
 */

(function () {
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => document.querySelectorAll(selector);

  // Datos base y persistencia local
  function loadUsers() {
    let users = JSON.parse(localStorage.getItem('muroUsers') || '[]');
    if (!users.length) {
      users = [
        { id: 'usr-1', name: 'Boris Saldarrega', email: 'saldavargasboris@gmail.com', role: 'superadmin', verified: true, createdAt: Date.now() - 86400000 * 5 },
        { id: 'usr-2', name: 'Pierina Medranda', email: 'pierinamedranda7@gmail.com', role: 'usuario', verified: true, createdAt: Date.now() - 86400000 * 3 },
        { id: 'usr-3', name: 'Brenda Gonzalez', email: 'brenditagf@gmail.com', role: 'usuario', verified: true, createdAt: Date.now() - 86400000 * 2 }
      ];
      localStorage.setItem('muroUsers', JSON.stringify(users));
    }
    return users;
  }

  function saveUsers(users) {
    localStorage.setItem('muroUsers', JSON.stringify(users));
  }

  function toast(message) {
    const item = $('#toast');
    if (!item) return;
    item.textContent = message;
    item.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => item.classList.remove('show'), 2800);
  }

  function initials(name = 'Usuario') {
    return name.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || 'U';
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

  // Estado del flujo de registro y verificación
  let pendingRegistration = null;
  let countdownTimerId = null;
  let activeVerifiedUser = null;
  let currentUser = null;

  /* ==========================================
     NAVEGACIÓN ENTRE VISTAS DE AUTENTICACIÓN
     ========================================== */

  function showAuth(view = 'login') {
    $('#authView')?.classList.remove('hidden');
    $('#wallsView')?.classList.add('hidden');
    $('#appView')?.classList.add('hidden');
    $('#adminView')?.classList.add('hidden');

    const formIds = ['login', 'register', 'verify', 'confirm', 'recover'];
    formIds.forEach((name) => {
      const el = $(`#${name}Form`);
      if (el) el.classList.toggle('hidden', name !== view);
    });

    if (view === 'verify') {
      setTimeout(() => $$('.code-digit')[0]?.focus(), 100);
    }
  }

  function enterApp(user) {
    currentUser = user;
    sessionStorage.setItem('muroSession', JSON.stringify(user));

    $('#authView')?.classList.add('hidden');
    $('#appView')?.classList.add('hidden');
    $('#adminView')?.classList.add('hidden');
    $('#wallsView')?.classList.remove('hidden');

    if ($('#profileName')) $('#profileName').textContent = user.name;
    if ($('#profileEmail')) $('#profileEmail').textContent = user.email;
    if ($('#profileButton')) $('#profileButton').textContent = initials(user.name);
    if ($('#wallsProfileBtn')) $('#wallsProfileBtn').textContent = initials(user.name);

    // Si es superadministrador, mostrar acceso al panel de monitoreo
    const isSuperadmin = user && user.role === 'superadmin';
    $$('#adminButton, #wallsAdminButton').forEach((btn) => btn.classList.toggle('hidden', !isSuperadmin));
    $('#profileAdminAccess')?.classList.toggle('hidden', !isSuperadmin);

    if (window.MuroBoard) {
      window.MuroBoard.init(user);
    }
  }

  // Botones de cambio de formulario
  $$('[data-view]').forEach((button) => {
    button.addEventListener('click', () => showAuth(button.dataset.view));
  });

  /* ==========================================
     INICIO DE SESIÓN
     ========================================== */

  $('#loginForm')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const email = $('#loginEmail').value.trim().toLowerCase();
    const password = $('#loginPassword').value;
    const socket = window.MuroBoard?.getSocket();

    if (socket) {
      socket.emit('auth:login', { email, password }, (res) => {
        if (res && res.ok) {
          enterApp(res.user);
          toast(`¡Bienvenida/o ${res.user.name}!`);
        } else {
          fallbackLogin(email, password);
        }
      });
    } else {
      fallbackLogin(email, password);
    }
  });

  function fallbackLogin(email, password) {
    const user = loadUsers().find((u) => u.email === email);
    if (!user) return toast('Correo no encontrado. Por favor regístrate.');
    if (user.password && user.password !== password) return toast('Contraseña incorrecta.');
    enterApp(user);
    toast(`¡Bienvenida/o ${user.name}!`);
  }

  // Acceso directo como Superadministrador (Modo Monitor)
  $('#adminQuickLoginBtn')?.addEventListener('click', () => {
    const adminUser = {
      id: 'admin-mon-01',
      name: 'Superadministrador',
      email: 'saldavargasboris@gmail.com',
      role: 'superadmin',
      verified: true
    };
    currentUser = adminUser;
    sessionStorage.setItem('muroSession', JSON.stringify(adminUser));
    openAdminDashboard(adminUser);
    toast('👁️ Ingresaste al Panel de Monitoreo (Modo Espectador)');
  });

  /* ==========================================
     REGISTRO CON CÓDIGO DE VERIFICACIÓN (PASO 1)
     ========================================== */

  $('#registerForm')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const name = $('#registerName').value.trim();
    const email = $('#registerEmail').value.trim().toLowerCase();
    const password = $('#registerPassword').value;
    const confirmPassword = $('#registerConfirmPassword').value;

    if (password !== confirmPassword) {
      return toast('Las contraseñas no coinciden.');
    }

    const users = loadUsers();
    if (users.some((u) => u.email === email && u.verified)) {
      return toast('Ese correo ya está registrado.');
    }

    // Generar código de 6 dígitos para validación
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    pendingRegistration = {
      id: crypto.randomUUID(),
      name,
      email,
      password,
      code,
      role: email === 'saldavargasboris@gmail.com' ? 'superadmin' : 'usuario',
      expires: Date.now() + 10 * 60 * 1000
    };

    // Actualizar interfaz del paso de verificación
    if ($('#verifyEmailTarget')) $('#verifyEmailTarget').textContent = email;
    if ($('#mockCodeDisplay')) $('#mockCodeDisplay').textContent = code;

    // Limpiar cajas de dígitos
    $$('.code-digit').forEach((input) => (input.value = ''));

    // Iniciar temporizador de reenvío (45 seg)
    startResendCountdown(45);

    // Ir a la vista de verificación
    showAuth('verify');
    toast(`✉️ Código de confirmación enviado a: ${email}`);
  });

  /* ==========================================
     INPUTS DE 6 DÍGITOS (MANEJO FLUIDO)
     ========================================== */

  const digitInputs = $$('.code-digit');
  digitInputs.forEach((input, index) => {
    // Al escribir un dígito, avanzar al siguiente input
    input.addEventListener('input', (e) => {
      const val = e.target.value.replace(/[^0-9]/g, '');
      e.target.value = val ? val[val.length - 1] : '';

      if (e.target.value && index < digitInputs.length - 1) {
        digitInputs[index + 1].focus();
      }
    });

    // Retroceder al borrar con Backspace
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && !input.value && index > 0) {
        digitInputs[index - 1].focus();
      }
    });

    // Soporte para pegar los 6 dígitos juntos
    input.addEventListener('paste', (e) => {
      e.preventDefault();
      const pasteData = (e.clipboardData || window.clipboardData).getData('text').trim();
      const numbers = pasteData.replace(/[^0-9]/g, '').slice(0, 6);
      if (numbers.length) {
        numbers.split('').forEach((digit, i) => {
          if (digitInputs[i]) digitInputs[i].value = digit;
        });
        const nextIndex = Math.min(numbers.length, digitInputs.length - 1);
        digitInputs[nextIndex]?.focus();
      }
    });
  });

  function startResendCountdown(seconds) {
    clearInterval(countdownTimerId);
    let remaining = seconds;
    const timerSpan = $('#countdownTimer');
    const countdownText = $('#countdownText');
    const resendBtn = $('#resendCodeBtn');

    if (countdownText) countdownText.style.display = 'inline';
    if (resendBtn) resendBtn.style.display = 'none';

    countdownTimerId = setInterval(() => {
      remaining--;
      if (timerSpan) {
        timerSpan.textContent = `00:${remaining < 10 ? '0' : ''}${remaining}`;
      }
      if (remaining <= 0) {
        clearInterval(countdownTimerId);
        if (countdownText) countdownText.style.display = 'none';
        if (resendBtn) resendBtn.style.display = 'inline';
      }
    }, 1000);
  }

  // Reenviar código
  $('#resendCodeBtn')?.addEventListener('click', () => {
    if (!pendingRegistration) return;
    const newCode = Math.floor(100000 + Math.random() * 900000).toString();
    pendingRegistration.code = newCode;
    if ($('#mockCodeDisplay')) $('#mockCodeDisplay').textContent = newCode;
    startResendCountdown(45);
    toast(`✉️ Nuevo código generado y enviado a ${pendingRegistration.email}`);
  });

  /* ==========================================
     VERIFICACIÓN DEL CÓDIGO (PASO 2)
     ========================================== */

  $('#verifyForm')?.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!pendingRegistration) {
      toast('No hay un registro pendiente. Vuelve a iniciar.');
      return showAuth('register');
    }

    const enteredCode = Array.from(digitInputs).map((inp) => inp.value).join('');

    if (enteredCode === pendingRegistration.code) {
      // Código correcto: Cuenta confirmada y verificada
      const users = loadUsers();
      const newUser = {
        id: pendingRegistration.id,
        name: pendingRegistration.name,
        email: pendingRegistration.email,
        password: pendingRegistration.password,
        role: pendingRegistration.role,
        verified: true,
        createdAt: Date.now()
      };

      // Guardar usuario verificado
      const existingIndex = users.findIndex((u) => u.email === newUser.email);
      if (existingIndex >= 0) {
        users[existingIndex] = newUser;
      } else {
        users.push(newUser);
      }
      saveUsers(users);

      // Emitir al socket si está disponible
      const socket = window.MuroBoard?.getSocket();
      if (socket) {
        socket.emit('auth:register', {
          name: newUser.name,
          email: newUser.email,
          password: newUser.password,
          passwordConfirmation: newUser.password
        });
      }

      activeVerifiedUser = newUser;
      clearInterval(countdownTimerId);
      showAuth('confirm');
      toast('✅ ¡Código verificado! Tu cuenta ha sido activada.');
    } else {
      // Código incorrecto
      digitInputs.forEach((inp) => {
        inp.classList.add('error');
        setTimeout(() => inp.classList.remove('error'), 400);
      });
      toast('❌ Código incorrecto. Revisa los 6 dígitos.');
    }
  });

  // Botón para entrar tras confirmación (PASO 3)
  $('#enterAfterConfirmBtn')?.addEventListener('click', () => {
    if (activeVerifiedUser) {
      enterApp(activeVerifiedUser);
      toast(`¡Bienvenida/o ${activeVerifiedUser.name}!`);
    } else {
      showAuth('login');
    }
  });

  // Recuperación de contraseña simulada
  $('#recoverForm')?.addEventListener('submit', (event) => {
    event.preventDefault();
    toast('Enlace de recuperación enviado si el correo está registrado.');
    showAuth('login');
  });

  /* ==========================================
     PANEL DE SUPERADMINISTRADOR (MODO ESPECTADOR)
     ========================================== */

  function openAdminDashboard(user) {
    currentUser = user || currentUser;
    $('#authView')?.classList.add('hidden');
    $('#wallsView')?.classList.add('hidden');
    $('#appView')?.classList.add('hidden');
    $('#sidePanel')?.classList.remove('open');
    $('#adminView')?.classList.remove('hidden');

    if ($('#adminUserName')) $('#adminUserName').textContent = currentUser?.name || 'Superadministrador';
    if ($('#adminAvatar')) $('#adminAvatar').textContent = initials(currentUser?.name || 'AD');

    renderAdminDashboard();
  }

  function renderAdminDashboard() {
    const users = loadUsers();
    const walls = window.MuroBoard ? window.MuroBoard.getWalls() : [];
    const notes = window.MuroBoard ? window.MuroBoard.getAllNotes() : [];
    const reports = window.MuroBoard ? window.MuroBoard.getReports() : [];

    // 1. Actualizar Contadores de Métricas
    if ($('#metricUsersCount')) $('#metricUsersCount').textContent = users.length;
    if ($('#metricNotesCount')) $('#metricNotesCount').textContent = notes.length;
    if ($('#metricWallsCount')) $('#metricWallsCount').textContent = walls.length || 1;
    if ($('#metricReportsCount')) $('#metricReportsCount').textContent = reports.length;
    if ($('#adminPendingBadge')) $('#adminPendingBadge').textContent = reports.length;

    // 2. Renderizar Moderación Pendiente
    const reportsContainer = $('#adminRecentReports');
    if (reportsContainer) {
      reportsContainer.innerHTML = '';
      if (!reports.length) {
        reportsContainer.innerHTML = `<div class="muted" style="text-align:center; padding:20px;">Sin reportes pendientes</div>`;
      } else {
        reports.slice(0, 4).forEach((rep) => {
          const item = document.createElement('div');
          item.className = 'report-item';
          item.innerHTML = `
            <div class="report-item-info">
              <strong>${rep.reason}</strong>
              <small>${rep.wallName} · ${rep.detail}</small>
            </div>
            <span class="status-badge pending">👁️ Pendiente</span>
          `;
          reportsContainer.appendChild(item);
        });
      }
    }

    // 3. Renderizar Usuarios Recientes (Tabla Resumen)
    const recentTable = $('#adminRecentUsersTable');
    if (recentTable) {
      recentTable.innerHTML = '';
      users.slice(0, 5).forEach((u) => {
        const tr = document.createElement('tr');
        const roleBadge = u.role === 'superadmin' ? 'superadmin' : 'user';
        tr.innerHTML = `
          <td><strong>${u.name}</strong></td>
          <td>${u.email}</td>
          <td><span class="status-badge ${roleBadge}">${u.role}</span></td>
          <td>1 muro</td>
          <td><span class="status-badge active">Activo</span></td>
        `;
        recentTable.appendChild(tr);
      });
    }

    // 4. Renderizar Todas las Salas (Pestaña Salas)
    const adminWallsGrid = $('#adminWallsGrid');
    if (adminWallsGrid) {
      adminWallsGrid.innerHTML = '';
      const displayWalls = walls.length ? walls : [
        { id: 'general', name: 'Muro de ideas', description: 'Espacio colaborativo principal', notesCount: notes.length }
      ];
      displayWalls.forEach((w) => {
        const card = document.createElement('article');
        card.className = 'wall-card';
        card.innerHTML = `
          <div class="wall-card-head">
            <span class="wall-card-badge">👁️ Monitoreo</span>
          </div>
          <div>
            <h3>${w.name}</h3>
            <p>${w.description || 'Sin descripción'}</p>
          </div>
          <div class="wall-card-footer">
            <span class="wall-card-meta">📝 ${w.notesCount ?? 0} notas registradas</span>
            <small class="muted">Solo lectura</small>
          </div>
        `;
        adminWallsGrid.appendChild(card);
      });
    }

    // 5. Renderizar Notas Globales (Pestaña Notas)
    const adminNotesGrid = $('#adminNotesGrid');
    if (adminNotesGrid) {
      adminNotesGrid.innerHTML = '';
      if (!notes.length) {
        adminNotesGrid.innerHTML = `<div class="muted" style="grid-column:1/-1; text-align:center; padding:40px;">No hay notas creadas en el tablero aún.</div>`;
      } else {
        notes.forEach((n) => {
          const card = document.createElement('article');
          const colorClass = { amarillo: 'yellow', rosa: 'pink', azul: 'blue', verde: 'green', lila: 'purple' }[n.color] || 'yellow';
          card.className = `note-monitor-card ${colorClass}`;
          card.innerHTML = `
            <p>${n.texto}</p>
            <div class="note-monitor-meta">
              <span>👤 ${n.autor || 'Invitado'}</span>
              <span>🕒 ${timeAgo(n.updatedAt)}</span>
            </div>
          `;
          adminNotesGrid.appendChild(card);
        });
      }
    }

    // 6. Renderizar Directorio Completo de Usuarios (Pestaña Usuarios)
    renderAdminUsersTable(users);

    // 7. Renderizar Tabla Completa de Reportes (Pestaña Reportes)
    const allReportsTable = $('#adminAllReportsTable');
    if (allReportsTable) {
      allReportsTable.innerHTML = '';
      if (!reports.length) {
        allReportsTable.innerHTML = `<tr><td colspan="5" class="muted" style="text-align:center; padding:30px;">No se han recibido reportes.</td></tr>`;
      } else {
        reports.forEach((rep) => {
          const tr = document.createElement('tr');
          tr.innerHTML = `
            <td><strong>${rep.reason}</strong></td>
            <td>${rep.detail}</td>
            <td>${rep.wallName || 'Muro de ideas'}</td>
            <td>${timeAgo(rep.createdAt)}</td>
            <td><span class="status-badge pending">👁️ Pendiente</span></td>
          `;
          allReportsTable.appendChild(tr);
        });
      }
    }
  }

  function renderAdminUsersTable(userList) {
    const tableBody = $('#adminAllUsersTable');
    if (!tableBody) return;
    tableBody.innerHTML = '';
    userList.forEach((u) => {
      const tr = document.createElement('tr');
      const roleBadge = u.role === 'superadmin' ? 'superadmin' : 'user';
      tr.innerHTML = `
        <td><strong>${u.name}</strong></td>
        <td>${u.email}</td>
        <td><span class="status-badge ${roleBadge}">${u.role}</span></td>
        <td><span class="status-badge active">${u.verified ? 'Verificado' : 'Pendiente'}</span></td>
        <td><small class="muted">👁️ Espectador</small></td>
      `;
      tableBody.appendChild(tr);
    });
  }

  // Buscador en tiempo real de usuarios en el Panel Admin
  $('#adminUserSearch')?.addEventListener('input', (e) => {
    const term = e.target.value.toLowerCase().trim();
    const allUsers = loadUsers();
    const filtered = allUsers.filter(
      (u) => u.name.toLowerCase().includes(term) || u.email.toLowerCase().includes(term)
    );
    renderAdminUsersTable(filtered);
  });

  // Cambio de pestañas en el panel de Superadministrador
  $$('[data-admin-tab]').forEach((tabBtn) => {
    tabBtn.addEventListener('click', () => {
      $$('[data-admin-tab]').forEach((btn) => btn.classList.remove('active'));
      tabBtn.classList.add('active');

      const targetTab = tabBtn.dataset.adminTab;
      const tabNameMap = {
        resumen: 'Resumen General',
        salas: 'Salas y Muros Monitoreados',
        notas: 'Notas Globales del Sistema',
        usuarios: 'Directorio de Usuarios',
        reportes: 'Bandeja de Reportes de Contenido'
      };

      if ($('#adminTabTitle')) $('#adminTabTitle').textContent = tabNameMap[targetTab] || 'Panel de Monitoreo';

      // Alternar visualización de contenidos
      const allTabs = ['Resumen', 'Salas', 'Notas', 'Usuarios', 'Reportes'];
      allTabs.forEach((name) => {
        const tabEl = $(`#adminTab${name}`);
        if (tabEl) {
          tabEl.classList.toggle('hidden', name.toLowerCase() !== targetTab);
        }
      });
    });
  });

  // Salir del Panel de Superadministrador y volver a Mis Muros
  $('#adminExitBtn')?.addEventListener('click', () => {
    $('#adminView')?.classList.add('hidden');
    $('#wallsView')?.classList.remove('hidden');
    if (window.MuroBoard) window.MuroBoard.fetchWalls();
  });

  /* ==========================================
     PANEL LATERAL Y ACCESOS
     ========================================== */

  function openPanel(kind) {
    const sidePanel = $('#sidePanel');
    if (!sidePanel) return;
    sidePanel.classList.add('open');
    sidePanel.setAttribute('aria-hidden', 'false');
    if ($('#profilePanel')) $('#profilePanel').classList.toggle('hidden', kind !== 'profile');
  }

  $('#profileButton')?.addEventListener('click', () => openPanel('profile'));
  $('#wallsProfileBtn')?.addEventListener('click', () => openPanel('profile'));
  $('#adminButton')?.addEventListener('click', () => openAdminDashboard(currentUser));
  $('#wallsAdminButton')?.addEventListener('click', () => openAdminDashboard(currentUser));
  $('#openAdminFromProfileBtn')?.addEventListener('click', () => openAdminDashboard(currentUser));

  $('#closePanel')?.addEventListener('click', () => $('#sidePanel')?.classList.remove('open'));
  $('#logoutButton')?.addEventListener('click', () => {
    sessionStorage.removeItem('muroSession');
    currentUser = null;
    $('#sidePanel')?.classList.remove('open');
    showAuth('login');
    toast('Sesión cerrada.');
  });

  /* ==========================================
     INICIALIZACIÓN
     ========================================== */

  const savedSession = JSON.parse(sessionStorage.getItem('muroSession') || 'null');
  if (savedSession) {
    enterApp(savedSession);
  } else {
    showAuth('login');
  }
})();
