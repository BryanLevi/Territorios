const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const order = require('../outputs/locality-order.js');

const html = fs.readFileSync(path.join(__dirname, '../outputs/croquis_territorios.html'), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
const ids = locs => locs.map(loc => String(loc.num));
const locations = () => [
  { num:1, displayNum:1, name:'Ixhuatlán del Café', lat:19.04, lon:-96.91 },
  { num:17, displayNum:2, name:'Nevería', lat:19.05, lon:-96.92 },
  { num:'custom-1', displayNum:3, name:'Los Lirios', lat:19.06, lon:-96.93, custom:true }
];

test('normaliza únicamente IDs simples, únicos y no vacíos, sin mutar el origen', () => {
  const raw = Object.freeze([17, '17', ' custom-1 ', '', '  ', null, undefined, true, {}, [], NaN, Infinity, -Infinity, 0, '0']);
  assert.deepEqual(order.normalizeOrder(raw), ['17', 'custom-1', '0']);
  for(const value of [null, {}, '17', 17]) assert.deepEqual(order.normalizeOrder(value), []);
});

test('mantiene el orden manual conocido y agrega localidades nuevas al final', () => {
  const locs = locations();
  assert.deepEqual(order.orderedIds(locs, ['custom-1', 'removed', 1, 1]), ['custom-1', '1', '17']);
  assert.deepEqual(order.orderedIds(locs.concat({num:'new'}), ['custom-1', 17, 1]), ['custom-1', '17', '1', 'new']);
  assert.deepEqual(order.orderedIds([], ['1']), []);
});

test('reordenar conserva objetos, IDs, números y el arreglo original', () => {
  const locs = Object.freeze(locations().map(Object.freeze));
  const before = plain(locs), result = order.reorder(locs, ['custom-1', 1]);
  assert.deepEqual(ids(result), ['custom-1', '1', '17']);
  assert.strictEqual(result[0], locs[2]);
  assert.strictEqual(result[1], locs[0]);
  assert.deepEqual(locs, before);
  assert.deepEqual(result.map(loc => loc.displayNum), [3, 1, 2]);
});

test('mueve a cualquier puesto de 1 a N y limita posiciones fuera de los extremos', () => {
  const raw = Object.freeze(['1', '17', 'custom-1']);
  assert.deepEqual(order.moveTo(raw, 'custom-1', 1), ['custom-1', '1', '17']);
  assert.deepEqual(order.moveTo(raw, 1, 3), ['17', 'custom-1', '1']);
  assert.deepEqual(order.moveTo(raw, 'custom-1', 2), ['1', 'custom-1', '17']);
  assert.deepEqual(order.moveTo(raw, 'custom-1', -50), ['custom-1', '1', '17']);
  assert.deepEqual(order.moveTo(raw, 1, 500), ['17', 'custom-1', '1']);
  assert.deepEqual(order.moveTo(raw, 'unknown', 1), raw);
  assert.deepEqual(raw, ['1', '17', 'custom-1']);
});

function sourceFunction(name){
  const expression = new RegExp('(?:async\\s+)?function\\s+' + name + '\\s*\\(');
  const match = expression.exec(html);
  assert.ok(match, 'Función disponible: ' + name);
  // El parser de JavaScript encuentra el cierre real aun si hay llaves en texto o comentarios.
  for(let end = html.indexOf('}', match.index); end >= 0; end = html.indexOf('}', end + 1)){
    const source = html.slice(match.index, end + 1);
    try{ new vm.Script('(' + source + ')'); return source; }catch(error){
      if(!(error instanceof SyntaxError)) throw error;
    }
  }
  throw new Error('Función incompleta: ' + name);
}

const sourceNames = [
  'loadLocalityOrder', 'saveLocalityOrder', 'applyLocalityOrder', 'applyCustomTerritories',
  'populateSelect', 'displayTerritoryNumber', 'displayTerritoryName', 'automaticTerritorySelectorNote',
  'territorySelectorNote', 'territorySelectorLabel', 'safeObject', 'safeArray',
  'buildBackupPayload', 'getBackupData', 'datosDeCongregacion', 'datosDeTodasLasCongregaciones',
  'publicarLista', 'aplicarListaRemota', 'hasSavedDataObject', 'hasLocalSavedWork'
];

function browser({ saved = {}, congregation = 'ixhuatlan' } = {}){
  const values = new Map(Object.entries(saved)), writes = [], published = [], notices = [], info = [];
  const nodes = new Map(), view = { zoom:18, center:[19.055, -96.923] }, draft = [[19.04,-96.91],[19.05,-96.92]];
  let fail = false;
  const node = id => {
    if(!nodes.has(id)) nodes.set(id, {value:'', hidden:true, disabled:false, textContent:'', innerHTML:'', setAttribute(){}, addEventListener(){}});
    return nodes.get(id);
  };
  const select = {options:[], value:'1', appendChild(option){ this.options.push(option); }};
  Object.defineProperty(select, 'innerHTML', {set(){ this.options = []; }});
  const c = vm.createContext({
    console:{error(){}}, Date, Math, Number, String, Set, Map,
    CroquisLocalityOrder:order, LOCALITY_ORDER_STORAGE_KEY:'croquis-locality-order-v1',
    CONGREGACION_BASE_ID:'ixhuatlan', congregacionActivaId:congregation,
    LOCS:locations(), BASE_LOCS:locations().slice(0, 2), currentIndex:1, locSel:select,
    document:{createElement:() => ({}), getElementById:node}, $:node,
    localStorage:{
      getItem:key => values.get(key) ?? null,
      setItem(key, value){ if(fail){ fail = false; throw new Error('QuotaExceededError simulado'); } values.set(key, String(value)); writes.push(key); },
      removeItem(key){ values.delete(key); }
    },
    esCongregacionBase:() => c.congregacionActivaId === 'ixhuatlan',
    loadHiddenTerritorySettings:() => [],
    loadCustomTerritorySettings:() => c.congregacionActivaId === 'ixhuatlan' ? locations().slice(2) : locations(),
    subterritoriosDeLoc:() => [], updateInfo:loc => info.push(loc),
    updateButtons(){}, refreshTerritoryCounts(){}, pintarPanelAgrupar(){},
    setStatus:(message, type) => notices.push({message, type}),
    map:{getZoom:() => view.zoom, getCenter:() => view.center,
      fitBounds(){ throw new Error('Ordenar no debe mover el mapa'); }, setView(){ throw new Error('Ordenar no debe mover el mapa'); }},
    goTo(){ throw new Error('Ordenar no debe navegar ni cancelar el dibujo'); },
    draftPoints:draft, roadDraftPoints:[], riverDraftPoints:[], colorDrawMode:true,
    nombresSettings:{}, colorAreaSettings:{17:[{color:'#ab1234', points:draft}]},
    textLabelSettings:{17:[{text:'10', lat:19.05, lng:-96.92}]}, manualIconSettings:{},
    whiteRoadSettings:{}, manualRiverSettings:{}, frameScaleSettings:{}, framePositionSettings:{}, leyendaSettings:{},
    undoHistory:[{locNum:17,index:1,reason:'colors'}], redoHistory:[],
    agruparOrden:['17','1'], agruparPrincipal:'17',
    BACKUP_FILE_VERSION:1, location:{href:'http://localhost/croquis'},
    normalizeFramePositionSettings:value => value || {}, normalizeCustomTerritory:value => value,
    normalizeNombresSettings:value => value || {}, saveNombresSettings:() => true,
    saveCustomTerritorySettings:() => true, saveHiddenTerritorySettings:() => true,
    cargarCongregaciones:() => [{id:'ixhuatlan'},{id:'otra'}], cargarRegistroCongregaciones:() => [{id:'ixhuatlan'},{id:'otra'}],
    colorFondoImpresion:() => '#ffffff', FONDOS_IMPRESION:[['#ffffff']], fondoPersonalizado:false,
    sincronizarFondoImpresion(){}, limpiarMapaSinTerritorios(){}, nubeEditando:() => true,
    nubeAplicando:false, nubeYo:'yo', nubeQuien:'Equipo',
    nube:{db:{}, fs:{doc:() => 'lista', async setDoc(reference, data){ published.push(data); }}}
  });
  c.window = c;
  for(const match of html.matchAll(/const\s+([A-Z_]+_STORAGE_KEY)\s*=\s*(['"])(.*?)\2/g)){
    c[match[1]] = match[3];
  }
  const keys = html.match(/const CLAVES_POR_CONGREGACION = \[[\s\S]*?\n\];/);
  assert.ok(keys, 'El respaldo incluye claves por congregación');
  const namespaceStart = html.indexOf('function claveDe('), namespaceEnd = html.indexOf('function congregacionBase(', namespaceStart);
  assert.ok(namespaceStart >= 0 && namespaceEnd > namespaceStart);
  vm.runInContext(keys[0] + '\n' + html.slice(namespaceStart, namespaceEnd) + '\n' + sourceNames.map(sourceFunction).join('\n'), c);
  const run = code => vm.runInContext(code, c);
  run('applyCustomTerritories(); populateSelect();');
  return {c, values, writes, published, notices, info, select, view, draft, run,
    failNext(){ fail = true; },
    savedOrder(id = c.congregacionActivaId){ return JSON.parse(values.get(id === 'ixhuatlan' ? 'croquis-locality-order-v1' : 'croquis-locality-order-v1::' + id) || '[]'); }
  };
}

test('ordenar renumera las localidades conservando la activa, los dibujos, zoom, borrador e historial', () => {
  const e = browser(), before = plain({view:e.view, draft:e.c.draftPoints, areas:e.c.colorAreaSettings,
    labels:e.c.textLabelSettings, undo:e.c.undoHistory, pdf:e.c.agruparOrden});
  assert.equal(e.c.applyLocalityOrder(['custom-1','1','17']), true);
  assert.deepEqual(ids(e.c.LOCS), ['custom-1','1','17']);
  assert.equal(e.c.currentIndex, 2);
  assert.equal(e.c.LOCS[e.c.currentIndex].num, 17);
  assert.equal(e.select.value, '2');
  assert.deepEqual(plain(e.c.LOCS.map(loc => loc.displayNum)), [1,2,3]);
  assert.deepEqual(e.select.options.map(option => option.textContent), [
    '#1 - Los Lirios', '#2 - Ixhuatlán del Café', '#3 - Nevería'
  ]);
  assert.equal(e.info.at(-1).displayNum, 3);
  assert.deepEqual(e.savedOrder(), ['custom-1','1','17']);
  assert.deepEqual(plain({view:e.view, draft:e.c.draftPoints, areas:e.c.colorAreaSettings,
    labels:e.c.textLabelSettings, undo:e.c.undoHistory, pdf:e.c.agruparOrden}), before);
  assert.strictEqual(e.c.draftPoints, e.draft);
  assert.equal(e.published.length, 1);
  assert.deepEqual(JSON.parse(e.published[0].localityOrder), ['custom-1','1','17']);
});

test('el orden se conserva al recargar y permanece separado por congregación', () => {
  const e = browser();
  assert.equal(e.c.applyLocalityOrder(['custom-1','17','1']), true);
  const next = browser({saved:Object.fromEntries(e.values)});
  assert.deepEqual(ids(next.c.LOCS), ['custom-1','17','1']);
  assert.deepEqual(plain(next.c.LOCS.map(loc => loc.displayNum)), [1,2,3]);
  next.c.congregacionActivaId = 'otra';
  next.run('applyCustomTerritories(); populateSelect();');
  assert.deepEqual(ids(next.c.LOCS), ['1','17','custom-1']);
  assert.deepEqual(plain(next.c.LOCS.map(loc => loc.displayNum)), [1,2,3]);
  assert.equal(next.c.applyLocalityOrder(['17','1','custom-1']), true);
  next.c.congregacionActivaId = 'ixhuatlan';
  next.run('applyCustomTerritories(); populateSelect();');
  assert.deepEqual(ids(next.c.LOCS), ['custom-1','17','1']);
  assert.deepEqual(plain(next.c.LOCS.map(loc => loc.displayNum)), [1,2,3]);
  assert.deepEqual(next.savedOrder('otra'), ['17','1','custom-1']);
});

test('un fallo de almacenamiento deja lista, selección y descarga anterior intactas sin publicar', () => {
  const e = browser(), before = plain(e.c.LOCS), selected = e.c.currentIndex;
  e.failNext();
  assert.equal(e.c.applyLocalityOrder(['custom-1','17','1']), false);
  assert.deepEqual(plain(e.c.LOCS), before);
  assert.equal(e.c.currentIndex, selected);
  assert.equal(e.select.value, String(selected));
  assert.deepEqual(e.savedOrder(), []);
  assert.equal(e.published.length, 0);
});

test('una lista abierta desde otra congregación no puede aplicar su orden a la actual', () => {
  const e = browser(), before = plain(e.c.LOCS);
  assert.equal(e.c.applyLocalityOrder(['custom-1','17','1'], 'otra'), false);
  assert.deepEqual(plain(e.c.LOCS), before);
  assert.equal(e.writes.length, 0);
  assert.equal(e.published.length, 0);
});

test('datos de orden dañados no impiden cargar localidades y los IDs ausentes no reaparecen', () => {
  for(const raw of ['invalid json', '{}', 'null']){
    const e = browser({saved:{'croquis-locality-order-v1':raw}});
    assert.deepEqual(plain(e.c.loadLocalityOrder()), []);
    assert.deepEqual(ids(e.c.LOCS), ['1','17','custom-1']);
  }
  const e = browser({saved:{'croquis-locality-order-v1':'["removed","custom-1","custom-1",1]'}});
  assert.deepEqual(ids(e.c.LOCS), ['custom-1','1','17']);
  assert.deepEqual(plain(e.c.LOCS.map(loc => loc.displayNum)), [1,2,3]);
  assert.equal(e.c.LOCS[e.c.currentIndex].num, 17);
});

test('el respaldo transporta el orden activo y el de las otras congregaciones', () => {
  const e = browser({saved:{'croquis-locality-order-v1::otra':'["17","1","custom-1"]'}});
  e.c.applyLocalityOrder(['custom-1','1','17']);
  const backup = plain(e.c.buildBackupPayload());
  assert.deepEqual(backup.data.localityOrder, ['custom-1','1','17']);
  assert.deepEqual(plain(e.c.getBackupData(backup)).localityOrder, ['custom-1','1','17']);
  assert.deepEqual(JSON.parse(backup.porCongregacion.otra.localityOrder), ['17','1','custom-1']);
});

test('recibir un orden compartido mantiene la localidad y el dibujo en curso; un emisor antiguo no lo borra', () => {
  const e = browser(), draft = e.c.draftPoints;
  e.c.aplicarListaRemota({localityOrder:'["custom-1","1","17"]', porQuien:'Otro equipo'});
  assert.deepEqual(ids(e.c.LOCS), ['custom-1','1','17']);
  assert.deepEqual(plain(e.c.LOCS.map(loc => loc.displayNum)), [1,2,3]);
  assert.equal(e.info.at(-1).num, 17);
  assert.equal(e.info.at(-1).displayNum, 3);
  assert.equal(e.c.LOCS[e.c.currentIndex].num, 17);
  assert.equal(e.select.value, '2');
  assert.strictEqual(e.c.draftPoints, draft);
  assert.deepEqual(e.savedOrder(), ['custom-1','1','17']);
  assert.equal(e.published.length, 0);
  e.c.aplicarListaRemota({porQuien:'Versión anterior'});
  assert.deepEqual(ids(e.c.LOCS), ['custom-1','1','17']);
  assert.deepEqual(e.savedOrder(), ['custom-1','1','17']);
});

test('un orden manual cuenta como trabajo guardado y evita que GitHub lo reemplace automáticamente', () => {
  const e = browser();
  e.c.loadCustomTerritorySettings = () => [];
  e.c.colorAreaSettings = {}; e.c.textLabelSettings = {};
  assert.equal(e.c.hasLocalSavedWork(), false);
  e.c.saveLocalityOrder(['17','1','custom-1']);
  assert.equal(e.c.hasLocalSavedWork(), true);
});

test('Los Lirios pasa de 22 a 6 y recorre la numeración sin trasladar dibujos entre localidades', () => {
  const e = browser();
  e.c.BASE_LOCS = Array.from({length:21}, (_, index) => ({num:index + 1,
    displayNum:index + 1, name:'Localidad ' + (index + 1), lat:19.04, lon:-96.91}));
  e.run('applyCustomTerritories(); populateSelect();');
  assert.equal(e.c.LOCS.length, 22);
  assert.equal(e.c.LOCS.at(-1).name, 'Los Lirios');
  assert.equal(e.c.LOCS.at(-1).displayNum, 22);
  const originalIds = ids(e.c.LOCS), activeId = e.c.LOCS[e.c.currentIndex].num;
  const drawings = plain({areas:e.c.colorAreaSettings, labels:e.c.textLabelSettings, history:e.c.undoHistory});
  const reordered = order.moveTo(originalIds,'custom-1',6);
  assert.equal(e.c.applyLocalityOrder(reordered), true);
  assert.equal(e.c.LOCS[5].num, 'custom-1');
  assert.equal(e.c.LOCS[5].displayNum, 6);
  assert.equal(e.select.options[5].textContent, '#6 - Los Lirios');
  assert.deepEqual(plain(e.c.LOCS.map(loc => loc.displayNum)), Array.from({length:22}, (_, index) => index + 1));
  assert.deepEqual(ids(e.c.LOCS).slice().sort(), originalIds.slice().sort());
  assert.equal(e.c.LOCS[e.c.currentIndex].num, activeId);
  assert.deepEqual(plain({areas:e.c.colorAreaSettings, labels:e.c.textLabelSettings, history:e.c.undoHistory}), drawings);
});

test('localidades nuevas y retiradas conservan números consecutivos al reconstruir un orden guardado', () => {
  const e = browser({saved:{'croquis-locality-order-v1':'["custom-1","17","1"]'}});
  e.c.loadHiddenTerritorySettings = () => ['17'];
  e.c.loadCustomTerritorySettings = () => locations().slice(2).concat({num:'new',displayNum:80,name:'Nueva',lat:19.04,lon:-96.91});
  e.run('applyCustomTerritories(); populateSelect();');
  assert.deepEqual(ids(e.c.LOCS), ['custom-1','1','new']);
  assert.deepEqual(plain(e.c.LOCS.map(loc => loc.displayNum)), [1,2,3]);
  assert.deepEqual(e.select.options.map(option => option.textContent), ['#1 - Los Lirios','#2 - Ixhuatlán del Café','#3 - Nueva']);
});
