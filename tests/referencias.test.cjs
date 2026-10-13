const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '../outputs/croquis_territorios.html'), 'utf8');
function funcion(nombre){
  const inicio = html.indexOf(`function ${nombre}(`);
  assert(inicio >= 0, `Funcion disponible: ${nombre}`);
  const apertura = html.indexOf('{', inicio);
  let nivel = 0, comilla = null;
  for(let i = apertura; i < html.length; i++){
    const actual = html[i], siguiente = html[i + 1];
    if(comilla){
      if(actual === '\\'){ i++; continue; }
      if(actual === comilla) comilla = null;
      continue;
    }
    if(actual === '/' && siguiente === '/'){ i = html.indexOf('\n', i); continue; }
    if(actual === '/' && siguiente === '*'){ i = html.indexOf('*/', i + 2) + 1; continue; }
    if(actual === '"' || actual === "'" || actual === '`'){ comilla = actual; continue; }
    if(actual === '{') nivel++;
    if(actual === '}' && --nivel === 0) return html.slice(inicio, i + 1);
  }
  throw new Error(`Funcion incompleta: ${nombre}`);
}
const funciones = ['referenciasAutomaticasDeLoc', 'tiposDeIconoEn',
  'nombrePorDefectoDeIcono', 'referenciasDeLoc', 'construirLeyendaIconos'].map(funcion).join('\n');
const copiar = valor => JSON.parse(JSON.stringify(valor));
const referencia = (kind, opciones = {}) => ({kind, name:`Lugar ${kind}`, lat:19.3, lng:-97.2, ...opciones});
const clave = ref => `${ref.name}@${ref.lat},${ref.lng}`;
const escapar = texto => String(texto).replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));

function entorno(opciones = {}){
  const automaticas = opciones.automaticas || {};
  const manuales = opciones.manuales || {};
  const ocultas = opciones.ocultas || {};
  const lecturas = [];
  const contexto = vm.createContext({
    congregacionActivaId:'principal', runtimeReferenceCache:opciones.runtime || null,
    leyendaSettings:opciones.leyendas || {},
    MANUAL_ICON_OPTIONS:[['Escuela','Escuela'], ['Iglesia','Iglesia / templo'], ['Comercio','Tienda / comercio']],
    getRuntimeRoadCacheKey:loc => String(loc.num),
    readOverpassCache:(loc, campo) => {
      lecturas.push({num:loc.num, campo});
      return automaticas[loc.num] || null;
    },
    getManualIconsForLoc:loc => manuales[loc.num] || [],
    getHiddenReferencesForLoc:loc => new Set(ocultas[loc.num] || []),
    referenceKey:clave,
    referenceLabelText:ref => String(ref.name || ref.kind || '').trim(),
    isCoveredByManualIcon:ref => !!ref.covered,
    referenceIconSvg:ref => `<svg data-kind="${escapar(ref.kind)}"></svg>`,
    escapeHtml:escapar
  });
  vm.runInContext(funciones, contexto);
  return {contexto, lecturas};
}

test('Las referencias automaticas del mapa no crean opciones ni una leyenda sin iconos manuales', () => {
  const refs = [referencia('Escuela'), referencia('Iglesia')];
  const e = entorno({runtime:{key:'ref:1', congregationId:'principal', references:refs}});
  assert.equal(e.contexto.referenciasAutomaticasDeLoc({num:1}),refs,
    'The map keeps its loaded automatic references');
  assert.deepEqual(copiar(e.contexto.referenciasDeLoc({num:1})),[]);
  assert.equal(e.contexto.construirLeyendaIconos({num:1}), '');
  assert.equal(e.lecturas.length, 0);
});

test('Combina iconos manuales y automaticos sin repetir un tipo', () => {
  const e = entorno({
    manuales:{1:[referencia('Escuela'), referencia('Escuela')]},
    automaticas:{1:[referencia('Escuela'), referencia('Iglesia'), referencia('Iglesia')]}
  });
  assert.deepEqual(copiar(e.contexto.tiposDeIconoEn({num:1})), ['Escuela','Iglesia']);
});

