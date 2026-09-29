const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '../outputs/croquis_territorios.html'), 'utf8');
function funcion(nombre){
  let comienzo = html.indexOf(`function ${nombre}(`);
  assert(comienzo >= 0, `Función disponible: ${nombre}`);
  if(html.slice(comienzo - 6, comienzo) === 'async ') comienzo -= 6;
  const apertura = html.indexOf('{', comienzo);
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
    if(actual === '}' && --profundidad === 0) return html.slice(comienzo, i + 1) + '\n';
  }
  throw new Error(`Función incompleta: ${nombre}`);
}
const funciones = [
  'normalizeFramePosition', 'normalizeFramePositionSettings', 'loadFramePositionSettings', 'saveFramePositionSettings',
  'clampFrameScale', 'getFrameScaleForLoc', 'scaleBoundsPlain', 'translateFrameBoundsPlain',
  'getPrintBoundsPlain', 'getBaseBoundsPlain', 'boundsAroundCenter', 'calcBoundsPlain', 'll2t', 't2ll',
  'getExportBoundsPlain', 'getColorAreasBoundsPlain', 'getRuntimeRoadCacheKey',
  'cloneData', 'stateFingerprint', 'getCurrentSnapshot', 'pushUndoSnapshot', 'saveUndoHistory', 'restoreLastUndoSnapshot',
  'setFramePositionForLoc', 'resetFrameForCurrent', 'isFrameMoveSessionCurrent',
  'nubeEditando', 'publicarTerritorio', 'aplicarTerritorioRemoto'
].map(funcion).join('\n');
const copia = valor => JSON.parse(JSON.stringify(valor));
const centro = bounds => ({lat:(bounds.south + bounds.north) / 2, lng:(bounds.west + bounds.east) / 2});
const spans = bounds => ({lat:bounds.north - bounds.south, lng:bounds.east - bounds.west});
const cercano = (actual, esperado) => assert(Math.abs(actual - esperado) < 1e-9, `${actual} ≈ ${esperado}`);

