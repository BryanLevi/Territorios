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

function environment(renderScale = 3, labels = []){
  const context = vm.createContext({
    printRenderScale:renderScale,
    PRINT_ZONE_NUMBER_SIZE_PT:Number(html.match(/const PRINT_ZONE_NUMBER_SIZE_PT\s*=\s*([\d.]+)\s*;/)[1]),
    TAM_CARRETERA_PANTALLA:16,
    getTextLabelsForLoc:() => labels,
    L:{divIcon:options => options},
    renderColonyLabelHtml:value => '<span>' + String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char])) + '</span>'
  });
  vm.runInContext(['isPrintZoneNumber', 'printZoneNumberStyle', 'createTextIcon', 'updatePrintZoneNumbers', 'getPrintZoneNumberExportBoundsPlain'].map(extractFunction).join('\n'), context);
  return context;
}

function properties(css){
  return Object.fromEntries(String(css).split(';').filter(part => part.includes(':')).map(part => {
    const colon = part.indexOf(':');
    return [part.slice(0, colon).trim(), part.slice(colon + 1).trim()];
  }));
}
function labelDiv(icon){
  const match = icon.html.match(/<div\b([^>]*)>([\s\S]*)<\/div>/);
  assert(match, 'The Leaflet marker contains its visible label');
  return {attributes:match[1], contents:match[2], css:properties(match[1].match(/\bstyle="([^"]*)"/)?.[1] || '')};
}
function close(actual, expected, description){
  assert(Math.abs(actual - expected) < 1e-8, `${description}: got ${actual}, expected ${expected}`);
}
function physicalDimensions(css, renderScale, layoutScale){
  const factor = layoutScale / renderScale;
  const padding = css.padding.split(/\s+/).map(parseFloat);
  return {
    fontPt:parseFloat(css['font-size']) * factor * 72 / 96,
    paddingY:padding[0] * factor,
    paddingX:(padding[1] ?? padding[0]) * factor,
    border:parseFloat(css['border-width']) * factor,
    radius:parseFloat(css['border-radius']) * factor
  };
}
function uniformBadge(css, renderScale, layoutScale){
  const actual = physicalDimensions(css, renderScale, layoutScale);
  close(actual.fontPt, 7, 'Printed number in points');
  close(actual.paddingY, 1.4, 'Vertical padding in final CSS pixels');
  close(actual.paddingX, 2.8, 'Horizontal padding in final CSS pixels');
  close(actual.border, .35, 'Final badge border');
  close(actual.radius, 1.05, 'Final badge corner radius');
}

test('Only whole numeric zone labels use uniform PDF numbering', () => {
  const context = environment();
  for(const text of ['1', '38', '040', '123', '  39\n', 40]){
    assert.equal(context.isPrintZoneNumber({text, type:'texto'}), true, String(text));
  }
  assert.equal(context.isPrintZoneNumber({text:'16'}), true);
  for(const text of ['', ' ', 'Zona 1', 'Av. 1', '1 / 2', '1\n2', '1.5', '-2', '<38>', null, undefined]){
    assert.equal(context.isPrintZoneNumber({text, type:'texto'}), false, String(text));
  }
  for(const type of ['carretera', 'destino']){
    assert.equal(context.isPrintZoneNumber({text:'38', type}), false, type);
  }
});

test('PDF numbers keep the same physical font and badge dimensions across render and frame scales', () => {
  const context = environment(7);
  uniformBadge(properties(context.printZoneNumberStyle()), 7, 1);
  for(const renderScale of [2, 3, 8, 12, 18]){
    for(const layoutScale of [.2, .35, .7, 1, 1.5, 2]){
      uniformBadge(properties(context.printZoneNumberStyle(renderScale, layoutScale)), renderScale, layoutScale);
    }
  }
});

test('Printed numeric markers ignore saved editor font sizes and the territory enlargement factor', () => {
  for(const renderScale of [2, 8, 18]){
    const context = environment(renderScale);
    for(const layoutScale of [.2, .65, 1, 2]){
      for(const [text, size] of [['1', 13], ['16', 22], ['38', 38], ['123', 200]]){
        const label = Object.freeze({text, type:'texto', size, opacity:.8, lat:19.049, lng:-96.982});
        const snapshot = JSON.stringify(label);
        const icon = context.createTextIcon(label, false, renderScale * 1.2, 13, layoutScale);
        const div = labelDiv(icon);
        assert.match(div.attributes, /\bprint-zone-number\b/);
        assert.equal(Number(div.attributes.match(/\bdata-print-scale="([^"]+)"/)?.[1]), renderScale);
        assert.equal(div.contents, `<span>${text}</span>`);
        uniformBadge(div.css, renderScale, layoutScale);
        assert.equal(JSON.stringify(label), snapshot, 'Export never rewrites saved coordinates or editor size');
        assert.deepEqual(Array.from(icon.iconAnchor), [0, 0]);
      }
    }
  }
});

test('Screen numbers and nonnumeric or highway labels preserve their existing sizes and selection', () => {
  const context = environment(8);
  const screen = labelDiv(context.createTextIcon({text:'38', type:'texto', size:28, opacity:.75}, true));
  assert.doesNotMatch(screen.attributes, /print-zone-number|data-print-scale/);
  assert.match(screen.attributes, /is-selected/);
  assert.equal(parseFloat(screen.css['font-size']), 28);
  assert.equal(parseFloat(screen.css.opacity), .75);
  const colony = labelDiv(context.createTextIcon({text:'Colonia <Centro>', size:20}, false, 8 * 1.2, 13, .25));
  assert.doesNotMatch(colony.attributes, /print-zone-number/);
  close(parseFloat(colony.css['font-size']), 20 * 8 * 1.2, 'Existing nonnumeric font size');
  assert.equal(colony.contents, '<span>Colonia &lt;Centro&gt;</span>');
  const highway = labelDiv(context.createTextIcon({text:'38', type:'carretera', size:38}, false, 8, 13, .25));
  assert.doesNotMatch(highway.attributes, /print-zone-number/);
  assert.equal(parseFloat(highway.css['font-size']), 13 * 8);
});

test('Changing the PDF frame scale resizes only printed badges without moving markers or editing saved labels', () => {
  const context = environment(3);
  const storedLabels = Object.freeze([
    Object.freeze({text:'38', size:18, lat:19.05, lng:-96.98}),
    Object.freeze({text:'San Martín', size:30, lat:19.04, lng:-96.99})
  ]);
  const snapshot = JSON.stringify(storedLabels);
  const numbers = [2, 18].map(renderScale => ({
    dataset:{printScale:String(renderScale)},
    style:{cssText:'color:#243129!important;opacity:.8;' + context.printZoneNumberStyle(renderScale, 1)},
    coordinate:Object.freeze({lat:19.05, lng:-96.98})
  }));
  const other = {style:{cssText:'font-size:80px;opacity:.8'}, coordinate:{lat:19.04, lng:-96.99}};
  const originalOther = JSON.stringify(other);
  const originalDatasets = JSON.stringify(numbers.map(node => node.dataset));
  const container = {querySelectorAll:selector => {
    assert.equal(selector, '.print-zone-number', 'Resize only the exported numeric markers');
    return numbers;
  }};
  const targetMap = {getContainer:() => container,
    setView:() => assert.fail('PDF marker sizing must not move the map'),
    panTo:() => assert.fail('PDF marker sizing must not move the map')};
  for(const layoutScale of [.2, .75, 1, 2]){
    context.updatePrintZoneNumbers(targetMap, layoutScale);
    numbers.forEach(node => {
      const css = properties(node.style.cssText);
      uniformBadge(css, Number(node.dataset.printScale), layoutScale);
      assert.equal(css.color, '#243129!important');
      assert.equal(css.opacity, '.8');
      assert.equal((node.style.cssText.match(/font-size\s*:/g) || []).length, 1, 'Each refinement replaces its previous sizing');
      assert.deepEqual(node.coordinate, {lat:19.05, lng:-96.98});
    });
    assert.equal(JSON.stringify(storedLabels), snapshot);
    assert.equal(JSON.stringify(other), originalOther);
    assert.equal(JSON.stringify(numbers.map(node => node.dataset)), originalDatasets);
  }
});

test('Numeric labels at or beyond the map edges reserve enough paper for the complete badge', () => {
  const labels = [
    {text:'123', type:'texto', lat:1, lng:0},
    {text:'38', type:'texto', lat:0, lng:1},
    {text:'16', type:'texto', lat:1.2, lng:-.3},
    {text:'40', type:'texto', lat:-.2, lng:1.3}
  ].map(Object.freeze);
  const original = Object.freeze({south:0, north:1, west:0, east:1});
  const context = environment(3, labels);
  const stored = JSON.stringify(labels);
  let previous = null;
  for(const layoutScale of [1, .5, .2]){
    const bounds = context.getPrintZoneNumberExportBoundsPlain({num:1}, original, layoutScale);
    assert(Object.values(bounds).every(Number.isFinite));
    assert(bounds.north > 1.2 && bounds.south < -.2 && bounds.west < -.3 && bounds.east > 1.3);
    for(const label of labels){
      const css = properties(context.printZoneNumberStyle(1, 1));
      const padding = css.padding.split(/\s+/).map(parseFloat);
      const border = parseFloat(css['border-width']);
      const halfWidthMm = (label.text.length * parseFloat(css['font-size']) * .68 + 2 * padding[1] + 2 * border) / 2 * 25.4 / 96;
      const halfHeightMm = (parseFloat(css['font-size']) * 1.02 + 2 * padding[0] + 2 * border) / 2 * 25.4 / 96;
      const leftMm = (label.lng - bounds.west) / (bounds.east - bounds.west) * 297 * layoutScale;
      const rightMm = (bounds.east - label.lng) / (bounds.east - bounds.west) * 297 * layoutScale;
      const topMm = (bounds.north - label.lat) / (bounds.north - bounds.south) * 189 * layoutScale;
      const bottomMm = (label.lat - bounds.south) / (bounds.north - bounds.south) * 189 * layoutScale;
      assert(leftMm >= halfWidthMm && rightMm >= halfWidthMm, 'The entire numeric badge fits horizontally');
      assert(topMm >= halfHeightMm && bottomMm >= halfHeightMm, 'The entire numeric badge fits vertically');
    }
    if(previous){
      assert(bounds.west < previous.west && bounds.east > previous.east);
      assert(bounds.south < previous.south && bounds.north > previous.north);
    }
    previous = bounds;
    assert.deepEqual(original, {south:0, north:1, west:0, east:1});
    assert.equal(JSON.stringify(labels), stored, 'Padding export bounds never moves the saved labels');
  }
});

test('Empty, nonnumeric, road, destination and invalid coordinate labels do not alter the export frame', () => {
  const original = Object.freeze({south:0, north:1, west:0, east:1});
  for(const labels of [[], [
    {text:'Colonia Centro', lat:5, lng:5},
    {text:'38', type:'carretera', lat:5, lng:5},
    {text:'40', type:'destino', lat:5, lng:5},
    {text:'39', lat:NaN, lng:5},
    {text:'16', lat:5, lng:Infinity}
  ]]){
    assert.equal(environment(3, labels).getPrintZoneNumberExportBoundsPlain({num:1}, original, .2), original);
  }
});
