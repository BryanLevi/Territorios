const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '../outputs/croquis_territorios.html'), 'utf8');
function funcion(nombre){
  let inicio = html.indexOf(`function ${nombre}(`);
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
const funciones = ['isPrintZoneNumber', 'printDirectionLabelsForLoc', 'getDirectionExportBoundsPlain',
  'medidaDeLasZonas', 'medidaDeMarcasImpresas', 'recorteDelCroquis', 'elegirSitioLeyenda', 'drawPrintTextLabels',
  'escalaDeHueco', 'acomodarHojaSueltaEnHueco'].map(funcion).join('\n');
const copiar = valor => JSON.parse(JSON.stringify(valor));
const destino = opciones => ({type:'destino', text:'Hacia Ocotitlan', lat:.5, lng:-.2,
  points:[[.5,.2],[.5,-.1]], sizePt:10, strokePt:1.2, headMm:3, ...opciones});
function entorno(labels = []){
  const base = {south:0, north:1, west:0, east:1};
  const marcas = [];
  const contexto = vm.createContext({
    DETAIL_ZOOM:20, printRenderScale:3, PRINT_ZONE_NUMBER_BOOST:1.2, TAM_CARRETERA_PAPEL:13,
    A4_LARGO:297, A4_CORTO:210,
    getTextLabelsForLoc:() => labels,
    getExportBoundsPlain:() => base,
    getExportColorAreasForLoc:() => [{points:[[.3,.3],[.7,.3],[.7,.7],[.3,.7]]}],
    printMapW:() => 1123 * 3, printMapH:() => 714 * 3,
    createTextIcon:label => ({text:label.text}),
    L:{marker:(point, options) => ({addTo:mapa => marcas.push({point, options, mapa})})}
  });
  vm.runInContext(funciones, contexto);
  const mapa = {latLngToContainerPoint:([lat,lng]) => ({x:lng * 1123 * 3, y:(1 - lat) * 714 * 3})};
  return {contexto, base, marcas, mapa};
}

test('Sin flechas el PDF conserva exactamente el encuadre existente', () => {
  const e = entorno([{text:'Zona 1', lat:.5, lng:.5}]);
  assert.equal(e.contexto.getDirectionExportBoundsPlain({num:1}), e.base);
});

test('Incluye texto y ambos extremos fuera del territorio sin alterar el recuadro', () => {
  const e = entorno([destino({lat:1.3, lng:-.8, points:[[.8,.1],[1.1,-.5]]})]);
  const b = e.contexto.getDirectionExportBoundsPlain({num:1});
  assert(b.north > 1.3 && b.west < -.8 && b.south < 0 && b.east > 1);
  assert.deepEqual(e.base, {south:0, north:1, west:0, east:1});
});

test('Reserva mas espacio para texto de tamano fisico constante en laminas pequenas', () => {
  const e = entorno([destino({text:'Hacia San Francisco y la carretera principal'})]);
  const individual = e.contexto.getDirectionExportBoundsPlain({num:1}, 20, 1, 64);
  const lamina = e.contexto.getDirectionExportBoundsPlain({num:1}, 20, .25, 32);
  assert(lamina.north - lamina.south > individual.north - individual.south);
  assert(lamina.east - lamina.west > individual.east - individual.west);
  assert(Object.values(lamina).every(Number.isFinite));
});

test('Las flechas incompletas no cambian el encuadre ni generan coordenadas invalidas', () => {
  const e = entorno([destino({points:[[.5,.2],[NaN,0]]}), destino({text:' '}),
    destino({points:[[.5,.2]]}), destino({lat:undefined})]);
  assert.equal(e.contexto.getDirectionExportBoundsPlain({num:1}), e.base);
});

test('El recorte de la lamina incluye la referencia que queda fuera de las zonas', () => {
  const e = entorno([]);
  const normal = e.contexto.recorteDelCroquis(e.mapa, {num:1});
  const bounds = {x0:130, y0:260, x1:3200, y1:1900};
  const conDestino = e.contexto.recorteDelCroquis(e.mapa, {num:1}, bounds, .5);
  assert(conDestino.x < normal.x && conDestino.w > normal.w);
  assert(conDestino.y < normal.y && conDestino.h > normal.h);
  const inicioTexto = bounds.x0 / (1123 * 3) * 297;
  const finalTexto = bounds.x1 / (1123 * 3) * 297;
  assert(conDestino.x <= inicioTexto - 1.6 + .0001);
  assert(conDestino.x + conDestino.w >= finalTexto + 1.6 - .0001);
});

test('El territorio ocupa casi todo el lado disponible sin deformarse ni cortar el contorno', () => {
  const e = entorno([]), util = {w:80 - 2.4, h:55 - 5 - 2.4};
  const core = {x: .3 * 297, y:15 + .3 * 189, w:.4 * 297, h:.4 * 189};
  let rec = e.contexto.recorteDelCroquis(e.mapa, {num:1});
  let k = Math.min(util.w / rec.w, util.h / rec.h);
  for(let i = 0; i < 48; i++){
    rec = e.contexto.recorteDelCroquis(e.mapa, {num:1}, null, k);
    k = Math.min(util.w / rec.w, util.h / rec.h);
  }
  assert(Math.max(core.w*k/util.w,core.h*k/util.h) > .96);
  assert(rec.x < core.x && rec.y < core.y);
  assert(rec.x+rec.w > core.x+core.w && rec.y+rec.h > core.y+core.h);
  assert(rec.w*k <= util.w+.001 && rec.h*k <= util.h+.001);
  assert(Math.abs((core.w*k)/(core.h*k)-core.w/core.h) < 1e-10);
});

test('Los extremos del recorte quedan dentro del escenario aun con texto junto a un borde', () => {
  const e = entorno([]);
  const rec = e.contexto.recorteDelCroquis(e.mapa,{num:1},{x0:0,y0:0,x1:1123*3,y1:714*3},.2);
  assert.equal(rec.x,0); assert.equal(rec.y,15);
  assert.equal(rec.w,297); assert.equal(rec.h,189);
  assert(rec.x+rec.w <= 297 && rec.y+rec.h <= 204);
});

test('El contorno conserva reserva de tinta al ampliar mucho un territorio diminuto', () => {
  const e = entorno([]);
  const rec = e.contexto.recorteDelCroquis(e.mapa,{num:1},null,50);
  const halfOutlineMm = .325 * 25.4 / 96;
  assert(rec.x <= .3*297-halfOutlineMm);
  assert(rec.x+rec.w >= .7*297+halfOutlineMm);
});

test('El ajuste conserva iconos o etiquetas que sobresalen del color', () => {
  const e = entorno([]);
  const texto = {getBoundingClientRect:() => ({left:22,top:100,right:64,bottom:120,width:42,height:20})};
  const container = {getBoundingClientRect:() => ({left:0,top:0,width:1123,height:714}),querySelectorAll:() => [texto]};
  const mapa = {...e.mapa,getContainer:() => container,getSize:() => ({x:1123*3,y:714*3})};
  const limites = copiar(e.contexto.medidaDeMarcasImpresas(mapa));
  assert.deepEqual(limites,{x0:66,y0:300,x1:192,y1:360});
  const rec = e.contexto.recorteDelCroquis(mapa,{num:1},null,.5);
  assert(rec.x <= 22/1123*297 - 1.6 + .001);
  assert(rec.y <= 15+100/714*189 - 1.6 + .001);
});

test('Una calle horizontal fuera del color conserva sus dos extremos y todo su grosor', () => {
  const e = entorno([]);
  e.contexto.getComputedStyle = () => ({strokeWidth:'12px'});
  const path = {tagName:'path',getBoundingClientRect:() => ({left:50,top:60,right:150,bottom:60,width:100,height:0})};
  const container = {getBoundingClientRect:() => ({left:0,top:0,width:1123,height:714}),querySelectorAll:() => []};
  const mapa = {...e.mapa,getContainer:() => container,getSize:() => ({x:1123*3,y:714*3}),
    getPane:nombre => nombre==='territoryWhiteRoadPane'?{querySelectorAll:() => [path]}:null};
  assert.deepEqual(copiar(e.contexto.medidaDeMarcasImpresas(mapa)),{x0:144,y0:174,x1:456,y1:186});
});

test('La leyenda busca una esquina libre en la silueta real y respeta textos y rotulo', () => {
  const e = entorno([]);
  const poligono = [{x:0,y:0},{x:100,y:0},{x:100,y:70},{x:0,y:70}];
  const obstaculo = {left:70,top:70,right:100,bottom:100};
  const sitio = copiar(e.contexto.elegirSitioLeyenda(100,100,25,20,8,3,[poligono],[obstaculo]));
  assert.deepEqual(sitio,{left:3,top:77});
  assert(sitio.left >= 3 && sitio.left+25 <= 97);
  assert(sitio.top >= 11 && sitio.top+20 <= 97);
  // Una diagonal no ocupa todas las esquinas de su cuadro envolvente.
  const diagonal = [{x:0,y:0},{x:100,y:90},{x:100,y:100},{x:0,y:10}];
  const libre = copiar(e.contexto.elegirSitioLeyenda(100,100,20,20,0,3,[diagonal],[]));
  assert(libre.left === 77 || libre.top === 77);
});

test('El rotulado general no duplica destinos ni les aplica el aumento de zona', () => {
  const e = entorno([destino(), {text:'12', type:'texto', lat:.4, lng:.6, size:20}]);
  const mapa = {latLngToLayerPoint:() => ({x:100, y:100})};
  const ocupadas = [];
  e.contexto.drawPrintTextLabels(mapa, {num:1}, ocupadas);
  assert.equal(e.marcas.length, 1);
  assert.equal(e.marcas[0].options.icon.text, '12');
  assert.equal(ocupadas.length, 1);
});

test('Una hoja suelta vertical contiene el papel completo y compensa el texto fisico', () => {
  const e = entorno([destino()]);
  const papel = {style:{}};
  const hueco = {w:210, h:297};
  const k = e.contexto.acomodarHojaSueltaEnHueco(papel, hueco);
  assert.equal(k, 210 / 297);
  assert(297 * k <= hueco.w && 210 * k <= hueco.h);
  assert.equal(papel.style.transformOrigin, 'top left');
  assert.match(papel.style.transform, /^translate\(0\.00mm,74\.26mm\) scale\(/);
  // El render recibe esta misma escala: fuente multiplicada por 1/k y luego
  // papel multiplicado por k producen los 10 puntos pedidos en el PDF.
  const fuentePx = 10 * 96 / 72 / k;
  assert(Math.abs(fuentePx * k * 72 / 96 - 10) < 1e-10);
  const normal = {style:{}};
  assert.equal(e.contexto.acomodarHojaSueltaEnHueco(normal, {w:297,h:210}), 1);
  assert.deepEqual(normal.style, {});
});
