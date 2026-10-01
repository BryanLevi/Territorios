/* Control de los mapas descargados por congregación. La posición GPS nunca se guarda. */
(function () {
  'use strict';

  const $offline = id => document.getElementById(id);
  const dataStore = window.CroquisOfflineData;
  const offlineDialog = $offline('offline-dialog');
  let running = null;
  let shellPromise = null;

  function plain(bounds) {
    return {
      south: bounds.getSouth(), west: bounds.getWest(),
      north: bounds.getNorth(), east: bounds.getEast()
    };
  }

  function territoryBounds(loc) {
    const frame = getPrintBoundsPlain(loc, loc.zoom || DETAIL_ZOOM);
    if (!frame) throw new Error('El territorio no tiene un recuadro válido.');
    const color = getColorAreasBoundsPlain(loc);
    const box = L.latLngBounds(
      [Math.min(frame.south, color?.south ?? frame.south), Math.min(frame.west, color?.west ?? frame.west)],
      [Math.max(frame.north, color?.north ?? frame.north), Math.max(frame.east, color?.east ?? frame.east)]
    ).pad(.14);
    const result = plain(box);
    if (result.north - result.south > .3 || result.east - result.west > .3) {
      throw new Error('El recuadro de «' + displayTerritoryName(loc) + '» es demasiado amplio para guardarlo.');
    }
    return result;
  }

  function covers(saved, required) {
    if (!saved || !required) return false;
    return saved.south <= required.south + .000001 && saved.west <= required.west + .000001 &&
      saved.north >= required.north - .000001 && saved.east >= required.east - .000001;
  }

  function status(message, state) {
    const element = $offline('offline-status');
    if (!element) return;
    element.textContent = message;
    element.dataset.state = state || '';
  }

  function badge(message, state) {
    const element = $offline('offline-badge');
    if (!element) return;
    element.textContent = message;
    element.dataset.state = state || '';
  }

  function progress(done, total) {
    $offline('offline-progress-wrap').hidden = false;
    $offline('offline-progress').value = total ? Math.round(done / total * 100) : 0;
    $offline('offline-progress-label').textContent = done + ' de ' + total;
  }

  function controls(active, hasRecords) {
    $offline('offline-download').disabled = active || !navigator.onLine || !LOCS.length;
    $offline('offline-cancel').hidden = !active;
    $offline('offline-remove').hidden = active || !hasRecords;
  }

  async function refresh() {
    if (!dataStore) return;
    const group = congregacionActivaId;
    const name = congregacionActual().nombre;
    if ($offline('offline-dialog-congregation')) $offline('offline-dialog-congregation').textContent = name;
    if (running && running.group !== group) running.controller.abort();
    const territories = LOCS.slice();
    try {
      const records = await dataStore.list(group);
      if (group !== congregacionActivaId || (running && running.group === group)) return;
      const found = new Map(records.map(record => [record.key, record.data]));
      let complete = 0;
      territories.forEach(loc => {
        try {
          if (covers(found.get(String(loc.num))?.bounds, territoryBounds(loc))) complete++;
        } catch (error) { /* El botón mostrará el error al intentar descargar. */ }
      });
      let shellReady = false;
      if ('caches' in window) {
        const shellCache = await caches.open('croquis-app-shell-v2');
        shellReady = !!await shellCache.match(new URL('croquis_territorios.html', location.href).href);
      }
      if (group !== congregacionActivaId || (running && running.group === group)) return;
      controls(false, records.length > 0);
      if (running && running.group !== group) $offline('offline-download').disabled = true;
      const downloadLabel = $offline('offline-download').querySelector('span');
      if (downloadLabel) downloadLabel.textContent = territories.length && complete === territories.length
        ? (shellReady ? 'Actualizar mapas' : 'Completar descarga') : 'Descargar congregación';
      $offline('offline-progress-wrap').hidden = complete === 0 || complete === territories.length;
      if (!territories.length) {
        badge('Sin territorios', '');
        status('Agrega un territorio para preparar el mapa sin conexión.');
      } else if (complete === territories.length && !shellReady) {
        badge('Por completar', 'loading');
        status(navigator.onLine
          ? 'Las calles ya están guardadas. Toca «Completar descarga» para preparar la página sin conexión.'
          : 'Las calles siguen guardadas, pero falta preparar la página. Conéctate para completar la descarga.');
      } else if (complete === territories.length) {
        badge('Listo', 'ready');
        status(complete + (complete === 1 ? ' territorio disponible' : ' territorios disponibles') +
          ' sin internet. Elige «Mapa descargado» en el selector Mapa.', 'ready');
      } else if (complete > 0) {
        badge(complete + ' de ' + territories.length, 'loading');
        progress(complete, territories.length);
        status('Faltan territorios. Toca «Descargar congregación» para completar la descarga.');
      } else {
        badge('Sin descargar', '');
        status(navigator.onLine ? 'Prepara los mapas mientras tengas internet.' :
          'Conéctate a internet para descargar los mapas.');
      }
    } catch (error) {
      if (group !== congregacionActivaId) return;
      controls(false, false);
      badge('No disponible', 'error');
      status(error.message || 'No se pudo consultar la descarga.', 'error');
    }
  }

  async function ensureShell() {
    if (!('serviceWorker' in navigator) || !('caches' in window) || !window.isSecureContext) {
      throw new Error('Para guardar la página, ábrela con HTTPS en este navegador.');
    }
    if (!shellPromise) shellPromise = (async () => {
      await navigator.serviceWorker.register('../sw.js', { scope:'../' });
      const registration = await Promise.race([
        navigator.serviceWorker.ready,
        new Promise((_, reject) => setTimeout(() => reject(new Error('La página tardó en prepararse. Recárgala e intenta de nuevo.')), 20000))
      ]);
      const cache = await caches.open('croquis-app-shell-v2');
      const required = ['croquis_territorios.html', 'offline-data.js', 'offline-controller.js',
        '../vendor/leaflet/leaflet.js', '../vendor/leaflet/leaflet.css'];
      const shellComplete = async () => (await Promise.all(required.map(path =>
        cache.match(new URL(path, location.href).href)))).every(Boolean);
      if (!await shellComplete()) {
        const worker = registration.active;
        if (!worker) throw new Error('No se pudo guardar la página para abrirla sin internet.');
        await new Promise((resolve, reject) => {
          const channel = new MessageChannel();
          const timer = setTimeout(() => reject(new Error('La página tardó demasiado en guardarse.')), 30000);
          channel.port1.onmessage = event => {
            clearTimeout(timer);
            event.data?.ok ? resolve() : reject(new Error(event.data?.message || 'No se pudo guardar la página.'));
          };
          worker.postMessage({type:'CACHE_SHELL'}, [channel.port2]);
        });
        if (!await shellComplete()) throw new Error('No se pudo guardar la página para abrirla sin internet.');
      }
      return true;
    })().finally(() => { shellPromise = null; });
    return shellPromise;
  }

  async function downloadAll() {
    if (running) return;
    if (!dataStore || !map || !LOCS.length) {
      status('Primero abre el editor y agrega un territorio.', 'error');
      return;
    }
    if (!navigator.onLine) {
      status('Necesitas internet para preparar la descarga.', 'error');
      return;
    }
    const group = congregacionActivaId;
    let territories;
    try {
      territories = LOCS.map(loc => ({loc, key:String(loc.num), bounds:territoryBounds(loc)}));
    } catch (error) {
      status(error.message || 'Revisa el recuadro de los territorios.', 'error');
      return;
    }
    const controller = new AbortController();
    running = {group, controller};
    let finalNotice = null;
    controls(true, false);
    badge('Preparando', 'loading');
    progress(0, territories.length);
    status('Guardando la página y preparando los territorios…', 'loading');
    try {
      await ensureShell();
      if (navigator.storage?.persist) await navigator.storage.persist().catch(() => false);
      let done = 0;
      for (const territory of territories) {
        if (controller.signal.aborted || group !== congregacionActivaId) throw new DOMException('Descarga cancelada.', 'AbortError');
        const existing = await dataStore.get(group, territory.key);
        if (!covers(existing?.bounds, territory.bounds)) {
          status('Descargando ' + displayTerritoryName(territory.loc) + ' (' + (done + 1) + ' de ' + territories.length + ')…', 'loading');
          const elements = await dataStore.download(territory.bounds, {signal:controller.signal});
          const roads = packRoadWays(roadWaysFromOverpass({elements:elements.roadElements}));
          const refs = referencesFromOverpass({elements:elements.referenceElements});
          await dataStore.set(group, territory.key, {
            roads, refs, bounds:territory.bounds, savedAt:Date.now()
          });
          if (done + 1 < territories.length) await new Promise(resolve => setTimeout(resolve, 1200));
        }
        done++;
        progress(done, territories.length);
      }
      badge('Listo', 'ready');
      status('Listo: ' + done + (done === 1 ? ' territorio guardado' : ' territorios guardados') +
        '. Los colores, dibujos y tu ubicación se verán en el mapa descargado.', 'ready');
      if (currentView === 'offline') {
        runtimeRoadCache = null;
        runtimeReferenceCache = null;
        updateRuntimeVectorRoadOverlay();
        updateRuntimeReferenceOverlay();
      }
    } catch (error) {
      if (error?.name === 'AbortError') {
        badge('Pausado', '');
        finalNotice = ['Descarga pausada. Los territorios ya guardados se conservan; puedes reanudarla.', ''];
      } else {
        badge('Incompleto', 'error');
        finalNotice = [(error?.message || 'No se completó la descarga.') + ' Toca «Descargar congregación» para continuar.', 'error'];
      }
    } finally {
      running = null;
      await refresh();
      if (finalNotice && group === congregacionActivaId) status(finalNotice[0], finalNotice[1]);
    }
  }

  async function removeAll() {
    if (running || !dataStore) return;
    const group = congregacionActivaId;
    try {
      await dataStore.clear(group);
      if (currentView === 'offline') {
        runtimeRoadCache = null;
        runtimeReferenceCache = null;
        updateRuntimeVectorRoadOverlay();
        updateRuntimeReferenceOverlay();
      }
      await refresh();
      status('Se quitaron los mapas de esta congregación. Tus colores y dibujos permanecen guardados.');
    } catch (error) { status(error.message || 'No se pudo quitar la descarga.', 'error'); }
  }

  function networkChange() {
    if (!map) { refresh(); return; }
    if (!navigator.onLine && currentView !== 'offline') {
      lastOnlineView = currentView;
      offlineAutoView = true;
      viewSel.value = 'offline';
      changeView('offline', true);
      setStatus('Sin internet. Mostrando el mapa descargado; Mi ubicación usa la señal del dispositivo.', 'warn');
    } else if (navigator.onLine && offlineAutoView && currentView === 'offline') {
      offlineAutoView = false;
      viewSel.value = lastOnlineView;
      changeView(lastOnlineView, true);
    }
    refresh();
  }

  $offline('offline-download')?.addEventListener('click', downloadAll);
  $offline('offline-cancel')?.addEventListener('click', () => running?.controller.abort());
  $offline('offline-remove')?.addEventListener('click', removeAll);
  $offline('btn-offline')?.addEventListener('click', () => {
    if (!offlineDialog || offlineDialog.open) return;
    $offline('offline-dialog-congregation').textContent = congregacionActual().nombre;
    offlineDialog.showModal();
    refresh();
    $offline('offline-dialog-close')?.focus({preventScroll:true});
  });
  $offline('offline-dialog-close')?.addEventListener('click', () => offlineDialog?.close());
  offlineDialog?.addEventListener('click', event => { if (event.target === offlineDialog) offlineDialog.close(); });
  offlineDialog?.addEventListener('close', () => $offline('btn-offline')?.focus({preventScroll:true}));
  window.addEventListener('online', networkChange);
  window.addEventListener('offline', networkChange);
  window.refreshOfflineCard = refresh;
  window.offlineRecordCovers = (loc, record) => !!record && covers(record.bounds, territoryBounds(loc));
  if (window.isSecureContext && 'serviceWorker' in navigator) ensureShell().then(refresh).catch(() => {});
  refresh();
})();
