const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '../outputs/croquis_territorios.html'), 'utf8');
function funcion(nombre){
  const inicio = html.indexOf(`function ${nombre}(`);
  assert(inicio >= 0, `Función disponible: ${nombre}`);
  const apertura = html.indexOf('){', inicio) + 1;
  let profundidad = 0, comilla = null;
  for(let i = apertura; i < html.length; i++){
    const actual = html[i], siguiente = html[i + 1];
    if(comilla){
      if(actual === '\\'){ i++; continue; }
      if(actual === comilla) comilla = null;
      continue;
    }
    if(actual === '/' && siguiente === '/') { i = html.indexOf('\n', i); continue; }
    if(actual === '/' && siguiente === '*') { i = html.indexOf('*/', i + 2) + 1; continue; }
    if(actual === '"' || actual === "'" || actual === '`'){ comilla = actual; continue; }
    if(actual === '{') profundidad++;
    if(actual === '}' && --profundidad === 0) return html.slice(inicio, i + 1) + '\n';
  }
  throw new Error(`Función incompleta: ${nombre}`);
}
const codigo = ['cloneData', 'saveUndoHistory', 'restoreLastUndoSnapshot', 'undoDraftColorPoint',
  'goTo', 'drawTerritoryFrame'].map(funcion).join('\n');
const copia = valor => JSON.parse(JSON.stringify(valor));

