(function () {
  const $ = (selector) => document.querySelector(selector);

  function toast(message, tone = 'info') {
    const item = $('#toast');
    if (!item) return;
    item.textContent = message;
    item.dataset.tone = tone;
    item.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => item.classList.remove('show'), 3200);
  }

  function confirmAction({ title, message, confirmText = 'Confirmar', tone = 'primary', icon = '✨' }) {
    return new Promise((resolve) => {
      const dialog = $('#actionDialog');
      if (!dialog) return resolve(false);
      $('#actionDialogIcon').textContent = icon;
      $('#actionDialogTitle').textContent = title;
      $('#actionDialogMessage').textContent = message;
      const accept = $('#actionDialogAccept');
      const cancel = $('#actionDialogCancel');
      accept.textContent = confirmText;
      accept.className = tone === 'danger' ? 'danger-button action-confirm' : 'primary-button action-confirm';
      const close = (value) => { dialog.close(); resolve(value); };
      accept.onclick = () => close(true);
      cancel.onclick = () => close(false);
      dialog.oncancel = (event) => { event.preventDefault(); close(false); };
      dialog.showModal();
    });
  }

  function moderateUser({ user, reportId = '', reportSummary = '' }) {
    return new Promise((resolve) => {
      const dialog = $('#moderationDialog');
      if (!dialog) return resolve(null);
      $('#moderationUserName').textContent = user.name || 'Usuario';
      $('#moderationUserEmail').textContent = user.email || '';
      $('#moderationReportSummary').textContent = reportSummary || 'Revisa el historial antes de aplicar una medida.';
      $('#moderationAction').value = user.status === 'suspendido' ? 'reactivar' : 'advertir';
      $('#moderationMessage').value = '';
      $('#moderationReportId').value = reportId;
      const finish = (value) => { dialog.close(); resolve(value); };
      $('#moderationCancel').onclick = () => finish(null);
      $('#moderationForm').onsubmit = (event) => {
        event.preventDefault();
        const action = $('#moderationAction').value;
        const message = $('#moderationMessage').value.trim();
        if (message.length < 3) return toast('Escribe el mensaje que recibirá la persona.', 'error');
        finish({ action, message, reportId: $('#moderationReportId').value || null });
      };
      dialog.oncancel = (event) => { event.preventDefault(); finish(null); };
      dialog.showModal();
    });
  }

  window.MuroUI = { toast, confirmAction, moderateUser };
})();
