const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '../outputs/croquis_territorios.html'), 'utf8');
function extractFunction(name) {
  const start = html.indexOf(`function ${name}(`);
  assert(start >= 0, `La función real ${name} debe estar disponible`);
  let depth = 0, opening = -1;
  for (let i = html.indexOf('(', start); i < html.length; i++) {
    if (html[i] === '(') depth++;
    if (html[i] === ')' && --depth === 0) { opening = html.indexOf('{', i); break; }
  }
  assert(opening >= 0, `El cuerpo de ${name} debe estar completo`);
  depth = 0;
  let quote = null;
  for (let i = opening; i < html.length; i++) {
    const char = html[i], next = html[i + 1];
    if (quote) {
      if (char === '\\') { i++; continue; }
      if (char === quote) quote = null;
      continue;
    }
    if (char === '/' && next === '/') { i = html.indexOf('\n', i); continue; }
    if (char === '/' && next === '*') { i = html.indexOf('*/', i + 2) + 1; continue; }
    if (char === '"' || char === "'" || char === '`') { quote = char; continue; }
    if (char === '{') depth++;
    if (char === '}' && --depth === 0) return html.slice(start, i + 1) + '\n';
  }
  throw new Error(`La función ${name} está incompleta`);
}

const source = ['cloneData', 'stateFingerprint', 'sanitizeColor', 'getFillOpacity', 'pointsToLatLngs',
  'getColorAreasForLoc', 'setColorAreasForLoc', 'getColorDraftSession', 'restoreColorDraftSession',
  'resetDraftArea', 'resetRoadDraft', 'resetRiverDraft', 'setRoadPencilMode', 'setRiverPencilMode',
  'ajustarDobleClic', 'setColorDrawMode', 'continueColorArea', 'addColorAreaForCurrent',
  'finishDraftColorArea', 'clearColorAreasForCurrent'].map(extractFunction).join('\n');
const copy = value => JSON.parse(JSON.stringify(value));
const points = [[19.041, -96.951], [19.042, -96.95], [19.043, -96.952]];
const latLngs = coordinates => coordinates.map(([lat, lng]) => ({ lat, lng }));
const closedArea = (extra = {}) => ({color:'#1257c5', opacity:.5, points:copy(points),
  number:17, label:'Subterritorio 17', metadata:{owner:'propio'}, ...extra});

