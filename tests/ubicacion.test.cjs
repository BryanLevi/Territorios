const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '../outputs/croquis_territorios.html'), 'utf8');
const codigo = html.slice(html.indexOf('const UBICACION_OPCIONES'), html.indexOf("locSel.addEventListener('change'"));
const navegar = html.slice(html.indexOf('function goTo('), html.indexOf('function navigate('));

function entorno({ confirmar = false, alConfirmar = () => {}, seguro = true, geolocalizacion = true } = {}){
  const peticiones = [], vigias = [], cancelados = [], avisos = [], capas = [], encuadres = [], preguntas = [];
  const temporizadores = new Map();
  let siguienteTemporizador = 0;
  const nodos = new Map();
  const $ = id => {
    if(!nodos.has(id)) nodos.set(id, {
      hidden:true, textContent:'',
      classList:{ toggle(){} }, setAttribute(){},
      addEventListener(evento, funcion){ this[evento] = funcion; }
    });
    return nodos.get(id);
  };
  const map = {
    centro:null, zoom:14,
    getZoom(){ return this.zoom; },
    setView(punto, zoom){ this.centro = Array.from(punto); this.zoom = zoom; return this; },
    stop(){ return this; }, invalidateSize(){ return this; }, distance(){ return 100; }, removeLayer(){}
  };
  const L = {
    layerGroup(){
      const capa = { elementos:[], addTo(){ capas.push(this); return this; }, clearLayers(){ this.elementos = []; } };
      return capa;
    },
    divIcon(opciones){ return opciones; },
    marker(punto){ return { addTo(capa){ capa.elementos.push({ tipo:'punto', punto:Array.from(punto) }); } }; },
    circle(punto){ return { addTo(capa){ capa.elementos.push({ tipo:'precision', punto:Array.from(punto) }); } }; }
  };
  const geo = {
    getCurrentPosition(exito, error, opciones){ peticiones.push({ exito, error, opciones }); },
    watchPosition(exito, error, opciones){ const id = vigias.length; vigias.push({ exito, error, opciones }); return id; },
    clearWatch(id){ cancelados.push(id); }
  };
  const noOp = () => {};
  const contexto = vm.createContext({
    navigator:{ geolocation:geolocalizacion ? geo : null },
    window:{ L, isSecureContext:seguro, confirm:texto => { preguntas.push(texto); alConfirmar(map); return confirmar; } },
    setTimeout(funcion, demora){ const id = ++siguienteTemporizador; temporizadores.set(id, { funcion, demora }); return id; },
    clearTimeout(id){ temporizadores.delete(id); },
    location:{ hostname:seguro ? 'localhost' : 'ejemplo.test' },
    map, L, $, currentIndex:0, locSel:{ value:'0' },
    LOCS:[{ num:1, name:'Abierto', lat:10, lon:10 }, { num:2, name:'Destino', lat:19.06, lon:-96.97 }],
    colorDrawMode:false, roadPencilMode:false, riverPencilMode:false, contourEditMode:false,
    textAddMode:false, iconAddMode:false, territoryAddMode:false,
    getExportColorAreasForLoc:loc => loc.num === 2 ? [{ points:[[19,-97],[19.1,-97],[19.1,-96.9],[19,-96.9]] }] : [],
    getTextLabelsForLoc:loc => loc.num === 2 ? [{ text:'3', lat:19.05, lng:-96.95 }] : [],
    displayTerritoryName:loc => loc.name,
    drawTerritoryFrame(loc, fit){ encuadres.push(fit); if(fit) map.setView([loc.lat, loc.lon], 12); },
    setStatus(texto, tipo){ avisos.push({ texto, tipo }); },
    localStorage:new Proxy({}, { get(){ throw new Error('La ubicación no debe persistirse'); } }),
    updateInfo:noOp, updateFrameControls:noOp, renderColorAreas:noOp, renderManualWhiteRoads:noOp,
    renderManualRivers:noOp, renderTextLabels:noOp, renderManualIcons:noOp,
    updateColorControls:noOp, updateButtons:noOp
  });
  vm.runInContext(navegar + codigo, contexto);
  return { contexto, map, $, peticiones, vigias, cancelados, avisos, capas, encuadres, preguntas, temporizadores,
    agotarEspera:() => { const [id, temporizador] = temporizadores.entries().next().value; temporizadores.delete(id); temporizador.funcion(); },
    clic:() => $('btn-ubicacion').click(), detener:() => $('btn-ubicacion-stop').click() };
}
let secuencia = 0;
const posicion = (lat = 20, lng = -99, opciones = {}) => {
  const { coords, ...otros } = opciones;
  return { coords:{ latitude:lat, longitude:lng, accuracy:8, ...coords },
    timestamp:Date.now() - 1000 + ++secuencia, ...otros };
};

