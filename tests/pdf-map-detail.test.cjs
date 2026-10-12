const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '../outputs/croquis_territorios.html'), 'utf8');
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
function constant(name){
  const expression = html.match(new RegExp(`const ${name}\\s*=\\s*([^;]+);`))?.[1];
  assert(expression, `Constant available: ${name}`);
  return vm.runInNewContext(expression);
}

// Geographic fixtures from saved polygons, with provider zoom and printed
// glyph measurements from the 33b5157 export (512 px tiles, offset -1).
// Comparing provider detail, rather than canvas zoom, permits an equivalent
// smaller canvas without accepting the low-detail/large-label regression.
const REGIONS = [
  {num:1, name:'Ixhuatlán del Café', south:19.0382, north:19.058581, west:-96.995456, east:-96.97035,
    oldScale:17.222070321824535, providerZoom:19, glyphFactor:.08633167982188047},
  {num:30, name:'Tomatlán', south:19.02241, north:19.040832, west:-97.018583, east:-96.999388,
    oldScale:13.167276341416688, providerZoom:18, glyphFactor:.19104371977175785},
  {num:31, name:'Las Compras', south:19.024135, north:19.02656, west:-96.997983, east:-96.996287,
    oldScale:3, providerZoom:19, glyphFactor:2 / 3},
  {num:100, name:'Dibujo pequeño al límite nativo', south:19.0251, north:19.0253, west:-96.9972, east:-96.997,
    oldScale:3, providerZoom:19, glyphFactor:2 / 3}
];
function geographicBounds(region){
  return Object.freeze({
    isValid:() => true,
    getNorthWest:() => ({lat:region.north, lng:region.west}),
    getSouthEast:() => ({lat:region.south, lng:region.east})
  });
}
function project(point, zoom){
  const sine = Math.sin(point.lat * Math.PI / 180);
  const world = 256 * 2 ** zoom;
  return {x:(point.lng + 180) / 360 * world,
    y:(.5 - Math.log((1 + sine) / (1 - sine)) / (4 * Math.PI)) * world};
}
function detailEnvironment(currentView = 'g-road'){
  const projectionZooms = [];
  const context = vm.createContext({
    currentView,
    editorState:Object.freeze({zoom:17.25, center:Object.freeze([19.048889,-96.981944]), editing:true}),
    PRINT_RENDER_SCALE_MAX:constant('PRINT_RENDER_SCALE_MAX'),
    PRINT_RENDER_SCALE_MIN:constant('PRINT_RENDER_SCALE_MIN'),
    PRINT_MAX_ZOOM:constant('PRINT_MAX_ZOOM'),
    L:{CRS:{EPSG3857:{latLngToPoint:(point, zoom) => {
      projectionZooms.push(zoom);
      return project(point, zoom);
    }}}}
  });
  context.window = context;
  vm.runInContext(extractFunction('choosePrintRenderScale'), context);
  return {context, projectionZooms};
}
function mapFitZoom(region, renderScale, maxZoom = 20){
  const nw = project({lat:region.north,lng:region.west}, 0);
  const se = project({lat:region.south,lng:region.east}, 0);
  // The export canvas is a 297 x 189 mm map with 10 px per-side padding,
  // before its final frame transform. This estimates the source tile zoom.
  const fit = Math.min((1123 - 20) * renderScale / (se.x - nw.x),
    (714 - 20) * renderScale / (se.y - nw.y));
  return Math.min(maxZoom, Math.log2(fit));
}
function printFitMaxZoom(loc, src, renderScale){
  const frameMap = html.match(/const frameMap = \(\) => \{[\s\S]*?\n    \};/)?.[0];
  assert(frameMap, 'The real PDF map framing operation is available');
  let fitOptions;
  vm.runInNewContext(frameMap + '\nframeMap();', {
    printMap:{invalidateSize:() => {}, fitBounds:(bounds, options) => { fitOptions = options; }},
    bounds:{}, src, loc, printRenderScale:renderScale, PRINT_MAX_ZOOM:constant('PRINT_MAX_ZOOM')
  });
  return fitOptions.maxZoom;
}
function glyphFactor(renderScale, fitZoom, tileSize){
  // A provider tile is magnified by its display grid and fractional map
  // zoom, then reduced by the canvas-to-paper transform. Google scale=2
  // affects intrinsic resolution equally for both profiles, not this ratio.
  return tileSize / 256 * 2 ** (fitZoom - Math.round(fitZoom)) / renderScale;
}