test('No ofrece referencias automaticas ocultadas ni reemplazadas por iconos manuales', () => {
  const oculta = referencia('Comercio');
  const e = entorno({
    manuales:{1:[referencia('Escuela')]},
    automaticas:{1:[oculta, referencia('Iglesia',{covered:true}), referencia('Escuela')]},
    ocultas:{1:[clave(oculta)]}
  });
  assert.deepEqual(copiar(e.contexto.tiposDeIconoEn({num:1})), ['Escuela']);
});

test('Descarta iconos con coordenadas invalidas y referencias sin rotulo', () => {
  const e = entorno({
    manuales:{1:[referencia('Escuela',{lat:NaN}), referencia('Iglesia')]},
    automaticas:{1:[referencia('Comercio',{lng:Infinity}), referencia('',{name:' '})]}
  });
  assert.deepEqual(copiar(e.contexto.tiposDeIconoEn({num:1})), ['Iglesia']);
});

test('El PDF de un territorio inactivo usa su cache propia', () => {
  const e = entorno({
    runtime:{key:'ref:1', congregationId:'principal', references:[referencia('Iglesia')]},
    automaticas:{2:[referencia('Escuela')]}
  });
  assert.deepEqual(copiar(e.contexto.tiposDeIconoEn({num:2})), ['Escuela']);
  assert.deepEqual(e.lecturas, [{num:2,campo:'refs'}]);
});

test('No usa referencias de otra congregacion aunque coincida el numero de territorio', () => {
  const e = entorno({
    runtime:{key:'ref:1', congregationId:'otra', references:[referencia('Iglesia')]},
    automaticas:{1:[referencia('Escuela')]}
  });
  assert.deepEqual(copiar(e.contexto.tiposDeIconoEn({num:1})), ['Escuela']);
  assert.deepEqual(e.lecturas, [{num:1,campo:'refs'}]);
});

test('Las referencias offline siguen disponibles para el mapa y quedan fuera del cuadro de referencias', () => {
  const refs = [referencia('Comercio')];
  const e = entorno({runtime:{key:'ref:4', congregationId:'principal', references:refs, offline:true}});
  assert.equal(e.contexto.referenciasAutomaticasDeLoc({num:4}), refs);
  assert.equal(e.contexto.construirLeyendaIconos({num:4}), '');
  assert.deepEqual(copiar(e.contexto.referenciasDeLoc({num:4})),[]);
});

test('Respeta nombres y seleccion guardados para iconos manuales y no revive tipos automaticos antiguos', () => {
  const e = entorno({manuales:{1:[referencia('Escuela'),referencia('Escuela'),referencia('Iglesia')]},
    automaticas:{1:[referencia('Escuela'), referencia('Comercio')]}, leyendas:{1:{
    Escuela:{nombre:'Escuela del pueblo <Norte>',ver:true}, Iglesia:{nombre:'Templo',ver:false},
    Comercio:{nombre:'Comercio automatico guardado',ver:true}
  }}});
  const filas = copiar(e.contexto.referenciasDeLoc({num:1}));
  assert.deepEqual(filas, [
    {kind:'Escuela',nombre:'Escuela del pueblo <Norte>',ver:true},
    {kind:'Iglesia',nombre:'Templo',ver:false}
  ]);
  const leyenda = e.contexto.construirLeyendaIconos({num:1});
  assert.match(leyenda, /Escuela del pueblo &lt;Norte&gt;/);
  assert.doesNotMatch(leyenda, /Templo|data-kind="Iglesia"|Comercio|data-kind="Comercio"/);
  assert.equal((leyenda.match(/data-kind="Escuela"/g) || []).length,1);
  assert.deepEqual(e.lecturas,[],'Building the manual legend never reads provider reference caches');
});