function entorno(){
  const movimientos = [], dibujados = [], publicaciones = [], guardados = [], borradores = [];
  const camara = {centro:[19.0512345, -96.9765432], zoom:19};
  const noOp = () => {};
  const c = vm.createContext({
    currentIndex:0, locSel:{value:'0'}, LOCS:[{num:1, lat:19, lon:-97}, {num:2, lat:20, lon:-98}],
    DETAIL_ZOOM:20, UNDO_HISTORY_LIMIT:80, UNDO_HISTORY_STORAGE_KEY:'undo',
    map:{
      removeLayer:noOp,
      fitBounds(bounds, options){ movimientos.push({tipo:'fitBounds', bounds, options}); camara.centro = [bounds[0][0], bounds[0][1]]; camara.zoom = 14; },
      setView(centro, zoom){ movimientos.push({tipo:'setView'}); camara.centro = Array.from(centro); camara.zoom = zoom; },
      panTo(centro){ movimientos.push({tipo:'panTo'}); camara.centro = Array.from(centro); },
      panBy(){ movimientos.push({tipo:'panBy'}); },
      getCenter:() => ({lat:camara.centro[0], lng:camara.centro[1]}), getZoom:() => camara.zoom
    },
    L:{rectangle(bounds){ return {addTo(){ dibujados.push(copia(bounds)); return this; }, bringToFront:noOp}; }},
    window:{refreshOfflineCard:noOp}, ringLayer:null,
    getBoundsForLoc(loc){
      const p = c.framePositionSettings[String(loc.num)] || {lat:loc.lat, lng:loc.lon};
      const d = (c.frameScaleSettings[String(loc.num)] || 100) / 1000;
      return [[p.lat - d, p.lng - d], [p.lat + d, p.lng + d]];
    },
    framePositionSettings:{}, frameScaleSettings:{}, colorAreaSettings:{}, textLabelSettings:{},
    manualIconSettings:{}, whiteRoadSettings:{}, manualRiverSettings:{}, undoHistory:[], suppressUndoSnapshot:false,
    selectedAreaIndex:null, selectedTextIndex:null, selectedIconIndex:null,
    frameMoveMode:false, territoryAddMode:false, colorDrawMode:false, roadPencilMode:false, riverPencilMode:false,
    textAddMode:false, iconAddMode:false, contourEditMode:false, destinationAddMode:false, destinationSession:null,
    roadDraftPoints:[], riverDraftPoints:[], draftPoints:[],
    almacen:{setItem(key, value){ guardados.push({key, value:JSON.parse(value)}); }}, clearHeavyUndoStorage:noOp,
    normalizeFramePosition:p => p && Number.isFinite(p.lat) && Number.isFinite(p.lng) ? {lat:p.lat, lng:p.lng} : null,
    clampFrameScale:value => Math.max(55, Math.min(180, Number(value) || 100)),
    saveFramePositionSettings:noOp, saveFrameScaleSettings:noOp, saveColorAreaSettings:noOp,
    saveTextLabelSettings:noOp, saveManualIconSettings:noOp, saveWhiteRoadSettings:noOp, saveManualRiverSettings:noOp,
    resetDraftArea:noOp, clearSelectedLine:noOp, setContourEditMode:noOp, cerrarPanelReferencias:noOp,
    cancelDestinationInteraction(){ c.destinationAddMode = false; c.destinationSession = null; },
    setFrameMoveMode:noOp, renderFrameMoveHandle:noOp, setTerritoryAddMode:noOp, setColorDrawMode:noOp,
    setRoadPencilMode:noOp, setRiverPencilMode:noOp, setTextAddMode:noOp, setIconAddMode:noOp,
    updateInfo:noOp, updateFrameControls:noOp, renderColorAreas:noOp, renderTextLabels:noOp,
    renderManualIcons:noOp, renderManualWhiteRoads:noOp, renderManualRivers:noOp, updateColorControls:noOp,
    refreshTerritoryCounts:noOp, updateButtons:noOp, setStatus:noOp,
    publicarTerritorioPronto:loc => publicaciones.push(loc.num),
    renderRoadDraft:() => borradores.push('road'), renderRiverDraft:() => borradores.push('river'),
    renderDraftArea:() => borradores.push('area'), getColorAreasForLoc:loc => c.colorAreaSettings[String(loc.num)] || [],
    updateSelectedAreaPoints:points => { c.colorAreaSettings[String(c.LOCS[c.currentIndex].num)][c.selectedAreaIndex].points = points; }
  });
  vm.runInContext(codigo, c);
  return {c, camara, movimientos, dibujados, publicaciones, guardados, borradores};
}
function snapshot(extra = {}){
  return {locNum:1, index:0, areas:[{color:'#1265ab', points:[[19,-97], [19.1,-97], [19,-96.9]]}],
    labels:[{text:'Zona', lat:19, lng:-97}], icons:[{kind:'Escuela', lat:19, lng:-97}],
    roads:[{points:[[19,-97], [19.1,-97]]}], rivers:[{points:[[19,-97], [19,-96.9]]}], ...extra};
}
function permanece(e, antes){
  assert.deepEqual(e.camara, antes, 'Deshacer conserva el centro y zoom actuales');
  assert.deepEqual(e.movimientos, [], 'Deshacer no solicita encuadrar ni mover el mapa');
}

test('deshacer restaura todos los elementos guardados y conserva la vista de trabajo actual', () => {
  const e = entorno(), antes = copia(e.camara), original = snapshot();
  e.c.colorAreaSettings['1'] = [{color:'#ff0000'}]; e.c.textLabelSettings['1'] = [{text:'Cambio'}];
  e.c.undoHistory.push(original); e.c.restoreLastUndoSnapshot();
  permanece(e, antes);
  for(const [bolsa, campo] of [['colorAreaSettings','areas'], ['textLabelSettings','labels'],
    ['manualIconSettings','icons'], ['whiteRoadSettings','roads'], ['manualRiverSettings','rivers']]){
    assert.deepEqual(copia(e.c[bolsa]['1']), original[campo]);
  }
  assert.equal(e.c.undoHistory.length, 0); assert.equal(e.c.suppressUndoSnapshot, false);
  assert.deepEqual(e.publicaciones, [1]); assert.equal(e.dibujados.length, 1);
});

