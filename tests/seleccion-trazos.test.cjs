const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '../outputs/croquis_territorios.html'), 'utf8');
function seccion(desde, hasta){
  const inicio = html.indexOf(desde);
  const fin = html.indexOf(hasta, inicio + desde.length);
  assert(inicio >= 0 && fin > inicio, `No se encontró la sección ${desde}`);
  return html.slice(inicio, fin);
}
const almacenamiento = seccion('function normalizeWhiteRoad(', 'function colorAreaStyle(');
const seleccion = seccion('function distanceToScreenSegment(', 'function updateColorControls(');
const borrar = seccion('function clearColorAreasForCurrent(', 'async function handleColorMapClick(');
const clicMapa = seccion('async function handleColorMapClick(', 'function handleMapMouseMove(');
const copia = value => JSON.parse(JSON.stringify(value));
const carretera = (y, x = 0) => ({points:[[y, x], [y, x + 20]], width:8, color:'#ddb93d'});
const rio = y => ({points:[[y, 0], [y, 20]], width:6});
const punto = (x, y) => ({lat:y, lng:x});

function entorno({roads = [carretera(0), carretera(30)], rivers = [rio(60)], areaHit = null, guardar = true} = {}){
  const avisos = [], snapshots = [], llamadas = [];
  const noOp = () => {};
  const contexto = vm.createContext({
    LOCS:[{num:1}, {num:2}], currentIndex:0, congregacionActivaId:'congregacion-a',
    selectedLine:null, selectedAreaIndex:null, selectedTextIndex:null, selectedIconIndex:null,
    selectedReference:null, colorEditMode:false, contourEditMode:false,
    territoryAddMode:false, textAddMode:false, iconAddMode:false, frameMoveMode:false,
    destinationAddMode:false, destinationSession:null, cancelDestinationInteraction:noOp,
    colorDrawMode:false, roadPencilMode:false, riverPencilMode:false,
    roadDraftPoints:[], riverDraftPoints:[], draftPoints:[],
    whiteRoadSettings:{'1':copia(roads)}, manualRiverSettings:{'1':copia(rivers)},
    colorAreaSettings:{'1':[{points:[[0,0],[0,20],[20,20],[20,0]], color:'#1452c9', opacity:.5}]},
    textLabelSettings:{'1':[{text:'Zona 1', lat:10, lng:10}]},
    manualIconSettings:{'1':[{kind:'salon', lat:12, lng:12}]},
    map:{
      scale:1,
      latLngToContainerPoint(value){
        const lat = Array.isArray(value) ? Number(value[0]) : Number(value.lat);
        const lng = Array.isArray(value) ? Number(value[1]) : Number(value.lng);
        return {x:lng * this.scale, y:lat * this.scale};
      }
    },
    lineEditLayer:{clearLayers(){ llamadas.push('clear-handles'); }},
    cloneData:copia,
    stateFingerprint:value => JSON.stringify(value ?? null),
    publicarTerritorioPronto:loc => llamadas.push(`publish:${loc.num}`),
    saveWhiteRoadSettings:() => guardar, saveManualRiverSettings:() => guardar,
    getColorAreasForLoc:loc => contexto.colorAreaSettings[String(loc.num)] || [],
    getTextLabelsForLoc:loc => contexto.textLabelSettings[String(loc.num)] || [],
    getManualIconsForLoc:loc => contexto.manualIconSettings[String(loc.num)] || [],
    setColorAreasForLoc(loc, areas){ contexto.colorAreaSettings[String(loc.num)] = copia(areas); llamadas.push('set-areas'); return true; },
    setTextLabelsForLoc(loc, labels){ contexto.textLabelSettings[String(loc.num)] = copia(labels); llamadas.push('set-labels'); return true; },
    setManualIconsForLoc(loc, icons){ contexto.manualIconSettings[String(loc.num)] = copia(icons); llamadas.push('set-icons'); return true; },
    findColorAreaAtLatLng:() => areaHit,
    selectColorArea(index){ contexto.selectedAreaIndex = index; contexto.clearSelectedLine(); llamadas.push('select-area'); },
    setContourEditMode(active){ contexto.contourEditMode = active; },
    renderColorAreas:noOp, renderTextLabels:noOp, renderManualIcons:noOp,
    renderManualWhiteRoads:noOp, renderManualRivers:noOp, renderLinearEditHandles:noOp,
    updateColorControls:noOp, renderRoadDraft:noOp, renderRiverDraft:noOp, renderDraftArea:noOp,
    resetRoadDraft(){ contexto.roadDraftPoints = []; },
    resetRiverDraft(){ contexto.riverDraftPoints = []; },
    resetDraftArea(){ contexto.draftPoints = []; },
    handleTerritoryAddClick:() => llamadas.push('draw-territory'),
    addTextLabelForCurrent:() => llamadas.push('draw-text'),
    addManualIconForCurrent:() => llamadas.push('draw-icon'),
    deleteSelectedIcon:() => llamadas.push('delete-icon'),
    setStatus:(texto, tipo) => avisos.push({texto, tipo}),
    pushUndoSnapshot(reason, loc){ snapshots.push({reason, num:loc.num, state:estado()}); }
  });
  function estado(){
    return copia({roads:contexto.whiteRoadSettings, rivers:contexto.manualRiverSettings,
      areas:contexto.colorAreaSettings, labels:contexto.textLabelSettings, icons:contexto.manualIconSettings});
  }
  vm.runInContext(almacenamiento + seleccion + borrar + clicMapa, contexto);
  function deshacer(){
    const snapshot = snapshots.pop();
    assert(snapshot, 'El cambio debe crear un snapshot');
    contexto.whiteRoadSettings = copia(snapshot.state.roads);
    contexto.manualRiverSettings = copia(snapshot.state.rivers);
    contexto.colorAreaSettings = copia(snapshot.state.areas);
    contexto.textLabelSettings = copia(snapshot.state.labels);
    contexto.manualIconSettings = copia(snapshot.state.icons);
    return snapshot;
  }
  return {contexto, avisos, snapshots, llamadas, estado, deshacer,
    seleccionar:(kind, index = 0) => contexto.selectLinearElement(kind, index),
    clic:(x, y, originalEvent) => contexto.handleColorMapClick({latlng:punto(x, y), originalEvent})};
}

