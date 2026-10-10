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
