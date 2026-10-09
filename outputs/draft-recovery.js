/* Los trazos sin terminar se conservan solo en este dispositivo y por congregación. */
(function () {
  'use strict';

  const STORAGE_KEY = 'croquis-draw-drafts-v1';
  const MAX_POINTS = 2500;
  const MAX_RECORDS = 128;
  const MAX_STORAGE_LENGTH = 1000000;
  const kinds = new Set(['area', 'road', 'highway', 'river']);
  let active = null;
  let pending = null;
  let queuedWrite = null;
  let timer = null;
  let applying = false;
  let initialized = false;
  let observedMap = null;
  let storageWarningShown = false;
  let lastFingerprint = '';
  let pointRedo = null;

  const element = id => document.getElementById(id);
  const dialog = () => element('draft-recovery-dialog');
  const validId = value => typeof value === 'string' && /^[\w.-]{1,100}$/.test(value);
  const finiteNumber = value => typeof value === 'number' && Number.isFinite(value);

  function coordinate(value) {
    const lat = Array.isArray(value) ? value[0] : value?.lat;
    const lng = Array.isArray(value) ? value[1] : value?.lng;
    return finiteNumber(lat) && finiteNumber(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
      ? [lat, lng] : null;
  }

  function normalizeRecord(value, id) {
    if (!value || value.version !== 1 || value.congregationId !== id || !validId(value.locNum)
      || !kinds.has(value.kind) || !Array.isArray(value.points) || !value.points.length
      || value.points.length > MAX_POINTS || !finiteNumber(value.savedAt) || value.savedAt <= 0) return null;
    const points = value.points.map(coordinate);
    if (points.some(point => !point)) return null;
    const cameraCenter = coordinate(value.camera?.center);
    const cameraZoom = value.camera?.zoom;
    const camera = cameraCenter && finiteNumber(cameraZoom) && cameraZoom >= 0 && cameraZoom <= 24
      ? { center:cameraCenter, zoom:cameraZoom } : null;
    const color = /^#[0-9a-f]{6}$/i.test(value.color) ? value.color : '#8b5cf6';
    const opacity = finiteNumber(value.opacity) ? Math.max(10, Math.min(85, value.opacity)) : 50;
    return { version:1, congregationId:id, locNum:value.locNum, kind:value.kind,
      points, color, opacity, camera, savedAt:value.savedAt };
  }

  // El destino de cada escritura queda fijado antes del debounce. Cambiar de
  // congregación nunca puede trasladar un borrador a su nuevo almacenamiento.
  function scopedStorage(id) {
    if (id === congregacionActivaId) return almacen;
    return {
      getItem:key => localStorage.getItem(claveDe(key, id)),
      setItem:(key, value) => localStorage.setItem(claveDe(key, id), value),
      removeItem:key => localStorage.removeItem(claveDe(key, id))
    };
  }

  function readRecords(id) {
    try {
      const raw = scopedStorage(id).getItem(STORAGE_KEY);
      if (!raw || raw.length > MAX_STORAGE_LENGTH) return [];
      const parsed = JSON.parse(raw);
      if (parsed?.version !== 1 || !Array.isArray(parsed.entries) || parsed.entries.length > MAX_RECORDS) return [];
      const seen = new Set();
      return parsed.entries.map(value => normalizeRecord(value, id)).filter(value => {
        if (!value || seen.has(value.locNum)) return false;
        seen.add(value.locNum); return true;
      });
    } catch (_) { return []; }
  }

  function persist(write) {
    if (!write || !validId(write.id) || !validId(write.num)) return false;
    try {
      const entries = readRecords(write.id).filter(value => value.locNum !== write.num);
      if (write.record) entries.push(write.record);
      entries.sort((a, b) => b.savedAt - a.savedAt);
      if (entries.length > MAX_RECORDS) entries.length = MAX_RECORDS;
      if (!entries.length) scopedStorage(write.id).removeItem(STORAGE_KEY);
      else {
        const raw = JSON.stringify({ version:1, entries });
        if (raw.length > MAX_STORAGE_LENGTH) throw new Error('draft-storage-full');
        scopedStorage(write.id).setItem(STORAGE_KEY, raw);
      }
      storageWarningShown = false;
      return true;
    } catch (_) {
      if (!storageWarningShown) {
        storageWarningShown = true;
        setStatus('No se pudo guardar el borrador en este dispositivo. Guarda el dibujo antes de cerrar la página.', 'warn');
      }
      return false;
    }
  }

  function currentIdentity(loc = LOCS[currentIndex]) {
    const id = congregacionActivaId, num = String(loc?.num ?? '');
    return validId(id) && validId(num) ? { id, num } : null;
  }

  function editorReady() {
    return !!map && !!LOCS[currentIndex] && element('welcome-screen')?.classList.contains('is-hidden')
      && (!window.CroquisAccess || window.CroquisAccess.canEnter());
  }

  function sameIdentity(identity) {
    return !!active && !!identity && active.id === identity.id && active.num === identity.num;
  }

  function readLiveDraft() {
    let kind, points;
    if (roadPencilMode && roadDraftPoints.length) { kind = modoCarretera ? 'highway' : 'road'; points = roadDraftPoints; }
    else if (riverPencilMode && riverDraftPoints.length) { kind = 'river'; points = riverDraftPoints; }
    else if (colorDrawMode && draftPoints.length) { kind = 'area'; points = draftPoints; }
    else return null;
    return normalizeRecord({ version:1, congregationId:active.id, locNum:active.num, kind, points,
      color:colorInput?.value, opacity:getFillOpacity() * 100,
      camera:{ center:coordinate(map.getCenter()), zoom:map.getZoom() }, savedAt:Date.now() }, active.id) || undefined;
  }

  function rememberLiveDraft() {
    if (applying || !editorReady() || !sameIdentity(currentIdentity()) || !active.accepted) return;
    const record = readLiveDraft();
    if (record === undefined) return;
    const fingerprint = JSON.stringify(record ? { ...record, savedAt:0 } : null);
    if (fingerprint === lastFingerprint) return;
    lastFingerprint = fingerprint;
    queuedWrite = { id:active.id, num:active.num, record };
  }

  function capture() {
    if (!applying && pointRedo && !validPointRedo()) pointRedo = null;
    rememberLiveDraft();
    if (!queuedWrite || applying) return;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; writeQueued(); }, 120);
  }

  function writeQueued() {
    if (!queuedWrite) return true;
    const write = queuedWrite;
    if (!persist(write)) return false;
    if (queuedWrite === write) queuedWrite = null;
    return true;
  }

  function flush() {
    rememberLiveDraft();
    if (timer !== null) clearTimeout(timer);
    timer = null;
    return writeQueued();
  }

  function leave() {
    flush();
    active = null; pending = null; lastFingerprint = '';
    pointRedo = null;
    if (dialog()?.open) dialog().close();
  }

  function observeMap() {
    if (!map || map === observedMap) return;
    if (observedMap) observedMap.off('moveend', capture);
    observedMap = map;
    map.on('moveend', capture);
  }

  function offer(loc = LOCS[currentIndex], options = {}) {
    if (applying) return false;
    init();
    observeMap();
    const identity = currentIdentity(loc);
    if (!editorReady() || !identity || identity.num !== String(LOCS[currentIndex].num)) return false;
    if (sameIdentity(identity) && active.accepted) return false;
    active = { ...identity, accepted:false };
    const records = readRecords(identity.id);
    pending = records.find(value => value.locNum === identity.num) || null;
    if (!pending && options.latest) {
      pending = records.filter(value => LOCS.some(item => String(item.num) === value.locNum))
        .sort((a, b) => b.savedAt - a.savedAt)[0] || null;
    }
    lastFingerprint = '';
    if (!pending) { active.accepted = true; return false; }
    const names = { area:'una zona de color', road:'una calle', highway:'una carretera', river:'un río' };
    const target = LOCS.find(item => String(item.num) === pending.locNum) || loc;
    const description = element('draft-recovery-description');
    if (description) description.textContent = 'Encontramos ' + names[pending.kind] + ' sin terminar en '
      + displayTerritoryTitle(target) + '. Sus ' + pending.points.length
      + ' puntos están guardados en este dispositivo. Puedes continuar donde lo dejaste o descartar el borrador.';
    if (!dialog()) return false;
    if (!dialog().open) dialog().showModal();
    element('draft-recover')?.focus();
    return true;
  }

  function recover() {
    if (!pending || !editorReady() || !sameIdentity(currentIdentity())) return false;
    const record = pending;
    const targetIndex = LOCS.findIndex(item => String(item.num) === record.locNum);
    if (targetIndex < 0 || record.congregationId !== congregacionActivaId) return false;
    applying = true;
    try {
      if (targetIndex !== currentIndex) goTo(targetIndex, true, false);
      active = { id:record.congregationId, num:record.locNum, accepted:false };
      if (record.kind === 'area') {
        setColorDrawMode(true);
        colorInput.value = record.color;
        colorOpacityInput.value = String(record.opacity);
        draftPoints = record.points.map(point => L.latLng(point[0], point[1]));
      } else if (record.kind === 'river') {
        setRiverPencilMode(true, false);
        riverDraftPoints = record.points.map(point => L.latLng(point[0], point[1]));
      } else {
        setRoadPencilMode(true, false, record.kind === 'highway');
        roadDraftPoints = record.points.map(point => L.latLng(point[0], point[1]));
      }
      if (record.camera) {
        const min = Number.isFinite(map.getMinZoom?.()) ? map.getMinZoom() : 0;
        const max = Number.isFinite(map.getMaxZoom?.()) ? map.getMaxZoom() : 24;
        map.setView(record.camera.center, Math.max(min, Math.min(max, record.camera.zoom)), { animate:false });
      }
      if (record.kind === 'area') renderDraftArea();
      else if (record.kind === 'river') renderRiverDraft();
      else renderRoadDraft();
      updateColorControls(LOCS[currentIndex]);
      setStatus('Borrador recuperado. Continúa dibujando y usa Guardar cuando esté listo.', 'warn');
      active.accepted = true; pending = null;
      if (dialog()?.open) dialog().close();
    } finally { applying = false; }
    capture();
    return true;
  }

  function discard() {
    if (!pending || !sameIdentity(currentIdentity())) return false;
    queuedWrite = { id:active.id, num:pending.locNum, record:null };
    if (timer !== null) clearTimeout(timer);
    timer = null;
    if (!writeQueued()) return false;
    pending = null; active.accepted = true; lastFingerprint = JSON.stringify(null);
    if (dialog()?.open) dialog().close();
    setStatus('Borrador descartado.', 'warn');
    return true;
  }

  function pointState() {
    if (roadPencilMode) return { kind:'road', points:roadDraftPoints };
    if (riverPencilMode) return { kind:'river', points:riverDraftPoints };
    if (colorDrawMode) return { kind:'color', points:draftPoints };
    return null;
  }

  function pointSignature(points) {
    return JSON.stringify(points.map(coordinate));
  }

  function validPointRedo() {
    const identity = currentIdentity(), state = pointState();
    return !!pointRedo && !!identity && !!state && pointRedo.id === identity.id
      && pointRedo.num === identity.num && pointRedo.kind === state.kind
      && pointRedo.expected === pointSignature(state.points);
  }

  function rememberPointUndo(kind, pointsBefore) {
    const identity = currentIdentity(), state = pointState();
    const normalizedKind = kind === 'area' ? 'color' : kind === 'highway' ? 'road' : kind;
    if (!identity || !state || state.kind !== normalizedKind || !Array.isArray(pointsBefore)
      || !pointsBefore.length || pointsBefore.length > MAX_POINTS) return false;
    const before = pointsBefore.map(coordinate);
    if (before.some(point => !point)) return false;
    if (!validPointRedo()) pointRedo = { ...identity, kind:normalizedKind, steps:[] };
    pointRedo.steps.push(before);
    if (pointRedo.steps.length > 80) pointRedo.steps.shift();
    pointRedo.expected = pointSignature(before.slice(0, -1));
    return true;
  }

  function canRedoPoint() {
    if (!validPointRedo()) { pointRedo = null; return false; }
    return pointRedo.steps.length > 0;
  }

  function redoPoint() {
    if (!editorReady() || !canRedoPoint()) return false;
    const next = pointRedo.steps.pop().map(point => L.latLng(point[0], point[1]));
    pointRedo.expected = pointSignature(next);
    if (pointRedo.kind === 'road') { roadDraftPoints = next; renderRoadDraft(); }
    else if (pointRedo.kind === 'river') { riverDraftPoints = next; renderRiverDraft(); }
    else { draftPoints = next; renderDraftArea(); }
    if (!pointRedo.steps.length) pointRedo = null;
    updateColorControls(LOCS[currentIndex]);
    capture();
    return true;
  }

  function hasPending() {
    return !!pending || !!pointState()?.points.length;
  }

  function init() {
    if (initialized) return;
    initialized = true;
    element('draft-recover')?.addEventListener('click', recover);
    element('draft-discard')?.addEventListener('click', discard);
    // Escape no elimina el trabajo ni deja capturas nuevas sobre la decisión pendiente.
    dialog()?.addEventListener('cancel', event => event.preventDefault());
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
  }

  window.CroquisDrafts = { init, capture, flush, leave, offer, recover, discard,
    hasPending, rememberPointUndo, canRedoPoint, redoPoint };
  init();
})();
