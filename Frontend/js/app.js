/**
 * Muro de Notas Adhesivas Colaborativo - Controlador Principal de la Aplicación
 */

(function () {
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => document.querySelectorAll(selector);

  function loadUsers() { return JSON.parse(localStorage.getItem('muroUsers') || '[]'); }
  function saveUsers(users) { localStorage.setItem('muroUsers', JSON.stringify(users)); }
  function toast(message) {
    const item = $('#toast');
    if (!item) return;
    item.textContent = message;
    item.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => item.classList.remove('show'), 2600);
  }
  function initials(name = 'Usuario') {
    return name.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || 'U';
  }

  function showAuth(view = 'login') {
    $('#authView')?.classList.remove('hidden');
    $('#wallsView')?.classList.add('hidden');
    $('#appView')?.classList.add('hidden');
    ['login', 'register', 'recover'].forEach((name) => {
      $(`#${name}Form`)?.classList.toggle('hidden', name !== view);
    });
  }

  function enterApp(user) {
    sessionStorage.setItem('muroSession', JSON.stringify(user));
    $('#authView')?.classList.add('hidden');
    $('#appView')?.classList.add('hidden');
    $('#wallsView')?.classList.remove('hidden'); // Redirigir al Dashboard de Mis Muros

    if ($('#profileName')) $('#profileName').textContent = user.name;
    if ($('#profileEmail')) $('#profileEmail').textContent = user.email;
    if ($('#profileButton')) $('#profileButton').textContent = initials(user.name);
    if ($('#wallsProfileBtn')) $('#wallsProfileBtn').textContent = initials(user.name);

    // CONTROL STRICTO DE ROLES:
    // El botón de engranaje (⚙) de superadmin SOLO se muestra si user.role === 'superadmin'
    const isSuperadmin = user && user.role === 'superadmin';
    const adminBtns = $$('#adminButton, #wallsAdminButton');
    adminBtns.forEach((btn) => btn.classList.toggle('hidden', !isSuperadmin));

    if (window.MuroBoard) {
      window.MuroBoard.init(user);
    }
  }

  // Event Listeners de Formularios de Sesión
  $$('[data-view]').forEach((button) => button.addEventListener('click', () => showAuth(button.dataset.view)));

  $('#loginForm')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const email = $('#loginEmail').value.trim().toLowerCase();
    const password = $('#loginPassword').value;
    const socket = window.MuroBoard?.getSocket();

    if (socket) {
      socket.emit('auth:login', { email, password }, (res) => {
        if (res && res.ok) {
          enterApp(res.user);
          toast(`¡Bienvenida ${res.user.name}!`);
        } else {
          const user = loadUsers().find((u) => u.email === email && u.password === password);
          if (!user) return toast(res?.error || 'Correo o contraseña incorrectos.');
          enterApp(user);
        }
      });
    } else {
      const user = loadUsers().find((u) => u.email === email && u.password === password);
      if (!user) return toast('Correo o contraseña incorrectos.');
      enterApp(user);
    }
  });

  $('#registerForm')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const name = $('#registerName').value.trim();
    const email = $('#registerEmail').value.trim().toLowerCase();
    const password = $('#registerPassword').value;
    const socket = window.MuroBoard?.getSocket();

    if (socket) {
      socket.emit('auth:register', { name, email, password, passwordConfirmation: password }, (res) => {
        if (res && res.ok) {
          enterApp(res.user);
          toast('Cuenta registrada con éxito.');
        } else {
          toast(res?.error || 'No se pudo crear la cuenta.');
        }
      });
    } else {
      const users = loadUsers();
      if (users.some((u) => u.email === email)) return toast('Ese correo ya está registrado.');
      const user = { id: crypto.randomUUID(), name, email, password, role: users.length ? 'usuario' : 'superadmin' };
      users.push(user);
      saveUsers(users);
      enterApp(user);
      toast('Cuenta creada correctamente.');
    }
  });

  $('#recoverForm')?.addEventListener('submit', (event) => {
    event.preventDefault();
    toast('Enlace de recuperación enviado.');
    showAuth('login');
  });

  // Panel lateral
  function openPanel(kind) {
    const sidePanel = $('#sidePanel');
    if (!sidePanel) return;
    sidePanel.classList.add('open');
    sidePanel.setAttribute('aria-hidden', 'false');
    if ($('#profilePanel')) $('#profilePanel').classList.toggle('hidden', kind !== 'profile');
    if ($('#adminPanel')) $('#adminPanel').classList.toggle('hidden', kind !== 'admin');
  }

  $('#profileButton')?.addEventListener('click', () => openPanel('profile'));
  $('#wallsProfileBtn')?.addEventListener('click', () => openPanel('profile'));
  
  // Botones de superadmin (solo para Brenda o cuentas superadmin)
  $('#adminButton')?.addEventListener('click', () => openPanel('admin'));
  $('#wallsAdminButton')?.addEventListener('click', () => openPanel('admin'));

  $('#closePanel')?.addEventListener('click', () => $('#sidePanel')?.classList.remove('open'));
  $('#logoutButton')?.addEventListener('click', () => {
    sessionStorage.removeItem('muroSession');
    $('#sidePanel')?.classList.remove('open');
    showAuth('login');
  });

  // Inicialización
  const savedSession = JSON.parse(sessionStorage.getItem('muroSession') || 'null');
  if (savedSession) {
    enterApp(savedSession);
  } else {
    showAuth('login');
  }
})();