function providerNameOptions(renderScale, layoutScale){
  const context = vm.createContext({PRINT_NAME_TILE_SIZE:constant('PRINT_NAME_TILE_SIZE'),
    PRINT_NAME_ZOOM_OFFSET:constant('PRINT_NAME_ZOOM_OFFSET')});
  vm.runInContext(extractFunction('printProviderNameOptions'), context);
  return context.printProviderNameOptions(renderScale, layoutScale);
}

test('Reduced frames magnify provider lettering without moving its geographic position', () => {
  const point = {lat:19.048889, lng:-96.981944};
  for(const [render, layout] of [[1.5,1],[3,.5],[9,.45],[4.5,.12],[9,.1]]){
    const options = providerNameOptions(render, layout);
    const levels = -options.zoomOffset;
    const original = project(point, 19);
    const adapted = project(point, 19 + options.zoomOffset);
    const tileRatio = options.tileSize / 256;
    assert(Math.abs(adapted.x * tileRatio - original.x) < 1e-6);
    assert(Math.abs(adapted.y * tileRatio - original.y) < 1e-6);
    assert(levels >= 0 && levels <= 2, 'Keep local labels within two provider zoom levels');
    assert(options.tileSize >= 256 && options.tileSize <= 1024);
    const before = 8 * layout / render, after = before * tileRatio;
    assert(after >= before, 'Lettering never gets smaller in a reduced frame');
    if(before < .7) assert(after >= .7 || levels === 2,
      'Reach the paper-size target unless geographic detail caps the enlargement');
  }
  assert.equal(providerNameOptions(9,.2).tileSize,1024,
    'Dense overview maps need larger street/place lettering than the old native grid');
  assert.equal(providerNameOptions(1.5,1).tileSize,256,
    'Maps that already have legible provider lettering retain their native grid');
});

test('Lamina lettering uses real high resolution labels independently of the white street geometry', () => {
  const context = vm.createContext({});
  vm.runInContext(extractFunction('printProviderNameUrl'), context);
  const original = 'https://mt{s}.google.com/vt/lyrs=h&x={x}&y={y}&z={z}&scale=2';
  const actual = context.printProviderNameUrl(original);
  const parsed = new URL(actual.replace('{s}','0'));
  assert.equal(parsed.searchParams.get('lyrs'),'m');
  assert.equal(parsed.searchParams.get('scale'),'4', 'Request 1024 native pixels instead of upscaling a 512 image');
  assert.equal(parsed.searchParams.getAll('scale').length,1);
  for(const key of ['x','y','z']) assert.equal(parsed.searchParams.get(key),`{${key}}`);
  assert(parsed.searchParams.get('apistyle').includes('s.e:g|p.v:off'),
    'Provider geometry cannot cover the independently drawn white streets');
  assert(parsed.searchParams.get('apistyle').includes('s.e:l.t.f|p.c:#202c23'),
    'Names retain dark ink that can be measured and kept complete at the territory border');
  const carto = 'https://a.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}.png';
  assert.equal(context.printProviderNameUrl(carto),carto);
  assert.equal(original.endsWith('scale=2'),true, 'Does not mutate the selected live-map source');
});

test('Automatic PDF streets stay white at native geographic detail with no duplicate labels', () => {
  const context = vm.createContext({});
  vm.runInContext(extractFunction('printProviderRoadUrl'), context);
  const original = 'https://mt0.google.com/vt/lyrs=h&x={x}&y={y}&z={z}&scale=2';
  const result = new URL(context.printProviderRoadUrl(original));
  assert.equal(result.searchParams.get('scale'),'2', 'Street cartography keeps its original native grid/resolution');
  for(const key of ['x','y','z']) assert.equal(result.searchParams.get(key),`{${key}}`);
  const style = result.searchParams.get('apistyle');
  assert(style.includes('s.e:l|p.v:off'), 'Never repeats street/place lettering under the enlarged name layer');
  assert(style.includes('s.t:3|s.e:g|p.v:on'), 'The road geometry remains visible');
  assert(style.includes('s.e:g.f|p.c:#ffffff') && style.includes('s.e:g.s|p.c:#ffffff'),
    'Both the road centre and its casing print white');
  assert.equal(context.printProviderRoadUrl('https://example.org/labels/{z}/{x}/{y}.png'),null);
});