function entorno({guardados = {}, cuota = false} = {}){
  const valores = new Map(Object.entries(guardados)), escrituras = [], llamadas = [], avisos = [], enviados = [];
  let fallos = cuota ? Infinity : 0, fallarEscala = false;
  const noOp = () => {};
  const contexto = vm.createContext({
    DETAIL_ZOOM:20, DETAIL_PAD:2, PRINT_ASPECT:297 / 189, COLOR_BOUNDS_PAD:.06,
    FRAME_SCALE_MIN:55, FRAME_SCALE_MAX:180, FRAME_SCALE_STEP:5, UNDO_HISTORY_LIMIT:80,
    FRAME_POSITION_STORAGE_KEY:'posiciones', UNDO_HISTORY_STORAGE_KEY:'undo',
    congregacionActivaId:'congregacion-a', currentIndex:0,
    LOCS:[
      {num:'custom-1', lat:19.01, lon:-97.015, printBounds:{south:19, north:19.02, west:-97.03, east:-97}},
      {num:2, lat:19.1, lon:-96.9, printRadiusM:750},
      {num:3, lat:19.4, lon:-96.8}
    ],
    framePositionSettings:{}, frameScaleSettings:{}, frameMoveMode:false, frameMoveSession:null, frameMoveHandle:null,
    colorDrawMode:false, roadPencilMode:false, riverPencilMode:false, textAddMode:false,
    iconAddMode:false, contourEditMode:false, territoryAddMode:false, draftPoints:[],
    destinationAddMode:false, destinationSession:null, cancelDestinationInteraction:noOp,
    nube:null, nubeAplicando:false, nubeYo:'yo', nubeQuien:'Equipo', leyendaSettings:{},
    colorAreaSettings:{'custom-1':[{color:'#1257c5', points:[[19,-97],[19.02,-97],[19.01,-96.98]]}]},
    textLabelSettings:{'custom-1':[{text:'Zona', lat:19.01, lng:-97}]},
    manualIconSettings:{}, whiteRoadSettings:{}, manualRiverSettings:{},
    undoHistory:[], suppressUndoSnapshot:false,
    selectedAreaIndex:null, selectedTextIndex:null, selectedIconIndex:null,
    almacen:{
      getItem(clave){ return valores.get(clave + '::' + contexto.congregacionActivaId) ?? null; },
      setItem(clave, valor){
        if(fallos){ fallos--; throw new Error('QuotaExceededError simulado'); }
        const key = clave + '::' + contexto.congregacionActivaId;
        if(clave === 'posiciones') llamadas.push({persist:JSON.parse(valor), memory:copia(contexto.framePositionSettings)});
        valores.set(key, valor); escrituras.push(key);
      }
    },
    console:{error:noOp},
    clearHeavyUndoStorage(){ llamadas.push('clear-heavy-undo'); },
    setStatus:(texto, tipo) => avisos.push({texto, tipo}),
    getColorAreasForLoc:loc => contexto.colorAreaSettings[String(loc?.num)] || [],
    getExportColorAreasForLoc:loc => contexto.colorAreaSettings[String(loc?.num)] || [],
    getTextLabelsForLoc:loc => contexto.textLabelSettings[String(loc?.num)] || [],
    getManualIconsForLoc:loc => contexto.manualIconSettings[String(loc?.num)] || [],
    getWhiteRoadsForLoc:loc => contexto.whiteRoadSettings[String(loc?.num)] || [],
    getManualRiversForLoc:loc => contexto.manualRiverSettings[String(loc?.num)] || [],
    publicarTerritorioPronto:loc => llamadas.push({publish:loc.num, position:copia(contexto.framePositionSettings[String(loc.num)] ?? null)}),
    updateFrameControls:noOp, updateInfo:noOp, updateButtons:noOp, updateLabelOverlayVisibility:noOp,
    drawTerritoryFrame:loc => llamadas.push({draw:loc.num}),
    renderFrameMoveHandle:noOp, renderColorAreas:noOp, renderTextLabels:noOp, renderManualIcons:noOp,
    renderManualWhiteRoads:noOp, renderManualRivers:noOp, updateColorControls:noOp,
    loadRuntimeRoadReferences:noOp, refreshRuntimeRoadReferences:noOp,
    saveColorAreaSettings:() => true, saveTextLabelSettings:() => true, saveManualIconSettings:() => true,
    saveWhiteRoadSettings:() => true, saveManualRiverSettings:() => true,
    saveLeyendaSettings:() => true,
    saveFrameScaleSettings(settings = contexto.frameScaleSettings){
      if(fallarEscala) return false;
      valores.set('escalas::' + contexto.congregacionActivaId, JSON.stringify(settings)); return true;
    },
    setFrameMoveMode(active){ contexto.frameMoveMode = active; },
    resetDraftArea:noOp, clearSelectedLine:noOp, setContourEditMode:noOp, refreshTerritoryCounts:noOp,
    goTo(index){ contexto.currentIndex = index; llamadas.push({goTo:index}); },
    map:{},
    cargarCongregaciones:() => [{id:contexto.congregacionActivaId}],
    displayTerritoryTitle:loc => String(loc.num),
  });
  vm.runInContext(funciones, contexto);
  contexto.framePositionSettings = contexto.loadFramePositionSettings();
  return {contexto, valores, escrituras, llamadas, avisos, enviados, copiar:copia,
    fallarVeces:veces => { fallos = veces; },
    fallarGuardarEscala:() => { fallarEscala = true; },
    mover:(position, loc = contexto.LOCS[contexto.currentIndex]) => contexto.setFramePositionForLoc(loc, position),
    bounds:(loc = contexto.LOCS[contexto.currentIndex]) => copia(contexto.getPrintBoundsPlain(loc)),
    undo:() => contexto.restoreLastUndoSnapshot(),
    conectar(){ contexto.nube = {db:{},fs:{doc:(...partes) => partes.slice(1), async setDoc(ref,datos){ enviados.push({ref,datos}); }}}; },
    recibir:datos => contexto.aplicarTerritorioRemoto('custom-1',{datos:JSON.stringify(datos),porQuien:'Otro'})
  };
}

