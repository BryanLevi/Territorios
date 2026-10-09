const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '../outputs/croquis_territorios.html'), 'utf8');
const source = html.slice(html.indexOf('function clearHeavyUndoStorage(){'), html.indexOf('function sanitizeColor('));
const uiSource = fs.readFileSync(path.join(__dirname, '../outputs/edit-history.js'), 'utf8');
const copy = value => JSON.parse(JSON.stringify(value));
const bags = [['colorAreaSettings','areas'], ['textLabelSettings','labels'], ['manualIconSettings','icons'],
  ['whiteRoadSettings','roads'], ['manualRiverSettings','rivers']];

function env() {
  const storage = new Map(), visits = [], notices = [], noop = () => {};
  const camera = {center:[19.055123, -96.987456], zoom:19};
  let group = 'a', refreshes = 0;
  const c = vm.createContext({
    LOCS:[{num:1, name:'Centro'}, {num:2, name:'La Tranca'}], currentIndex:0,
    undoHistory:[], redoHistory:[], suppressUndoSnapshot:false, UNDO_HISTORY_LIMIT:80,
    UNDO_HISTORY_STORAGE_KEY:'undo', LEGACY_UNDO_HISTORY_STORAGE_KEY:'legacy', REDO_HISTORY_STORAGE_KEY:'redo',
    almacen:{getItem:key => storage.get(group + ':' + key), setItem:(key,value) => storage.set(group + ':' + key,value),
      removeItem:key => storage.delete(group + ':' + key)},
    window:{CroquisHistory:{refresh(){ refreshes++; }}}, map:{getCenter:() => camera.center, getZoom:() => camera.zoom},
    colorAreaSettings:{}, textLabelSettings:{}, manualIconSettings:{}, whiteRoadSettings:{}, manualRiverSettings:{},
    framePositionSettings:{}, frameScaleSettings:{}, selectedAreaIndex:null, selectedTextIndex:null, selectedIconIndex:null,
    normalizeFramePosition:p => p ? {lat:Number(p.lat), lng:Number(p.lng)} : null,
    clampFrameScale:value => Math.max(55, Math.min(180, Number(value) || 100)),
    saveFramePositionSettings:noop, saveFrameScaleSettings:noop, saveColorAreaSettings:noop,
    saveTextLabelSettings:noop, saveManualIconSettings:noop, saveWhiteRoadSettings:noop, saveManualRiverSettings:noop,
    getColorAreasForLoc:loc => c.colorAreaSettings[String(loc?.num)] || [],
    getTextLabelsForLoc:loc => c.textLabelSettings[String(loc?.num)] || [],
    getManualIconsForLoc:loc => c.manualIconSettings[String(loc?.num)] || [],
    getWhiteRoadsForLoc:loc => c.whiteRoadSettings[String(loc?.num)] || [],
    getManualRiversForLoc:loc => c.manualRiverSettings[String(loc?.num)] || [],
    getFrameScaleForLoc:loc => c.frameScaleSettings[String(loc?.num)] || 100,
    resetDraftArea:noop, clearSelectedLine:noop, setContourEditMode:noop,
    renderColorAreas:noop, renderTextLabels:noop, renderManualIcons:noop, renderManualWhiteRoads:noop,
    renderManualRivers:noop, updateColorControls:noop, refreshTerritoryCounts:noop,
    publicarTerritorioPronto:noop, setStatus:text => notices.push(text),
    goTo(index, silent, fitMap){
      visits.push({index, silent, fitMap}); c.currentIndex = index;
      assert.equal(fitMap, false, 'El historial nunca reencuadra la cámara');
    }
  });
  vm.runInContext(source, c);
  return {c, storage, camera, visits, notices, group:value => { group = value; }, refreshes:() => refreshes};
}

