/* Historial de edición de la congregación activa, separado de la vista del mapa. */
(function () {
  'use strict';

  const reasons = {
    colors:'Colores y contornos', text:'Textos y destinos', icons:'Iconos de referencia',
    'white-roads':'Calles y carreteras', 'manual-rivers':'Ríos',
    'clear-white-roads':'Calles eliminadas', 'clear-manual-rivers':'Ríos eliminados',
    'clear-all':'Elementos eliminados', 'frame-position':'Recuadro movido',
    'frame-reset':'Recuadro restablecido', 'recover-ixcatla-blue':'Colores recuperados',
    change:'Edición del territorio'
  };
  let initialized = false;
  const node = id => document.getElementById(id);
  const walking = () => !!window.CroquisWalk?.isActive?.();
  const hasDraft = () => !!window.CroquisDrafts?.hasPending?.();

  function describe(snapshot) {
    const loc = LOCS.find(item => String(item.num) === String(snapshot.locNum)) || LOCS[snapshot.index];
    const number = loc ? displayTerritoryNumber(loc) : snapshot.locNum;
    const name = loc ? displayTerritoryName(loc) : '';
    const time = Number(snapshot.createdAt);
    const date = Number.isFinite(time) && time > 0 ? new Date(time) : null;
    return {
      title:reasons[snapshot.reason] || reasons.change,
      territory:(number != null ? '#' + number + (name ? ' · ' : '') : '') + name || 'Territorio anterior',
      time:date && !Number.isNaN(date.getTime()) ? date.toLocaleString('es-MX', {
        day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit'
      }) : 'Cambio anterior'
    };
  }

  function appendGroup(list, title, snapshots, state) {
    if(!snapshots.length) return;
    const group = document.createElement('li');
    group.className = 'history-group';
    const heading = document.createElement('h3');
    heading.textContent = title;
    const items = document.createElement('ol');
    items.className = 'history-entries';
    snapshots.slice().reverse().forEach((snapshot, index) => {
      const item = document.createElement('li');
      item.className = 'history-entry is-' + state;
      const info = describe(snapshot);
      const label = document.createElement('strong');
      label.textContent = info.title;
      const territory = document.createElement('span');
      territory.textContent = info.territory;
      const time = document.createElement('small');
      time.textContent = info.time + (index === 0 ? (state === 'pending' ? ' · Siguiente al rehacer' : ' · Último cambio') : '');
      item.append(label, territory, time);
      items.append(item);
    });
    group.append(heading, items);
    list.append(group);
  }

  function refresh() {
    const list = node('history-list');
    if(!list) return;
    list.replaceChildren();
    appendGroup(list, 'Por rehacer', redoHistory, 'pending');
    appendGroup(list, 'Cambios aplicados', undoHistory, 'applied');
    if(!undoHistory.length && !redoHistory.length){
      const empty = document.createElement('li');
      empty.className = 'history-empty';
      empty.textContent = 'Aquí aparecerán los cambios que guardes en esta congregación.';
      list.append(empty);
    }
    const status = node('history-status');
    if(status) status.textContent = walking() ? 'Sal del modo recorrido para editar.' : hasDraft() ?
      'Guarda o cancela el dibujo en curso para recorrer los cambios guardados.' :
      undoHistory.length + ' cambios aplicados · ' + redoHistory.length + ' por rehacer. El zoom y la posición del mapa se conservan.';
    const undo = node('history-undo'), redo = node('history-redo');
    if(undo) undo.disabled = walking() || !map || !undoHistory.length || hasDraft();
    if(redo) redo.disabled = walking() || !map || !redoHistory.length || hasDraft();
    const toolbarRedo = node('btn-color-redo');
    if(toolbarRedo) toolbarRedo.disabled = !map || walking() ||
      (!window.CroquisDrafts?.canRedoPoint?.() && (!redoHistory.length || hasDraft()));
  }

  function open() {
    const dialog = node('history-dialog');
    if(!dialog || !map || window.CroquisAccess?.canEnter?.() === false ||
      node('welcome-screen') && !node('welcome-screen').classList.contains('is-hidden')) return;
    refresh();
    if(!dialog.open) dialog.showModal();
    node('history-close')?.focus();
  }

  function init() {
    if(initialized || !node('history-dialog')) return;
    initialized = true;
    node('btn-history')?.addEventListener('click', open);
    node('history-close')?.addEventListener('click', () => node('history-dialog').close());
    node('history-undo')?.addEventListener('click', () => {
      if(walking() || hasDraft() || !undoHistory.length) return;
      restoreLastUndoSnapshot();
      refresh();
    });
    node('history-redo')?.addEventListener('click', () => {
      if(walking() || hasDraft() || !redoHistory.length) return;
      restoreLastRedoSnapshot();
      refresh();
    });
    node('btn-color-redo')?.addEventListener('click', () => {
      if(walking()) return;
      redoEditChange();
    });
    refresh();
  }

  window.CroquisHistory = {init, open, refresh, describe};
  init();
})();
