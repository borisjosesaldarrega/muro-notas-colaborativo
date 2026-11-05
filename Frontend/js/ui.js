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

  function confirmAction({ title, message, confirmText = 'Confirmar', tone = 'primary', showCancel = true }) {
    return new Promise((resolve) => {
      const dialog = $('#actionDialog');
      if (!dialog) return resolve(false);
      $('#actionDialogIcon').innerHTML = tone === 'danger'
        ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2 1 21h22L12 2Zm0 5.8L19.5 19h-15L12 7.8ZM11 11v4h2v-4h-2Zm0 5.5v2h2v-2h-2Z"/></svg>'
        : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm-1 5h2v2h-2V7Zm0 4h2v6h-2v-6Z"/></svg>';
      $('#actionDialogTitle').textContent = title;
      $('#actionDialogMessage').textContent = message;
      const accept = $('#actionDialogAccept');
      const cancel = $('#actionDialogCancel');
      cancel.classList.toggle('hidden', !showCancel);
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
      $('#moderationClose').onclick = () => finish(null);
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