test('el primer clic pide una lectura actual y centra el punto del dispositivo', () => {
  const e = entorno();
  e.clic();
  assert.equal(e.vigias.length, 1);
  assert.equal(e.peticiones[0].opciones.maximumAge, 0);
  assert.equal(e.peticiones[0].opciones.enableHighAccuracy, true);
  e.peticiones[0].exito(posicion());
  assert.deepEqual(e.map.centro, [20,-99]);
  assert.equal(e.map.zoom, 17);
  assert.equal(e.vigias.length, 1);
  assert.equal(e.$('btn-ubicacion-stop').hidden, false);
  assert.equal(e.temporizadores.size, 0);
  assert.deepEqual(e.capas[0].elementos.find(x => x.tipo === 'punto').punto, [20,-99]);
});

test('centra antes del diálogo y abrir el territorio conserva la ubicación', () => {
  const e = entorno({ confirmar:true, alConfirmar:map => assert.deepEqual(map.centro, [19.05,-96.95]) });
  e.clic();
  e.peticiones[0].exito(posicion(19.05,-96.95));
  assert.equal(e.contexto.currentIndex, 1);
  assert.deepEqual(e.encuadres, [false]);
  assert.deepEqual(e.map.centro, [19.05,-96.95]);
  assert.match(e.avisos.find(x => x.texto.includes('zona 3')).texto, /Destino/);
});

test('cada clic vuelve a localizar; las lecturas canceladas no mueven el mapa', () => {
  const e = entorno();
  e.clic(); e.peticiones[0].exito(posicion());
  e.clic();
  assert.deepEqual(e.cancelados, [0]);
  assert.equal(e.peticiones.length, 2);
  e.peticiones[1].exito(posicion(21,-100));
  e.vigias[0].exito(posicion(22,-101));
  assert.deepEqual(e.map.centro, [21,-100]);
  assert.equal(e.$('btn-ubicacion-texto').textContent, 'Mi ubicación');
});

test('localizar mientras se agrega texto no cambia ni cancela el territorio en edición', () => {
  const e = entorno({ confirmar:true });
  e.contexto.textAddMode = true;
  e.clic(); e.peticiones[0].exito(posicion(19.05,-96.95));
  assert.equal(e.contexto.currentIndex, 0);
  assert.equal(e.contexto.textAddMode, true);
  assert.deepEqual(e.map.centro, [19.05,-96.95]);
  assert.match(e.avisos.at(-1).texto, /medio dibujar/);
});

test('arrastrar permite explorar y el siguiente clic busca una posición nueva', () => {
  const e = entorno();
  e.clic(); e.peticiones[0].exito(posicion());
  vm.runInContext('ubicacionSigue = false', e.contexto);
  e.vigias[0].exito(posicion(21,-100));
  assert.deepEqual(e.map.centro, [20,-99]);
  assert.equal(e.$('btn-ubicacion-texto').textContent, 'Volver a mí');
  e.clic(); e.peticiones[1].exito(posicion(22,-101));
  assert.deepEqual(e.map.centro, [22,-101]);
});

test('Detener cancela tanto la petición pendiente como el seguimiento', () => {
  const e = entorno();
  e.clic(); e.detener(); e.peticiones[0].exito(posicion());
  assert.equal(e.map.centro, null);
  assert.equal(e.vigias.length, 1);
  assert.equal(e.temporizadores.size, 0);
  e.clic(); e.peticiones[1].exito(posicion()); e.detener();
  e.vigias[1].exito(posicion(21,-100));
  assert.deepEqual(e.map.centro, [20,-99]);
  assert.equal(e.capas[0].elementos.length, 0);
  assert.equal(e.$('btn-ubicacion-stop').hidden, true);
});

test('dos clics pendientes solo admiten la respuesta de la última petición', () => {
  const e = entorno();
  e.clic(); e.clic();
  e.peticiones[1].exito(posicion(21,-100));
  e.peticiones[0].exito(posicion());
  assert.deepEqual(e.map.centro, [21,-100]);
  assert.equal(e.vigias.length, 2);
});

test('un timeout del seguimiento permite recuperarse y el permiso denegado lo apaga', () => {
  const e = entorno();
  e.clic(); e.peticiones[0].exito(posicion());
  e.vigias[0].error({ code:3 });
  assert.equal(e.cancelados.length, 0);
  e.vigias[0].exito(posicion(21,-100));
  assert.deepEqual(e.map.centro, [21,-100]);
  e.vigias[0].error({ code:1 });
  assert.deepEqual(e.cancelados, [0]);
  assert.match(e.avisos.at(-1).texto, /bloqueado el permiso/);
  assert.equal(e.capas[0].elementos.length, 0);
});

test('sin API, sin contexto seguro o con coordenadas inválidas no inventa una ubicación', () => {
  for(const opciones of [{ geolocalizacion:false }, { seguro:false }]){
    const e = entorno(opciones); e.clic();
    assert.equal(e.peticiones.length, 0);
    assert.equal(e.map.centro, null);
    assert.equal(e.avisos.at(-1).tipo, 'error');
  }
  const e = entorno(); e.clic(); e.peticiones[0].exito(posicion(NaN,-99));
  assert.equal(e.map.centro, null);
  assert.equal(e.vigias.length, 1);
  assert.equal(e.capas.length, 0);
});

