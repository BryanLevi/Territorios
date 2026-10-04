/* Vista de recorrido: navegar y localizarse sin modificar dibujos. */
(function () {
  'use strict';
  let active = false;
  let initialized = false;
  const el = id => document.getElementById(id);

  function refresh() {
    const loc = LOCS[currentIndex];
    const selector = el('route-territory');
    if (selector) {
      const signature = LOCS.map(item => String(item.num) + ':' + territorySelectorLabel(item)).join('|');
      if (selector.dataset.signature !== signature) {
        selector.replaceChildren();
        LOCS.forEach((item, index) => {
          const option = document.createElement('option');
          option.value = String(index);
          option.textContent = territorySelectorLabel(item);
          selector.append(option);
        });
        selector.dataset.signature = signature;
      }
      selector.value = String(currentIndex);
      selector.disabled = !map || !loc;
    }
    if (el('route-congregation')) el('route-congregation').textContent = congregacionActual()?.nombre || '';
    if (el('route-map-name')) el('route-map-name').textContent = currentView === 'offline' ? 'Mapa sin conexión' : currentView === 'g-sat' ? 'Google Satélite' : 'Google Calles';
    ['route-prev', 'route-next'].forEach(id => { if (el(id)) el(id).disabled = LOCS.length < 2; });
    if (el('btn-walk-mode')) el('btn-walk-mode').disabled = !map || !loc;
    const gps = el('btn-ubicacion');
    if (gps && el('route-location')) {
      el('route-location').classList.toggle('is-on', gps.classList.contains('is-on'));
      el('route-location').disabled = gps.disabled;
      el('route-location').title = gps.title;
      el('route-location').setAttribute('aria-label', gps.getAttribute('aria-label') || 'Mi ubicación');
      el('route-location').setAttribute('aria-pressed', gps.getAttribute('aria-pressed') || 'false');
      el('route-gps-status').textContent = gps.title || 'Toca Mi ubicación para localizarte';
      el('route-stop-location').hidden = el('btn-ubicacion-stop')?.hidden !== false;
    }
  }

  function setActive(next, options = {}) {
    next = Boolean(next);
    if (next === active) return active;
    if (next && (!map || !LOCS[currentIndex] || !el('welcome-screen')?.classList.contains('is-hidden') || (window.CroquisAccess && !window.CroquisAccess.canEnter()))) return false;
    const center = map?.getCenter();
    const zoom = map?.getZoom();
    if (next) {
      window.CroquisDrafts?.leave();
      active = true;
      cancelDestinationInteraction();
      cerrarPanelReferencias();
      closeIconPicker(false);
      setFrameMoveMode(false, false);
      setTerritoryAddMode(false, false);
      setColorDrawMode(false);
      setRoadPencilMode(false, false);
      setRiverPencilMode(false, false);
      setTextAddMode(false, false);
      setIconAddMode(false, false);
      setContourEditMode(false, false);
      setColorEditMode(false);
      ['history-dialog', 'draft-recovery-dialog'].forEach(id => el(id)?.close());
      setStatus('', '');
    } else {
      active = false;
    }
    document.body.classList.toggle('is-walk-mode', active);
    document.querySelector('.bar').inert = active;
    const markers = map?.getPane?.('markerPane');
    if (markers) markers.inert = active;
    el('walk-panel').hidden = !active;
    el('btn-walk-mode').setAttribute('aria-pressed', String(active));
    refresh();
    // Al cambiar el espacio disponible, mantener el mismo punto de trabajo.
    map?.invalidateSize({pan:false});
    if (center && Number.isFinite(zoom)) map.setView(center, zoom, {animate:false});
    if (active) el('route-exit').focus({preventScroll:true});
    else {
      updateColorControls();
      if (options.offer !== false) window.CroquisDrafts?.offer(LOCS[currentIndex]);
      if (options.focus !== false) el('btn-walk-mode').focus({preventScroll:true});
    }
    return active;
  }

  function init() {
    if (initialized) return;
    initialized = true;
    el('btn-walk-mode')?.addEventListener('click', () => setActive(true));
    el('route-exit')?.addEventListener('click', () => setActive(false));
    el('route-territory')?.addEventListener('change', event => goTo(Number(event.target.value)));
    el('route-prev')?.addEventListener('click', () => navigate(-1));
    el('route-next')?.addEventListener('click', () => navigate(1));
    el('route-location')?.addEventListener('click', () => el('btn-ubicacion')?.click());
    el('route-stop-location')?.addEventListener('click', () => el('btn-ubicacion-stop')?.click());
    const gps = el('btn-ubicacion');
    if (gps && typeof MutationObserver !== 'undefined') new MutationObserver(refresh).observe(gps, {attributes:true, childList:true, subtree:true});
    document.addEventListener('keydown', event => {
      if (!active || event.target?.closest?.('dialog')) return;
      const typing = ['INPUT','SELECT','TEXTAREA'].includes(event.target?.tagName);
      if (event.key === 'Escape') { event.preventDefault(); setActive(false); return; }
      if (typing) return;
      if ((event.ctrlKey || event.metaKey) && ['z','y','s'].includes(event.key.toLowerCase()) || ['Delete','Backspace'].includes(event.key)) event.preventDefault();
      if (event.key === 'ArrowLeft') { event.preventDefault(); navigate(-1); }
      if (event.key === 'ArrowRight') { event.preventDefault(); navigate(1); }
    });
    refresh();
  }
  window.CroquisWalk = {init, refresh, setActive, isActive:() => active};
  init();
})();