test('deshacer y rehacer recorren varios cambios sin alterar la cámara actual', () => {
  const e = env(), c = e.c;
  c.pushUndoSnapshot('text'); c.textLabelSettings['1'] = [{text:'Uno'}];
  c.pushUndoSnapshot('text'); c.textLabelSettings['1'] = [{text:'Dos'}];
  const before = copy(e.camera);
  assert.equal(c.restoreLastUndoSnapshot(), true); assert.equal(c.textLabelSettings['1'][0].text, 'Uno');
  assert.equal(c.restoreLastUndoSnapshot(), true); assert.equal(c.textLabelSettings['1'], undefined);
  assert.equal(c.restoreLastRedoSnapshot(), true); assert.equal(c.textLabelSettings['1'][0].text, 'Uno');
  assert.equal(c.restoreLastRedoSnapshot(), true); assert.equal(c.textLabelSettings['1'][0].text, 'Dos');
  assert.equal(c.undoHistory.length, 2); assert.equal(c.redoHistory.length, 0);
  assert.deepEqual(e.camera, before); assert.equal(e.visits.length, 4);
});

test('rehacer recupera cada tipo de elemento, posición y escala del recuadro', () => {
  const e = env(), c = e.c;
  for(const [bag] of bags) c[bag]['1'] = [{value:'antes'}];
  c.framePositionSettings['1'] = {lat:19, lng:-97}; c.frameScaleSettings['1'] = 125;
  c.pushUndoSnapshot('frame-reset');
  for(const [bag] of bags) c[bag]['1'] = [{value:'después'}];
  c.framePositionSettings['1'] = {lat:19.01, lng:-97.01}; c.frameScaleSettings['1'] = 145;
  c.restoreLastUndoSnapshot(); c.restoreLastRedoSnapshot();
  for(const [bag] of bags) assert.deepEqual(copy(c[bag]['1']), [{value:'después'}]);
  assert.deepEqual(copy(c.framePositionSettings['1']), {lat:19.01, lng:-97.01});
  assert.equal(c.frameScaleSettings['1'], 145);
});

test('la captura inversa usa el territorio del cambio aunque esté seleccionado otro', () => {
  const c = env().c;
  c.textLabelSettings = {'1':[{text:'A'}], '2':[{text:'Ajeno'}]};
  c.pushUndoSnapshot('text', c.LOCS[0]); c.textLabelSettings['1'] = [{text:'B'}];
  c.currentIndex = 1; c.restoreLastUndoSnapshot();
  assert.equal(c.redoHistory[0].locNum, 1); assert.equal(c.redoHistory[0].index, 0);
  assert.deepEqual(copy(c.redoHistory[0].labels), [{text:'B'}]);
  c.currentIndex = 1; c.restoreLastRedoSnapshot();
  assert.deepEqual(copy(c.textLabelSettings), {'1':[{text:'B'}], '2':[{text:'Ajeno'}]});
});

test('un cambio nuevo descarta la rama de rehacer y conserva su propio paso para deshacer', () => {
  const e = env(), c = e.c;
  c.pushUndoSnapshot('text'); c.textLabelSettings['1'] = [{text:'Primero'}]; c.restoreLastUndoSnapshot();
  c.pushUndoSnapshot('icons'); c.manualIconSettings['1'] = [{kind:'Escuela'}];
  assert.equal(c.redoHistory.length, 0); assert.equal(JSON.parse(e.storage.get('a:redo')).length, 0);
  assert.equal(c.restoreLastRedoSnapshot(), false);
  c.restoreLastUndoSnapshot(); assert.equal(c.manualIconSettings['1'], undefined);
});

test('la deduplicación del estado previo también invalida y persiste la rama de rehacer', () => {
  const e = env(), c = e.c;
  c.pushUndoSnapshot('text');
  c.redoHistory.push({locNum:1, labels:[{text:'Pendiente'}]}); c.saveUndoHistory();
  c.pushUndoSnapshot('text');
  assert.equal(c.undoHistory.length, 1); assert.equal(c.redoHistory.length, 0);
  assert.equal(JSON.parse(e.storage.get('a:redo')).length, 0);
});

test('un cambio suprimido por restauración no consume ni crea historial', () => {
  const c = env().c;
  c.redoHistory.push({locNum:1}); c.suppressUndoSnapshot = true; c.pushUndoSnapshot('text');
  assert.equal(c.redoHistory.length, 1); assert.equal(c.undoHistory.length, 0);
});

test('guardar colores idénticos no crea un paso ni descarta un cambio pendiente de rehacer', () => {
  const c = env().c;
  vm.runInContext(html.slice(html.indexOf('function setColorAreasForLoc('), html.indexOf('function normalizeDestinationPoint(')), c);
  const areas = [{color:'#000000', points:[[19,-97],[19.1,-97],[19,-96.9]]}];
  c.colorAreaSettings['1'] = copy(areas); c.redoHistory.push({locNum:1, reason:'text'});
  c.saveColorAreaSettings = () => true;
  assert.equal(c.setColorAreasForLoc(c.LOCS[0], copy(areas)), true);
  assert.equal(c.undoHistory.length, 0); assert.equal(c.redoHistory.length, 1);
});

