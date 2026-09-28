const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '../outputs/croquis_territorios.html'), 'utf8');
const codigo = html.slice(html.indexOf('const UBICACION_OPCIONES'), html.indexOf("locSel.addEventListener('change'"));
const navegar = html.slice(html.indexOf('function goTo('), html.indexOf('function navigate('));

function entorno({ confirmar = false, seguro = true, geolocalizacion = true } = {}){
  const peticiones = [], vigias = [], cancelados = [], avisos = [], capas = [], encuadres = [];
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
    stop(){ return this; }, distance(){ return 100; }, removeLayer(){}
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
    window:{ L, isSecureContext:seguro, confirm:() => confirmar },
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
  return { contexto, map, $, peticiones, vigias, cancelados, avisos, capas, encuadres,
    clic:() => $('btn-ubicacion').click(), detener:() => $('btn-ubicacion-stop').click() };
}
const posicion = (lat = 20, lng = -99) => ({ coords:{ latitude:lat, longitude:lng, accuracy:8 } });

test('el primer clic pide una lectura actual y centra el punto del dispositivo', () => {
  const e = entorno();
  e.clic();
  assert.equal(e.vigias.length, 0);
  assert.equal(e.peticiones[0].opciones.maximumAge, 0);
  assert.equal(e.peticiones[0].opciones.enableHighAccuracy, true);
  e.peticiones[0].exito(posicion());
  assert.deepEqual(e.map.centro, [20,-99]);
  assert.equal(e.map.zoom, 17);
  assert.equal(e.vigias.length, 1);
  assert.equal(e.$('btn-ubicacion-stop').hidden, false);
  assert.deepEqual(e.capas[0].elementos.find(x => x.tipo === 'punto').punto, [20,-99]);
});

test('abrir el territorio detectado conserva el centro en la ubicación, no en el recuadro', () => {
  const e = entorno({ confirmar:true });
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
  assert.equal(e.vigias.length, 0);
  e.clic(); e.peticiones[1].exito(posicion()); e.detener();
  e.vigias[0].exito(posicion(21,-100));
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
  assert.equal(e.vigias.length, 1);
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
  assert.equal(e.vigias.length, 0);
});

test('los scripts de la página conservan sintaxis válida', () => {
  for(const script of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)){
    new vm.Script(script[1]);
  }
});