test('la distancia se limita al segmento y admite segmentos de longitud cero', () => {
  const e = entorno();
  const distancia = e.contexto.distanceToScreenSegment;
  assert.equal(distancia({x:2,y:3}, {x:0,y:0}, {x:4,y:0}), 3);
  assert.equal(distancia({x:-3,y:4}, {x:0,y:0}, {x:4,y:0}), 5);
  assert.equal(distancia({x:7,y:4}, {x:0,y:0}, {x:4,y:0}), 5);
  assert.equal(distancia({x:3,y:4}, {x:0,y:0}, {x:0,y:0}), 5);
});

test('un trazo corto admite cercanía en sus extremos sin seleccionar su prolongación lejana', () => {
  const e = entorno({roads:[{points:[[0,0],[0,4]], width:4}], rivers:[]});
  const hit = (x, y) => copia(e.contexto.findManualLineAtLatLng(e.contexto.LOCS[0], punto(x, y)));
  assert.deepEqual(hit(-5, 0), {kind:'road', index:0});
  assert.deepEqual(hit(9, 0), {kind:'road', index:0});
  assert.deepEqual(hit(2, 6), {kind:'road', index:0});
  assert.equal(hit(-7, 0), null);
  assert.equal(hit(2, 7), null);
  assert.equal(hit(30, 0), null);
});