test('normaliza coordenadas válidas y rechaza posiciones incompletas o fuera del mapa', () => {
  const e = entorno();
  assert.deepEqual(copia(e.contexto.normalizeFramePosition({lat:'19.123456789', lng:'-97.123456789'})), {lat:19.12345679, lng:-97.12345679});
  for(const position of [null, [], true, {}, {lat:19}, {lat:null,lng:1}, {lat:' ',lng:1}, {lat:true,lng:1}, {lat:1,lng:false},
    {lat:Infinity,lng:1}, {lat:NaN,lng:1}, {lat:86,lng:1}, {lat:-86,lng:1}, {lat:1,lng:181}, {lat:1,lng:-181}]){
    assert.equal(e.contexto.normalizeFramePosition(position), null);
  }
  assert.deepEqual(copia(e.contexto.normalizeFramePosition({lat:0,lng:0})), {lat:0,lng:0});
});

test('la recarga descarta datos dañados y conserva posiciones de la congregación activa', () => {
  const e = entorno({guardados:{
    'posiciones::congregacion-a':JSON.stringify({'custom-1':{lat:20,lng:-98}, mala:{lat:90,lng:1}}),
    'posiciones::congregacion-b':JSON.stringify({'custom-1':{lat:21,lng:-99}})
  }});
  assert.deepEqual(copia(e.contexto.framePositionSettings), {'custom-1':{lat:20,lng:-98}});
  e.contexto.congregacionActivaId = 'congregacion-b';
  e.contexto.framePositionSettings = e.contexto.loadFramePositionSettings();
  assert.deepEqual(copia(e.contexto.framePositionSettings), {'custom-1':{lat:21,lng:-99}});
  assert.equal(e.escrituras.length, 0);
  assert.deepEqual(copia(entorno({guardados:{'posiciones::congregacion-a':'{ roto'}}).contexto.framePositionSettings), {});
});

test('guardar un candidato no modifica la memoria ni el espacio de otra congregación', () => {
  const e = entorno();
  const position = {'custom-1':{lat:20,lng:-98}};
  assert.equal(e.contexto.saveFramePositionSettings(position), true);
  assert.deepEqual(copia(e.contexto.framePositionSettings), {});
  assert.equal(e.valores.has('posiciones::congregacion-b'), false);
  assert.deepEqual(JSON.parse(e.valores.get('posiciones::congregacion-a')), position);
});

for(const num of ['custom-1',2,3]){
  test(`mover el recuadro ${num} conserva ancho, alto y escala sin modificar su geometría original`, () => {
    const e = entorno(), loc = e.contexto.LOCS.find(loc => loc.num === num), original = copia(loc);
    for(const scale of [55,100,180]){
      e.contexto.frameScaleSettings[String(loc.num)] = scale;
      const antes = e.bounds(loc);
      e.contexto.framePositionSettings[String(loc.num)] = {lat:20.25,lng:-98.5};
      const despues = e.bounds(loc);
      cercano(centro(despues).lat,20.25); cercano(centro(despues).lng,-98.5);
      cercano(spans(despues).lat,spans(antes).lat); cercano(spans(despues).lng,spans(antes).lng);
      assert.deepEqual(loc, original);
      delete e.contexto.framePositionSettings[String(loc.num)];
    }
  });
}

