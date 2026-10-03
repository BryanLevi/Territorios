const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = file => JSON.parse(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'));
const pack = read('outputs/offline-map-pack.json');
const source = read('tools/offline-map-bounds.json');
const details = require('../outputs/offline-map-details.js');

test('el paquete público incluye todos los territorios preparados y su área completa', () => {
  assert.equal(pack.version, 2);
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
    assert.equal(entry.detailVersion, details.VERSION);
    assert.equal(details.valid(entry.details),true,'Geometría inválida en '+territory.name);
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
    assert.deepEqual(Object.keys(entry).sort(), ['bounds', 'detailVersion', 'details', 'key', 'name', 'refs', 'roads', 'savedAt']);
    assert.ok(Number.isFinite(entry.savedAt));
    for (const area of entry.details.areas) assert.deepEqual(Object.keys(area).sort(),['id','kind','name','rings']);
    for (const place of entry.details.places) assert.deepEqual(Object.keys(place).sort(),['kind','lat','lng','name']);
  }
});

test('el paquete incluye edificios, verde y nombres públicos donde OSM los tiene, sin crear detalles de Google',()=>{
  const town=pack.territories.find(entry=>entry.name==='Ixhuatlán del Café');
  assert(town.details.areas.some(area=>area.kind==='building'));
  assert(town.details.areas.some(area=>area.kind==='park'));
  assert(town.details.areas.some(area=>area.kind==='forest'));
  assert(town.details.places.some(place=>place.name==='Ixhuatlán del Café'));
  assert.equal(town.refs.some(ref=>ref.name==='Papelería El Girasol'),false);
  const areaCount=pack.territories.reduce((total,entry)=>total+entry.details.areas.length,0);
  assert(areaCount>=100);
});
