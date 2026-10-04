const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalize, buildIndex, search } = require('../outputs/territory-search.js');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const points = [[19, -97], [19, -96.99], [19.01, -96.99], [19.01, -97]];
const fixture = () => buildIndex({
  groupId: 'ixhuatlan',
  locs: [
    { num: 29, displayNum: 2, name: 'Pizarrostla', alias: 'La Tranca' },
    { num: 17, displayNum: 3, name: 'Nevería' },
    { num: 1, displayNum: 1, name: 'Ixhuatlán del Café' },
    { num: 81, displayNum: 4, name: 'Privado', congregacionId: 'otra' }
  ],
  getAreas: loc => loc.num === 1 ? [{ points }] : [],
  getLabels: loc => loc.num === 1 ? [
    { text: '8', lat: 19.005, lng: -96.995 },
    { text: '007', lat: 19.003, lng: -96.998 },
    { text: '7', lat: 19.004, lng: -96.997 },
    { text: 'Hacia Tomatlán', type: 'destino', lat: 19, lng: -97 },
    { text: '9', lat: null, lng: -97 }
  ] : []
});
const find = (query, options = {}) => search(fixture(), query, { groupId: 'ixhuatlan', ...options });

test('Busca nombres y alias sin tildes, mayúsculas ni signos', () => {
  assert.equal(normalize(' IXHUATLÁN del CAFÉ '), 'ixhuatlan del cafe');
  assert.equal(find('NEVERIA')[0].name, 'Nevería');
  assert.equal(find('la tranca')[0].name, 'Pizarrostla / La Tranca');
  assert.equal(find('ixhuatlan cafe')[0].locNum, '1');
});

test('Los territorios usan su número visible; el ID interno no se convierte en número de búsqueda', () => {
  assert.equal(find('#2')[0].locNum, '29');
  assert.equal(find('territorio 3')[0].locNum, '17');
  assert.deepEqual(find('29'), []);
});

test('Busca un subterritorio por número exacto y por su localidad', () => {
  const item = find('subterritorio 8 ixhuatlan')[0];
  assert.equal(item.kind, 'subterritory');
  assert.equal(item.number, '8');
  assert.equal(item.detail, '#1 · Ixhuatlán del Café');
  assert.deepEqual(item.points, points);
  assert.deepEqual(item.position, [19.005, -96.995]);
});

test('Un número no coincide parcialmente con otras numeraciones', () => {
  const entries = buildIndex({ groupId: 'g', locs: Array.from({ length: 12 }, (_, i) => ({ num: i + 1, name: 'Lugar ' + (i + 1) })) });
  assert.deepEqual(search(entries, '1', { groupId: 'g' }).map(item => item.number), ['1']);
  assert.deepEqual(search(entries, '01', { groupId: 'g' }).map(item => item.number), ['1']);
});

test('Textos de destino y posiciones inválidas no se confunden con subterritorios; números duplicados se unifican', () => {
  const items = fixture().filter(item => item.kind === 'subterritory');
  assert.deepEqual(items.map(item => item.number), ['8', '7']);
  assert.equal(find('subterritorio 007')[0].number, '7');
  assert.equal(find('Tomatlán').length, 0);
});

test('Solo indexa la congregación activa y vuelve a filtrar al buscar índices combinados', () => {
  assert.equal(find('Privado').length, 0);
  assert.deepEqual(search(fixture(), '', { groupId: 'otra' }), []);
  assert.deepEqual(search(fixture(), ''), []);
  assert.deepEqual(buildIndex({ locs: [{ num: 1, name: 'A' }] }), []);
  const mixed = fixture().concat(buildIndex({ groupId: 'otra', locs: [{ num: 1, name: 'Nevería secreta' }] }));
  assert.deepEqual(search(mixed, 'Nevería', { groupId: 'ixhuatlan' }).map(item => item.name), ['Nevería']);
});

test('Limita resultados a 25 por defecto y nunca supera 40 para mantener fluidez', () => {
  const entries = buildIndex({ groupId: 'g', locs: Array.from({ length: 100 }, (_, i) => ({ num: i, name: 'Lugar' })) });
  assert.equal(search(entries, '', { groupId: 'g' }).length, 25);
  assert.equal(search(entries, 'Lugar', { groupId: 'g', limit: 1000 }).length, 40);
  assert.equal(search(entries, '', { groupId: 'g', limit: 3 }).length, 3);
  assert.equal(search(entries, '', { groupId: 'g', limit: -2 }).length, 1);
  assert.equal(search(entries, 'No existe', { groupId: 'g' }).length, 0);
});

test('El número sobre un borde identifica la zona y los polígonos mal formados no se usan', () => {
  const entries = buildIndex({ groupId: 'g', locs: [{ num: 5, name: 'Ixcatla' }], getLabels: () => [{ text: '23', lat: 19, lng: -96.995 }], getAreas: () => [{ points }, { points: [[null, -97], [19, -97], [19.01, -97]] }] });
  assert.deepEqual(entries[1].points, points);
});