test('la traslación rechaza un centro válido cuyo recuadro completo saldría de Mercator o del meridiano', () => {
  const e = entorno(), bounds = {south:18,north:20,west:-98,east:-96};
  for(const position of [{lat:85,lng:0},{lat:-85,lng:0},{lat:0,lng:179.5},{lat:0,lng:-179.5},null]){
    assert.equal(e.contexto.translateFrameBoundsPlain(bounds,position), null);
  }
  const trasladado = copia(e.contexto.translateFrameBoundsPlain(bounds,{lat:0,lng:0}));
  assert.deepEqual(trasladado,{south:-1,north:1,west:-1,east:1});
  assert.deepEqual(bounds,{south:18,north:20,west:-98,east:-96});
});

test('una posición antigua que no admite el tamaño actual conserva un recuadro válido', () => {
  const e = entorno(), loc = e.contexto.LOCS[0], antes = e.bounds();
  e.contexto.framePositionSettings[String(loc.num)] = {lat:85.05112,lng:179.99999};
  const despues = e.bounds();
  assert.deepEqual(despues, antes);
});

test('mover persiste antes de aplicarse, crea un solo undo y publica el centro nuevo', () => {
  const e = entorno(), antes = e.bounds(), dibujos = copia(e.contexto.colorAreaSettings), textos = copia(e.contexto.textLabelSettings);
  assert.equal(e.mover({lat:20,lng:-98}),true);
  assert.deepEqual(JSON.parse(e.valores.get('posiciones::congregacion-a')),{'custom-1':{lat:20,lng:-98}});
  assert.deepEqual(e.llamadas.find(x => x.persist).memory,{});
  assert.equal(e.contexto.undoHistory.length,1);
  assert.equal(e.contexto.undoHistory[0].framePosition,null);
  assert.equal(e.llamadas.filter(x => x.publish).length,1);
  assert.deepEqual(e.llamadas.find(x => x.publish).position,{lat:20,lng:-98});
  cercano(spans(e.bounds()).lat,spans(antes).lat); cercano(spans(e.bounds()).lng,spans(antes).lng);
  assert.deepEqual(e.contexto.colorAreaSettings,dibujos); assert.deepEqual(e.contexto.textLabelSettings,textos);
});

test('mover de nuevo al mismo punto no escribe, publica ni duplica undo', () => {
  const e = entorno(); assert.equal(e.mover({lat:20,lng:-98}),true);
  const escrituras = e.escrituras.length, publicaciones = e.llamadas.filter(x => x.publish).length;
  assert.equal(e.mover({lat:20,lng:-98}),false);
  assert.equal(e.escrituras.length,escrituras); assert.equal(e.llamadas.filter(x => x.publish).length,publicaciones);
  assert.equal(e.contexto.undoHistory.length,1);
});

test('posiciones inválidas y recuadros fuera del mapa no alteran datos ni crean undo', () => {
  const e = entorno(), antes = e.bounds();
  for(const position of [null,{lat:90,lng:0},{lat:85.05112,lng:179.99999}]) assert.equal(e.mover(position),false);
  assert.deepEqual(e.bounds(),antes); assert.deepEqual(copia(e.contexto.framePositionSettings),{});
  assert.equal(e.escrituras.length,0); assert.equal(e.contexto.undoHistory.length,0);
  assert.equal(e.llamadas.filter(x => x.publish).length,0);
});

test('un fallo de almacenamiento conserva posición y dibujos previos sin publicar ni crear undo', () => {
  const e = entorno({guardados:{'posiciones::congregacion-a':JSON.stringify({'custom-1':{lat:20,lng:-98}})},cuota:true});
  const antes = e.bounds(), dibujos = copia(e.contexto.colorAreaSettings);
  assert.equal(e.mover({lat:21,lng:-99}),false);
  assert.deepEqual(e.bounds(),antes); assert.deepEqual(e.contexto.colorAreaSettings,dibujos);
  assert.deepEqual(copia(e.contexto.framePositionSettings),{'custom-1':{lat:20,lng:-98}});
  assert.deepEqual(JSON.parse(e.valores.get('posiciones::congregacion-a')),{'custom-1':{lat:20,lng:-98}});
  assert.equal(e.contexto.undoHistory.length,0); assert.equal(e.llamadas.filter(x => x.publish).length,0);
  assert.equal(e.avisos.at(-1).tipo,'error');
});