test('la tolerancia se mide en píxeles proyectados y es algo mayor para tocar con el dedo', () => {
  const e = entorno({roads:[{points:[[0,0],[0,.04]], width:4}], rivers:[]});
  e.contexto.map.scale = 100;
  const hit = (y, event) => e.contexto.findManualLineAtLatLng(e.contexto.LOCS[0], punto(.02, y), event);
  assert(hit(.06));
  assert.equal(hit(.08), null);
  assert(hit(.08, {originalEvent:{pointerType:'touch'}}));
  assert(hit(.08, {originalEvent:{touches:[{}]}}));
  assert.equal(hit(.10, {originalEvent:{pointerType:'touch'}}), null);
});

test('se encuentran los segmentos interiores y los vértices repetidos sin errores', () => {
  const e = entorno({roads:[{points:[[0,0],[0,3],[4,3]], width:4}], rivers:[]});
  assert.deepEqual(copia(e.contexto.findManualLineAtLatLng(e.contexto.LOCS[0], punto(8, 2))), {kind:'road', index:0});
  assert.equal(e.contexto.findManualLineAtLatLng(e.contexto.LOCS[0], punto(30, 30)), null);
  e.contexto.whiteRoadSettings['1'] = [{points:[[1,1],[1,1]], width:4}];
  assert(e.contexto.findManualLineAtLatLng(e.contexto.LOCS[0], punto(1, 1)));
  assert.equal(e.contexto.findManualLineAtLatLng(null, punto(1,1)), null);
  e.contexto.map = null;
  assert.equal(e.contexto.findManualLineAtLatLng(e.contexto.LOCS[0], punto(1,1)), null);
});

test('el río superior gana a la calle y el último trazo de cada capa gana al anterior', () => {
  const e = entorno({roads:[carretera(0), carretera(0)], rivers:[rio(0), rio(0)]});
  assert.deepEqual(copia(e.contexto.findManualLineAtLatLng(e.contexto.LOCS[0], punto(10,0))), {kind:'river', index:1});
  e.contexto.manualRiverSettings = {};
  assert.deepEqual(copia(e.contexto.findManualLineAtLatLng(e.contexto.LOCS[0], punto(10,0))), {kind:'road', index:1});
});

test('la tolerancia de un río cercano no roba el clic sobre la tinta de una calle', () => {
  const e = entorno({roads:[carretera(0)], rivers:[rio(6)]});
  const hit = y => copia(e.contexto.findManualLineAtLatLng(e.contexto.LOCS[0], punto(10,y)));
  assert.deepEqual(hit(0), {kind:'road', index:0});
  assert.deepEqual(hit(6), {kind:'river', index:0});
});

test('cuando ambas tintas cubren el punto, gana el río que se dibuja encima', () => {
  const e = entorno({roads:[carretera(0)], rivers:[rio(6)]});
  assert.deepEqual(copia(e.contexto.findManualLineAtLatLng(e.contexto.LOCS[0], punto(10,4))), {kind:'river', index:0});
});

test('fuera de la tinta se elige el borde más cercano aunque pertenezca a una capa inferior', () => {
  const e = entorno({roads:[carretera(0)], rivers:[rio(14)]});
  assert.deepEqual(copia(e.contexto.findManualLineAtLatLng(e.contexto.LOCS[0], punto(10,7))), {kind:'road', index:0});
});

test('la proximidad usa el borde pintado, no la distancia al centro de una línea más estrecha', () => {
  const e = entorno({roads:[{...carretera(0), width:16}], rivers:[{...rio(14), width:3}]});
  assert.deepEqual(copia(e.contexto.findManualLineAtLatLng(e.contexto.LOCS[0], punto(10,10))), {kind:'road', index:0});
});

