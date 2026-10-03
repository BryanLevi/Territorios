const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../outputs/offline-data.js'), 'utf8');
const bounds = {south:19, west:-97, north:19.04, east:-96.96};
const main = 'https://overpass-api.de/api/interpreter';
const alternate = 'https://overpass.private.coffee/api/interpreter';
const road = id => ({type:'way', id, tags:{highway:'residential'}, geometry:[{lat:19.01, lon:-96.99}, {lat:19.02, lon:-96.98}]});
const response = (elements = [], extra = {}) => ({ok:true, status:200, headers:new Headers(), json:async () => ({elements, ...extra})});
const failure = (status, retryAfter) => ({ok:false, status, headers:new Headers(retryAfter ? {'Retry-After':retryAfter} : {})});

function harness(fetcher) {
  const clock = {now:1000};
  const calls = [];
  const timers = new Map();
  const listeners = new Map();
  let timerId = 0;
  class Clock extends Date { static now() { return clock.now; } }
  const window = {
    navigator:{onLine:true},
    addEventListener(type, callback) { listeners.set(type, callback); },
    removeEventListener(type, callback) { if (listeners.get(type) === callback) listeners.delete(type); },
    fetch:async (endpoint, options) => {
      const call = {endpoint, ...options, query:decodeURIComponent(options.body.slice(5))};
      calls.push(call);
      return fetcher(call, calls.length, {clock, timers, window});
    }
  };
  vm.runInNewContext(source, {window, Date:Clock, AbortController, DOMException,
    setTimeout(callback, delay) { const id = ++timerId; timers.set(id, {callback, delay}); return id; },
    clearTimeout(id) { timers.delete(id); }
  });
  return {api:window.CroquisOfflineData, calls, clock, timers, listeners, window};
}

test('una respuesta completa combina el mismo icono con su calle sin perder geometría ni centro', async () => {
  const data = harness(async call => {
    assert.match(call.query, /\[timeout:20\]/);
    return response([road(5), {type:'way', id:5, tags:{amenity:'school', name:'Escuela'}, center:{lat:19.01, lon:-96.99}}]);
  });
  const result = await data.api.download(bounds);
  assert.equal(data.calls.length, 1);
  assert.equal(result.roadElements.length, 1);
  assert.equal(result.referenceElements.length, 1);
  assert.equal(result.roadElements[0].geometry.length, 2);
  assert.equal(result.referenceElements[0].center.lat, 19.01);
  assert.equal(result.referenceElements[0].tags.name, 'Escuela');
  assert.equal(result.referenceElements[0].tags.highway, 'residential');
  assert.equal(data.timers.size, 0);
});

test('cambia de servidor una sola vez y prefiere el que respondió en el siguiente territorio', async () => {
  const progress = [];
  const data = harness(async (call, count) => count === 1 ? failure(503, '120') : response([road(count)]));
  await data.api.download(bounds, {onProgress:event => progress.push(event.phase)});
  await data.api.download(bounds);
  assert.deepEqual(data.calls.map(call => call.endpoint), [main, alternate, alternate]);
  assert.deepEqual(progress, ['request', 'retry']);
});

test('divide una consulta rechazada por tamaño en cuatro zonas completas y une elementos compartidos', async () => {
  const progress = [];
  const data = harness(async (call, count) => count <= 2 ? failure(504) : response([road(5), road(count)]));
  const result = await data.api.download(bounds, {onProgress:event => progress.push(event)});
  assert.equal(data.calls.length, 6);
  assert.equal(result.roadElements.length, 4);
  const boxes = data.calls.slice(2).map(call => call.query.match(/\((19[\d.,-]+)\);/)[1]);
  assert.deepEqual(boxes, [
    '19.000000,-97.000000,19.020000,-96.980000',
    '19.000000,-96.980000,19.020000,-96.960000',
    '19.020000,-97.000000,19.040000,-96.980000',
    '19.020000,-96.980000,19.040000,-96.960000'
  ]);
  assert.ok(progress.some(event => event.phase === 'split'));
  assert.deepEqual(progress.filter(event => event.total === 4 && event.phase === 'request').map(event => event.part), [1,2,3,4]);
});

test('no acepta resultados parciales con remark ni devuelve un territorio con una zona fallida', async () => {
  const incomplete = harness(async (call, count) => count <= 2
    ? response([road(999)], {remark:'runtime error: Query timed out after 20 seconds.'})
    : response([road(count)]));
  const result = await incomplete.api.download(bounds);
  assert.equal(incomplete.calls.length, 6);
  assert.ok(result.roadElements.every(element => element.id !== 999));

  const failedCell = harness(async (call, count) => count <= 2 ? failure(504) : count === 3 ? response([road(3)]) : failure(400));
  await assert.rejects(failedCell.api.download(bounds), /Servidor de calles: 400/);
  assert.equal(failedCell.calls.length, 5);
});