test('Las referencias automaticas entregadas al finalizar el PDF no agregan ni quitan tipos manuales', () => {
  const e = entorno({manuales:{1:[referencia('Escuela')]},
    runtime:{key:'ref:1', congregationId:'principal', references:[referencia('Iglesia')]}});
  const leyenda = e.contexto.construirLeyendaIconos({num:1}, [referencia('Iglesia')]);
  assert.match(leyenda, /data-kind="Escuela"/);
  assert.doesNotMatch(leyenda, /data-kind="Iglesia"/);
  assert.deepEqual(copiar(e.contexto.referenciasDeLoc({num:1},[referencia('Iglesia')])),[
    {kind:'Escuela',nombre:'Escuela',ver:true}
  ]);
});

test('La leyenda de cada recuadro usa sus propios iconos manuales y no los del editor activo', () => {
  const e = entorno({manuales:{1:[referencia('Iglesia')],2:[referencia('Escuela')]},
    runtime:{key:'ref:1',congregationId:'principal',references:[referencia('Comercio')]},
    automaticas:{2:[referencia('Iglesia')]},leyendas:{2:{Escuela:{nombre:'Escuela de localidad 2',ver:true}}}});
  const leyenda = e.contexto.construirLeyendaIconos({num:2});
  assert.match(leyenda,/Escuela de localidad 2/);
  assert.doesNotMatch(leyenda,/Iglesia|Comercio/);
  assert.deepEqual(e.lecturas,[]);
});

test('Cambiar de congregacion no mezcla iconos ni nombres de referencias de otro espacio', () => {
  const iconos = {principal:{1:[referencia('Escuela')]},otra:{1:[referencia('Iglesia')]}};
  const ajustes = {principal:{1:{Escuela:{nombre:'Escuela propia',ver:true}}},
    otra:{1:{Iglesia:{nombre:'Templo propio',ver:true}}}};
  const before = JSON.stringify({iconos,ajustes});
  const e = entorno({runtime:{key:'ref:1',congregationId:'principal',references:[referencia('Comercio')]}});
  e.contexto.getManualIconsForLoc = loc => iconos[e.contexto.congregacionActivaId][loc.num] || [];
  e.contexto.leyendaSettings = ajustes.principal;
  assert.match(e.contexto.construirLeyendaIconos({num:1}),/Escuela propia/);
  // The congregation loader replaces its scoped state before the legend is built.
  e.contexto.congregacionActivaId = 'otra';
  e.contexto.leyendaSettings = ajustes.otra;
  const leyenda = e.contexto.construirLeyendaIconos({num:1});
  assert.match(leyenda,/Templo propio/);
  assert.doesNotMatch(leyenda,/Escuela propia|Comercio/);
  assert.deepEqual(e.lecturas,[],'Legend construction never reads another provider namespace');
  assert.equal(JSON.stringify({iconos,ajustes}),before,'Printing does not modify either congregation state');
});

test('El perfil de la lamina reserva espacio solo para los tipos manuales visibles en la leyenda', () => {
  const e = entorno({manuales:{1:[referencia('Escuela'),referencia('Escuela'),referencia('Iglesia')]},
    automaticas:{1:[referencia('Comercio')],2:[referencia('Comercio'),referencia('Escuela')]},
    leyendas:{1:{Iglesia:{ver:false}}}});
  Object.assign(e.contexto,{DETAIL_ZOOM:17,getExportColorAreasForLoc:() => [],
    getExportBoundsPlain:() => ({south:19.1,north:19.2,west:-97.3,east:-97.2}),
    getTextLabelsForLoc:() => [],isPrintZoneNumber:() => false});
  vm.runInContext(funcion('perfilDeCroquisParaLamina'),e.contexto);
  assert.equal(e.contexto.perfilDeCroquisParaLamina({num:1}).references,1,
    'Repeated manual kinds count once; hidden manual kinds and automatic references add no space');
  assert.equal(e.contexto.perfilDeCroquisParaLamina({num:2}).references,0,
    'A map without manual references reserves no legend space even when provider POIs are loaded');
  assert.deepEqual(e.lecturas,[]);
});

test('Un territorio sin referencias o con todas desmarcadas no imprime una caja vacia', () => {
  const sinReferencias = entorno();
  assert.equal(sinReferencias.contexto.construirLeyendaIconos({num:1}), '');
  const desmarcadas = entorno({manuales:{1:[referencia('Escuela')]},leyendas:{1:{Escuela:{ver:false}}}});
  assert.equal(desmarcadas.contexto.construirLeyendaIconos({num:1}), '');
});