for(const kind of ['road', 'river']){
  test(`editar un ${kind} conserva su estilo, las otras líneas y las áreas; un undo restaura todo`, () => {
    const e = entorno({rivers:[rio(60), rio(90)]});
    const antes = e.estado();
    assert.equal(e.seleccionar(kind), true);
    assert.equal(e.contexto.selectedAreaIndex, null);
    assert.equal(e.contexto.updateSelectedLinePoints([[4,5],[6,7],[8,9]]), true);
    const clave = kind === 'road' ? 'roads' : 'rivers';
    const despues = e.estado();
    assert.deepEqual(despues[clave]['1'][0], {...antes[clave]['1'][0], points:[[4,5],[6,7],[8,9]]});
    assert.deepEqual(despues[clave]['1'].slice(1), antes[clave]['1'].slice(1));
    for(const otra of ['roads','rivers','areas','labels','icons'].filter(k => k !== clave)) assert.deepEqual(despues[otra], antes[otra]);
    assert(e.contexto.getSelectedLine());
    assert.equal(e.snapshots.length, 1);
    e.deshacer();
    assert.deepEqual(e.estado(), antes);
    assert.equal(e.snapshots.length, 0);
  });

  test(`borrar un ${kind} elimina solo el seleccionado y admite un único undo`, () => {
    const e = entorno({rivers:[rio(60), rio(90)]});
    const antes = e.estado();
    e.seleccionar(kind);
    assert.equal(e.contexto.deleteSelectedLine(), true);
    const clave = kind === 'road' ? 'roads' : 'rivers';
    const despues = e.estado();
    assert.deepEqual(despues[clave]['1'], antes[clave]['1'].slice(1));
    for(const otra of ['roads','rivers','areas','labels','icons'].filter(k => k !== clave)) assert.deepEqual(despues[otra], antes[otra]);
    assert.equal(e.contexto.selectedLine, null);
    assert.equal(e.snapshots.length, 1);
    e.deshacer();
    assert.deepEqual(e.estado(), antes);
  });
}

test('la selección se puede limpiar sin editar datos ni crear undo', () => {
  const e = entorno();
  const antes = e.estado();
  e.seleccionar('road');
  e.contexto.clearSelectedLine();
  assert.equal(e.contexto.selectedLine, null);
  assert.equal(e.contexto.getSelectedLine(), null);
  assert.deepEqual(e.estado(), antes);
  assert.equal(e.snapshots.length, 0);
  assert(e.llamadas.includes('clear-handles'));
});

test('una edición sin suficientes puntos no guarda ni borra el trazo', () => {
  const e = entorno();
  e.seleccionar('road');
  const antes = e.estado();
  const selection = e.contexto.selectedLine;
  assert.equal(e.contexto.updateSelectedLinePoints([[1,2]]), false);
  assert.equal(e.contexto.updateSelectedLinePoints([[NaN,2],[1,2]]), false);
  assert.deepEqual(e.estado(), antes);
  assert.equal(e.contexto.selectedLine, selection);
  assert.equal(e.snapshots.length, 0);
});

for(const cambio of ['territorio', 'congregacion', 'fingerprint']){
  for(const operacion of ['editar', 'borrar']){
    test(`${operacion} rechaza una selección obsoleta por ${cambio} sin alterar almacenamiento`, () => {
      const e = entorno();
      e.seleccionar('road');
      if(cambio === 'territorio') e.contexto.currentIndex = 1;
      if(cambio === 'congregacion') e.contexto.congregacionActivaId = 'congregacion-b';
      if(cambio === 'fingerprint') e.contexto.whiteRoadSettings['1'][0] = carretera(10);
      const antes = e.estado();
      assert.equal(e.contexto.getSelectedLine(), null);
      assert.equal(operacion === 'editar' ? e.contexto.updateSelectedLinePoints([[1,2],[3,4]]) : e.contexto.deleteSelectedLine(), false);
      assert.deepEqual(e.estado(), antes);
      assert.equal(e.contexto.selectedLine, null);
      assert.equal(e.snapshots.length, 0);
      assert.equal(e.llamadas.some(x => x.startsWith('publish:')), false);
    });
  }
}

