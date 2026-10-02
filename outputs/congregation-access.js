/* Bloqueo de entrada por congregación. No cifra el trabajo ni sustituye permisos del servidor. */
(function () {
  'use strict';

  const element = id => document.getElementById(id);
  const password = window.CroquisPassword;
  const dialog = element('password-dialog');
  const form = element('password-form');
  if (!password || !dialog || !form) return;
  const visibilityButtons = Array.from(form.querySelectorAll('[data-password-toggle]'));

  let granted = null;
  let pending = null;
  let busy = false;

  function congregation(id = congregacionActivaId) {
    return cargarCongregaciones().find(item => item.id === id) || null;
  }

  function signature(item) {
    return JSON.stringify(item?.proteccion || null);
  }

  function canEnter() {
    const item = congregation();
    return !!item && (!item.proteccion || (granted?.id === item.id && granted.signature === signature(item)));
  }

  function refresh() {
    const item = congregation();
    const button = element('welcome-cong-password');
    const start = element('welcome-start')?.querySelector('span');
    if (button) {
      button.disabled = !item;
      button.querySelector('span').textContent = item?.proteccion ? 'Cambiar clave' : 'Contraseña';
      button.title = item?.proteccion ? 'Cambiar o quitar la contraseña de esta congregación' : 'Poner contraseña a esta congregación';
      button.setAttribute('aria-label', button.title);
      button.dataset.protected = item?.proteccion ? 'true' : 'false';
    }
    if (start) start.textContent = item?.proteccion && !canEnter() ? 'Entrar con contraseña' : 'Abrir editor';
    const note = element('welcome-cong-note');
    if (note && item?.proteccion) note.textContent = 'Esta congregación pide contraseña cada vez que entras desde Inicio.';
  }

  function lock() {
    granted = null;
    refresh();
  }

  function error(message, input) {
    const box = element('password-error');
    box.textContent = message || '';
    box.hidden = !message;
    ['password-current', 'password-new', 'password-confirm', 'password-recovery'].forEach(id => element(id).removeAttribute('aria-invalid'));
    if (input) {
      element(input).setAttribute('aria-invalid', 'true');
      element(input).focus();
    }
  }

  function setBusy(value) {
    busy = value;
    ['password-current', 'password-new', 'password-confirm', 'password-recovery', 'password-submit', 'password-remove', 'password-forgot', 'password-back', 'password-setup-recovery'].forEach(id => {
      element(id).disabled = value;
    });
    visibilityButtons.forEach(button => { button.disabled = value; });
    element('password-submit').setAttribute('aria-busy', String(value));
  }

  function setVisibility(button, visible) {
    const input = element(button.dataset.passwordToggle);
    input.type = visible ? 'text' : 'password';
    const label = input.id === 'password-confirm'
      ? 'confirmación de contraseña'
      : input.closest('.password-field').querySelector('label').textContent.toLocaleLowerCase('es');
    const action = (visible ? 'Ocultar ' : 'Mostrar ') + label;
    button.setAttribute('aria-pressed', String(visible));
    button.setAttribute('aria-label', action);
    button.title = action;
  }

  function resetVisibility() {
    visibilityButtons.forEach(button => setVisibility(button, false));
  }

  function showMode(mode) {
    const item = congregation();
    pending.mode = mode;
    form.reset();
    error('');
    setBusy(false);
    const recover = mode === 'recover', receipt = mode === 'receipt';
    const available = !!password.normalize(item.proteccion)?.recovery;
    element('password-current-field').hidden = !['unlock', 'change'].includes(mode);
    element('password-new-field').hidden = !['set', 'change'].includes(mode) && !(recover && available);
    element('password-confirm-field').hidden = element('password-new-field').hidden;
    element('password-recovery-field').hidden = !recover || !available;
    element('password-recovery-unavailable').hidden = !recover || available;
    element('password-recovery-receipt').hidden = !receipt;
    element('password-recovery-options').hidden = !['unlock', 'change'].includes(mode);
    element('password-setup-recovery').hidden = mode !== 'change';
    element('password-setup-note').hidden = mode !== 'change';
    element('password-setup-recovery').textContent = available ? 'Renovar código de recuperación' : 'Activar recuperación';
    element('password-setup-note').textContent = available
      ? 'Escribe la contraseña actual para generar otro código. El anterior dejará de funcionar.'
      : 'Escribe la contraseña actual para obtener un código, sin cambiar la clave.';
    element('password-remove').hidden = mode !== 'change';
    element('password-back').hidden = !recover;
    element('password-cancel').textContent = receipt ? 'Listo' : 'Cancelar';
    element('password-submit').hidden = receipt || (recover && !available);
    element('password-dialog-congregation').textContent = item.nombre;
    const titles = { unlock:'Entrar a la congregación', set:'Crear contraseña', change:'Cambiar contraseña', recover:'Recuperar acceso', receipt:'Guarda tu código de recuperación' };
    element('password-dialog-title').textContent = titles[mode];
    element('password-current-label').textContent = mode === 'unlock' ? 'Contraseña' : 'Contraseña actual';
    resetVisibility();
    const descriptions = {
      unlock:'Escribe la contraseña de esta congregación para abrir su editor.',
      set:'Usa exactamente 4 dígitos, solo números. Al guardarla recibirás un código para recuperar el acceso si la olvidas.',
      change:'Escribe la contraseña actual y una nueva de 4 dígitos. Al guardar recibirás un nuevo código de recuperación.',
      recover:available ? 'Escribe el código que guardaste y elige una nueva contraseña de 4 dígitos.' : 'La recuperación necesita el código guardado por el responsable de esta congregación.',
      receipt:'La contraseña está guardada. Copia o descarga este código; al usarlo recibirás otro.'
    };
    element('password-dialog-description').textContent = descriptions[mode];
    element('password-submit').textContent = mode === 'unlock' ? 'Entrar' : mode === 'set' ? 'Guardar contraseña' : recover ? 'Restablecer contraseña' : 'Cambiar contraseña';
    element('password-recovery-feedback').textContent = '';
    element('password-recovery-code').value = receipt ? pending.code : '';
    return receipt ? 'password-recovery-code' : recover ? available ? 'password-recovery' : 'password-back' : mode === 'set' ? 'password-new' : 'password-current';
  }

  function open(mode, onGranted = null) {
    const item = congregation();
    if (!item || dialog.open) return;
    if (item.proteccion && !password.normalize(item.proteccion)) {
      mostrarEstadoCongregaciones('No se puede verificar la contraseña de esta congregación. Recupera un registro válido antes de entrar.', true);
      return;
    }
    pending = { id:item.id, signature:signature(item), mode, originMode:mode, onGranted, returnFocus:document.activeElement };
    const focus = showMode(mode);
    dialog.showModal();
    element(focus).focus();
  }

  function switchMode(mode) {
    if (busy || !currentPending()) return;
    element(showMode(mode)).focus();
  }

  function showReceipt(request, code) {
    pending = { ...request, mode:'receipt', signature:signature(congregation()), onGranted:null, code };
    element(showMode('receipt')).focus();
  }

  function currentPending() {
    if (!pending || !dialog.open || congregation()?.id !== pending.id) {
      error('La congregación seleccionada cambió. Cierra esta ventana y vuelve a intentarlo.');
      return null;
    }
    const item = congregation(pending.id);
    if (signature(item) !== pending.signature) {
      error('La contraseña cambió en otro equipo. Cierra esta ventana y vuelve a abrirla.');
      return null;
    }
    return item;
  }

  function validateNew() {
    const next = element('password-new').value;
    const confirmation = element('password-confirm').value;
    if (!/^[0-9]{4}$/.test(next)) { error('La contraseña debe tener exactamente 4 dígitos, solo números.', 'password-new'); return null; }
    if (next !== confirmation) { error('Las contraseñas no coinciden.', 'password-confirm'); return null; }
    return next;
  }

  function saveProtection(item, protection) {
    const entries = cargarRegistroCongregaciones();
    const current = entries.find(entry => entry.id === item.id && !entry.deletedAt);
    if (!current || signature(current) !== pending.signature) throw new Error('La congregación cambió en otro equipo. Vuelve a abrir esta ventana.');
    const stamp = siguienteFechaCongregacion(entries);
    const next = { ...current, updatedAt:stamp, accesoActualizadoEn:stamp, revision:current.revision + 1 };
    if (protection) next.proteccion = protection;
    else delete next.proteccion;
    if (!guardarCongregaciones(entries.map(entry => entry.id === item.id ? next : entry))) {
      throw new Error('No se pudo guardar la contraseña. Revisa el espacio disponible.');
    }
    granted = null;
    refrescarCongregacionesEnInicio();
  }

  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    const item = currentPending();
    if (!item) return;
    const request = pending;
    if (!['set', 'change', 'unlock', 'recover'].includes(request.mode)) return;
    if (request.mode === 'recover' && !password.normalize(item.proteccion)?.recovery) return;
    const next = request.mode === 'unlock' ? null : validateNew();
    if (request.mode !== 'unlock' && next === null) return;
    if (request.mode === 'unlock' && !element('password-current').value) {
      error('Escribe la contraseña.', 'password-current'); return;
    }
    if (request.mode === 'recover' && !element('password-recovery').value.trim()) {
      error('Escribe el código de recuperación.', 'password-recovery'); return;
    }
    setBusy(true);
    try {
      if (request.mode === 'recover') {
        const accepted = await password.verifyRecovery(element('password-recovery').value, item.proteccion);
        if (request !== pending || !currentPending()) return;
        if (!accepted) { setBusy(false); error('Código de recuperación incorrecto.', 'password-recovery'); return; }
      }
      if (['unlock', 'change'].includes(request.mode)) {
        const accepted = await password.verify(element('password-current').value, item.proteccion);
        if (request !== pending || !currentPending()) return;
        if (!accepted) { setBusy(false); error('Contraseña incorrecta.', 'password-current'); return; }
      }
      if (request !== pending || !currentPending()) return;
      if (request.mode === 'unlock') {
        granted = { id:item.id, signature:signature(item) };
        dialog.close();
        request.onGranted?.();
      } else {
        const result = await password.createWithRecovery(next);
        if (request !== pending || !currentPending()) return;
        saveProtection(item, result.protection);
        showReceipt(request, result.code);
        mostrarEstadoCongregaciones(request.mode === 'set' ? 'Contraseña activada para ' + item.nombre + '.' : request.mode === 'recover' ? 'Acceso recuperado. Entra con tu nueva contraseña.' : 'Contraseña actualizada para ' + item.nombre + '.');
      }
    } catch (cause) {
      if (request !== pending) return;
      setBusy(false);
      error(cause?.message || 'No se pudo verificar la contraseña. Inténtalo de nuevo.');
    } finally {
      if (request === pending) setBusy(false);
    }
  }

  async function setupRecovery() {
    if (busy || pending?.mode !== 'change') return;
    const item = currentPending(), request = pending;
    if (!item) return;
    if (!element('password-current').value) { error('Escribe la contraseña actual.', 'password-current'); return; }
    setBusy(true);
    try {
      const accepted = await password.verify(element('password-current').value, item.proteccion);
      if (request !== pending || !currentPending()) return;
      if (!accepted) { setBusy(false); error('Contraseña incorrecta.', 'password-current'); return; }
      const recovery = await password.createRecovery();
      if (request !== pending || !currentPending()) return;
      saveProtection(item, { ...password.normalize(item.proteccion), recovery:recovery.record });
      showReceipt(request, recovery.code);
      mostrarEstadoCongregaciones('Código de recuperación actualizado para ' + item.nombre + '.');
    } catch (cause) {
      if (request !== pending) return;
      setBusy(false); error(cause?.message || 'No se pudo activar la recuperación. Inténtalo de nuevo.');
    } finally {
      if (request === pending) setBusy(false);
    }
  }

  async function copyRecovery() {
    if (pending?.mode !== 'receipt' || !pending.code) return;
    if (!currentPending()) return;
    const request = pending;
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable');
      await navigator.clipboard.writeText(request.code);
      if (pending === request && currentPending()) element('password-recovery-feedback').textContent = 'Código copiado. Guárdalo en un lugar seguro.';
    } catch (_) {
      if (pending !== request || !currentPending()) return;
      element('password-recovery-code').focus();
      element('password-recovery-code').select();
      element('password-recovery-feedback').textContent = 'El código está seleccionado. Cópialo o usa Descargar código.';
    }
  }

  function downloadRecovery() {
    if (pending?.mode !== 'receipt' || !pending.code) return;
    const item = currentPending();
    if (!item) return;
    const text = 'Croquis de territorios — Código de recuperación\nCongregación: ' + item.nombre + '\n\n' + pending.code + '\n\nEn Inicio, abre la congregación y pulsa «Olvidé mi contraseña». Escribe este código para elegir una contraseña nueva de 4 dígitos. Al usarlo se genera otro código.\n';
    const url = URL.createObjectURL(new Blob([text], { type:'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'Codigo-recuperacion-' + item.nombre.replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 60) + '.txt';
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    element('password-recovery-feedback').textContent = 'Se descargó tu código de recuperación.';
  }

  async function remove() {
    if (busy) return;
    const item = currentPending();
    if (!item || pending.mode !== 'change') return;
    const request = pending;
    if (!element('password-current').value) { error('Escribe la contraseña actual.', 'password-current'); return; }
    setBusy(true);
    try {
      const accepted = await password.verify(element('password-current').value, item.proteccion);
      if (request !== pending || !currentPending()) return;
      if (!accepted) { setBusy(false); error('Contraseña incorrecta.', 'password-current'); return; }
      saveProtection(item, null);
      dialog.close();
      mostrarEstadoCongregaciones('Se quitó la contraseña de ' + item.nombre + '.');
    } catch (cause) {
      if (request !== pending) return;
      setBusy(false);
      error(cause?.message || 'No se pudo quitar la contraseña. Inténtalo de nuevo.');
    } finally {
      if (request === pending) setBusy(false);
    }
  }

  function requireEntry(action) {
    if (canEnter()) { action(); return; }
    open('unlock', action);
  }

  element('welcome-start')?.addEventListener('click', () => requireEntry(hideWelcomeScreen));
  element('welcome-cong-renombrar')?.addEventListener('click', () => requireEntry(renombrarCongregacion));
  element('welcome-cong-eliminar')?.addEventListener('click', () => requireEntry(confirmarEliminarCongregacion));
  element('welcome-cong-password')?.addEventListener('click', () => open(congregation()?.proteccion ? 'change' : 'set'));
  element('password-cancel')?.addEventListener('click', () => dialog.close());
  element('password-remove')?.addEventListener('click', remove);
  element('password-forgot')?.addEventListener('click', () => switchMode('recover'));
  element('password-back')?.addEventListener('click', () => switchMode(pending?.originMode || 'unlock'));
  element('password-setup-recovery')?.addEventListener('click', setupRecovery);
  element('password-recovery-copy')?.addEventListener('click', copyRecovery);
  element('password-recovery-download')?.addEventListener('click', downloadRecovery);
  form.addEventListener('submit', submit);
  visibilityButtons.forEach(button => button.addEventListener('click', () => {
    if (!busy) setVisibility(button, element(button.dataset.passwordToggle).type === 'password');
  }));
  dialog.addEventListener('close', () => {
    const previous = pending?.returnFocus;
    pending = null;
    form.reset();
    element('password-recovery-code').value = '';
    resetVisibility();
    error('');
    if (!element('welcome-screen')?.classList.contains('is-hidden') && !element('congregacion-dialog')?.open) previous?.focus?.();
  });
  window.addEventListener('storage', event => {
    if (event.key !== CONGREGACIONES_STORAGE_KEY) return;
    if (dialog.open && pending?.id !== congregation()?.id) dialog.close();
    if (element('welcome-screen')?.classList.contains('is-hidden') && !canEnter()) showWelcomeScreen();
    else refresh();
  });
  window.CroquisAccess = { canEnter, lock, refresh, enforce() {
    if (!element('welcome-screen')?.classList.contains('is-hidden') || canEnter()) return;
    showWelcomeScreen();
  } };
  refresh();
})();
