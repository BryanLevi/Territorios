const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '../outputs/croquis_territorios.html'), 'utf8');
const changeViewSource = html.slice(html.indexOf('function changeView('), html.indexOf('\nfunction ll2t('));
const viewSelectionSource = html.slice(html.indexOf("viewSel.addEventListener('change'"), html.indexOf("frameScaleInput.addEventListener('input'"));

function harness(online = true) {
  const calls = {tiles:[], removed:[], refresh:0, roads:0, refs:0};
  let selected = 'g-road';
  const viewSel = {dataset:{}, title:'', handlers:{}, addEventListener(type, handler) { this.handlers[type] = handler; }};
  Object.defineProperty(viewSel, 'value', {
    get:() => selected,
    set:value => { selected = ['g-road','g-sat','offline'].includes(value) ? value : ''; }
  });
  const container = {classList:{toggle(name, state) { container[name] = state; }}};
  const context = {
    navigator:{onLine:online}, viewSel, currentView:'g-road', lastOnlineView:'g-road', offlineAutoView:false,
    TILES:{
      'g-road':{url:'https://tiles.test/road/{z}/{x}/{y}', maxZ:20, attr:'Google', downloadable:true},
      'g-sat':{url:'https://tiles.test/satellite/{z}/{x}/{y}', maxZ:20, attr:'Google', downloadable:true},
      offline:{attr:'OpenStreetMap'}
    },
    map:{getContainer:() => container, removeLayer:layer => calls.removed.push(layer),
      attributionControl:{addAttribution(){}, removeAttribution(){}}},
    tileLayer:null, colorRestoreLayer:null, labelOverlayLayer:null, roadOverlayLayer:null,
    vectorRoadLayer:{}, runtimeRoadCache:{}, runtimeReferenceCache:{}, runtimeOfflineLabelLayer:null,drawRuntimeOfflineDetails(){},tileErrorCount:0,
    configureRuntimeMapZoom(){}, cancelRuntimeOfflineMapRefresh(){},
    LOCS:[{num:1}], currentIndex:0, MAP_DETAIL_RESTORE_OPACITY:1,
    statusBox:{classList:{contains:() => false}}, setStatus(){}, updateButtons(){},
    getColorAreasForLoc:() => [], getRuntimeRoadTileSource:() => null, getRuntimeLabelTileSource:() => null,
    updateRuntimeVectorRoadOverlay:() => calls.roads++, updateRuntimeReferenceOverlay:() => calls.refs++,
    refreshOfflineCard:() => calls.refresh++,
    L:{tileLayer(url, options) {
      const layer = {url, options, handlers:{}, addTo(){return this;}, on(type, handler){this.handlers[type] = handler;}};
      calls.tiles.push(layer);
      return layer;
    }}
  };
  context.window = context;
  vm.runInNewContext(changeViewSource, context);
  vm.runInNewContext(viewSelectionSource, context);
  return {context, calls, container};
}

test('perder conexión usa la descarga y refleja el mapa sin conexión en el selector', () => {
  const {context, calls, container} = harness(false);
  const originalMap = context.map;
  context.changeView('g-road', true);
  assert.equal(context.map, originalMap);
  assert.equal(context.currentView, 'offline');
  assert.equal(context.viewSel.value, 'offline');
  assert.equal(context.lastOnlineView, 'g-road');
  assert.equal(context.viewSel.dataset.offline, 'true');
  assert.equal(context.offlineAutoView, true);
  assert.equal(container['offline-map'], true);
  assert.equal(calls.tiles.length, 0);
  assert.equal(calls.roads, 1);
  assert.equal(calls.refs, 1);
  assert.equal(calls.refresh, 1);
});

test('cambiar la selección sin internet recuerda la vista y no pide teselas', () => {
  const {context, calls} = harness(false);
  context.changeView('g-sat');
  assert.equal(context.currentView, 'offline');
  assert.equal(context.lastOnlineView, 'g-sat');
  assert.equal(context.viewSel.value, 'offline');
  assert.equal(calls.tiles.length, 0);
  context.navigator.onLine = true;
  context.changeView(context.lastOnlineView, true);
  assert.equal(context.currentView, 'g-sat');
  assert.equal(context.offlineAutoView, false);
  assert.equal(context.viewSel.dataset.offline, 'false');
  assert(calls.tiles.every(layer => layer.url.includes('/satellite/')));
});

test('ver y cerrar la copia guardada conserva el mapa y retira las capas externas', () => {
  const {context, calls, container} = harness();
  const originalMap = context.map;
  context.changeView('g-road', true);
  const externalLayers = calls.tiles.slice();
  context.changeView('offline', true);
  assert.equal(context.viewSel.value, 'offline');
  assert.equal(context.currentView, 'offline');
  assert.equal(context.tileLayer, null);
  assert(externalLayers.every(layer => calls.removed.includes(layer)));
  assert.equal(calls.tiles.length, externalLayers.length);
  context.changeView(context.lastOnlineView, true);
  assert.equal(context.map, originalMap);
  assert.equal(context.currentView, 'g-road');
  assert.equal(context.viewSel.value, 'g-road');
  assert.equal(container['offline-map'], false);
  assert.equal(context.map._offlineAttribution, false);
});

test('elegir la copia offline desde el selector convierte el respaldo automático en una selección manual', () => {
  const {context, calls} = harness(false);
  context.changeView('g-sat');
  assert.equal(context.offlineAutoView, true);
  assert.equal(context.viewSel.value, 'offline');
  context.viewSel.handlers.change();
  assert.equal(context.currentView, 'offline');
  assert.equal(context.viewSel.value, 'offline');
  assert.equal(context.lastOnlineView, 'g-sat');
  assert.equal(context.offlineAutoView, false);
  assert.equal(calls.tiles.length, 0);

  context.navigator.onLine = true;
  context.viewSel.value = 'g-sat';
  context.viewSel.handlers.change();
  assert.equal(context.currentView, 'g-sat');
  assert.equal(context.viewSel.value, 'g-sat');
  assert.equal(context.offlineAutoView, false);
  assert(calls.tiles.every(layer => layer.url.includes('/satellite/')));
});