test('un fallo de cuota transitorio se recupera sin perder la posición', () => {
  const e = entorno(); e.fallarVeces(1);
  assert.equal(e.mover({lat:20,lng:-98}),true);
  assert.deepEqual(copia(e.contexto.framePositionSettings),{'custom-1':{lat:20,lng:-98}});
  assert.equal(e.contexto.undoHistory.length,1);
  assert(e.llamadas.includes('clear-heavy-undo'));
});

test('Deshacer recupera el centro anterior y persiste sin desplazar los dibujos', () => {
  const e = entorno(), antes = e.bounds(), dibujos = copia(e.contexto.colorAreaSettings);
  assert.equal(e.mover({lat:20,lng:-98}),true); assert.equal(e.mover({lat:21,lng:-99}),true);
  e.undo(); cercano(centro(e.bounds()).lat,20); cercano(centro(e.bounds()).lng,-98);
  e.undo(); assert.deepEqual(e.bounds(),antes);
  assert.deepEqual(copia(e.contexto.framePositionSettings),{});
  assert.deepEqual(JSON.parse(e.valores.get('posiciones::congregacion-a')),{});
  assert.deepEqual(copia(e.contexto.colorAreaSettings),dibujos);
});

test('un undo antiguo sin campo de posición conserva el marco movido', () => {
  const e = entorno(); e.contexto.framePositionSettings['custom-1'] = {lat:20,lng:-98};
  const snapshot = copia(e.contexto.getCurrentSnapshot('colors'));
  delete snapshot.framePosition; e.contexto.undoHistory.push(snapshot); e.undo();
  assert.deepEqual(copia(e.contexto.framePositionSettings),{'custom-1':{lat:20,lng:-98}});
});

test('el PDF respeta el marco colocado manualmente aunque haya áreas pintadas en otra posición', () => {
  const e = entorno(), loc = e.contexto.LOCS[0];
  const antes = copia(e.contexto.getExportBoundsPlain(loc));
  assert.notDeepEqual(antes,e.bounds());
  assert.equal(e.mover({lat:20,lng:-98}),true);
  assert.deepEqual(copia(e.contexto.getExportBoundsPlain(loc)),e.bounds());
});

test('referencias descargadas para el centro anterior no se reutilizan después de mover', () => {
  const e = entorno(), loc = e.contexto.LOCS[0];
  const original = e.contexto.getRuntimeRoadCacheKey(loc);
  assert.equal(original,String(loc.num));
  assert.equal(e.mover({lat:20,lng:-98}),true);
  const movido = e.contexto.getRuntimeRoadCacheKey(loc);
  assert.notEqual(movido,original);
  assert.equal(e.mover({lat:21,lng:-99}),true);
  assert.notEqual(e.contexto.getRuntimeRoadCacheKey(loc),movido);
});

test('la misma clave de territorio guarda centros independientes en cada congregación', () => {
  const e = entorno(); assert.equal(e.mover({lat:20,lng:-98}),true);
  e.contexto.congregacionActivaId = 'congregacion-b';
  e.contexto.framePositionSettings = e.contexto.loadFramePositionSettings();
  assert.equal(e.mover({lat:21,lng:-99}),true);
  e.contexto.congregacionActivaId = 'congregacion-a';
  e.contexto.framePositionSettings = e.contexto.loadFramePositionSettings();
  assert.deepEqual(copia(e.contexto.framePositionSettings),{'custom-1':{lat:20,lng:-98}});
  assert.deepEqual(JSON.parse(e.valores.get('posiciones::congregacion-b')),{'custom-1':{lat:21,lng:-99}});
});

