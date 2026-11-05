/**
 * Muro de Notas Adhesivas Colaborativo - Controlador Principal de la Aplicación
 * Conexión completa con el Backend:
 * 1. Validaciones estrictas de correo y contraseña (sin datos inventados)
 * 2. Flujo de registro validado y persistido por el backend
 * 3. Superadministrador: ingreso estándar con correo y contraseña, y acceso al
 *    Panel de Monitoreo (Modo Espectador) a través de una ventanita en su perfil
 * 4. Métricas, usuarios y salas sincronizados con la base de datos real del Backend
 */

(function () {
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => document.querySelectorAll(selector);

  const EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+$/;

  function toast(message, tone = 'info') {
    if (window.MuroUI) return window.MuroUI.toast(message, tone);
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
  let activeVerifiedToken = '';
  let currentUser = null;
  let cachedAdminUsers = [];
  let cachedAdminReports = [];

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

  function enterApp(user, token = '') {
    currentUser = user;
    sessionStorage.setItem('muroSession', JSON.stringify(user));
    if (token) sessionStorage.setItem('muroToken', token);

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
          enterApp(res.user, res.token);
          toast(`¡Bienvenida/o ${res.user.name}!`);
        } else {
          toast(res?.error || 'Correo o contraseña incorrectos.');
        }
      });
    } else {
      toast('Conectando con el servidor Backend...');
    }
  });

  /* Registro validado por el backend. No se generan ni registran códigos en
     el navegador y el correo nunca se envía a servicios externos. */

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

    const socket = window.MuroBoard?.getSocket();
    if (!socket) return toast('Conexión con el servidor no disponible.');
    socket.emit('auth:register', { name, email, password, passwordConfirmation: confirmPassword }, (res) => {
      if (!res?.ok) return toast(res?.error || 'No se pudo crear la cuenta.');
      activeVerifiedUser = res.user;
      activeVerifiedToken = res.token;
      showAuth('confirm');
      toast('✅ Cuenta registrada correctamente.');
    });
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
    pendingRegistration = null;
    showAuth('register');
    toast('Completa nuevamente el registro seguro.');
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
      enterApp(activeVerifiedUser, activeVerifiedToken);
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

      cachedAdminUsers = res.users || [];
      if ($('#metricUsersCount')) $('#metricUsersCount').textContent = cachedAdminUsers.length;
      if ($('#metricSuspendedCount')) $('#metricSuspendedCount').textContent = cachedAdminUsers.filter((user) => user.status === 'suspendido').length;

      socket.emit('admin:reports:list', {}, (reportResult) => {
        cachedAdminReports = reportResult?.ok ? reportResult.reports : [];
        const pending = cachedAdminReports.filter((report) => ['pendiente', 'en_revision'].includes(report.status)).length;
        const resolved = cachedAdminReports.filter((report) => report.status === 'resuelto').length;
        if ($('#metricReportsCount')) $('#metricReportsCount').textContent = pending;
        if ($('#metricResolvedCount')) $('#metricResolvedCount').textContent = resolved;
        if ($('#adminPendingBadge')) $('#adminPendingBadge').textContent = pending;
        renderAdminReports(cachedAdminReports);
        renderAdminRecentUsers(cachedAdminUsers, cachedAdminReports);
        renderAdminUsersTable(cachedAdminUsers, cachedAdminReports);
        renderAdminAllReports(cachedAdminReports);
        if (!reportResult?.ok) toast(reportResult?.error || 'No se pudieron cargar los reportes.');
      });
    });
  }

  function renderAdminReports(reports = []) {
    const reportsContainer = $('#adminRecentReports');
    if (!reportsContainer) return;

    reportsContainer.innerHTML = '';
    if (!reports.length) {
      reportsContainer.innerHTML = `<div class="muted" style="text-align:center; padding:24px;">Sin reportes pendientes en el sistema.</div>`;
      return;
    }

    reports.filter((rep) => ['pendiente', 'en_revision'].includes(rep.status)).slice(0, 4).forEach((rep) => {
      const item = document.createElement('div');
      item.className = 'report-item';
      const info = document.createElement('div'); info.className = 'report-item-info';
      const title = document.createElement('strong'); title.textContent = rep.reportedUserName ? `Reporte sobre ${rep.reportedUserName}` : rep.reason;
      const detail = document.createElement('small'); detail.textContent = `${rep.reporterName || 'Usuario'} · ${rep.detail}`;
      const status = document.createElement('span'); status.className = `status-badge ${rep.status}`; status.textContent = rep.status;
      info.append(title, detail); item.append(info, status);
      reportsContainer.appendChild(item);
    });
  }

  function reportsForUser(userId, reports = cachedAdminReports) {
    return reports.filter((report) => report.reportedUserId === userId);
  }

  async function moderateAccount(user, report = null) {
    const reports = reportsForUser(user.id);
    const result = await window.MuroUI.moderateUser({
      user,
      reportId: report?.id || '',
      reportSummary: report ? `${report.reason}: ${report.detail}` : `${reports.length} reporte(s) recibido(s) · ${user.sanctions?.length || 0} medida(s) previa(s)`
    });
    if (!result) return;
    if (result.action === 'eliminar') {
      const accepted = await window.MuroUI.confirmAction({ title: 'Eliminar cuenta', message: `La cuenta de ${user.name} se eliminará de forma permanente.`, confirmText: 'Eliminar cuenta', tone: 'danger', icon: '⚠️' });
      if (!accepted) return;
    }
    const socket = window.MuroBoard?.getSocket();
    socket.emit('admin:user:discipline', { userId: user.id, ...result }, (response) => {
      if (!response?.ok) return toast(response?.error || 'No se pudo aplicar la medida.', 'error');
      const finish = () => { toast('Medida aplicada y registrada.', 'success'); renderAdminDashboard(); };
      if (!result.reportId) return finish();
      socket.emit('admin:report:respond', { id: result.reportId, status: 'resuelto', decision: result.message }, () => finish());
    });
  }

  function makeModerationButton(user, report = null) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'primary-button compact moderation-button';
    button.textContent = 'Revisar';
    button.disabled = user.role === 'superadmin';
    button.addEventListener('click', () => moderateAccount(user, report));
    return button;
  }

  function renderAdminRecentUsers(users = [], reports = []) {
    const recentTable = $('#adminRecentUsersTable');
    if (!recentTable) return;

    recentTable.innerHTML = '';
    if (!users.length) {
      recentTable.innerHTML = `<tr><td colspan="5" class="muted" style="text-align:center; padding:20px;">No hay usuarios registrados.</td></tr>`;
      return;
    }

    [...users].sort((a, b) => reportsForUser(b.id, reports).length - reportsForUser(a.id, reports).length).slice(0, 5).forEach((u) => {
      const tr = document.createElement('tr');
      const name = document.createElement('td'); const strong = document.createElement('strong'); strong.textContent = u.name; name.appendChild(strong);
      const email = document.createElement('td'); email.textContent = u.email;
      const count = document.createElement('td'); count.textContent = String(reportsForUser(u.id, reports).length);
      const statusCell = document.createElement('td'); const status = document.createElement('span'); status.className = `status-badge ${u.status === 'suspendido' ? 'suspended' : 'active'}`; status.textContent = u.status || 'activo'; statusCell.appendChild(status);
      const action = document.createElement('td'); action.appendChild(makeModerationButton(u));
      tr.append(name, email, count, statusCell, action);
      recentTable.appendChild(tr);
    });
  }

  function renderAdminUsersTable(userList = [], reports = cachedAdminReports) {
    const tableBody = $('#adminAllUsersTable');
    if (!tableBody) return;

    tableBody.innerHTML = '';
    if (!userList.length) {
      tableBody.innerHTML = `<tr><td colspan="5" class="muted" style="text-align:center; padding:24px;">No se encontraron usuarios.</td></tr>`;
      return;
    }

    userList.forEach((u) => {
      const tr = document.createElement('tr');
      const name = document.createElement('td'); const strong = document.createElement('strong'); strong.textContent = u.name; name.append(strong, document.createElement('br')); const mail = document.createElement('small'); mail.className = 'muted'; mail.textContent = u.email; name.appendChild(mail);
      const count = document.createElement('td'); count.textContent = String(reportsForUser(u.id, reports).length);
      const sanction = document.createElement('td'); sanction.textContent = u.sanctions?.[0] ? `${u.sanctions[0].type} · ${timeAgo(u.sanctions[0].createdAt)}` : 'Sin medidas';
      const statusCell = document.createElement('td'); const status = document.createElement('span'); status.className = `status-badge ${u.status === 'suspendido' ? 'suspended' : 'active'}`; status.textContent = u.status || 'activo'; statusCell.appendChild(status);
      const action = document.createElement('td'); action.appendChild(makeModerationButton(u));
      tr.append(name, count, sanction, statusCell, action);
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
      const reporter = document.createElement('td'); reporter.textContent = rep.reporterName || 'Usuario';
      const reported = document.createElement('td'); const reportedStrong = document.createElement('strong'); reportedStrong.textContent = rep.reportedUserName || 'Sin usuario asociado'; reported.appendChild(reportedStrong); if (rep.reportedUserEmail) { const mail = document.createElement('small'); mail.className = 'muted'; mail.textContent = rep.reportedUserEmail; reported.append(document.createElement('br'), mail); }
      const reason = document.createElement('td'); const reasonStrong = document.createElement('strong'); reasonStrong.textContent = rep.reason; const detail = document.createElement('small'); detail.className = 'muted'; detail.textContent = rep.detail; reason.append(reasonStrong, document.createElement('br'), detail);
      const date = document.createElement('td'); date.textContent = timeAgo(rep.createdAt);
      const actions = document.createElement('td');
      const status = document.createElement('span'); status.className = `status-badge ${rep.status}`; status.textContent = rep.status;
      actions.appendChild(status);
      if (rep.status === 'pendiente') {
        const take = document.createElement('button'); take.type = 'button'; take.className = 'secondary-button compact'; take.textContent = 'Tomar';
        take.addEventListener('click', () => window.MuroBoard.getSocket().emit('admin:report:take', { id: rep.id }, (res) => res?.ok ? renderAdminDashboard() : toast(res?.error)));
        actions.appendChild(take);
      }
      if (['pendiente', 'en_revision'].includes(rep.status) && rep.reportedUserId) {
        const target = cachedAdminUsers.find((user) => user.id === rep.reportedUserId);
        if (target) actions.appendChild(makeModerationButton(target, rep));
      }
      tr.append(reporter, reported, reason, date, actions);
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
        resumen: 'Centro de ayuda',
        usuarios: 'Directorio de Usuarios',
        reportes: 'Reportes de usuarios'
      };

      if ($('#adminTabTitle')) $('#adminTabTitle').textContent = tabNameMap[targetTab] || 'Panel de Monitoreo';

      const allTabs = ['Resumen', 'Usuarios', 'Reportes'];
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
    sessionStorage.removeItem('muroToken');
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

  const savedToken = sessionStorage.getItem('muroToken') || '';
  const sessionSocket = window.MuroBoard?.getSocket();
  if (savedToken && sessionSocket) {
    sessionSocket.emit('auth:restore', { token: savedToken }, (res) => {
      if (res?.ok) enterApp(res.user, res.token);
      else {
        sessionStorage.removeItem('muroSession');
        sessionStorage.removeItem('muroToken');
        showAuth('login');
        toast(res?.error || 'La sesión expiró.');
      }
    });
  } else showAuth('login');
})();
