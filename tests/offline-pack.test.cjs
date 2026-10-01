const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = file => JSON.parse(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'));
const pack = read('outputs/offline-map-pack.json');
const source = read('tools/offline-map-bounds.json');

test('el paquete público incluye todos los territorios preparados y su área completa', () => {
  assert.equal(pack.version, 1);
  assert.equal(pack.territories.length, source.territories.length);
  assert.equal(new Set(pack.territories.map(entry => entry.key)).size, pack.territories.length);
  for (const territory of source.territories) {
    const entry = pack.territories.find(item => item.key === territory.key);
    assert.ok(entry, territory.name);
    assert.equal(entry.name, territory.name);
    assert.deepEqual(entry.bounds, territory.bounds);
    assert.ok(entry.bounds.south < entry.bounds.north && entry.bounds.west < entry.bounds.east);
    assert.ok(entry.roads.length > 0, 'Faltan las calles de ' + territory.name);
    assert.ok(Array.isArray(entry.refs));
  }
});

test('las calles y referencias del paquete tienen coordenadas utilizables sin internet', () => {
  const validPoint = (lat, lng) => Number.isFinite(lat) && Number.isFinite(lng)
    && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
  for (const entry of pack.territories) {
    for (const road of entry.roads) {
      assert.ok(Array.isArray(road.p) && road.p.length >= 2, entry.name);
      assert.ok(road.p.every(point => Array.isArray(point) && point.length === 2 && validPoint(...point)), entry.name);
      assert.ok(road.h || road.w, entry.name);
    }
    for (const reference of entry.refs) {
      assert.ok(validPoint(reference.lat, reference.lng), entry.name);
      assert.equal(typeof reference.name, 'string');
      assert.equal(typeof reference.kind, 'string');
    }
  }
});

test('el paquete conserva atribución y solo contiene datos públicos del mapa', () => {
  assert.equal(pack.attribution, '© OpenStreetMap contributors');
  assert.equal(pack.license, 'https://www.openstreetmap.org/copyright');
  for (const entry of pack.territories) {
    assert.deepEqual(Object.keys(entry).sort(), ['bounds', 'key', 'name', 'refs', 'roads', 'savedAt']);
    assert.ok(Number.isFinite(entry.savedAt));
  }
});