test('Restablecer y Deshacer recuperan juntos posición y tamaño sin cambiar otros territorios', () => {
  const e = entorno();
  e.contexto.frameScaleSettings = {'custom-1':145,'2':80};
  e.contexto.framePositionSettings = {'custom-1':{lat:20,lng:-98},'2':{lat:21,lng:-99}};
  const antes = e.bounds();
  e.contexto.resetFrameForCurrent();
  assert.deepEqual(copia(e.contexto.framePositionSettings),{'2':{lat:21,lng:-99}});
  assert.deepEqual(copia(e.contexto.frameScaleSettings),{'2':80});
  assert.equal(e.contexto.undoHistory.length,1);
  assert.equal(e.contexto.undoHistory[0].frameScale,145);
  assert.equal(e.llamadas.filter(x => x.publish).length,1);
  e.undo();
  assert.deepEqual(e.bounds(),antes);
  assert.deepEqual(copia(e.contexto.frameScaleSettings),{'custom-1':145,'2':80});
  assert.deepEqual(copia(e.contexto.framePositionSettings),{'custom-1':{lat:20,lng:-98},'2':{lat:21,lng:-99}});
});

test('un fallo al restablecer el tamaño revierte también el centro ya persistido', () => {
  const previo = {'custom-1':{lat:20,lng:-98}};
  const e = entorno({guardados:{'posiciones::congregacion-a':JSON.stringify(previo)}});
  e.contexto.frameScaleSettings['custom-1'] = 145;
  const antes = e.bounds(); e.fallarGuardarEscala(); e.contexto.resetFrameForCurrent();
  assert.deepEqual(e.bounds(),antes);
  assert.deepEqual(copia(e.contexto.framePositionSettings),previo);
  assert.deepEqual(JSON.parse(e.valores.get('posiciones::congregacion-a')),previo);
  assert.equal(e.contexto.frameScaleSettings['custom-1'],145);
  assert.equal(e.contexto.undoHistory.length,0);
  assert.equal(e.llamadas.filter(x => x.publish).length,0);
  assert.equal(e.avisos.at(-1).tipo,'error');
});

function prepararSesion(e){
  const c = e.contexto, loc = c.LOCS[c.currentIndex];
  c.frameMoveMode = true;
  c.frameMoveSession = {num:String(loc.num), congregacionId:c.congregacionActivaId,
    scale:c.getFrameScaleForLoc(loc), fingerprint:c.stateFingerprint(c.normalizeFramePosition(c.framePositionSettings[String(loc.num)]))};
  return c.frameMoveSession;
}

test('un marcador pertenece a una sola sesión activa del territorio', () => {
  const e = entorno(), session = prepararSesion(e);
  assert.equal(e.contexto.isFrameMoveSessionCurrent(session),true);
  assert.equal(e.contexto.isFrameMoveSessionCurrent({...session}),false);
  assert.equal(e.contexto.isFrameMoveSessionCurrent(null),false);
});

for(const [motivo, modificar] of [
  ['cerrar el modo', c => { c.frameMoveMode = false; }],
  ['abrir otro territorio', c => { c.currentIndex = 1; }],
  ['cambiar de congregación', c => { c.congregacionActivaId = 'congregacion-b'; }],
  ['recibir otro centro', c => { c.framePositionSettings['custom-1'] = {lat:20,lng:-98}; }],
  ['cambiar el tamaño', c => { c.frameScaleSettings['custom-1'] = 145; }],
  ['crear una nueva sesión', c => { c.frameMoveSession = {...c.frameMoveSession}; }]
]){
  test(`el arrastre pendiente se invalida al ${motivo}`, () => {
    const e = entorno(), session = prepararSesion(e);
    modificar(e.contexto);
    assert.equal(e.contexto.isFrameMoveSessionCurrent(session),false);
    assert.equal(e.escrituras.length,0);
    assert.equal(e.contexto.undoHistory.length,0);
  });
}