test('un snapshot legado con índice conserva la cámara y la selección histórica', () => {
  const e = entorno(), antes = copia(e.camara);
  e.c.undoHistory.push({index:1, colorAreaSettings:{'2':[{color:'#abcdef'}]}, textLabelSettings:{},
    manualIconSettings:{}, whiteRoadSettings:{}, manualRiverSettings:{}});
  e.c.restoreLastUndoSnapshot(); permanece(e, antes);
  assert.equal(e.c.currentIndex, 1); assert.equal(e.c.locSel.value, '1');
  assert.deepEqual(copia(e.c.colorAreaSettings), {'2':[{color:'#abcdef'}]});
  assert.deepEqual(e.publicaciones, [2]);
});

test('deshacer en otro territorio restaura el territorio histórico sin reencuadrar la cámara actual', () => {
  const e = entorno(), antes = copia(e.camara);
  e.c.currentIndex = 1; e.c.locSel.value = '1'; e.c.undoHistory.push(snapshot());
  e.c.restoreLastUndoSnapshot(); permanece(e, antes);
  assert.equal(e.c.currentIndex, 0); assert.equal(e.c.locSel.value, '0');
  assert.deepEqual(copia(e.c.textLabelSettings['1']), snapshot().labels);
});

test('deshacer el recuadro restaura posición y escala de sus datos sin mover la vista', () => {
  const e = entorno(), antes = copia(e.camara);
  e.c.framePositionSettings['1'] = {lat:20, lng:-98}; e.c.frameScaleSettings['1'] = 180;
  e.c.undoHistory.push(snapshot({framePosition:{lat:19.03, lng:-96.99}, frameScale:145}));
  e.c.restoreLastUndoSnapshot(); permanece(e, antes);
  assert.deepEqual(copia(e.c.framePositionSettings['1']), {lat:19.03, lng:-96.99});
  assert.equal(e.c.frameScaleSettings['1'], 145);
  assert.deepEqual(e.dibujados, [[[19.03 - .145, -96.99 - .145], [19.03 + .145, -96.99 + .145]]]);
});

for(const [modo, puntos, dibujo] of [['roadPencilMode','roadDraftPoints','road'], ['riverPencilMode','riverDraftPoints','river'],
  ['colorDrawMode','draftPoints','area']]){
  test(`deshacer un punto del borrador ${dibujo} conserva la vista y el historial guardado`, () => {
    const e = entorno(), antes = copia(e.camara);
    e.c[modo] = true; e.c[puntos] = [[19,-97], [19.1,-97]]; e.c.undoHistory.push(snapshot());
    e.c.undoDraftColorPoint(); permanece(e, antes);
    assert.deepEqual(copia(e.c[puntos]), [[19,-97]]);
    assert.equal(e.c.undoHistory.length, 1); assert.deepEqual(e.borradores, [dibujo]);
  });
}

test('deshacer un vértice del contorno modifica la geometría y conserva la vista', () => {
  const e = entorno(), antes = copia(e.camara), puntos = [[19,-97], [19.1,-97], [19.1,-96.9], [19,-96.9]];
  e.c.contourEditMode = true; e.c.selectedAreaIndex = 0; e.c.colorAreaSettings['1'] = [{points:puntos}];
  e.c.undoDraftColorPoint(); permanece(e, antes);
  assert.deepEqual(copia(e.c.colorAreaSettings['1'][0].points), puntos.slice(0, 3));
});

test('cancelar una flecha sin guardar conserva la vista y no consume el historial', () => {
  const e = entorno(), antes = copia(e.camara);
  e.c.destinationAddMode = true; e.c.destinationSession = {points:[[19,-97], [19.1,-97]]};
  e.c.undoHistory.push(snapshot()); e.c.undoDraftColorPoint(); permanece(e, antes);
  assert.equal(e.c.destinationAddMode, false); assert.equal(e.c.destinationSession, null);
  assert.equal(e.c.undoHistory.length, 1);
});

test('la navegación normal sigue encuadrando el territorio elegido', () => {
  const e = entorno(); e.c.goTo(1, true);
  assert.equal(e.c.currentIndex, 1); assert.equal(e.movimientos.length, 1);
  assert.equal(e.movimientos[0].tipo, 'fitBounds'); assert.equal(e.camara.zoom, 14);
});