test('un arrastre antiguo no puede editar una selección más reciente', () => {
  const e = entorno();
  e.seleccionar('road', 0);
  const antigua = e.contexto.selectedLine;
  e.seleccionar('road', 1);
  const nueva = e.contexto.selectedLine;
  const avisos = copia(e.avisos);
  const antes = e.estado();
  assert.equal(e.contexto.updateSelectedLinePoints([[1,2],[3,4]], antigua), false);
  assert.deepEqual(e.estado(), antes);
  assert.equal(e.contexto.selectedLine, nueva);
  assert.deepEqual(copia(e.contexto.getSelectedLine()), antes.roads['1'][1]);
  assert.deepEqual(e.avisos, avisos);
  assert.equal(e.snapshots.length, 0);
});

for(const kind of ['road', 'river']){
  test(`un fallo al guardar el borrado de ${kind} informa el error sin anunciar que se eliminó`, () => {
    const e = entorno({guardar:false});
    e.seleccionar(kind);
    e.avisos.length = 0;
    assert.equal(e.contexto.deleteSelectedLine(), false);
    assert(e.avisos.some(aviso => aviso.tipo === 'error' && /No se pudieron guardar/.test(aviso.texto)));
    assert.equal(e.avisos.some(aviso => /eliminad[oa]|recuperarlo con Deshacer/.test(aviso.texto)), false);
  });
}

test('Borrar con un trazo seleccionado conserva áreas y el resto de dibujos', () => {
  const e = entorno();
  const antes = e.estado();
  e.seleccionar('road');
  e.contexto.clearColorAreasForCurrent();
  const despues = e.estado();
  assert.deepEqual(despues.roads['1'], antes.roads['1'].slice(1));
  for(const otra of ['rivers','areas','labels','icons']) assert.deepEqual(despues[otra], antes[otra]);
  assert.equal(e.snapshots.length, 1);
});

test('Borrar con una selección obsoleta no cae en el borrado de todo el territorio', () => {
  const e = entorno();
  e.seleccionar('road');
  e.contexto.whiteRoadSettings['1'][0] = carretera(10);
  const antes = e.estado();
  e.contexto.clearColorAreasForCurrent();
  assert.deepEqual(e.estado(), antes);
  assert.equal(e.snapshots.length, 0);
});

test('el clic en un trazo superpuesto selecciona la línea antes del área pintada', async () => {
  const e = entorno({areaHit:0});
  e.contexto.colorEditMode = true;
  await e.clic(10,0);
  assert.equal(e.contexto.selectedLine?.kind, 'road');
  assert.equal(e.contexto.selectedLine?.index, 0);
  assert.equal(e.contexto.selectedAreaIndex, null);
  assert.equal(e.llamadas.includes('select-area'), false);
  assert.equal(e.snapshots.length, 0);
});

for(const [modo, borrador, llamada] of [
  ['roadPencilMode','roadDraftPoints',null], ['riverPencilMode','riverDraftPoints',null],
  ['colorDrawMode','draftPoints',null], ['textAddMode',null,'draw-text'],
  ['iconAddMode',null,'draw-icon'], ['territoryAddMode',null,'draw-territory']
]){
  test(`el modo ${modo} conserva prioridad sobre la selección del trazo existente`, async () => {
    const e = entorno();
    e.contexto.colorEditMode = true;
    e.contexto[modo] = true;
    await e.clic(10,0);
    assert.equal(e.contexto.selectedLine, null);
    assert.equal(e.snapshots.length, 0);
    if(borrador) assert.deepEqual(copia(e.contexto[borrador]), [punto(10,0)]);
    if(llamada) assert(e.llamadas.includes(llamada));
  });
}

test('la edición activa del contorno no selecciona una línea al tocar el mapa', async () => {
  const e = entorno();
  e.contexto.contourEditMode = true;
  e.contexto.selectedAreaIndex = 0;
  await e.clic(10,0);
  assert.equal(e.contexto.selectedAreaIndex, 0);
  assert.equal(e.contexto.selectedLine, null);
  assert.equal(e.snapshots.length, 0);
});