function harness({areas = [closedArea(), closedArea({number:18, color:'#55cc11'})], nestedRefresh = false} = {}) {
  const classes = new Set(), statuses = [], calls = [], captures = [], refreshes = [];
  const noOp = () => {};
  const mapClassList = {add:name => classes.add(name), remove:name => classes.delete(name),
    toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); }};
  let saving = true;
  let persisted = {'1':copy(areas)};
  const c = vm.createContext({
    LOCS:[{num:1, name:'Moctezuma'}, {num:2, name:'Neviería'}], currentIndex:0,
    congregacionActivaId:'ixhuatlan', DEFAULT_FILL_COLOR:'#8b5cf6', OPACIDAD_POR_DEFECTO:50,
    colorAreaSettings:{'1':copy(areas)}, undoHistory:[], redoHistory:[], suppressUndoSnapshot:false,
    colorDrawMode:false, colorEditMode:false, contourEditMode:false, colorDraftSession:null,
    draftPoints:[], roadPencilMode:false, modoCarretera:false, roadDraftPoints:[], riverPencilMode:false,
    riverDraftPoints:[], textAddMode:false, iconAddMode:false, territoryAddMode:false,
    frameMoveMode:false, destinationAddMode:false, destinationSession:null,
    selectedAreaIndex:null, selectedTextIndex:null, selectedIconIndex:null,
    selectedReference:null, selectedLine:null,
    colorInput:{value:'#0a67cf'}, colorOpacityInput:{value:'47'},
    colorDrawButton:{classList:mapClassList}, colorResumeButton:{hidden:true, disabled:false},
    statusBox:{classList:{contains:() => false}, textContent:''},
    document:{querySelector:() => ({classList:mapClassList}), getElementById:() => null},
    window:{L:{}, CroquisAccess:{canEnter:() => true}, CroquisDrafts:{capture:() => captures.push('capture')}},
    L:{latLng:(lat, lng) => ({lat, lng})},
    draftLayer:{clearLayers:() => calls.push('clear-draft')},
    map:{getCenter:() => ({lat:19.044, lng:-96.953}), getZoom:() => 19,
      setView:() => calls.push('set-view'), fitBounds:() => calls.push('fit-bounds'),
      doubleClickZoom:{disable:() => calls.push('disable-double-click'), enable:() => calls.push('enable-double-click')}},
    cancelDestinationInteraction:noOp,
    clearSelectedLine:() => { c.selectedLine = null; },
    setFrameMoveMode:active => { c.frameMoveMode = active; },
    setTerritoryAddMode:active => { c.territoryAddMode = active; },
    setTextAddMode:active => { c.textAddMode = active; },
    setIconAddMode:active => { c.iconAddMode = active; },
    setContourEditMode:active => { c.contourEditMode = active; c.updateColorControls(); },
    renderDraftArea:() => calls.push('render-draft'),
    renderColorAreas:() => calls.push('render-areas'), renderTextLabels:noOp, renderManualIcons:noOp,
    getTextLabelsForLoc:() => [], getWhiteRoadsForLoc:() => [], getManualRiversForLoc:() => [],
    updateColorControls() {
      if (!nestedRefresh) return;
      const current = c.getColorDraftSession();
      if (current) refreshes.push(copy(current));
    },
    setStatus:(text, type) => statuses.push({text, type}),
    publicarTerritorioPronto:loc => calls.push(`publish:${loc.num}`),
    saveColorAreaSettings() {
      calls.push('save-colors');
      if (!saving) return false;
      persisted = copy(c.colorAreaSettings);
      return true;
    },
    pushUndoSnapshot(reason, loc) {
      c.undoHistory.push({reason, locNum:loc.num, areas:copy(c.getColorAreasForLoc(loc))});
      c.redoHistory = [];
    },
    saveUndoHistory:() => { calls.push('save-history'); return true; }
  });
  vm.runInContext(source, c);
  const start = (coordinates = points) => { c.setColorDrawMode(true); c.draftPoints = latLngs(coordinates); };
  const session = () => copy(c.getColorDraftSession());
  const geometry = () => copy(c.draftPoints).map(point => [point.lat, point.lng]);
  const assertCamera = () => assert.equal(calls.some(call => call === 'set-view' || call === 'fit-bounds'), false);
  return {c, classes, calls, captures, statuses, refreshes, start, session, geometry, assertCamera,
    persisted:() => copy(persisted), failStorage:() => { saving = false; },
    restoreStorage:() => { saving = true; }};
}

test('pausar Pintar conserva puntos y estilo; reactivarlo vuelve a la cruz sin Editar ni selecciones', () => {
  const h = harness(); h.start();
  const before = h.session();
  h.c.setColorDrawMode(false);
  assert.equal(h.c.colorDrawMode, false);
  assert.deepEqual(h.geometry(), points);
  assert.deepEqual(h.session(), before);
  h.c.colorInput.value = '#dd3300'; h.c.colorOpacityInput.value = '80';
  h.c.colorEditMode = h.c.contourEditMode = true;
  h.c.selectedAreaIndex = h.c.selectedTextIndex = h.c.selectedIconIndex = 0;
  h.c.selectedReference = {name:'Referencia'}; h.c.selectedLine = {kind:'road', index:0};
  h.c.setColorDrawMode(true);
  assert.equal(h.c.colorDrawMode, true); assert.equal(h.c.colorEditMode, false);
  assert.equal(h.c.contourEditMode, false);
  for (const field of ['selectedAreaIndex','selectedTextIndex','selectedIconIndex','selectedReference','selectedLine']) {
    assert.equal(h.c[field], null, `${field} no debe modificar otra selección al pintar`);
  }
  assert.equal(h.c.colorInput.value, before.color);
  assert.equal(Number(h.c.colorOpacityInput.value) / 100, before.opacity);
  assert.deepEqual(h.geometry(), points); assert(h.classes.has('is-color-drawing'));
  assert.deepEqual(h.c.colorAreaSettings['1'].map(area => area.number), [17,18]);
  h.assertCamera();
});

