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
    ['password-current', 'password-new', 'password-confirm'].forEach(id => element(id).removeAttribute('aria-invalid'));
    if (input) {
      element(input).setAttribute('aria-invalid', 'true');
      element(input).focus();
    }
  }

  function setBusy(value) {
    busy = value;
    ['password-current', 'password-new', 'password-confirm', 'password-submit', 'password-remove'].forEach(id => {
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

  function open(mode, onGranted = null) {
    const item = congregation();
    if (!item || dialog.open) return;
    if (item.proteccion && !password.normalize(item.proteccion)) {
      mostrarEstadoCongregaciones('No se puede verificar la contraseña de esta congregación. Recupera un registro válido antes de entrar.', true);
      return;
    }
    pending = { id:item.id, signature:signature(item), mode, onGranted, returnFocus:document.activeElement };
    form.reset();
    error('');
    setBusy(false);
    element('password-current-field').hidden = mode === 'set';
    element('password-new-field').hidden = mode === 'unlock';
    element('password-confirm-field').hidden = mode === 'unlock';
    element('password-remove').hidden = mode !== 'change';
    element('password-dialog-congregation').textContent = item.nombre;
    const title = mode === 'unlock' ? 'Entrar a la congregación' : mode === 'set' ? 'Crear contraseña' : 'Cambiar contraseña';
    element('password-dialog-title').textContent = title;
    element('password-current-label').textContent = mode === 'unlock' ? 'Contraseña' : 'Contraseña actual';
    resetVisibility();
    element('password-dialog-description').textContent = mode === 'unlock'
      ? 'Escribe la contraseña de esta congregación para abrir su editor.'
      : mode === 'set'
        ? 'Quienes entren desde Inicio deberán escribir esta contraseña. Usa exactamente 4 dígitos, solo números, y guárdala: la página no puede recuperarla. Los mapas y respaldos existentes no se vuelven privados.'
        : 'Escribe la contraseña actual para cambiarla o quitarla. La nueva contraseña debe tener exactamente 4 dígitos, solo números.';
    element('password-submit').textContent = mode === 'unlock' ? 'Entrar' : mode === 'set' ? 'Guardar contraseña' : 'Cambiar contraseña';
    dialog.showModal();
    element(mode === 'set' ? 'password-new' : 'password-current').focus();
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
    const next = request.mode === 'unlock' ? null : validateNew();
    if (request.mode !== 'unlock' && next === null) return;
    if (request.mode === 'unlock' && !element('password-current').value) {
      error('Escribe la contraseña.', 'password-current'); return;
    }
    setBusy(true);
    try {
      if (request.mode !== 'set' && !await password.verify(element('password-current').value, item.proteccion)) {
        setBusy(false);
        error('Contraseña incorrecta.', 'password-current'); return;
      }
      if (request !== pending || !currentPending()) return;
      if (request.mode === 'unlock') {
        granted = { id:item.id, signature:signature(item) };
        dialog.close();
        request.onGranted?.();
      } else {
        const protection = await password.create(next);
        if (request !== pending || !currentPending()) return;
        saveProtection(item, protection);
        dialog.close();
        mostrarEstadoCongregaciones(request.mode === 'set' ? 'Contraseña activada para ' + item.nombre + '.' : 'Contraseña actualizada para ' + item.nombre + '.');
      }
    } catch (cause) {
      setBusy(false);
      error(cause?.message || 'No se pudo verificar la contraseña. Inténtalo de nuevo.');
    } finally {
      if (request === pending) setBusy(false);
    }
  }

  async function remove() {
    if (busy) return;
    const item = currentPending();
    if (!item || pending.mode !== 'change') return;
    const request = pending;
    if (!element('password-current').value) { error('Escribe la contraseña actual.', 'password-current'); return; }
    setBusy(true);
    try {
      if (!await password.verify(element('password-current').value, item.proteccion)) {
        setBusy(false);
        error('Contraseña incorrecta.', 'password-current'); return;
      }
      if (request !== pending || !currentPending()) return;
      saveProtection(item, null);
      dialog.close();
      mostrarEstadoCongregaciones('Se quitó la contraseña de ' + item.nombre + '.');
    } catch (cause) {
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
  form.addEventListener('submit', submit);
  visibilityButtons.forEach(button => button.addEventListener('click', () => {
    if (!busy) setVisibility(button, element(button.dataset.passwordToggle).type === 'password');
  }));
  dialog.addEventListener('close', () => {
    const previous = pending?.returnFocus;
    pending = null;
    form.reset();
    resetVisibility();
    error('');
    if (!element('welcome-screen')?.classList.contains('is-hidden') && !element('congregacion-dialog')?.open) previous?.focus?.();
  });
  window.addEventListener('storage', event => {
    if (event.key !== CONGREGACIONES_STORAGE_KEY) return;
    if (element('welcome-screen')?.classList.contains('is-hidden') && !canEnter()) showWelcomeScreen();
    else refresh();
  });
  window.CroquisAccess = { canEnter, lock, refresh, enforce() {
    if (!element('welcome-screen')?.classList.contains('is-hidden') || canEnter()) return;
    showWelcomeScreen();
  } };
  refresh();
})();