test('ambas ramas sobreviven una recarga y quedan separadas por congregación', () => {
  const e = env(), c = e.c;
  c.pushUndoSnapshot('text'); c.textLabelSettings['1'] = [{text:'Guardado'}]; c.restoreLastUndoSnapshot();
  c.undoHistory = []; c.redoHistory = c.loadRedoHistory();
  assert.equal(c.redoHistory.length, 1); assert.equal(c.redoHistory[0].labels[0].text, 'Guardado');
  e.group('b'); assert.equal(c.loadUndoHistory().length, 0); assert.equal(c.loadRedoHistory().length, 0);
  e.group('a'); c.restoreLastRedoSnapshot(); assert.equal(c.textLabelSettings['1'][0].text, 'Guardado');
});

test('historial legado de bolsas completas puede deshacerse y rehacerse sin perder otro territorio', () => {
  const c = env().c;
  c.colorAreaSettings = {'1':[{value:'nuevo'}], '2':[{value:'otro nuevo'}]};
  c.textLabelSettings = {'2':[{text:'Texto nuevo'}]};
  c.undoHistory.push({index:1, createdAt:100, colorAreaSettings:{'1':[{value:'viejo'}]}, textLabelSettings:{},
    manualIconSettings:{}, whiteRoadSettings:{}, manualRiverSettings:{}});
  c.restoreLastUndoSnapshot();
  assert.deepEqual(copy(c.colorAreaSettings), {'1':[{value:'viejo'}]});
  assert.equal(c.redoHistory[0].index, 1); assert.equal(c.redoHistory[0].createdAt, 100);
  c.restoreLastRedoSnapshot();
  assert.deepEqual(copy(c.colorAreaSettings), {'1':[{value:'nuevo'}], '2':[{value:'otro nuevo'}]});
  assert.deepEqual(copy(c.textLabelSettings), {'2':[{text:'Texto nuevo'}]});
});

test('un snapshot sin escala no cambia la escala durante deshacer ni rehacer', () => {
  const c = env().c;
  c.pushUndoSnapshot('text'); c.textLabelSettings['1'] = [{text:'Texto'}]; c.frameScaleSettings['1'] = 160;
  c.restoreLastUndoSnapshot(); c.frameScaleSettings['1'] = 170; c.restoreLastRedoSnapshot();
  assert.equal(c.frameScaleSettings['1'], 170);
});

test('limita a 80 cambios y restaura datos desde un historial persistido defectuoso', () => {
  const e = env(), c = e.c;
  for(let n = 0; n < 95; n++) { c.pushUndoSnapshot('text'); c.textLabelSettings['1'] = [{text:String(n)}]; }
  assert.equal(c.undoHistory.length, 80); assert.equal(c.loadUndoHistory().length, 80);
  e.storage.set('a:redo', '[null,5,[],{"locNum":1}]'); assert.equal(c.loadRedoHistory().length, 1);
  e.storage.set('a:redo', '{incompleto'); assert.equal(c.loadRedoHistory().length, 0);
});

test('la falta de espacio reduce las dos ramas y elimina las claves pesadas si no caben', () => {
  const e = env(), c = e.c;
  c.undoHistory = Array.from({length:25}, (_,index) => ({index})); c.redoHistory = copy(c.undoHistory);
  c.almacen.setItem = () => { throw new Error('QuotaExceededError'); };
  e.storage.set('a:undo', 'viejo'); e.storage.set('a:redo', 'viejo'); e.storage.set('a:legacy', 'viejo');
  c.saveUndoHistory();
  assert.equal(c.undoHistory.length, 12); assert.equal(c.redoHistory.length, 12);
  assert.equal(e.storage.size, 0); assert.equal(e.refreshes(), 1);
});