test('la sincronización publica el centro y tamaño en el espacio de la congregación activa', async () => {
  const e = entorno();
  e.contexto.framePositionSettings['custom-1'] = {lat:20,lng:-98};
  e.contexto.frameScaleSettings['custom-1'] = 135;
  e.conectar(); await e.contexto.publicarTerritorio(e.contexto.LOCS[0]);
  assert.deepEqual(copia(e.enviados[0].ref),['congregaciones','congregacion-a','territorios','custom-1']);
  const datos = JSON.parse(e.enviados[0].datos.datos);
  assert.deepEqual(datos.centroRecuadro,{lat:20,lng:-98}); assert.equal(datos.recuadro,135);
  assert.deepEqual(datos.areas,copia(e.contexto.colorAreaSettings['custom-1']));
});

test('una posición compartida se persiste; el tamaño remoto nulo recupera 100%, evitando 55%', () => {
  const e = entorno(); e.contexto.frameScaleSettings['custom-1'] = 145;
  e.recibir({recuadro:null,centroRecuadro:{lat:20,lng:-98}});
  assert.deepEqual(copia(e.contexto.framePositionSettings['custom-1']),{lat:20,lng:-98});
  assert.equal(e.contexto.getFrameScaleForLoc(e.contexto.LOCS[0]),100);
  assert.deepEqual(JSON.parse(e.valores.get('posiciones::congregacion-a')),{'custom-1':{lat:20,lng:-98}});
});

test('un documento antiguo sin centro mantiene la posición local y un centro nulo la restablece', () => {
  const e = entorno(); e.contexto.framePositionSettings['custom-1'] = {lat:20,lng:-98};
  e.recibir({recuadro:130});
  assert.deepEqual(copia(e.contexto.framePositionSettings['custom-1']),{lat:20,lng:-98});
  e.recibir({recuadro:null,centroRecuadro:null});
  assert.equal(e.contexto.framePositionSettings['custom-1'],undefined);
  assert.equal(e.contexto.getFrameScaleForLoc(e.contexto.LOCS[0]),100);
});

test('un cambio remoto recibido durante el arrastre invalida la sesión sin mover el mapa bajo el dedo', () => {
  const e = entorno(), session = prepararSesion(e);
  e.recibir({recuadro:100,centroRecuadro:{lat:20,lng:-98}});
  assert.equal(e.contexto.isFrameMoveSessionCurrent(session),false);
  assert.equal(e.llamadas.filter(x => x.draw).length,0);
  assert.match(e.avisos.at(-1).texto,/Termina o cancela/);
  assert.equal(e.contexto.undoHistory.length,0);
});

function publicacionDiferida(e){
  const timers = new Map(), publicaciones = []; let siguiente = 0;
  const c = e.contexto;
  c.nube = {}; c.publicarPendiente = null;
  c.setTimeout = fn => { const id = ++siguiente; timers.set(id,fn); return id; };
  c.clearTimeout = id => timers.delete(id);
  c.publicarTerritorio = loc => publicaciones.push({num:loc.num,congregacion:c.congregacionActivaId});
  vm.runInContext(funcion('publicarTerritorioPronto'),c);
  return {timers,publicaciones};
}

test('una publicación pendiente no envía el recuadro de una congregación a otra', () => {
  const e = entorno(), {timers,publicaciones} = publicacionDiferida(e);
  e.contexto.publicarTerritorioPronto(e.contexto.LOCS[0]);
  assert.equal(timers.size,1);
  e.contexto.congregacionActivaId = 'congregacion-b';
  [...timers.values()][0]();
  assert.deepEqual(publicaciones,[]);
});

test('la publicación diferida combina movimientos repetidos y envía solo el territorio más reciente', () => {
  const e = entorno(), {timers,publicaciones} = publicacionDiferida(e);
  e.contexto.publicarTerritorioPronto(e.contexto.LOCS[0]);
  e.contexto.publicarTerritorioPronto(e.contexto.LOCS[1]);
  assert.equal(timers.size,1);
  [...timers.values()][0]();
  assert.deepEqual(publicaciones,[{num:2,congregacion:'congregacion-a'}]);
});