test('Continuar pintando retoma un borrador pausado sin crear una segunda zona', () => {
  const h = harness(); h.start(points.slice(0,2)); h.c.setColorDrawMode(false);
  const original = copy(h.c.colorAreaSettings);
  assert.equal(h.c.continueColorArea(), true);
  assert.equal(h.c.colorDrawMode, true); assert.deepEqual(h.geometry(), points.slice(0,2));
  assert.deepEqual(copy(h.c.colorAreaSettings), original);
  assert.equal(h.c.undoHistory.length, 0); h.assertCamera();
});

test('Continuar restaura el azul pausado antes de los refrescos anidados de otras herramientas', () => {
  const h = harness({nestedRefresh:true}); h.start();
  const blue = h.session(); h.c.setColorDrawMode(false);
  h.c.colorInput.value = '#dd3300'; h.c.colorOpacityInput.value = '80';
  h.refreshes.length = 0;
  assert.equal(h.c.continueColorArea(), true);
  assert(h.refreshes.length >= 3, 'Los cambios de modo deben ejercitar refrescos anidados');
  for (const current of h.refreshes) {
    assert.equal(current.color, blue.color); assert.equal(current.opacity, blue.opacity);
  }
  assert.deepEqual(h.session(), blue);
  assert.equal(h.c.colorInput.value, blue.color);
  assert.equal(Number(h.c.colorOpacityInput.value) / 100, blue.opacity);
  assert.deepEqual(h.geometry(), points); h.assertCamera();
});

for (const mode of ['road','river']) {
  for (const paused of [false,true]) {
    test(`el setter real de ${mode} no sustituye una pintura ${paused ? 'pausada' : 'activa'} pendiente`, () => {
      const h = harness({nestedRefresh:true}); h.start();
      if (paused) h.c.setColorDrawMode(false);
      const session = h.session(), settings = copy(h.c.colorAreaSettings);
      if (mode === 'road') h.c.setRoadPencilMode(true);
      else h.c.setRiverPencilMode(true);
      assert.equal(h.c.roadPencilMode, false); assert.equal(h.c.riverPencilMode, false);
      assert.equal(h.c.colorDrawMode, false, 'La pintura queda en pausa hasta guardarla o borrarla');
      assert.deepEqual(h.geometry(), points); assert.deepEqual(h.session(), session);
      assert.deepEqual(copy(h.c.colorAreaSettings), settings);
      assert.equal(h.c.undoHistory.length, 0);
      assert.match(h.statuses.at(-1).text, /pintura pendiente/); h.assertCamera();
    });
  }
}

test('Borrar una continuación sale de Pintar y conserva el original; después permite una pintura nueva', () => {
  const h = harness({nestedRefresh:true}); const original = copy(h.c.colorAreaSettings);
  h.c.selectedAreaIndex = 0; h.c.continueColorArea();
  h.c.draftPoints.push({lat:19.044,lng:-96.953});
  h.c.clearColorAreasForCurrent();
  assert.equal(h.c.colorDrawMode, false); assert.equal(h.c.draftPoints.length, 0);
  assert.equal(h.c.getColorDraftSession(), null); assert.equal(h.classes.has('is-color-drawing'), false);
  assert.deepEqual(copy(h.c.colorAreaSettings), original);
  assert(h.calls.includes('render-areas')); assert.equal(h.c.undoHistory.length, 0);
  h.start();
  assert.equal(h.session().areaTarget, undefined, 'La pintura nueva ya no debe reemplazar la continuación borrada');
  assert.equal(h.c.finishDraftColorArea(), true);
  assert.equal(h.c.colorAreaSettings['1'].length, 3);
  assert.deepEqual(copy(h.c.colorAreaSettings['1'].slice(0,2)), original['1']);
  h.assertCamera();
});