class Element {
  constructor(tag) { this.tag = tag; this.children = []; this.listeners = {}; this.open = false; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  addEventListener(type, callback) { this.listeners[type] = callback; }
  focus() { this.focused = true; }
  showModal() { this.open = true; }
  close() { this.open = false; }
}

function uiEnv() {
  const ids = ['history-dialog','history-list','history-status','history-undo','history-redo','history-close','btn-history','btn-color-redo'];
  const nodes = Object.fromEntries(ids.map(id => [id, new Element(id)]));
  let undos = 0, redos = 0, draft = false;
  const c = vm.createContext({
    document:{getElementById:id => nodes[id], createElement:tag => new Element(tag)},
    window:{CroquisDrafts:{hasPending:() => draft}}, map:{},
    LOCS:[{num:1, name:'<img onerror=alert(1)>'}], displayTerritoryNumber:loc => loc.num, displayTerritoryName:loc => loc.name,
    undoHistory:[{locNum:1, reason:'icons', createdAt:1720000000000}],
    redoHistory:[{locNum:1, reason:'text', createdAt:1720000000010}],
    restoreLastUndoSnapshot:() => { undos++; }, restoreLastRedoSnapshot:() => { redos++; },
    redoEditChange:() => { if(!draft) redos++; }
  });
  vm.runInContext(uiSource, c);
  return {c, nodes, undos:() => undos, redos:() => redos, draft:value => { draft = value; }};
}

test('el historial muestra cambios aplicados y pendientes con descripción, territorio y hora', () => {
  const e = uiEnv(), groups = e.nodes['history-list'].children;
  assert.equal(groups[0].children[0].textContent, 'Por rehacer');
  assert.equal(groups[1].children[0].textContent, 'Cambios aplicados');
  const item = groups[0].children[1].children[0];
  assert.equal(item.children[0].textContent, 'Textos y destinos');
  assert.equal(item.children[1].textContent, '#1 · <img onerror=alert(1)>');
  assert.match(item.children[2].textContent, /Siguiente al rehacer/);
  assert.equal(item.children[1].innerHTML, undefined, 'Los nombres se imprimen como texto seguro');
  assert.match(e.nodes['history-status'].textContent, /1 cambios aplicados · 1 por rehacer/);
});

test('los controles del historial abren, cierran, deshacen y rehacen un paso', () => {
  const e = uiEnv();
  e.nodes['btn-history'].listeners.click(); assert.equal(e.nodes['history-dialog'].open, true);
  assert.equal(e.nodes['history-close'].focused, true);
  e.nodes['history-undo'].listeners.click(); e.nodes['history-redo'].listeners.click();
  e.nodes['btn-color-redo'].listeners.click(); assert.equal(e.undos(), 1); assert.equal(e.redos(), 2);
  e.nodes['history-close'].listeners.click(); assert.equal(e.nodes['history-dialog'].open, false);
});

test('el historial no deshace ni rehace encima de un borrador', () => {
  const e = uiEnv();
  e.draft(true); e.c.window.CroquisHistory.refresh();
  assert.equal(e.nodes['history-undo'].disabled, true); assert.equal(e.nodes['history-redo'].disabled, true);
  e.nodes['history-undo'].listeners.click(); e.nodes['history-redo'].listeners.click(); e.nodes['btn-color-redo'].listeners.click();
  assert.equal(e.undos(), 0); assert.equal(e.redos(), 0);
});

test('el historial no abre mientras Inicio es visible o el acceso está bloqueado', () => {
  const e = uiEnv();
  e.nodes['welcome-screen'] = {classList:{contains:() => false}};
  e.c.window.CroquisHistory.open(); assert.equal(e.nodes['history-dialog'].open, false);
  delete e.nodes['welcome-screen']; e.c.window.CroquisAccess = {canEnter:() => false};
  e.c.window.CroquisHistory.open(); assert.equal(e.nodes['history-dialog'].open, false);
});

test('rehacer en barra admite puntos del borrador sin habilitar el historial guardado', () => {
  const e = uiEnv(); e.draft(true); e.c.redoHistory = [];
  e.c.window.CroquisDrafts.canRedoPoint = () => true;
  let restoredPoint = false; e.c.redoEditChange = () => { restoredPoint = true; };
  e.c.window.CroquisHistory.refresh();
  assert.equal(e.nodes['history-redo'].disabled, true); assert.equal(e.nodes['btn-color-redo'].disabled, false);
  e.nodes['btn-color-redo'].listeners.click(); assert.equal(restoredPoint, true);
});