test('Un encuadre distinto no reutiliza las referencias del recuadro anterior', () => {
  const e = entorno({
    runtime:{key:'ref:1@19.3,-97.2', congregationId:'principal', references:[referencia('Iglesia')]},
    automaticas:{1:[referencia('Escuela')]}
  });
  e.contexto.getRuntimeRoadCacheKey = loc => `${loc.num}@19.5,-97.4`;
  assert.deepEqual(copiar(e.contexto.tiposDeIconoEn({num:1})), ['Escuela']);
  assert.deepEqual(e.lecturas, [{num:1,campo:'refs'}]);
});

function overlayEntorno(offline = false){
  let resolver;
  const pendiente = new Promise(resolve => { resolver = resolve; });
  const guardadas = [], dibujadas = [], descargas = [];
  let limpiezas = 0;
  const contexto = vm.createContext({
    map:{}, runtimeReferenceLayer:{clearLayers:() => { limpiezas++; }},
    runtimeReferenceRequestId:0, runtimeReferenceCache:null,
    congregacionActivaId:'principal', currentView:offline ? 'offline' : 'online',LOCS:[{num:1}],currentIndex:0,
    getRuntimeRoadCacheKey:loc => String(loc.num),
    getRuntimeRoadBounds:loc => ({territorio:loc.num}),
    readOverpassCache:() => null,
    fetchReferencesForBounds:() => pendiente,
    writeOverpassCache:(...args) => guardadas.push(args),
    drawRuntimeReferences:refs => dibujadas.push(refs),
    dedupeReferences:refs => refs,
    window:{CroquisOfflineData:{get:(...args) => { descargas.push(args); return pendiente; }}},
    console
  });
  vm.runInContext('async ' + funcion('updateRuntimeReferenceOverlay'), contexto);
  return {contexto, resolver, guardadas, dibujadas, descargas, limpiezas:() => limpiezas};
}

test('Una respuesta online tardia no guarda ni dibuja referencias en otra congregacion', async () => {
  const e = overlayEntorno();
  const carga = e.contexto.updateRuntimeReferenceOverlay({num:1});
  assert.equal(e.contexto.runtimeReferenceRequestId, 1);
  e.contexto.congregacionActivaId = 'otra';
  e.resolver([referencia('Iglesia')]);
  await carga;
  // El número de solicitud no cambió: debe comprobar también la congregación.
  assert.equal(e.contexto.runtimeReferenceRequestId, 1);
  assert.equal(e.contexto.runtimeReferenceCache, null);
  assert.deepEqual(e.guardadas, []);
  assert.deepEqual(e.dibujadas, []);
  assert.equal(e.limpiezas(), 1);
});

test('Una lectura offline tardia tampoco cruza referencias entre congregaciones', async () => {
  const e = overlayEntorno(true);
  const carga = e.contexto.updateRuntimeReferenceOverlay({num:1});
  assert.deepEqual(e.descargas, [['principal','1']]);
  e.contexto.congregacionActivaId = 'otra';
  e.resolver({refs:[referencia('Escuela')]});
  await carga;
  assert.equal(e.contexto.runtimeReferenceCache, null);
  assert.deepEqual(e.guardadas, []);
  assert.deepEqual(e.dibujadas, []);
});

test('Una respuesta vigente identifica la congregacion propietaria de su cache', async () => {
  const e = overlayEntorno();
  const refs = [referencia('Escuela')];
  const loc = {num:1};
  const carga = e.contexto.updateRuntimeReferenceOverlay(loc);
  e.resolver(refs);
  await carga;
  assert.deepEqual(copiar(e.contexto.runtimeReferenceCache), {
    key:'ref:1', congregationId:'principal', references:refs
  });
  assert.deepEqual(e.guardadas, [[loc,'refs',refs]]);
  assert.deepEqual(e.dibujadas, [refs]);
});
