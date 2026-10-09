/* Buscar sobre los datos de la congregación abierta; navegar no cambia los dibujos. */
(function (global) {
  'use strict';
  const MAX_RESULTS = 40;
  const UI_LIMIT = 25;
  const normalize = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es').replace(/[^a-z0-9]+/g, ' ').trim();
  const digits = value => String(value).replace(/^0+(?=\d)/, '');
  const point = value => Array.isArray(value) && value.length >= 2 && value.slice(0, 2).every(n => n != null && typeof n !== 'boolean' && String(n).trim() !== '' && Number.isFinite(Number(n))) && Math.abs(Number(value[0])) <= 85.05112878 && Math.abs(Number(value[1])) <= 180;
  const polygon = area => Array.isArray(area?.points) && area.points.length >= 3 && area.points.every(point) ? area.points.map(p => [Number(p[0]), Number(p[1])]) : null;

  function contains(position, points) {
    const y = position[0], x = position[1];
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const [yi, xi] = points[i], [yj, xj] = points[j];
      // Un número colocado justo en el borde sigue perteneciendo a su zona.
      const cross = (x - xi) * (yj - yi) - (y - yi) * (xj - xi);
      if (Math.abs(cross) < 1e-12 && x >= Math.min(xi, xj) && x <= Math.max(xi, xj) && y >= Math.min(yi, yj) && y <= Math.max(yi, yj)) return true;
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  function buildIndex({ locs = [], groupId = '', getLabels = () => [], getAreas = () => [] } = {}) {
    if (!groupId || !Array.isArray(locs)) return [];
    const entries = [];
    locs.forEach((loc, index) => {
      if (!loc || loc.num == null) return;
      const owner = loc.congregacionId ?? loc.congregationId ?? loc.groupId;
      if (owner != null && String(owner) !== String(groupId)) return;
      const number = String(loc.displayNum || index + 1);
      const name = String(loc.name || '').trim();
      const alias = String(loc.alias || '').trim();
      const title = name + (alias && alias !== name ? ' / ' + alias : '');
      const base = { groupId: String(groupId), index, locNum: String(loc.num), parentNumber: number, name: title, words: normalize(title) };
      entries.push({ ...base, key: 'territory:' + loc.num, kind: 'territory', number, title: '#' + number + ' · ' + title });
      const rawAreas = getAreas(loc);
      const areas = (Array.isArray(rawAreas) ? rawAreas : []).map(polygon).filter(Boolean);
      const seen = new Set();
      const labels = getLabels(loc);
      (Array.isArray(labels) ? labels : []).forEach(label => {
        const text = String(label?.text ?? '').trim();
        if (!/^\d+$/.test(text) || !point([label.lat, label.lng])) return;
        const number = digits(text);
        if (seen.has(number)) return;
        seen.add(number);
        const position = [Number(label.lat), Number(label.lng)];
        const points = areas.slice().reverse().find(points => contains(position, points)) || null;
        entries.push({ ...base, key: 'subterritory:' + loc.num + ':' + number, kind: 'subterritory', number, position, points, title: 'Subterritorio ' + number, detail: '#' + base.parentNumber + ' · ' + title });
      });
    });
    return entries;
  }

  function search(entries, query, { groupId, limit = UI_LIMIT } = {}) {
    const tokens = normalize(query).split(' ').filter(Boolean);
    const wantsSub = tokens.some(t => t === 'subterritorio' || t === 'subterritorios');
    const wantsTerritory = !wantsSub && tokens.some(t => t === 'territorio' || t === 'territorios');
    const terms = tokens.filter(t => !['territorio', 'territorios', 'subterritorio', 'subterritorios'].includes(t));
    const maximum = Math.min(MAX_RESULTS, Math.max(1, Math.trunc(Number(limit)) || UI_LIMIT));
    return (Array.isArray(entries) ? entries : []).filter(entry => {
      if (groupId == null || String(entry.groupId) !== String(groupId)) return false;
      if (wantsSub && entry.kind !== 'subterritory' || wantsTerritory && entry.kind !== 'territory') return false;
      return terms.every(term => /^\d+$/.test(term) ? entry.number === digits(term) : entry.words.includes(term));
    }).slice(0, maximum);
  }

  let initialized = false, dialog, input, results, status, returnFocus, openedGroup = '';
  const element = id => global.document?.getElementById(id);
  const group = () => typeof congregacionActivaId === 'undefined' ? '' : String(congregacionActivaId || '');
  const allowed = () => !!group() && typeof map !== 'undefined' && !!map && (!global.CroquisAccess || global.CroquisAccess.canEnter());
  function currentEntries() {
    return buildIndex({ locs: typeof LOCS === 'undefined' ? [] : LOCS, groupId: group(), getLabels: loc => typeof getTextLabelsForLoc === 'function' ? getTextLabelsForLoc(loc) : [], getAreas: loc => typeof getColorAreasForLoc === 'function' ? getColorAreasForLoc(loc) : [] });
  }
  function close() { if (dialog?.open) dialog.close(); }
  function navigate(entry) {
    if (!allowed() || group() !== openedGroup || entry.groupId !== group()) { close(); return; }
    // Buscar otra vez evita abrir un resultado borrado o renombrado mientras el recuadro estaba abierto.
    const live = currentEntries().find(item => item.key === entry.key);
    if (!live || typeof goTo !== 'function') { refresh(); return; }
    close();
    if (live.kind === 'territory') { goTo(live.index); return; }
    goTo(live.index, true, false);
    if (live.points && global.L?.latLngBounds) map.fitBounds(global.L.latLngBounds(live.points), { padding: [40, 40], maxZoom: 19, animate: false });
    else map.setView(live.position, Math.max(18, map.getZoom()), { animate: false });
  }
  function refresh() {
    if (!initialized) return false;
    if (!allowed() || dialog.open && openedGroup !== group()) { results.replaceChildren(); close(); return false; }
    const entries = currentEntries();
    const matches = search(entries, input.value, { groupId: group() });
    const counts = new Map();
    entries.filter(item => item.kind === 'subterritory').forEach(item => counts.set(item.locNum, (counts.get(item.locNum) || 0) + 1));
    const fragment = global.document.createDocumentFragment();
    matches.forEach(entry => {
      const button = global.document.createElement('button');
      button.type = 'button';
      button.className = 'territory-search-result';
      const title = global.document.createElement('strong');
      title.textContent = entry.title;
      button.appendChild(title);
      const detail = global.document.createElement('span');
      detail.textContent = entry.kind === 'subterritory' ? entry.detail : 'Territorio · ' + (counts.get(entry.locNum) || 0) + ' subterritorios';
      button.appendChild(detail);
      button.addEventListener('click', () => navigate(entry));
      fragment.appendChild(button);
    });
    results.replaceChildren(fragment);
    status.textContent = matches.length ? matches.length + (matches.length === 1 ? ' resultado.' : ' resultados.') + (matches.length === UI_LIMIT ? ' Escribe un nombre o número para precisar la búsqueda.' : '') : 'No se encontraron territorios. Prueba otro nombre o número.';
    return true;
  }
  function open(trigger) {
    if (!init() || !allowed()) return false;
    returnFocus = trigger?.currentTarget || trigger || global.document.activeElement;
    openedGroup = group();
    input.value = '';
    refresh();
    if (!dialog.open) dialog.showModal();
    input.focus({ preventScroll: true });
    return true;
  }
  function init() {
    if (initialized) return true;
    dialog = element('territory-search-dialog'); input = element('territory-search-input');
    results = element('territory-search-results'); status = element('territory-search-status');
    if (!dialog || !input || !results || !status) return false;
    initialized = true;
    element('btn-territory-search')?.addEventListener('click', open);
    element('territory-search-close')?.addEventListener('click', close);
    input.addEventListener('input', refresh);
    input.addEventListener('keydown', event => {
      if (!['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key)) return;
      const buttons = results.querySelectorAll('button');
      if (!buttons.length) return;
      event.preventDefault();
      if (event.key === 'Enter') buttons[0].click();
      else buttons[event.key === 'ArrowUp' ? buttons.length - 1 : 0].focus();
    });
    results.addEventListener('keydown', event => {
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      const buttons = Array.from(results.querySelectorAll('button'));
      const from = buttons.indexOf(global.document.activeElement);
      if (from < 0) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : Math.max(0, Math.min(buttons.length - 1, from + (event.key === 'ArrowDown' ? 1 : -1)));
      buttons[next].focus();
    });
    dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
    dialog.addEventListener('close', () => { returnFocus?.focus?.({ preventScroll: true }); });
    return true;
  }
  const api = { init, open, refresh, normalize, buildIndex, search };
  global.CroquisSearch = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  init();
})(typeof window === 'undefined' ? globalThis : window);
