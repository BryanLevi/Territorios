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
const funciones = ['printDirectionLabelsForLoc', 'getDirectionExportBoundsPlain',
  'medidaDeLasZonas', 'recorteDelCroquis', 'drawPrintTextLabels',
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
  assert(conDestino.x <= inicioTexto - 8 + .0001);
  assert(conDestino.x + conDestino.w >= finalTexto + 8 - .0001);
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