test('Grouped provider names hide locality captions while retaining street and POI labels', () => {
  const context = vm.createContext({});
  vm.runInContext(extractFunction('printProviderNameUrl'), context);
  const result = new URL(context.printProviderNameUrl('https://mt0.google.com/vt/lyrs=h&x={x}&y={y}&z={z}&scale=2'));
  const rules = result.searchParams.get('apistyle').split(',');
  assert.deepEqual(rules.filter(rule => rule.includes('p.v:off')), [
    's.t:0|s.e:g|p.v:off', 's.t:19|s.e:l|p.v:off'
  ], 'Hide the locality feature specifically; a broad label rule also hides useful provider POIs');
  assert(rules.includes('s.t:0|s.e:l.t.f|p.c:#202c23'));
  assert(rules.includes('s.t:0|s.e:l.t.s|p.c:#ffffff'));
  assert(!rules.some(rule => /^s.t:(?:1|2|3)\|s.e:l(?:\.|\|)/.test(rule) && rule.includes('p.v:off')),
    'Broad provider, POI and street label selectors must not be suppressed');
});

test('Only grouped export adapts the provider locality labels; individual and saved sources stay intact', () => {
  const start = html.indexOf('let urlNombres = src.roadUrl || src.labelUrl;');
  const end = html.indexOf('let capaNombres = null;', start);
  assert(start >= 0 && end > start, 'Use the actual PDF provider selection path');
  const selectNames = html.slice(start,end) + '\nurlNombres;';
  const original = 'https://mt0.google.com/vt/lyrs=h&x={x}&y={y}&z={z}&scale=2';
  const src = Object.freeze({roadUrl:original, labelUrl:'https://example.org/labels/{z}/{x}/{y}.png'});
  const selected = lamina => {
    const roads = [];
    const context = vm.createContext({src, opciones:{lamina}, escalaTeselaImpresion:() => 2,
      anadirTeselas:(source, options) => roads.push(options)});
    vm.runInContext(extractFunction('printProviderNameUrl') + '\n' + extractFunction('printProviderRoadUrl'), context);
    return {url:vm.runInContext(selectNames, context), roads};
  };
  const grouped = selected(true);
  assert(new URL(grouped.url).searchParams.get('apistyle').includes('s.t:19|s.e:l|p.v:off'));
  assert.equal(grouped.roads.length,1);
  const individual = selected(false);
  assert.equal(individual.url,original);
  assert.equal(individual.roads.length,0);
  assert.equal(src.roadUrl,original, 'The live/editor tile URL remains the saved selected source');
  assert.equal(extractFunction('drawPrintTextLabels').includes('printProviderNameUrl'),false,
    'The provider-only policy does not suppress or transform saved manual text labels');
});

test('Small portrait/landscape frames retain the same neighborhood street detail as a full PDF map', () => {
  const {context} = detailEnvironment();
  const source = Object.freeze({maxZ:20});
  for(const region of REGIONS){
    const loc = Object.freeze({num:region.num, printMaxZoom:20});
    const bounds = geographicBounds(region);
    const fullScale = context.choosePrintRenderScale(loc, bounds, source, 1);
    const fullZoom = mapFitZoom(region, fullScale, printFitMaxZoom(loc, source, fullScale));
    const providerZoom = Math.round(fullZoom) + constant('PRINT_NAME_ZOOM_OFFSET');
    assert.equal(providerZoom, region.providerZoom, `${region.name} retains the historical provider detail level`);
    assert(Math.abs(glyphFactor(fullScale, fullZoom, constant('PRINT_NAME_TILE_SIZE')) - region.glyphFactor) < 1e-9,
      `${region.name} keeps the historical small street/place names in paper`);
    for(const frameScale of [.1, .18, .25, .5, .7]){
      const scale = context.choosePrintRenderScale(loc, bounds, source, frameScale);
      assert.equal(scale, fullScale, `${region.name}: changing the paper frame preserves source resolution`);
      assert.equal(mapFitZoom(region, scale, printFitMaxZoom(loc, source, scale)), fullZoom,
        'The frame transform never removes native map detail');
    }
  }
});

test('Map detail respects whichever native zoom limit is lower: provider or territory', () => {
  for(const [provider, territory, expected] of [[20,17,17],[16,20,16],[18,19,18]]){
    const {context, projectionZooms} = detailEnvironment();
    const scale = context.choosePrintRenderScale({printMaxZoom:territory},
      geographicBounds(REGIONS[0]), {maxZ:provider}, .15);
    assert(projectionZooms.length > 0);
    assert(projectionZooms.every(zoom => zoom === expected), 'Never calculates detail beyond available native tiles');
    assert(Number.isFinite(scale) && scale > 0);
    assert(mapFitZoom(REGIONS[0], scale, expected) <= expected);
  }
});

