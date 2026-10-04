const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '../outputs/croquis_territorios.html'), 'utf8');
function funcion(nombre){
  let inicio = html.indexOf(`function ${nombre}(`);
  assert(inicio >= 0, `Función disponible: ${nombre}`);
  if(html.slice(inicio - 6, inicio) === 'async ') inicio -= 6;
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
const funciones = [
  'normalizeDestinationPoint', 'normalizeDestinationLabel', 'normalizeTextLabelsForLoc', 'normalizeTextLabelSettings',
  'loadTextLabelSettings', 'saveTextLabelSettings', 'getTextLabelsForLoc', 'setTextLabelsForLoc',
  'cloneData', 'stateFingerprint', 'loadUndoHistory', 'loadRedoHistory', 'getCurrentSnapshot', 'pushUndoSnapshot',
  'saveUndoHistory', 'getInverseHistorySnapshot', 'restoreEditHistorySnapshot', 'restoreLastUndoSnapshot', 'restoreLastRedoSnapshot',
  'buildBackupPayload', 'getBackupData', 'publicarTerritorio', 'aplicarTerritorioRemoto',
  'directionAnnotationGeometry', 'directionInteractionAllowed', 'updateDestinationAnnotation', 'deleteDestinationAnnotation', 'ajustarDobleClic'
].map(funcion).join('\n');
const plano = valor => JSON.parse(JSON.stringify(valor));
const destino = extra => ({type:'destino',text:'Hacia Ocotitlán',lat:19.01,lng:-97.02,points:[[19.01,-97.01],[19.02,-97.03]],...extra});

function entorno(guardados = {}){
  const valores = new Map(Object.entries(guardados)), publicados = [], avisos = [];
  let fallos = 0;
  const noOp = () => {}, vacio = () => [];
  const c = vm.createContext({
    TEXT_LABELS_STORAGE_KEY:'textos', UNDO_HISTORY_STORAGE_KEY:'undo', REDO_HISTORY_STORAGE_KEY:'redo', UNDO_HISTORY_LIMIT:80,
    BACKUP_FILE_VERSION:1, location:{href:'http://localhost/croquis'},
    congregacionActivaId:'a', currentIndex:0, LOCS:[{num:1}],
    textLabelSettings:{}, colorAreaSettings:{}, manualIconSettings:{}, whiteRoadSettings:{}, manualRiverSettings:{},
    frameScaleSettings:{}, framePositionSettings:{}, leyendaSettings:{}, nombresSettings:{},
    undoHistory:[], redoHistory:[], suppressUndoSnapshot:false, selectedAreaIndex:null, selectedTextIndex:null, selectedIconIndex:null,
    nube:null, nubeAplicando:false, nubeYo:'yo', nubeQuien:'Equipo', map:null,
    destinationAddMode:false, destinationSession:null, frameMoveMode:false,
    territoryAddMode:false, colorDrawMode:false, roadPencilMode:false, riverPencilMode:false,
    textAddMode:false, iconAddMode:false, contourEditMode:false,
    L:{point:(x,y) => ({x,y})},
    almacen:{
      getItem:key => valores.get(key + '::' + c.congregacionActivaId) ?? null,
      setItem(key, value){ if(fallos){ fallos--; throw new Error('QuotaExceededError simulado'); } valores.set(key + '::' + c.congregacionActivaId, value); }
    },
    console:{error:noOp}, clearHeavyUndoStorage:noOp, clearLegacyUndoStorage:noOp,
    setStatus:(text,type) => avisos.push({text,type}), publicarTerritorioPronto:noOp, refreshTerritoryCounts:noOp,
    getColorAreasForLoc:vacio, getManualIconsForLoc:vacio, getWhiteRoadsForLoc:vacio, getManualRiversForLoc:vacio,
    normalizeFramePosition:() => null, normalizeFramePositionSettings:() => ({}), getFrameScaleForLoc:() => 100,
    saveFramePositionSettings:noOp, saveFrameScaleSettings:noOp, saveLeyendaSettings:noOp,
    saveColorAreaSettings:noOp, saveManualIconSettings:noOp, saveWhiteRoadSettings:noOp, saveManualRiverSettings:noOp,
    resetDraftArea:noOp, clearSelectedLine:noOp, cerrarPanelReferencias:noOp, setContourEditMode:noOp, goTo:noOp, updateColorControls:noOp,
    renderColorAreas:noOp, renderTextLabels:noOp, renderManualIcons:noOp, renderManualWhiteRoads:noOp, renderManualRivers:noOp,
    cancelDestinationInteraction(){c.destinationSession=null;c.destinationAddMode=false;c.selectedTextIndex=null;},
    safeObject:v => v && typeof v === 'object' && !Array.isArray(v) ? v : {}, safeArray:v => Array.isArray(v) ? v : [],
    loadCustomTerritorySettings:vacio, loadHiddenTerritorySettings:vacio, normalizeCustomTerritory:v => v,
    normalizeNombresSettings:v => v || {}, cargarCongregaciones:() => [{id:c.congregacionActivaId}],
    cargarRegistroCongregaciones:vacio, datosDeTodasLasCongregaciones:() => ({}),
    displayTerritoryTitle:loc => String(loc.num), nubeEditando:() => true,
    clampFrameScale:v => Number(v)
  });
  for(const match of funcion('getBackupData').matchAll(/data\[([A-Z_]+)\]/g)){
    if(c[match[1]] === undefined) c[match[1]] = match[1].toLowerCase();
  }
  vm.runInContext(funciones, c);
  c.textLabelSettings = c.loadTextLabelSettings();
  return {c,valores,publicados,avisos,
    guardar:labels => c.setTextLabelsForLoc(c.LOCS[0],labels),
    leer:() => plano(c.getTextLabelsForLoc(c.LOCS[0])),
    recargar(){ c.textLabelSettings = c.loadTextLabelSettings(); },
    fallar:veces => { fallos = veces; },
    conectar(){ c.nube = {db:{},fs:{doc:(...args) => args.slice(1),async setDoc(ref,value){publicados.push({ref,value});}}}; }
  };
}

test('la flecha conserva dos extremos, texto y metadatos con medidas de impresión por defecto', () => {
  const e = entorno(), original = destino({id:'flecha-1',text:'  Hacia Ocotitlán  ',nota:'Acceso principal'}), copia = plano(original);
  const normal = plano(e.c.normalizeDestinationLabel(original));
  assert.deepEqual(normal,{...original,text:'Hacia Ocotitlán',sizePt:10,strokePt:1.2,headMm:3});
  assert.deepEqual(original,copia);
  normal.points[0][0] = 20;
  assert.equal(original.points[0][0],19.01);
});

test('acepta coordenadas y medidas numéricas de un respaldo y acota tamaños útiles', () => {
  const e = entorno();
  const normal = plano(e.c.normalizeDestinationLabel(destino({lat:'19.123456789',lng:'-97.123456789',points:[['19.001','-97.02'],['19.002','-97.03']],sizePt:'12',strokePt:'1.5',headMm:'4'})));
  assert.equal(normal.lat,19.12345679); assert.equal(normal.lng,-97.12345679);
  assert.deepEqual(normal.points,[[19.001,-97.02],[19.002,-97.03]]);
  assert.equal(normal.sizePt,12); assert.equal(normal.strokePt,1.5); assert.equal(normal.headMm,4);
  const min = plano(e.c.normalizeDestinationLabel(destino({sizePt:-2,strokePt:-2,headMm:-2})));
  const max = plano(e.c.normalizeDestinationLabel(destino({sizePt:99,strokePt:99,headMm:99})));
  assert.deepEqual([min.sizePt,min.strokePt,min.headMm],[7,.6,2]);
  assert.deepEqual([max.sizePt,max.strokePt,max.headMm],[18,3,6]);
});

test('medidas ausentes o inválidas recuperan las medidas legibles por defecto', () => {
  const e = entorno();
  for(const value of [null,undefined,'',true,false,NaN,Infinity,'invalido']){
    const normal = plano(e.c.normalizeDestinationLabel(destino({sizePt:value,strokePt:value,headMm:value})));
    assert.deepEqual([normal.sizePt,normal.strokePt,normal.headMm],[10,1.2,3]);
  }
});

test('descarta flechas vacías, sin posición o con extremos corruptos sin afectar textos antiguos', () => {
  const e = entorno(), antiguos = [{text:'23',lat:19,lng:-97},{text:'A OCOTITLAN',lat:19,lng:-97,type:'carretera',size:28}];
  const invalidos = [null,[],{},destino({text:''}),destino({lat:null}),destino({lat:' '}),destino({lat:true}),destino({lng:Infinity}),
    destino({lat:86}),destino({lng:-181}),destino({points:null}),destino({points:[[19,-97]]}),
    destino({points:[[19,-97],[20,-97],[21,-97]]}),destino({points:[[19,-97],[false,-97]]}),
    destino({points:[[19,-97],[19,-97]]}),destino({points:[[19,-97],[19.000000001,-97]]})];
  for(const label of invalidos) assert.equal(e.c.normalizeDestinationLabel(label),null);
  assert.deepEqual(plano(e.c.normalizeTextLabelsForLoc([...antiguos,...invalidos])),antiguos);
  assert.equal(e.c.normalizeTextLabelsForLoc(antiguos)[0],antiguos[0]);
  assert.deepEqual(plano(e.c.normalizeTextLabelSettings([])),{});
});

test('guardar y recargar mantiene ambas puntas y separa el trabajo por congregación', () => {
  const e = entorno();
  assert.equal(e.guardar([destino()]),true);
  const guardado = e.leer(); e.recargar(); assert.deepEqual(e.leer(),guardado);
  assert.deepEqual(JSON.parse(e.valores.get('textos::a'))['1'],guardado);
  e.c.congregacionActivaId = 'b'; e.recargar(); assert.deepEqual(e.leer(),[]);
  assert.equal(e.guardar([destino({text:'Hacia Cruz Verde'})]),true);
  e.c.congregacionActivaId = 'a'; e.recargar(); assert.deepEqual(e.leer(),guardado);
});

test('la carga tolera JSON inválido y elimina solo las flechas dañadas', () => {
  const e = entorno({'textos::a':JSON.stringify({'1':[{text:'8'},destino(),destino({points:[]})],corrupto:'texto'})});
  assert.equal(e.leer().length,2); assert.equal(e.leer()[0].text,'8');
  assert.equal(e.leer()[1].type,'destino');
  assert.deepEqual(plano(entorno({'textos::a':'{ roto'}).c.textLabelSettings),{});
});

test('Deshacer recupera puntas, posición del texto y dimensiones de la flecha', () => {
  const e = entorno(); e.guardar([destino()]);
  const original = e.leer();
  e.guardar([destino({text:'Hacia Xalapa',lat:19.05,points:[[19.01,-97.02],[19.05,-97.04]],sizePt:12})]);
  e.c.restoreLastUndoSnapshot(); assert.deepEqual(e.leer(),original);
  e.recargar(); assert.deepEqual(e.leer(),original);
  e.c.restoreLastUndoSnapshot(); assert.deepEqual(e.leer(),[]);
});

test('Rehacer recupera la flecha modificada y persiste extremos, texto y medidas físicas', () => {
  const e = entorno(); e.guardar([destino()]);
  e.guardar([destino({text:'Hacia Xalapa',lat:19.05,lng:-97.04,
    points:[[19.02,-97.03],[19.05,-97.04]],sizePt:12,strokePt:1.7,headMm:4.5})]);
  const modified = e.leer();
  e.c.restoreLastUndoSnapshot(); assert.notDeepEqual(e.leer(),modified);
  e.c.redoHistory = e.c.loadRedoHistory();
  assert.equal(e.c.restoreLastRedoSnapshot(),true); assert.deepEqual(e.leer(),modified);
  e.recargar(); assert.deepEqual(e.leer(),modified);
});

test('respaldo y nube transportan la anotación íntegra con sus medidas físicas', async () => {
  const e = entorno(); e.guardar([destino({id:'destino-1',sizePt:12,strokePt:1.6,headMm:4})]);
  const original = e.leer(), payload = plano(e.c.buildBackupPayload());
  assert.deepEqual(plano(e.c.getBackupData(payload)).textLabels['1'],original);
  e.conectar(); await e.c.publicarTerritorio(e.c.LOCS[0]);
  const remoto = JSON.parse(e.publicados[0].value.datos);
  assert.deepEqual(remoto.textos,original);
  const receptor = entorno(); receptor.c.aplicarTerritorioRemoto('1',{datos:JSON.stringify(remoto),porQuien:'Equipo'});
  assert.deepEqual(receptor.leer(),original); receptor.recargar(); assert.deepEqual(receptor.leer(),original);
});

test('un fallo transitorio de cuota vuelve a guardar sin perder los extremos', () => {
  const e = entorno(); e.fallar(1);
  assert.equal(e.guardar([destino()]),true);
  e.recargar(); assert.deepEqual(e.leer()[0].points,destino().points);
});

test('las dos alas de la punta se orientan hacia atrás en cualquier dirección', () => {
  const e = entorno(), mapa = {latLngToContainerPoint:([lat,lng]) => ({x:lng,y:lat})};
  for(const tip of [[0,100],[0,-100],[100,0],[-100,0],[100,100]]){
    const geometry = e.c.directionAnnotationGeometry(mapa,{points:[[0,0],tip],headMm:3});
    const dx = tip[1], dy = tip[0], length = Math.hypot(dx,dy), ux = dx/length, uy = dy/length;
    const projections = geometry.wings.map(wing => (wing.x-geometry.tip.x)*ux + (wing.y-geometry.tip.y)*uy);
    for(const projection of projections) assert(Math.abs(projection + 3*96/25.4) < 1e-9);
    const perpendicular = geometry.wings.map(wing => (wing.x-geometry.tip.x)*(-uy) + (wing.y-geometry.tip.y)*ux);
    assert(Math.abs(perpendicular[0]+perpendicular[1]) < 1e-9);
    assert(Math.abs(Math.abs(perpendicular[0])-3*96/25.4*.55) < 1e-9);
  }
});

test('la punta compensa la escala del PDF conservando la misma medida física', () => {
  const e = entorno(), mapa = {latLngToContainerPoint:([lat,lng]) => ({x:lng,y:lat})};
  for(const factor of [.5,1,3,18]){
    const geometry = e.c.directionAnnotationGeometry(mapa,{points:[[0,0],[0,100]],headMm:4},factor);
    assert(Math.abs((geometry.tip.x-geometry.wings[0].x)/factor - 4*96/25.4) < 1e-9);
  }
});

test('mover un extremo mantiene texto, medidas y el otro extremo y permite Deshacer', () => {
  const e = entorno(); e.guardar([destino({sizePt:12,strokePt:1.5,headMm:4})]);
  const original = e.leer()[0], fingerprint = e.c.stateFingerprint(e.c.getTextLabelsForLoc(e.c.LOCS[0])[0]);
  assert.equal(e.c.updateDestinationAnnotation(0,{points:[[19.03,-97.01],original.points[1]]},fingerprint),true);
  const moved = e.leer()[0];
  assert.deepEqual({...moved,points:original.points},original);
  e.c.restoreLastUndoSnapshot(); assert.deepEqual(e.leer()[0],original);
});

test('un arrastre obsoleto o dos extremos coincidentes no modifican la flecha', () => {
  const e = entorno(); e.guardar([destino()]);
  const original = e.leer(), snapshots = e.c.undoHistory.length;
  assert.equal(e.c.updateDestinationAnnotation(0,{lat:20},'anotación anterior'),false);
  const fingerprint = e.c.stateFingerprint(e.c.getTextLabelsForLoc(e.c.LOCS[0])[0]);
  assert.equal(e.c.updateDestinationAnnotation(0,{points:[original[0].points[0],original[0].points[0]]},fingerprint),false);
  assert.deepEqual(e.leer(),original); assert.equal(e.c.undoHistory.length,snapshots);
});

test('ajustar una flecha respeta los otros modos de dibujo y permite editar una sesión guardada', () => {
  const e = entorno(); assert.equal(e.c.directionInteractionAllowed(),true);
  for(const mode of ['frameMoveMode','destinationAddMode','territoryAddMode','colorDrawMode','roadPencilMode','riverPencilMode','textAddMode','iconAddMode','contourEditMode']){
    e.c[mode] = true; assert.equal(e.c.directionInteractionAllowed(),false,mode); e.c[mode] = false;
  }
  e.c.destinationSession = {points:destino().points}; assert.equal(e.c.directionInteractionAllowed(),false);
  e.c.destinationSession = {index:0}; assert.equal(e.c.directionInteractionAllowed(),true);
});

for(const [nombre,patch] of [['congregación',{namespace:'b'}],['territorio',{locNum:'2'}],['índice',{index:1}],['datos remotos',{fingerprint:'anotación reemplazada'}]]){
  test(`Eliminar rechaza una sesión de destino obsoleta por ${nombre}`, () => {
    const e = entorno();e.guardar([destino(),{text:'23',lat:19,lng:-97}]);
    const original = e.leer(), snapshots = e.c.undoHistory.length;
    e.c.selectedTextIndex = 0;
    e.c.destinationSession = {namespace:'a',locNum:'1',index:0,fingerprint:e.c.stateFingerprint(e.c.getTextLabelsForLoc(e.c.LOCS[0])[0]),...patch};
    assert.equal(e.c.deleteDestinationAnnotation(),false);
    assert.deepEqual(e.leer(),original);assert.equal(e.c.undoHistory.length,snapshots);
    e.recargar();assert.deepEqual(e.leer(),original);
    assert.equal(e.c.destinationSession,null);assert.equal(e.avisos.at(-1).type,'warn');
  });
}

test('Eliminar borra solo la flecha vigente del panel y Deshacer recupera todos sus datos', () => {
  const e = entorno();e.guardar([destino(),{text:'23',lat:19,lng:-97}]);
  const original = e.leer();e.c.selectedTextIndex = 0;
  e.c.destinationSession = {namespace:'a',locNum:'1',index:0,fingerprint:e.c.stateFingerprint(e.c.getTextLabelsForLoc(e.c.LOCS[0])[0])};
  assert.equal(e.c.deleteDestinationAnnotation(),true);
  assert.deepEqual(e.leer(),[original[1]]);e.c.restoreLastUndoSnapshot();assert.deepEqual(e.leer(),original);
});

function controlesDestino(e){
  const nodos = new Map(), clases = new Set(), eventos = [];
  e.c.$ = id => {if(!nodos.has(id))nodos.set(id,{hidden:false,style:{},textContent:''});return nodos.get(id);};
  e.c.document = {querySelector:() => ({classList:{add(...values){values.forEach(v=>clases.add(v));},remove(...values){values.forEach(v=>clases.delete(v));}}})};
  e.c.destinationButton = {setAttribute:(key,value) => {e.c.$('btn-destino')[key]=value;}};
  e.c.destinationStartPoint = {lat:19,lng:-97};
  e.c.destinationDraftLayer = {clearLayers:() => eventos.push('borrador')};
  e.c.map = {doubleClickZoom:{disable:() => eventos.push('desactivar-zoom'),enable:() => eventos.push('activar-zoom')}};
  e.c.setFrameMoveMode=e.c.setTerritoryAddMode=e.c.setColorDrawMode=e.c.setRoadPencilMode=e.c.setRiverPencilMode=e.c.setTextAddMode=e.c.setIconAddMode=()=>{};
  vm.runInContext(funcion('cancelDestinationInteraction') + funcion('setDestinationAddMode'),e.c);
  return {nodos,clases,eventos};
}

test('colocar una flecha desactiva el zoom por doble toque y cancelar vuelve a activarlo', () => {
  const e = entorno(), controles = controlesDestino(e);
  e.c.setDestinationAddMode(true);
  assert.equal(e.c.destinationAddMode,true);assert.equal(controles.eventos.at(-1),'desactivar-zoom');
  assert.equal(controles.clases.has('is-destination-placing'),true);
  e.c.destinationSession = {points:destino().points};
  e.c.cancelDestinationInteraction();
  assert.equal(e.c.destinationAddMode,false);assert.equal(e.c.destinationSession,null);assert.equal(e.c.destinationStartPoint,null);
  assert.equal(controles.eventos.at(-1),'activar-zoom');assert.equal(controles.nodos.get('destination-panel').hidden,true);
  assert.equal(controles.clases.size,0);
});

test('cancelar destino conserva el zoom desactivado mientras otro modo todavía dibuja', () => {
  const e = entorno(), controles = controlesDestino(e);e.c.destinationAddMode=true;e.c.roadPencilMode=true;
  e.c.cancelDestinationInteraction();assert.equal(controles.eventos.at(-1),'desactivar-zoom');
  e.c.roadPencilMode=false;e.c.ajustarDobleClic();assert.equal(controles.eventos.at(-1),'activar-zoom');
});

test('una congregación sin territorios retira flechas y borradores de la vista sin borrar datos guardados', () => {
  const e = entorno();e.guardar([destino()]);const original=plano(e.c.textLabelSettings),controles=controlesDestino(e);
  for(const name of ['ringLayer','colorLayer','draftLayer','textLayer','manualIconLayer','editHandleLayer','colorRestoreLayer','labelOverlayLayer','roadOverlayLayer','vectorRoadLayer','runtimeReferenceLayer','runtimeOfflineAreaLayer','runtimeOfflineLabelLayer','manualWhiteRoadLayer','manualRiverLayer'])e.c[name]=null;
  e.c.map._directionLayer={clearLayers:()=>controles.eventos.push('flechas')};
  e.c.congregacionActual=()=>({nombre:'Congregación vacía'});e.c.updateFrameControls=e.c.updateButtons=()=>{};
  e.c.destinationAddMode=true;e.c.destinationSession={points:destino().points};e.c.LOCS=[];
  vm.runInContext(funcion('limpiarMapaSinTerritorios'),e.c);e.c.limpiarMapaSinTerritorios();
  assert.equal(e.c.destinationSession,null);assert.equal(e.c.destinationAddMode,false);
  assert(controles.eventos.includes('borrador'));assert(controles.eventos.includes('flechas'));
  assert.equal(controles.nodos.get('territory-badge').textContent,'Sin territorios');
  assert.deepEqual(plano(e.c.textLabelSettings),original);
});