test('Un número sin polígono sigue siendo buscable en su coordenada', () => {
  const entries = buildIndex({ groupId: 'g', locs: [{ num: 5, name: 'Ixcatla' }], getLabels: () => [{ text: '23', lat: 19, lng: -97 }], getAreas: () => [{ points: [[100, -97], [19, -97], [19.01, -97]] }] });
  assert.equal(entries[1].points, null);
  assert.deepEqual(entries[1].position, [19, -97]);
});

function browser() {
  const nodes = {}, navigation = [];
  let permitted = true;
  const document = { activeElement: null };
  function node(id, fragment = false) {
    const listeners = {};
    return { id, fragment, children: [], value: '', open: false,
      addEventListener(name, fn) { (listeners[name] ||= []).push(fn); },
      fire(name, event = {}) { listeners[name]?.forEach(fn => fn({ currentTarget: this, preventDefault() {}, ...event })); },
      appendChild(item) { this.children.push(...(item.fragment ? item.children : [item])); },
      replaceChildren(...items) { this.children = []; items.forEach(item => this.appendChild(item)); },
      querySelectorAll() { return this.children; },
      focus() { document.activeElement = this; },
      click() { this.fire('click'); },
      showModal() { this.open = true; },
      close() { this.open = false; this.fire('close'); }
    };
  }
  ['territory-search-dialog', 'territory-search-input', 'territory-search-results', 'territory-search-status', 'territory-search-close', 'btn-territory-search', 'route-search'].forEach(id => { nodes[id] = node(id); });
  Object.assign(document, { getElementById: id => nodes[id], createElement: name => node(name), createDocumentFragment: () => node('fragment', true) });
  const context = { document, congregacionActivaId: 'g', LOCS: [{ num: 29, displayNum: 2, name: '<b>La Tranca</b>' }],
    getTextLabelsForLoc: () => [{ text: '8', lat: 19.005, lng: -96.995 }], getColorAreasForLoc: () => [{ points }],
    CroquisAccess: { canEnter: () => permitted },
    L: { latLngBounds: value => value },
    map: { getZoom: () => 17, fitBounds: (...args) => navigation.push(['fitBounds', ...args]), setView: (...args) => navigation.push(['setView', ...args]) },
    goTo: (...args) => navigation.push(['goTo', ...args])
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../outputs/territory-search.js'), 'utf8'), context);
  context.CroquisSearch.init();
  return { nodes, context, navigation, lock: () => { permitted = false; } };
}

test('Navegar a un subterritorio encuadra únicamente su polígono; el texto se construye como contenido seguro', () => {
  const { nodes, context, navigation } = browser();
  nodes['btn-territory-search'].click();
  assert.equal(nodes['territory-search-dialog'].open, true);
  assert.equal(nodes['territory-search-results'].children[0].children[0].textContent, '#2 · <b>La Tranca</b>');
  nodes['territory-search-input'].value = '8';
  context.CroquisSearch.refresh();
  nodes['territory-search-results'].children[0].click();
  assert.deepEqual(navigation[0], ['goTo', 0, true, false]);
  assert.equal(navigation[1][0], 'fitBounds');
  assert.deepEqual(JSON.parse(JSON.stringify(navigation[1][1])), points);
  assert.equal(navigation[1][2].animate, false);
  assert.equal(nodes['territory-search-dialog'].open, false);
});

test('La búsqueda desde recorrido respeta el bloqueo al abrir y al elegir un resultado ya mostrado', () => {
  const { nodes, context, navigation, lock } = browser();
  nodes['route-search'].click();
  const stale = nodes['territory-search-results'].children[0];
  lock();
  stale.click();
  assert.deepEqual(navigation, []);
  assert.equal(nodes['territory-search-dialog'].open, false);
  assert.equal(context.CroquisSearch.open(), false);
});

test('Un resultado de otra congregación no navega al cambiar la activa', () => {
  const { nodes, context, navigation } = browser();
  nodes['btn-territory-search'].click();
  const stale = nodes['territory-search-results'].children[0];
  context.congregacionActivaId = 'otra';
  stale.click();
  assert.deepEqual(navigation, []);
  assert.equal(nodes['territory-search-dialog'].open, false);
});

test('Enter abre el primer resultado del buscador y Escape cierra el recuadro devolviendo el foco', () => {
  const { nodes, navigation } = browser();
  nodes['btn-territory-search'].click();
  nodes['territory-search-input'].fire('keydown', { key: 'Enter' });
  assert.deepEqual(navigation, [['goTo', 0]]);
  nodes['route-search'].click();
  nodes['territory-search-dialog'].fire('cancel');
  assert.equal(nodes['territory-search-dialog'].open, false);
});