test('Export detail calculation leaves the selected live map and editor view untouched', () => {
  for(const selectedMap of ['g-road','g-hybrid','offline']){
    const {context} = detailEnvironment(selectedMap);
    const before = JSON.stringify({currentView:context.currentView, editorState:context.editorState});
    const loc = Object.freeze({num:1, printMaxZoom:20});
    const source = Object.freeze({maxZ:20});
    context.choosePrintRenderScale(loc, geographicBounds(REGIONS[0]), source, .12);
    assert.equal(JSON.stringify({currentView:context.currentView, editorState:context.editorState}), before);
    assert.equal(constant('DETAIL_ZOOM'), 20, 'Editor zoom configuration remains independent of PDF frame size');
  }
});

test('Saved white street strokes remain white in PDF at both export scales without editing saved points', () => {
  const road = Object.freeze({width:8, points:Object.freeze([
    Object.freeze([19.0252,-96.9974]), Object.freeze([19.0258,-96.9969])
  ])});
  const original = JSON.stringify(road);
  for(const renderScale of [1.5,3,9,18]){
    const drawn = [], output = {};
    const context = vm.createContext({
      printRenderScale:renderScale,
      getWhiteRoadsForLoc:() => [road],
      pointsToLatLngs:points => points,
      CARRETERA_ORILLA:'#53655d',
      L:{polyline:(points, options) => ({addTo:map => drawn.push({points, options, map})})}
    });
    vm.runInContext(html.match(/const printVectorRoadScale\s*=\s*[^;]+;/)[0]
      + '\n' + extractFunction('drawWhiteRoadPolyline')
      + '\n' + extractFunction('drawPrintManualWhiteRoads'), context);
    output.getPane = name => name === 'territoryWhiteRoadPane' ? {} : undefined;
    context.drawPrintManualWhiteRoads(output, {num:31});
    assert.equal(drawn.length, 2, 'The saved road has its outline and white center');
    assert.equal(drawn[1].options.color, '#ffffff');
    assert(drawn.every(stroke => stroke.options.pane === 'territoryWhiteRoadPane' && stroke.map === output));
    assert.deepEqual(drawn[1].points, road.points);
    assert.equal(JSON.stringify(road), original, 'Export never recolors or rewrites the saved editor road');
    assert(Math.abs(drawn[1].options.weight / renderScale - 2.24) < 1e-9,
      'White road width on the source sheet stays constant across render resolutions');
  }
});

test('PDF street/place names render above saved white roads so repainting a street preserves its name', () => {
  const whiteStart = html.indexOf("printMap.createPane('territoryWhiteRoadPane');");
  const stop = html.indexOf("printMap.createPane('territoryLabelPane');", whiteStart);
  assert(whiteStart >= 0 && stop > whiteStart);
  const panes = {};
  const printMap = {
    createPane:name => { panes[name] = {style:{}, classList:{add:() => {}}}; },
    getPane:name => panes[name]
  };
  vm.runInNewContext(html.slice(whiteStart, stop), {printMap});
  assert(Number(panes.territoryRoadPane.style.zIndex) > Number(panes.territoryWhiteRoadPane.style.zIndex));
  assert(Number(panes.territoryMaskPane.style.zIndex) > Number(panes.territoryRoadPane.style.zIndex),
    'Geographic masking still clips external map labels after white streets are drawn');
});

test('Only grouped Google names without geometry use the translucent ink measurement', () => {
  const start=html.indexOf('const nameOptions = opciones.lamina ? printProviderNameOptions');
  const stop=html.indexOf('printMap._printNameTileOptions =',start);
  assert(start >= 0 && stop > start);
  for(const grouped of [false,true])for(const provider of ['google','other']){
    const context=vm.createContext({opciones:{lamina:grouped},printRenderScale:8,directionLayoutScale:.15,
      src:{sub:''},printProviderNameOptions:()=>({tileSize:1024,zoomOffset:-2}),
      urlNombres:provider==='google'?'https://mt0.google.com/vt?lyrs=h':'https://example.test/labels',
      anadirTeselas:(source,options)=>{context.measuredOptions=options;return {options};}});
    vm.runInContext(extractFunction('printProviderNameUrl'),context);
    if(grouped)context.urlNombres=context.printProviderNameUrl(context.urlNombres);
    vm.runInContext('let capaNombres;'+html.slice(start,stop),context);
    assert.equal(context.measuredOptions.printLabelsOnly,grouped && provider==='google');
  }
});