test('una lectura de kilómetros de margen no mueve el mapa ni propone un territorio', () => {
  const e = entorno({ confirmar:true }); e.clic();
  e.peticiones[0].exito(posicion(19.05,-96.95, { coords:{ latitude:19.05, longitude:-96.95, accuracy:10000 } }));
  assert.equal(e.map.centro, null);
  assert.equal(e.capas.length, 0);
  assert.equal(e.contexto.currentIndex, 0);
  assert.equal(e.preguntas.length, 0);
  assert.match(e.avisos.at(-1).texto, /demasiado aproximada/);
  assert.equal(e.$('ubicacion-estado').hidden, false);
  assert.match(e.$('ubicacion-estado').textContent, /demasiado aproximada/);
  assert.equal(e.temporizadores.size, 1);
  e.vigias[0].exito(posicion(19.05,-96.95));
  assert.deepEqual(e.map.centro, [19.05,-96.95]);
  assert.equal(e.contexto.currentIndex, 1);
  assert.equal(e.preguntas.length, 1);
  assert.equal(e.temporizadores.size, 0);
});

test('se exige una precisión conocida de hasta 50 metros antes de centrar', () => {
  for(const accuracy of [undefined, NaN, Infinity, -1, 51]){
    const e = entorno(); e.clic();
    const lectura = posicion(); lectura.coords.accuracy = accuracy;
    e.peticiones[0].exito(lectura);
    assert.equal(e.map.centro, null);
    assert.equal(e.capas.length, 0);
    assert.equal(e.cancelados.length, 0);
  }
  for(const accuracy of [0, 50]){
    const e = entorno(); e.clic();
    const lectura = posicion(); lectura.coords.accuracy = accuracy;
    e.vigias[0].exito(lectura);
    assert.deepEqual(e.map.centro, [20,-99]);
  }
});

test('las lecturas antiguas, sin fecha o con fecha futura no se usan como ubicación actual', () => {
  for(const timestamp of [Date.now() - 20000, undefined, NaN, Date.now() + 10000]){
    const e = entorno(); e.clic();
    e.peticiones[0].exito(posicion(21,-100, { timestamp }));
    assert.equal(e.map.centro, null);
    assert.equal(e.capas.length, 0);
    assert.match(e.avisos.at(-1).texto, /no es reciente/);
    e.vigias[0].exito(posicion());
    assert.deepEqual(e.map.centro, [20,-99]);
  }
});

test('una lectura posterior imprecisa conserva el último punto válido', () => {
  const e = entorno(); e.clic(); e.peticiones[0].exito(posicion());
  const lectura = posicion(21,-100); lectura.coords.accuracy = 5000;
  e.vigias[0].exito(lectura);
  assert.deepEqual(e.map.centro, [20,-99]);
  assert.deepEqual(e.capas[0].elementos.find(x => x.tipo === 'punto').punto, [20,-99]);
  assert.match(e.avisos.at(-1).texto, /última ubicación válida/);
  assert.equal(e.cancelados.length, 0);
});

test('una respuesta atrasada no reemplaza una lectura más reciente', () => {
  const e = entorno(); e.clic();
  const lectura = posicion(); e.vigias[0].exito(lectura);
  e.peticiones[0].exito(posicion(21,-100, { timestamp:lectura.timestamp - 1 }));
  e.vigias[0].exito(posicion(22,-101, { timestamp:lectura.timestamp }));
  assert.deepEqual(e.map.centro, [20,-99]);
});

test('un timeout inicial mantiene la búsqueda para recibir una lectura precisa', () => {
  const e = entorno(); e.clic(); e.peticiones[0].error({ code:3 });
  assert.equal(e.map.centro, null);
  assert.equal(e.cancelados.length, 0);
  assert.equal(e.temporizadores.size, 1);
  e.vigias[0].exito(posicion());
  assert.deepEqual(e.map.centro, [20,-99]);
  assert.equal(e.temporizadores.size, 0);
});

test('si no llega precisión suficiente en 45 segundos cancela sin inventar un punto', () => {
  const e = entorno(); e.clic();
  const lectura = posicion(); lectura.coords.accuracy = 8000;
  e.vigias[0].exito(lectura);
  assert.equal([...e.temporizadores.values()][0].demora, 45000);
  e.agotarEspera();
  assert.deepEqual(e.cancelados, [0]);
  assert.equal(e.map.centro, null);
  assert.equal(e.$('btn-ubicacion-stop').hidden, true);
  assert.equal(e.avisos.at(-1).tipo, 'error');
  assert.match(e.avisos.at(-1).texto, /precisión suficiente/);
  assert.match(e.$('ubicacion-estado').textContent, /precisión suficiente/);
  e.vigias[0].exito(posicion()); e.peticiones[0].exito(posicion());
  assert.equal(e.map.centro, null);
  assert.equal(e.capas.length, 0);
});

test('los scripts de la página conservan sintaxis válida', () => {
  for(const script of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)){
    new vm.Script(script[1]);
  }
});