test('Continuar una zona cerrada conserva sus propiedades y reemplaza solo esa zona al guardar', () => {
  const h = harness(); const original = copy(h.c.colorAreaSettings);
  h.c.selectedAreaIndex = 0; h.c.colorEditMode = true;
  assert.equal(h.c.continueColorArea(), true);
  assert.deepEqual(h.geometry(), points);
  assert.deepEqual(copy(h.c.colorAreaSettings), original);
  assert.deepEqual(h.session().areaTarget, {index:0, fingerprint:h.c.stateFingerprint(original['1'][0])});
  h.c.draftPoints.push({lat:19.0435,lng:-96.953});
  assert.equal(h.c.finishDraftColorArea(), true);
  const after = copy(h.c.colorAreaSettings);
  assert.equal(after['1'].length, 2);
  assert.deepEqual(after['1'][0], {...original['1'][0], points:[...points,[19.0435,-96.953]]});
  assert.deepEqual(after['1'][1], original['1'][1]);
  assert.deepEqual(h.persisted(), after);
  assert.equal(h.c.undoHistory.length, 1);
  assert.deepEqual(copy(h.c.undoHistory[0].areas), original['1']);
  assert.equal(h.c.colorDrawMode, false); assert.equal(h.c.draftPoints.length, 0);
  assert.equal(h.c.getColorDraftSession(), null); h.assertCamera();
});

test('cerrar una zona nueva guarda una sola zona y permite retomarla desde su último vértice', () => {
  const h = harness({areas:[]}); h.start();
  assert.equal(h.c.finishDraftColorArea(), true);
  assert.equal(h.c.colorAreaSettings['1'].length, 1);
  assert.equal(h.c.selectedAreaIndex, 0);
  assert.equal(h.c.continueColorArea(), true);
  assert.deepEqual(h.geometry(), points);
  h.c.draftPoints.push({lat:19.044,lng:-96.953});
  assert.equal(h.c.finishDraftColorArea(), true);
  assert.equal(h.c.colorAreaSettings['1'].length, 1);
  assert.equal(h.c.colorAreaSettings['1'][0].points.length, 4);
  h.assertCamera();
});

test('retomar un contorno con vértices repetidos sitúa la continuación en su último vértice real', () => {
  const closed = [points[0], points[1], points[1], points[2], points[0]];
  const h = harness({areas:[closedArea({points:copy(closed)})]});
  const before = copy(h.c.colorAreaSettings);
  h.c.selectedAreaIndex = 0;
  assert.equal(h.c.continueColorArea(), true);
  assert.deepEqual(h.geometry(), points);
  assert.deepEqual(copy(h.c.colorAreaSettings), before, 'Retomar no cambia todavía el contorno guardado');
  h.c.draftPoints.push({lat:19.044,lng:-96.953});
  assert.equal(h.c.finishDraftColorArea(), true);
  assert.deepEqual(copy(h.c.colorAreaSettings['1'][0].points), [...points,[19.044,-96.953]]);
  assert.equal(h.c.colorAreaSettings['1'][0].number, 17); h.assertCamera();
});

