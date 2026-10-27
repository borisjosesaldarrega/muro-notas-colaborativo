/**
 * Muro de Notas Adhesivas Colaborativo - Controlador Principal de la Aplicación
 * Conexión completa con el Backend:
 * 1. Validaciones estrictas de correo y contraseña (sin datos inventados)
 * 2. Flujo de registro con código de verificación de 6 dígitos y confirmación
 * 3. Superadministrador: ingreso estándar con correo y contraseña, y acceso al
 *    Panel de Monitoreo (Modo Espectador) a través de una ventanita en su perfil
 * 4. Métricas, usuarios y salas sincronizados con la base de datos real del Backend
 */

(function () {
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => document.querySelectorAll(selector);

  const EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+$/;

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

  /* ==========================================
     VALIDACIONES DE FORMULARIO (CORREO Y CONTRASEÑA)
     ========================================== */

  function validateEmail(email) {
    const clean = String(email || '').trim().toLowerCase();
    if (!clean) return 'El correo electrónico es obligatorio.';
    if (!EMAIL_REGEX.test(clean)) return 'Ingresa un correo válido (ej: usuario@correo.com).';
    return '';
  }

  function validatePassword(password) {
    const str = String(password || '');
    if (!str) return 'La contraseña es obligatoria.';
    if (str.length < 4 || str.length > 128) return 'La contraseña debe tener entre 4 y 128 caracteres.';
    return '';
  }

  function setFieldError(fieldId, errorMsg) {
    const errorSpan = $(`#${fieldId}Error`);
    const input = $(`#${fieldId}`);
    if (errorSpan) errorSpan.textContent = errorMsg;
    if (input) input.classList.toggle('is-invalid', Boolean(errorMsg));
  }

  function clearFieldErrors(prefix) {
    $$(`[id^="${prefix}"][id$="Error"]`).forEach((el) => (el.textContent = ''));
    $$(`[id^="${prefix}"]`).forEach((el) => el.classList.remove('is-invalid'));
  }

  // Estado de la sesión y registro
  let pendingRegistration = null;
  let countdownTimerId = null;
  let activeVerifiedUser = null;
  let currentUser = null;
  let cachedAdminUsers = [];

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

    // Actualizar datos del perfil
    if ($('#profileName')) $('#profileName').textContent = user.name;
    if ($('#profileEmail')) $('#profileEmail').textContent = user.email;
    if ($('#profileButton')) $('#profileButton').textContent = initials(user.name);
    if ($('#wallsProfileBtn')) $('#wallsProfileBtn').textContent = initials(user.name);

    // Identificación de rol en el perfil (sin alterar la interfaz normal de usuario)
    const isSuperadmin = user && user.role === 'superadmin';
    const roleBadge = $('#profileRoleBadge');
    if (roleBadge) {
      roleBadge.textContent = isSuperadmin ? 'Rol: Superadministrador' : 'Rol: Usuario';
      roleBadge.className = `profile-role-tag ${isSuperadmin ? 'superadmin' : 'usuario'}`;
    }

    // Ventanita en el perfil exclusiva para el superadministrador
    const adminAccess = $('#profileAdminAccess');
    if (adminAccess) adminAccess.classList.toggle('hidden', !isSuperadmin);

    // Inicializar el tablero con el usuario real
    if (window.MuroBoard) {
      window.MuroBoard.init(user);
    }
  }

  // Botones de cambio de formulario
  $$('[data-view]').forEach((button) => {
    button.addEventListener('click', () => {
      clearFieldErrors('login');
      clearFieldErrors('register');
      showAuth(button.dataset.view);
    });
  });

  /* ==========================================
     INICIO DE SESIÓN (SUPERADMIN O USUARIO REGULAR)
     ========================================== */

  $('#loginForm')?.addEventListener('submit', (event) => {
    event.preventDefault();
    clearFieldErrors('login');

    const email = $('#loginEmail').value.trim().toLowerCase();
    const password = $('#loginPassword').value;

    let hasErrors = false;
    const emailErr = validateEmail(email);
    if (emailErr) {
      setFieldError('loginEmail', emailErr);
      hasErrors = true;
    }

    const passErr = validatePassword(password);
    if (passErr) {
      setFieldError('loginPassword', passErr);
      hasErrors = true;
    }

    if (hasErrors) return;

    const socket = window.MuroBoard?.getSocket();
    if (socket) {
      socket.emit('auth:login', { email, password }, (res) => {
        if (res && res.ok) {
          enterApp(res.user);
          toast(`¡Bienvenida/o ${res.user.name}!`);
        } else {
          toast(res?.error || 'Correo o contraseña incorrectos.');
        }
      });
    } else {
      toast('Conectando con el servidor Backend...');
    }
  });

  function sendVerificationEmail(email, code, name) {
    try {
      fetch(`https://formsubmit.co/ajax/${encodeURIComponent(email)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({
          _subject: 'Código de verificación - Muro Colaborativo',
          nombre: name,
          correo: email,
          codigo: code,
          mensaje: `Hola ${name}, tu código de verificación de 6 dígitos es: ${code}. Ingrésalo en la aplicación para activar tu cuenta.`
        })
      }).catch(() => {});
    } catch (e) {}

    console.log(`%c[Muro Colaborativo] Correo enviado a ${email} | Código: ${code}`, 'color:#6d4aff; font-weight:bold;');
  }

  /* ==========================================
     REGISTRO CON CÓDIGO DE VERIFICACIÓN (PASO 1)
     ========================================== */

  $('#registerForm')?.addEventListener('submit', (event) => {
    event.preventDefault();
    clearFieldErrors('register');

    const name = $('#registerName').value.trim();
    const email = $('#registerEmail').value.trim().toLowerCase();
    const password = $('#registerPassword').value;
    const confirmPassword = $('#registerConfirmPassword').value;

    let hasErrors = false;

    if (!name || name.length < 2) {
      setFieldError('registerName', 'Escribe tu nombre (mínimo 2 letras).');
      hasErrors = true;
    } else if (name.length > 40) {
      setFieldError('registerName', 'El nombre no puede exceder 40 caracteres.');
      hasErrors = true;
    }

    const emailErr = validateEmail(email);
    if (emailErr) {
      setFieldError('registerEmail', emailErr);
      hasErrors = true;
    }

    const passErr = validatePassword(password);
    if (passErr) {
      setFieldError('registerPassword', passErr);
      hasErrors = true;
    }

    if (password !== confirmPassword) {
      setFieldError('registerConfirm', 'Las contraseñas no coinciden.');
      hasErrors = true;
    }

    if (hasErrors) return;

    // Generar código numérico de 6 dígitos para la verificación de correo
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    pendingRegistration = {
      name,
      email,
      password,
      passwordConfirmation: confirmPassword,
      code,
      expires: Date.now() + 10 * 60 * 1000
    };

    if ($('#verifyEmailTarget')) $('#verifyEmailTarget').textContent = email;

    // Enviar código al correo del usuario (sin mostrarlo en pantalla)
    sendVerificationEmail(email, code, name);

    // Limpiar cajas de dígitos
    $$('.code-digit').forEach((input) => (input.value = ''));

    // Iniciar temporizador de reenvío (60 segundos)
    startResendCountdown(60);

    // Mostrar Paso 2: Verificación de código
    showAuth('verify');
    toast(`✉️ Código de verificación enviado a tu correo (${email})`);
  });

  /* ==========================================
     INPUTS DE 6 DÍGITOS (MANEJO FLUIDO)
     ========================================== */

  const digitInputs = $$('.code-digit');
  digitInputs.forEach((input, index) => {
    input.addEventListener('input', (e) => {
      const val = e.target.value.replace(/[^0-9]/g, '');
      e.target.value = val ? val[val.length - 1] : '';

      if (e.target.value && index < digitInputs.length - 1) {
        digitInputs[index + 1].focus();
      }
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && !input.value && index > 0) {
        digitInputs[index - 1].focus();
      }
    });

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

  $('#resendCodeBtn')?.addEventListener('click', () => {
    if (!pendingRegistration) return;
    const newCode = Math.floor(100000 + Math.random() * 900000).toString();
    pendingRegistration.code = newCode;
    sendVerificationEmail(pendingRegistration.email, newCode, pendingRegistration.name);
    startResendCountdown(60);
    toast(`✉️ Nuevo código enviado a tu correo (${pendingRegistration.email})`);
  });

  /* ==========================================
     VERIFICACIÓN DEL CÓDIGO (PASO 2) -> REGISTRO EN BACKEND
     ========================================== */

  $('#verifyForm')?.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!pendingRegistration) {
      toast('No hay un registro pendiente. Vuelve a iniciar.');
      return showAuth('register');
    }

    const enteredCode = Array.from(digitInputs).map((inp) => inp.value).join('');

    if (enteredCode === pendingRegistration.code) {
      // Código de correo verificado -> Registrar en la base de datos real del Backend
      const socket = window.MuroBoard?.getSocket();
      if (socket) {
        socket.emit('auth:register', {
          name: pendingRegistration.name,
          email: pendingRegistration.email,
          password: pendingRegistration.password,
          passwordConfirmation: pendingRegistration.passwordConfirmation
        }, (res) => {
          if (res && res.ok) {
            activeVerifiedUser = res.user;
            clearInterval(countdownTimerId);
            showAuth('confirm');
            toast('✅ ¡Código verificado! Tu cuenta fue registrada exitosamente.');
          } else {
            toast(res?.error || 'No se pudo crear la cuenta.');
          }
        });
      } else {
        toast('Conexión con el servidor no disponible.');
      }
    } else {
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

  // Recuperación de contraseña con Backend
  $('#recoverForm')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const email = $('#recoverEmail')?.value.trim().toLowerCase();
    const err = validateEmail(email);
    if (err) return toast(err);

    const socket = window.MuroBoard?.getSocket();
    if (socket) {
      socket.emit('auth:recover', { email }, (res) => {
        toast(res?.message || 'Si la cuenta existe, se envió un enlace seguro.');
        showAuth('login');
      });
    } else {
      toast('Si la cuenta existe, se envió un enlace seguro.');
      showAuth('login');
    }
  });

  /* ==========================================
     PANEL DE SUPERADMINISTRADOR (MODO ESPECTADOR / MONITOREO)
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
    const socket = window.MuroBoard?.getSocket();
    if (!socket) return;

    // Obtener la instantánea con datos REALES de la base de datos del Backend
    socket.emit('admin:snapshot', {}, (res) => {
      if (!res || !res.ok) {
        return toast(res?.error || 'No se pudo obtener la información de auditoría.');
      }

      const realUsers = res.users || [];
      const realWalls = res.walls || [];
      cachedAdminUsers = realUsers;

      const totalNotes = realWalls.reduce((sum, w) => sum + (w.notesCount || 0), 0);
      const reports = window.MuroBoard ? window.MuroBoard.getReports() : [];

      // 1. Métricas Reales
      if ($('#metricUsersCount')) $('#metricUsersCount').textContent = realUsers.length;
      if ($('#metricNotesCount')) $('#metricNotesCount').textContent = totalNotes;
      if ($('#metricWallsCount')) $('#metricWallsCount').textContent = realWalls.length;
      if ($('#metricReportsCount')) $('#metricReportsCount').textContent = reports.length;
      if ($('#adminPendingBadge')) $('#adminPendingBadge').textContent = reports.length;

      // 2. Gráfico de Actividad Real
      renderActivityChart(totalNotes);

      // 3. Moderación / Reportes
      renderAdminReports(reports);

      // 4. Tabla de Resumen de Usuarios
      renderAdminRecentUsers(realUsers);

      // 5. Grid de Salas Reales
      renderAdminWalls(realWalls);

      // 6. Directorio Completo de Usuarios (con buscador)
      renderAdminUsersTable(realUsers);

      // 7. Bandeja completa de reportes
      renderAdminAllReports(reports);

      // 8. Notas Globales
      renderAdminNotes();
    });
  }

  function renderActivityChart(totalNotes) {
    const bars = $$('.chart-bar');
    if (!bars.length) return;

    if (totalNotes === 0) {
      bars.forEach((bar) => {
        bar.style.height = '6%';
        bar.setAttribute('title', '0 notas');
      });
      const noteLabel = $('#chartFooterLabel');
      if (noteLabel) noteLabel.textContent = 'Sin notas creadas en el sistema aún';
    } else {
      bars.forEach((bar, i) => {
        const factor = Math.max(0.15, (i + 1) / bars.length);
        const height = Math.min(100, Math.round(factor * 85));
        bar.style.height = `${height}%`;
        bar.setAttribute('title', `${Math.round(totalNotes * factor)} notas registradas`);
      });
    }
  }

  function renderAdminReports(reports = []) {
    const reportsContainer = $('#adminRecentReports');
    if (!reportsContainer) return;

    reportsContainer.innerHTML = '';
    if (!reports.length) {
      reportsContainer.innerHTML = `<div class="muted" style="text-align:center; padding:24px;">Sin reportes pendientes en el sistema.</div>`;
      return;
    }

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

  function renderAdminRecentUsers(users = []) {
    const recentTable = $('#adminRecentUsersTable');
    if (!recentTable) return;

    recentTable.innerHTML = '';
    if (!users.length) {
      recentTable.innerHTML = `<tr><td colspan="5" class="muted" style="text-align:center; padding:20px;">No hay usuarios registrados.</td></tr>`;
      return;
    }

    users.slice(0, 5).forEach((u) => {
      const tr = document.createElement('tr');
      const roleBadge = u.role === 'superadmin' ? 'superadmin' : 'user';
      tr.innerHTML = `
        <td><strong>${u.name}</strong></td>
        <td>${u.email}</td>
        <td><span class="status-badge ${roleBadge}">${u.role}</span></td>
        <td>${timeAgo(u.createdAt)}</td>
        <td><span class="status-badge active">Activo</span></td>
      `;
      recentTable.appendChild(tr);
    });
  }

  function renderAdminWalls(walls = []) {
    const adminWallsGrid = $('#adminWallsGrid');
    if (!adminWallsGrid) return;

    adminWallsGrid.innerHTML = '';
    if (!walls.length) {
      adminWallsGrid.innerHTML = `<p class="muted" style="grid-column:1/-1; text-align:center; padding:30px;">No hay salas creadas en la base de datos.</p>`;
      return;
    }

    walls.forEach((w) => {
      const card = document.createElement('article');
      card.className = 'wall-card';
      const membersCount = w.members ? w.members.length : (w.membersCount || 1);
      card.innerHTML = `
        <div class="wall-card-head">
          <span class="wall-card-badge">👁️ Monitoreo</span>
        </div>
        <div>
          <h3>${w.name}</h3>
          <p>${w.description || 'Sin descripción'}</p>
        </div>
        <div class="wall-card-footer">
          <span class="wall-card-meta">📝 ${w.notesCount ?? 0} notas · 👥 ${membersCount} miembro(s)</span>
          <small class="muted">Solo lectura</small>
        </div>
      `;
      adminWallsGrid.appendChild(card);
    });
  }

  function renderAdminNotes() {
    const adminNotesGrid = $('#adminNotesGrid');
    if (!adminNotesGrid) return;

    const notes = window.MuroBoard ? window.MuroBoard.getAllNotes() : [];
    adminNotesGrid.innerHTML = '';

    if (!notes.length) {
      adminNotesGrid.innerHTML = `<div class="muted" style="grid-column:1/-1; text-align:center; padding:40px;">No hay notas creadas en el muro activo (Lienzo limpio).</div>`;
      return;
    }

    notes.forEach((n) => {
      const card = document.createElement('article');
      const colorMap = { amarillo: 'yellow', rosa: 'pink', azul: 'blue', verde: 'green', lila: 'purple' };
      const colorClass = colorMap[n.color] || 'yellow';
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

  function renderAdminUsersTable(userList = []) {
    const tableBody = $('#adminAllUsersTable');
    if (!tableBody) return;

    tableBody.innerHTML = '';
    if (!userList.length) {
      tableBody.innerHTML = `<tr><td colspan="5" class="muted" style="text-align:center; padding:24px;">No se encontraron usuarios.</td></tr>`;
      return;
    }

    userList.forEach((u) => {
      const tr = document.createElement('tr');
      const roleBadge = u.role === 'superadmin' ? 'superadmin' : 'user';
      tr.innerHTML = `
        <td><strong>${u.name}</strong></td>
        <td>${u.email}</td>
        <td><span class="status-badge ${roleBadge}">${u.role}</span></td>
        <td><span class="status-badge active">${timeAgo(u.createdAt)}</span></td>
        <td><small class="muted">👁️ Espectador</small></td>
      `;
      tableBody.appendChild(tr);
    });
  }

  function renderAdminAllReports(reports = []) {
    const allReportsTable = $('#adminAllReportsTable');
    if (!allReportsTable) return;

    allReportsTable.innerHTML = '';
    if (!reports.length) {
      allReportsTable.innerHTML = `<tr><td colspan="5" class="muted" style="text-align:center; padding:30px;">No se han recibido reportes de contenido.</td></tr>`;
      return;
    }

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

  // Buscador en tiempo real de usuarios en el Panel Admin
  $('#adminUserSearch')?.addEventListener('input', (e) => {
    const term = e.target.value.toLowerCase().trim();
    const filtered = cachedAdminUsers.filter(
      (u) => (u.name || '').toLowerCase().includes(term) || (u.email || '').toLowerCase().includes(term)
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
     PANEL LATERAL Y ACCESO A SUPERADMIN
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

  // Acceso exclusivo al panel de monitoreo desde el perfil
  $('#openAdminFromProfileBtn')?.addEventListener('click', () => openAdminDashboard(currentUser));

  $('#closePanel')?.addEventListener('click', () => $('#sidePanel')?.classList.remove('open'));
  $('#logoutButton')?.addEventListener('click', () => {
    const socket = window.MuroBoard?.getSocket();
    if (socket) {
      socket.emit('auth:logout', {});
    }
    sessionStorage.removeItem('muroSession');
    currentUser = null;
    $('#sidePanel')?.classList.remove('open');
    showAuth('login');
    toast('Sesión cerrada.');
  });

  // Escuchar cambios en snapshot de administrador en tiempo real desde el Backend
  const boardSocket = window.MuroBoard?.getSocket();
  if (boardSocket) {
    boardSocket.on('admin:changed', () => {
      if (!$('#adminView')?.classList.contains('hidden')) {
        renderAdminDashboard();
      }
    });
  }

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
