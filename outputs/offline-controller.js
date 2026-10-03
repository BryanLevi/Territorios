/* Control de los mapas descargados por congregación. La posición GPS nunca se guarda. */
(function () {
  'use strict';

  const $offline = id => document.getElementById(id);
  const dataStore = window.CroquisOfflineData;
  const offlineDialog = $offline('offline-dialog');
  let running = null;
  let removingGroup = null;
  let shellPromise = null;
  let preparedPackPromise = null;
  let refreshVersion = 0;
  let readiness = {group:null, signature:'', ready:false};
  const shellFiles = ['../index.html', 'croquis_territorios.html', 'offline-data.js', 'offline-controller.js', 'destination-placement.js',
    'congregation-password.js', 'congregation-access.js', 'favicon.svg',
    '../croquis-territorios-jw/', '../croquis-territorios-jw/index.html', '../croquis-territorio-jw/', '../croquis-territorio-jw/index.html', '../coquis-territorios-jw/', '../coquis-territorios-jw/index.html', '../tokens.css', 'welcome-premium.css',
    'toolbar-premium.css', 'editor-premium.css', '../vendor/leaflet/leaflet.js', '../vendor/leaflet/leaflet.css',
    '../vendor/leaflet/images/layers.png', '../vendor/leaflet/images/layers-2x.png',
    '../vendor/leaflet/images/marker-icon.png', '../vendor/leaflet/images/marker-icon-2x.png',
    '../vendor/leaflet/images/marker-shadow.png'];

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
    if (!['south','west','north','east'].every(name => Number.isFinite(saved[name]) && Number.isFinite(required[name]))) return false;
    if (saved.south >= saved.north || saved.west >= saved.east) return false;
    return saved.south <= required.south + .000001 && saved.west <= required.west + .000001 &&
      saved.north >= required.north - .000001 && saved.east >= required.east - .000001;
  }

  function completeRecord(record, required) {
    return Array.isArray(record?.roads) && Array.isArray(record?.refs) && covers(record.bounds, required);
  }

  async function shellComplete(cache) {
    return (await Promise.all(shellFiles.map(path => cache.match(new URL(path, document.baseURI || location.href).href)))).every(response => response && response.ok !== false);
  }

  function requiredTerritories() {
    return LOCS.map(loc => ({key:String(loc.num), bounds:territoryBounds(loc)}));
  }

  function setReadiness(ready, group, signature, state = '') {
    readiness = {group, signature, ready};
    const button = $offline('btn-offline');
    if (button) {
      button.classList.toggle('is-offline-ready', ready);
      button.dataset.offlineState = ready ? 'ready' : state || 'incomplete';
      const description = ready ? 'Descarga completa de esta congregación, lista para usar sin internet.'
        : state === 'loading' ? 'Comprobando o completando la descarga de esta congregación.'
          : state === 'error' ? 'La descarga no está completa. Abre para revisarla.'
            : 'Abre para preparar o revisar los mapas de esta congregación.';
      button.title = 'Mapa sin conexión. ' + description;
      button.setAttribute('aria-label', 'Mapa sin conexión. ' + description);
    }
    const preview = $offline('offline-preview');
    if (preview) {
      const savedView = currentView === 'offline';
      preview.hidden = !ready && !savedView;
      preview.disabled = !!running || removingGroup === group || !map || (savedView && !navigator.onLine);
      let onlineName = 'Google Calles';
      if (typeof TILES !== 'undefined' && typeof lastOnlineView !== 'undefined') onlineName = (TILES[lastOnlineView]?.name || onlineName).split(' - ')[0];
      (preview.querySelector('span') || preview).textContent = savedView ? 'Volver a ' + onlineName : 'Ver mapa guardado';
      preview.title = savedView ? (navigator.onLine ? 'Volver al mapa en línea sin cambiar tu encuadre.' : 'Conéctate para volver al mapa en línea.')
        : 'Ver las calles y nombres guardados en este dispositivo, sin cambiar tu encuadre.';
      preview.setAttribute('aria-pressed', String(savedView));
    }
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
    $offline('offline-download').disabled = active || removingGroup === congregacionActivaId || !navigator.onLine || !LOCS.length;
    $offline('offline-cancel').hidden = !active;
    $offline('offline-remove').hidden = active || !hasRecords;
    $offline('offline-remove').disabled = active || removingGroup === congregacionActivaId;
  }

  async function refresh() {
    if (!dataStore) return;
    const version = ++refreshVersion;
    const group = congregacionActivaId;
    const name = congregacionActual().nombre;
    if ($offline('offline-dialog-congregation')) $offline('offline-dialog-congregation').textContent = name;
    if (running && running.group !== group) running.controller.abort();
    const territories = LOCS.slice();
    try {
      const required = requiredTerritories();
      const signature = JSON.stringify(required);
      if (readiness.group !== group || readiness.signature !== signature || running || removingGroup === group) setReadiness(false, group, signature, running || removingGroup === group ? 'loading' : '');
      else setReadiness(readiness.ready, group, signature);
      if (removingGroup === group) return;
      const records = await dataStore.list(group);
      if (version !== refreshVersion || group !== congregacionActivaId || (running && running.group === group)) return;
      const found = new Map(records.map(record => [record.key, record.data]));
      let complete = 0;
      required.forEach(territory => { if (completeRecord(found.get(territory.key), territory.bounds)) complete++; });
      let shellReady = false;
      if ('caches' in window) {
        const shellCache = await caches.open('croquis-app-shell-v10');
        shellReady = await shellComplete(shellCache);
      }
      if (version !== refreshVersion || group !== congregacionActivaId || (running && running.group === group)) return;
      if (signature !== JSON.stringify(requiredTerritories())) { setReadiness(false, group, '', ''); return; }
      setReadiness(territories.length > 0 && complete === territories.length && shellReady, group, signature);
      controls(false, records.length > 0);
      if (running && running.group !== group) $offline('offline-download').disabled = true;
      const downloadLabel = $offline('offline-download').querySelector('span');
      if (downloadLabel) downloadLabel.textContent = territories.length && complete === territories.length
        ? (shellReady ? 'Comprobar descarga' : 'Completar descarga') : complete ? 'Continuar descarga' : 'Descargar congregación';
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
          (currentView === 'offline'
            ? ' sin internet. Estás viendo las calles y nombres guardados en este dispositivo.'
            : ' sin internet. Al perder conexión, el mapa usará esta copia automáticamente. También puedes tocar «Ver mapa guardado».'), 'ready');
      } else if (complete > 0) {
        badge(complete + ' de ' + territories.length, 'loading');
        progress(complete, territories.length);
        status('Faltan territorios. Toca «Continuar descarga» para completar la descarga.');
      } else {
        badge('Sin descargar', '');
        status(navigator.onLine ? 'Prepara los mapas mientras tengas internet.' :
          'Conéctate a internet para descargar los mapas.');
      }
    } catch (error) {
      if (version !== refreshVersion || group !== congregacionActivaId) return;
      setReadiness(false, group, '', 'error');
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
      const registered = await navigator.serviceWorker.register('../sw.js', { scope:'../' });
      const updating = registered.installing || registered.waiting;
      // Durante una actualización, ready puede devolver todavía el trabajador
      // anterior. Esperamos al nuevo antes de pedirle que complete su caché.
      if (updating && updating.state !== 'activated') {
        await new Promise((resolve, reject) => {
          const finish = error => {
            clearTimeout(timer);
            updating.removeEventListener('statechange', changed);
            error ? reject(error) : resolve();
          };
          const changed = () => {
            if (updating.state === 'activated') finish();
            else if (updating.state === 'redundant') finish(new Error('No se pudo actualizar la página sin conexión. Recarga e intenta de nuevo.'));
          };
          const timer = setTimeout(() => finish(new Error('La página tardó en actualizarse. Recárgala e intenta de nuevo.')), 20000);
          updating.addEventListener('statechange', changed);
          changed();
        });
      }
      const registration = await Promise.race([
        navigator.serviceWorker.ready,
        new Promise((_, reject) => setTimeout(() => reject(new Error('La página tardó en prepararse. Recárgala e intenta de nuevo.')), 20000))
      ]);
      const cache = await caches.open('croquis-app-shell-v10');
      if (!await shellComplete(cache)) {
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
        if (!await shellComplete(cache)) throw new Error('No se pudo guardar la página para abrirla sin internet.');
      }
      return true;
    })().finally(() => { shellPromise = null; });
    return shellPromise;
  }

  function checkActive(signal, group) {
    if (signal.aborted || group !== congregacionActivaId) throw new DOMException('Descarga cancelada.', 'AbortError');
  }

  function cancellable(promise, signal) {
    return new Promise((resolve, reject) => {
      const onAbort = () => reject(new DOMException('Descarga cancelada.', 'AbortError'));
      signal.addEventListener('abort', onAbort, {once:true});
      if (signal.aborted) onAbort();
      promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
    });
  }

  async function preparedPack(signal) {
    if (!preparedPackPromise) preparedPackPromise = (async () => {
      const controller = new AbortController();
      const onAbort = () => controller.abort();
      signal.addEventListener('abort', onAbort, {once:true});
      if (signal.aborted) onAbort();
      const timer = setTimeout(() => controller.abort(), 8000);
      try {
        const response = await fetch(new URL('offline-map-pack.json', document.baseURI || location.href), {signal:controller.signal});
        if (!response.ok) return null;
        const pack = await response.json();
        return pack?.version === 1 && Array.isArray(pack.territories) ? pack : null;
      } catch (error) {
        if (signal.aborted) throw new DOMException('Descarga cancelada.', 'AbortError');
        return null;
      } finally {
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
      }
    })();
    return preparedPackPromise;
  }

  function preparedRecord(pack, territory) {
    const usable = entry => Array.isArray(entry?.roads) && Array.isArray(entry?.refs) && covers(entry.bounds, territory.bounds);
    return pack?.territories.find(entry => entry.key === territory.key && usable(entry))
      || pack?.territories.find(usable) || null;
  }

  async function downloadAll() {
    if (running || removingGroup) return;
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
      setReadiness(false, group, '', 'error');
      status(error.message || 'Revisa el recuadro de los territorios.', 'error');
      return;
    }
    const controller = new AbortController();
    let timeLimit = false;
    const downloadTimer = setTimeout(() => { timeLimit = true; controller.abort(); }, 180000);
    running = {group, controller};
    refreshVersion++;
    setReadiness(false, group, '', 'loading');
    window.pauseOnlineMapRequests?.();
    preparedPackPromise = null;
    let finalNotice = null;
    controls(true, false);
    badge('Preparando', 'loading');
    progress(0, territories.length);
    status('Guardando la página y preparando los territorios…', 'loading');
    try {
      await cancellable(ensureShell(), controller.signal);
      checkActive(controller.signal, group);
      if (navigator.storage?.persist) await cancellable(navigator.storage.persist().catch(() => false), controller.signal);
      let done = 0;
      const failed = [];
      let pack;
      for (const territory of territories) {
        checkActive(controller.signal, group);
        const existing = await dataStore.get(group, territory.key);
        checkActive(controller.signal, group);
        if (!completeRecord(existing, territory.bounds)) {
          const name = displayTerritoryName(territory.loc);
          if (pack === undefined) {
            status('Preparando los mapas de la congregación…', 'loading');
            pack = await preparedPack(controller.signal);
            checkActive(controller.signal, group);
          }
          const prepared = preparedRecord(pack, territory);
          let record;
          if (prepared) {
            status('Guardando ' + name + ' en este dispositivo…', 'loading');
            record = {roads:prepared.roads, refs:prepared.refs, bounds:prepared.bounds, savedAt:Date.now()};
          } else {
            status('Descargando ' + name + ' (' + (done + 1) + ' de ' + territories.length + ')…', 'loading');
            try {
              const elements = await dataStore.download(territory.bounds, {
                signal:controller.signal,
                onProgress:event => {
                  if (!controller.signal.aborted && group === congregacionActivaId) status(name + ': ' + event.message, 'loading');
                }
              });
              record = {
                roads:packRoadWays(roadWaysFromOverpass({elements:elements.roadElements})),
                refs:referencesFromOverpass({elements:elements.referenceElements}),
                bounds:territory.bounds, savedAt:Date.now()
              };
            } catch (error) {
              checkActive(controller.signal, group);
              if (error?.name === 'AbortError') throw error;
              failed.push({name, message:error?.message || 'No se pudo guardar este mapa.'});
              continue;
            }
          }
          checkActive(controller.signal, group);
          await dataStore.set(group, territory.key, record);
          checkActive(controller.signal, group);
          // El mapa que está abierto puede usar también estos datos, sin hacer
          // otra consulta al servidor mientras se prepara su copia sin conexión.
          writeOverpassCache(territory.loc, 'roads', unpackRoadWays(record.roads));
          writeOverpassCache(territory.loc, 'refs', record.refs);
        }
        done++;
        progress(done, territories.length);
      }
      if (failed.length) {
        finalNotice = [done ? 'Se guardaron ' + done + ' de ' + territories.length + ' territorios. Faltan: '
          + failed.map(item => item.name).join(', ') + '. Toca «Continuar descarga» para reintentar solo los pendientes.'
          : failed[0].message + ' Los mapas no se completaron. Toca «Descargar congregación» para reintentar.', 'error'];
      } else {
        badge('Listo', 'ready');
        status('Listo: ' + done + (done === 1 ? ' territorio guardado' : ' territorios guardados') +
          '. El mapa usará las calles guardadas cuando no haya internet; tus colores, dibujos y ubicación seguirán visibles.', 'ready');
      }
    } catch (error) {
      if (error?.name === 'AbortError') {
        badge('Pausado', '');
        finalNotice = [timeLimit ? 'El servidor sigue ocupado. Los mapas que ya se guardaron se conservan; vuelve a intentar para continuar los pendientes.'
          : 'Descarga pausada. Los territorios ya guardados se conservan; puedes reanudarla.', ''];
      } else {
        badge('Incompleto', 'error');
        finalNotice = [(error?.message || 'No se completó la descarga.') + ' Toca «Descargar congregación» para continuar.', 'error'];
      }
    } finally {
      clearTimeout(downloadTimer);
      running = null;
      window.resumeOnlineMapRequests?.();
      if (group === congregacionActivaId && map && $offline('welcome-screen')?.classList.contains('is-hidden')) {
        runtimeRoadCache = null;
        runtimeReferenceCache = null;
        updateRuntimeVectorRoadOverlay();
        updateRuntimeReferenceOverlay();
      }
      await refresh();
      if (finalNotice && group === congregacionActivaId) {
        if (finalNotice[1] === 'error') setReadiness(false, group, '', 'error');
        status(finalNotice[0], finalNotice[1]);
      }
    }
  }

  async function removeAll() {
    if (running || removingGroup || !dataStore) return;
    const group = congregacionActivaId;
    removingGroup = group;
    refreshVersion++;
    setReadiness(false, group, '', 'loading');
    controls(false, true);
    try {
      await dataStore.clear(group);
      removingGroup = null;
      if (group !== congregacionActivaId) { refresh(); return; }
      if (currentView === 'offline') {
        runtimeRoadCache = null;
        runtimeReferenceCache = null;
        updateRuntimeVectorRoadOverlay();
        updateRuntimeReferenceOverlay();
      }
      await refresh();
      status('Se quitaron los mapas de esta congregación. Tus colores y dibujos permanecen guardados.');
    } catch (error) {
      removingGroup = null;
      if (group !== congregacionActivaId) { refresh(); return; }
      controls(false, true);
      setReadiness(false, group, '', 'error');
      status(error.message || 'No se pudo quitar la descarga.', 'error');
    }
  }

  async function previewSavedMap() {
    if (running || !map) return;
    const group = congregacionActivaId;
    const requestedView = currentView;
    if (currentView === 'offline') {
      if (!navigator.onLine) return;
      offlineAutoView = false;
      changeView(lastOnlineView || 'g-road', true);
    } else {
      await refresh();
      if (group !== congregacionActivaId || currentView !== requestedView || !readiness.ready || readiness.group !== group) return;
      lastOnlineView = currentView;
      offlineAutoView = true;
      changeView('offline', true);
      setStatus('Mostrando las calles y nombres guardados en este dispositivo.', '');
    }
    offlineDialog?.close();
    refresh();
  }

  function networkChange() {
    if (!navigator.onLine) running?.controller.abort();
    if (!map) { refresh(); return; }
    if (!navigator.onLine && currentView !== 'offline') {
      lastOnlineView = currentView;
      offlineAutoView = true;
      changeView('offline', true);
      setStatus('Sin internet. Mostrando el mapa descargado; Mi ubicación usa la señal del dispositivo.', 'warn');
    } else if (navigator.onLine && offlineAutoView && currentView === 'offline') {
      offlineAutoView = false;
      changeView(lastOnlineView, true);
    }
    refresh();
  }

  $offline('offline-download')?.addEventListener('click', downloadAll);
  $offline('offline-cancel')?.addEventListener('click', () => running?.controller.abort());
  $offline('offline-remove')?.addEventListener('click', removeAll);
  $offline('offline-preview')?.addEventListener('click', previewSavedMap);
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
  window.offlineRecordCovers = (loc, record) => completeRecord(record, territoryBounds(loc));
  if (window.isSecureContext && 'serviceWorker' in navigator) ensureShell().then(refresh).catch(() => {});
  refresh();
})();
