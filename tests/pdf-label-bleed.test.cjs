const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '../outputs/croquis_territorios.html'), 'utf8');
const nameMaskGrow = Number(html.match(/const PRINT_MASK_GROW_NOMBRES\s*=\s*([\d.]+)\s*;/)[1]);

function extractFunction(name){
  const start = html.indexOf(`function ${name}(`);
  assert(start >= 0, `Function available: ${name}`);
  const open = html.indexOf('{', start);
  let depth = 0, quote = null;
  for(let i = open; i < html.length; i++){
    const char = html[i], next = html[i + 1];
    if(quote){
      if(char === '\\'){ i++; continue; }
      if(char === quote) quote = null;
      continue;
    }
    if(char === '/' && next === '/'){ i = html.indexOf('\n', i); continue; }
    if(char === '/' && next === '*'){ i = html.indexOf('*/', i + 2) + 1; continue; }
    if(char === '"' || char === "'" || char === '`'){ quote = char; continue; }
    if(char === '{') depth++;
    if(char === '}' && --depth === 0) return html.slice(start, i + 1);
  }
  throw new Error(`Incomplete function: ${name}`);
}

const clone = value => JSON.parse(JSON.stringify(value));
const close = (actual, expected, label) =>
  assert(Math.abs(actual - expected) < 1e-8, `${label}: got ${actual}, expected ${expected}`);

function exportBoundsEnvironment(){
  const context = vm.createContext({PRINT_MASK_GROW_NOMBRES:nameMaskGrow});
  vm.runInContext(extractFunction('getPrintMapLabelExportBoundsPlain'), context);
  return context;
}

function labelMeasureEnvironment(areas){
  const context = vm.createContext({
    DETAIL_ZOOM:20,
    printRenderScale:3,
    getExportColorAreasForLoc:() => areas,
    getComputedStyle:() => ({strokeWidth:'0px'}),
    getExportBoundsPlain:() => ({south:0,north:1,west:0,east:1}),
    printMapW:() => 1123 * 3,
    printMapH:() => 714 * 3,
    medidaDeMarcasImpresas:() => null
  });
  vm.runInContext([
    'medidaDeLasZonas', 'medidaDeNombresImpresos', 'recorteDelCroquis'
  ].map(extractFunction).join('\n'), context);
  const width = 1123 * 3, height = 714 * 3;
  const map = {
    _printNameBleed:nameMaskGrow * 3 / 2,
    getSize:() => ({x:width,y:height}),
    latLngToContainerPoint:([lat,lng]) => ({x:lng * width,y:(1 - lat) * height})
  };
  return {context,map,width,height};
}

test('Label bleed keeps the original export frame immutable and centered', () => {
  const context = exportBoundsEnvironment();
  const original = Object.freeze({south:19.03,north:19.06,west:-96.995,east:-96.96});
  const before = clone(original);
  const padded = context.getPrintMapLabelExportBoundsPlain(original);
  assert(Object.values(padded).every(Number.isFinite));
  assert(padded.south < original.south && padded.north > original.north);
  assert(padded.west < original.west && padded.east > original.east);
  close((padded.north + padded.south) / 2, (original.north + original.south) / 2, 'Latitude center');
  close((padded.east + padded.west) / 2, (original.east + original.west) / 2, 'Longitude center');
  const marginMm = nameMaskGrow / 2 * 25.4 / 96;
  close((original.west - padded.west) / (padded.east - padded.west) * 297, marginMm, 'Horizontal paper margin');
  close((padded.north - original.north) / (padded.north - padded.south) * 189, marginMm, 'Vertical paper margin');
  assert.deepEqual(original, before, 'Saved frame is untouched');
});

test('Invalid or incomplete export bounds remain untouched instead of producing invalid coordinates', () => {
  const context = exportBoundsEnvironment();
  for(const original of [null, undefined, {}, {south:0,north:1,west:0},
    {south:NaN,north:1,west:0,east:1}, {south:0,north:Infinity,west:0,east:1}]){
    assert.equal(context.getPrintMapLabelExportBoundsPlain(original), original);
  }
});

test('Label bleed preserves each side of the painted territory in the grouped crop', () => {
  const areas = [{points:[[.3,.25],[.3,.75],[.7,.75],[.7,.25]]}];
  const {context,map,width,height} = labelMeasureEnvironment(areas);
  const zone = clone(context.medidaDeLasZonas(map,{num:1}));
  const padded = clone(context.medidaDeNombresImpresos(map,{num:1}));
  assert(padded, 'Painted territory produces a label crop');
  assert(padded.x0 < zone.x0 && padded.x1 > zone.x1);
  assert(padded.y0 < zone.y0 && padded.y1 > zone.y1);
  close(zone.x0 - padded.x0, map._printNameBleed, 'Left source margin matches mask');
  close(padded.x1 - zone.x1, map._printNameBleed, 'Right source margin matches mask');
  close(zone.y0 - padded.y0, map._printNameBleed, 'Top source margin matches mask');
  close(padded.y1 - zone.y1, map._printNameBleed, 'Bottom source margin matches mask');
  assert(padded.x0 >= 0 && padded.x1 <= width);
  assert(padded.y0 >= 0 && padded.y1 <= height);
  close((padded.x0 + padded.x1) / 2, (zone.x0 + zone.x1) / 2, 'Horizontal center');
  close((padded.y0 + padded.y1) / 2, (zone.y0 + zone.y1) / 2, 'Vertical center');
});

test('Name bleed does not create a crop without painted areas or a measured map', () => {
  const {context,map} = labelMeasureEnvironment([]);
  assert.equal(context.medidaDeNombresImpresos(map,{num:1}), null);
  map._printNameBleed = 0;
  assert.equal(context.medidaDeNombresImpresos(map,{num:1}), null);
});

test('Name bleed near every map edge is clamped in the final grouped crop', () => {
  const areas = [{points:[[.01,.01],[.01,.99],[.99,.99],[.99,.01]]}];
  const {context,map,width,height} = labelMeasureEnvironment(areas);
  const padded = clone(context.medidaDeNombresImpresos(map,{num:1}));
  assert(padded);
  assert(padded.x0 < 0 && padded.y0 < 0, 'Measurement keeps real bleed before clipping');
  assert(padded.x1 > width && padded.y1 > height);
  const crop = clone(context.recorteDelCroquis(map,{num:1}));
  assert.equal(crop.x, 0);
  assert.equal(crop.y, 15);
  assert.equal(crop.w, 297);
  assert.equal(crop.h, 189);
  assert(padded.x0 < .01 * width && padded.x1 > .99 * width);
  assert(padded.y0 < .01 * height && padded.y1 > .99 * height);
});

test('The PDF background mask keeps its narrow border independently of name bleed', () => {
  assert.match(html, /const PRINT_MASK_GROW_FONDO\s*=\s*1\s*;/);
  assert.match(html, /pane:'territoryBaseMaskPane',\s*grow:PRINT_MASK_GROW_FONDO/);
  assert.match(html, /pane:'territoryMaskPane',\s*grow:PRINT_MASK_GROW_NOMBRES/);
});