for (const continuing of [false, true]) {
  test(`fallo de almacenamiento ${continuing ? 'al continuar' : 'al crear'} mantiene borrador y revierte geometría e historial`, () => {
    const h = harness();
    h.c.undoHistory = [{reason:'anterior', areas:[]}]; h.c.redoHistory = [{reason:'pendiente', areas:[]}];
    if (continuing) { h.c.selectedAreaIndex = 0; h.c.continueColorArea(); }
    else h.start();
    h.c.draftPoints.push({lat:19.044,lng:-96.953});
    const before = copy({settings:h.c.colorAreaSettings,undo:h.c.undoHistory,redo:h.c.redoHistory});
    const draft = h.geometry(), session = h.session(), persisted = h.persisted();
    h.failStorage();
    assert.equal(h.c.finishDraftColorArea(), false);
    assert.deepEqual(copy({settings:h.c.colorAreaSettings,undo:h.c.undoHistory,redo:h.c.redoHistory}), before);
    assert.deepEqual(h.persisted(), persisted);
    assert.deepEqual(h.geometry(), draft); assert.deepEqual(h.session(), session);
    assert.equal(h.c.colorDrawMode, true);
    h.restoreStorage(); assert.equal(h.c.finishDraftColorArea(), true);
    assert.equal(h.c.colorAreaSettings['1'].length, continuing ? 2 : 3);
    h.assertCamera();
  });
}

for (const conflict of ['changed','removed']) {
  test(`una zona ${conflict} durante la continuación no se sobrescribe y su borrador queda disponible`, () => {
    const h = harness(); h.c.selectedAreaIndex = 0; h.c.continueColorArea();
    h.c.draftPoints.push({lat:19.044,lng:-96.953});
    if (conflict === 'changed') h.c.colorAreaSettings['1'][0] = closedArea({color:'#aa0022'});
    else h.c.colorAreaSettings['1'].splice(0, 1);
    const settings = copy(h.c.colorAreaSettings), draft = h.geometry();
    assert.equal(h.c.finishDraftColorArea(), false);
    assert.deepEqual(copy(h.c.colorAreaSettings), settings); assert.deepEqual(h.geometry(), draft);
    assert.equal(h.c.undoHistory.length, 0); assert.equal(h.c.colorDrawMode, true);
    h.assertCamera();
  });
}

for (const change of ['territory','congregation']) {
  test(`una sesión de otro ${change} no guarda geometría bajo la identidad actual`, () => {
    const h = harness(); h.start(); const settings = copy(h.c.colorAreaSettings), draft = h.geometry();
    if (change === 'territory') h.c.currentIndex = 1;
    else h.c.congregacionActivaId = 'otra-congregacion';
    assert.equal(h.c.finishDraftColorArea(), false);
    assert.deepEqual(copy(h.c.colorAreaSettings), settings); assert.deepEqual(h.geometry(), draft);
    assert.equal(h.c.undoHistory.length, 0); assert.equal(h.calls.includes('save-colors'), false);
    h.assertCamera();
  });
}

test('menos de tres puntos se conserva para continuar y reset explícito sí elimina la sesión', () => {
  const h = harness(); h.start(points.slice(0,2));
  assert.equal(h.c.finishDraftColorArea(), false);
  assert.deepEqual(h.geometry(), points.slice(0,2)); assert(h.c.getColorDraftSession());
  h.c.resetDraftArea();
  assert.equal(h.c.draftPoints.length, 0); assert.equal(h.c.getColorDraftSession(), null);
  assert(h.captures.length > 0); h.assertCamera();
});

test('restaurar una sesión recuperada mantiene el objetivo y convierte la opacidad guardada a 0..1', () => {
  const h = harness(); const target = {index:0, fingerprint:h.c.stateFingerprint(h.c.colorAreaSettings['1'][0])};
  const record = {congregationId:'ixhuatlan', locNum:'1', kind:'area', color:'#33ccaa', opacity:62,
    points:copy(points), areaTarget:target};
  h.c.setColorDrawMode(true);
  h.c.colorInput.value = record.color; h.c.colorOpacityInput.value = String(record.opacity);
  h.c.draftPoints = latLngs(record.points);
  h.c.restoreColorDraftSession(record);
  const session = h.session();
  assert.equal(session.congregationId, 'ixhuatlan'); assert.equal(session.locNum, '1');
  assert.equal(session.color, '#33ccaa'); assert.equal(session.opacity, .62);
  assert.deepEqual(session.areaTarget, target); h.assertCamera();
});