test('respeta Retry-After y evita repetir peticiones a servidores saturados', async () => {
  const data = harness(async () => failure(429, '180'));
  await assert.rejects(data.api.download(bounds), /ocupado/);
  await assert.rejects(data.api.download(bounds), /ocupado/);
  assert.equal(data.calls.length, 2);
  data.clock.now += 180000;
  await assert.rejects(data.api.download(bounds), /ocupado/);
  assert.equal(data.calls.length, 4);
});

test('el límite total es 90 segundos incluso al dividir y no se repiten rondas largas', async () => {
  const delays = [];
  const data = harness((call, count, {clock, timers}) => new Promise((resolve, reject) => {
    call.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), {once:true});
    const timer = [...timers.values()].at(-1);
    delays.push(timer.delay);
    queueMicrotask(() => { clock.now += timer.delay; timer.callback(); });
  }));
  await assert.rejects(data.api.download(bounds), /pendiente/);
  assert.deepEqual(delays, [25000,25000,25000,15000]);
  assert.equal(data.clock.now, 91000);
  assert.equal(data.calls.length, 4);
  assert.equal(data.timers.size, 0);
});

test('cancelar o perder internet detiene la consulta activa sin probar otros servidores', async () => {
  let started;
  const began = new Promise(resolve => { started = resolve; });
  const data = harness(call => new Promise((resolve, reject) => {
    call.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), {once:true});
    started();
  }));
  const controller = new AbortController();
  const pending = data.api.download(bounds, {signal:controller.signal});
  await began;
  controller.abort();
  await assert.rejects(pending, {name:'AbortError'});
  assert.equal(data.calls.length, 1);
  assert.equal(data.listeners.size, 0);
  assert.equal(data.timers.size, 0);

  let wentOffline;
  const online = harness(call => new Promise((resolve, reject) => {
    call.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), {once:true});
    queueMicrotask(() => wentOffline());
  }));
  wentOffline = () => { online.window.navigator.onLine = false; online.listeners.get('offline')(); };
  await assert.rejects(online.api.download(bounds), /perdió la conexión/);
  assert.equal(online.calls.length, 1);
  await assert.rejects(online.api.download(bounds), /perdió la conexión/);
  assert.equal(online.calls.length, 1);
});

test('una descarga conserva áreas con geometría, huecos y localidades además de calles y referencias',async()=>{
  const ring=[{lat:19.01,lon:-96.99},{lat:19.02,lon:-96.99},{lat:19.02,lon:-96.98},{lat:19.01,lon:-96.98},{lat:19.01,lon:-96.99}];
  const forest={type:'relation',id:20,tags:{type:'multipolygon',natural:'wood'},members:[{type:'way',ref:21,role:'outer',geometry:ring}]};
  const building={type:'way',id:22,tags:{building:'yes'},geometry:ring};
  const town={type:'node',id:23,tags:{place:'town',name:'Ixhuatlán del Café'},lat:19.015,lon:-96.985};
  const app=harness(call=>{
    assert.match(call.query,/wr\[~"\^\(building\|landuse\|natural\|leisure\|waterway\)/);
    assert.match(call.query,/nwr\["place"/);
    assert.match(call.query,/\.details out geom;/);
    return response([road(1),forest,building,town]);
  });
  const result=await app.api.download(bounds);
  assert.equal(result.roadElements.length,1);
  assert.equal(result.detailElements.length,3);
  assert.equal(result.detailElements[0].members[0].geometry.length,5);
  assert.equal(result.detailElements[2].tags.name,'Ixhuatlán del Café');
});

test('divide y une áreas compartidas sin duplicar una relación ni perder sus miembros geométricos',async()=>{
  const forest={type:'relation',id:20,tags:{type:'multipolygon',natural:'wood'},members:[{type:'way',ref:21,role:'outer',geometry:[{lat:19,lon:-97},{lat:19.02,lon:-97}]}]};
  const app=harness((call,count)=>count<=2 ? failure(504) : response([forest,{type:'node',id:count,tags:{place:'hamlet',name:'Pueblo '+count},lat:19.01,lon:-96.99}]));
  const result=await app.api.download(bounds);
  assert.equal(result.detailElements.filter(element=>element.type==='relation').length,1);
  assert.equal(result.detailElements.find(element=>element.type==='relation').members[0].geometry.length,2);
  assert.equal(result.detailElements.filter(element=>element.type==='node').length,4);
});
