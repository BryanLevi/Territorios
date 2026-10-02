const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../outputs/offline-controller.js'), 'utf8');
const frame = {south:19, west:-97, north:19.01, east:-96.99};
const broad = {south:18.99, west:-97.01, north:19.02, east:-96.98};
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return {promise, resolve};
};
const tick = () => new Promise(resolve => setImmediate(resolve));

function bounds(a, b) {
  return {
    getSouth:() => a[0], getWest:() => a[1], getNorth:() => b[0], getEast:() => b[1],
    pad(ratio) {
      const lat = (b[0] - a[0]) * ratio, lng = (b[1] - a[1]) * ratio;
      return bounds([a[0] - lat, a[1] - lng], [b[0] + lat, b[1] + lng]);
    }
  };
}

function harness(options = {}) {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      textContent:'', dataset:{}, hidden:false, disabled:false, value:0, handlers:{},
      classList:{contains:() => id === 'welcome-screen'},
      addEventListener(type, fn) { this.handlers[type] = fn; },
      querySelector() { return element(id + '-label'); },
      focus() {}, showModal() { this.open = true; }, close() { this.open = false; }
    });
    return elements.get(id);
  };
  const records = new Map();
  const calls = {fetch:[], download:[], set:[], cache:[], shell:[], pause:0, resume:0, redraw:0};
  const timers = new Map();
  let timerId = 0;
  const cache = {match:async url => {
    calls.shell.push(url);
    return options.cacheMatch ? options.cacheMatch(url) : {ok:true};
  }};
  const registration = options.registration || {active:{postMessage() { throw new Error('Unexpected shell download'); }}};
  const dataStore = {
    async get(group, key) { return options.get ? options.get(group, key) : records.get(group + ':' + key) || null; },
    async set(group, key, record) {
      calls.set.push({group, key, record});
      if (options.set) await options.set(group, key, record);
      records.set(group + ':' + key, record);
    },
    async list(group) {
      return [...records].filter(([key]) => key.startsWith(group + ':'))
        .map(([key, data]) => ({key:key.slice(group.length + 1), data}));
    },
    async clear() {},
    async download(required, opts) {
      calls.download.push({required, opts});
      if (options.download) return options.download(required, opts, calls.download.length);
      return {roadElements:[], referenceElements:[]};
    }
  };
  const context = {
    document:{getElementById:element, baseURI:options.baseURI},
    location:{href:options.pageUrl || 'https://example.test/Territorios/outputs/croquis_territorios.html'},
    navigator:{onLine:true, storage:{persist:options.persist || (async () => true)},
      serviceWorker:{register:async () => registration, ready:Promise.resolve(registration)}},
    caches:{open:async () => cache}, isSecureContext:true,
    CroquisOfflineData:dataStore, addEventListener() {},
    pauseOnlineMapRequests() { calls.pause++; }, resumeOnlineMapRequests() { calls.resume++; },
    congregacionActivaId:'a', congregacionActual:() => ({nombre:context.congregacionActivaId}),
    LOCS:options.territories || [{num:1, nombre:'Primero'}], map:{}, DETAIL_ZOOM:16,
    getPrintBoundsPlain:loc => loc.bounds || frame, getColorAreasBoundsPlain:() => null,
    L:{latLngBounds:bounds}, displayTerritoryName:loc => loc.nombre,
    packRoadWays:ways => ways, unpackRoadWays:ways => ways,
    roadWaysFromOverpass:data => data.elements, referencesFromOverpass:data => data.elements,
    writeOverpassCache(loc, kind, value) { calls.cache.push({group:context.congregacionActivaId, key:loc.num, kind, value}); },
    currentView:'google', runtimeRoadCache:null, runtimeReferenceCache:null,
    updateRuntimeVectorRoadOverlay() { calls.redraw++; }, updateRuntimeReferenceOverlay() { calls.redraw++; },
    URL, AbortController, DOMException,
    setTimeout(fn, delay) { const id = ++timerId; timers.set(id, {fn, delay}); return id; },
    clearTimeout(id) { timers.delete(id); },
    MessageChannel:class { constructor() { this.port1 = {}; this.port2 = {dispatch:data => this.port1.onmessage({data})}; } },
    fetch:async (url, opts) => {
      calls.fetch.push({url:String(url), opts});
      return {ok:true, json:async () => options.pack || {version:1, territories:[{key:'1', bounds:broad, roads:[], refs:[]}]}};
    }
  };
  context.window = context;
  vm.runInNewContext(source, context);
  return {context, calls, records, element, timers,
    download:() => element('offline-download').handlers.click(),
    cancel:() => element('offline-cancel').handlers.click(),
    ready:async () => { await tick(); await context.refreshOfflineCard(); }
  };
}

test('cancelar durante el permiso de almacenamiento libera la descarga sin esperar el permiso', {timeout:1000}, async () => {
  const permission = deferred(), began = deferred();
  const app = harness({persist:() => { began.resolve(); return permission.promise; }});
  await app.ready();
  const pending = app.download();
  await began.promise;
  app.cancel();
  await pending;
  assert.match(app.element('offline-status').textContent, /Descarga pausada/);
  assert.equal(app.element('offline-download').disabled, false);
  assert.equal(app.calls.fetch.length, 0);
  assert.equal(app.calls.set.length, 0);
  assert.equal(app.calls.resume, 1);
  permission.resolve(true);
});

test('cancelar mientras se lee el dispositivo impide empezar otra petición del paquete', {timeout:1000}, async () => {
  const read = deferred(), began = deferred();
  const app = harness({get:() => { began.resolve(); return read.promise; }});
  await app.ready();
  const pending = app.download();
  await began.promise;
  app.cancel();
  read.resolve(null);
  await pending;
  assert.equal(app.calls.fetch.length, 0);
  assert.equal(app.calls.download.length, 0);
  assert.equal(app.calls.set.length, 0);
  assert.match(app.element('offline-status').textContent, /Descarga pausada/);
});

test('cambiar congregación durante la escritura no contamina la caché de la nueva congregación', {timeout:1000}, async () => {
  const writing = deferred(), began = deferred();
  const app = harness({set:() => { began.resolve(); return writing.promise; }});
  await app.ready();
  const pending = app.download();
  await began.promise;
  app.context.congregacionActivaId = 'b';
  app.context.LOCS = [{num:1, nombre:'Otro', bounds:{south:20, west:-98, north:20.01, east:-97.99}}];
  await app.context.refreshOfflineCard();
  writing.resolve();
  await pending;
  assert.ok(app.records.has('a:1'));
  assert.equal(app.records.has('b:1'), false);
  assert.equal(app.calls.cache.length, 0);
  assert.equal(app.element('offline-dialog-congregation').textContent, 'b');
  assert.doesNotMatch(app.element('offline-status').textContent, /Descarga pausada|Listo/);
  assert.equal(app.calls.redraw, 0);
});

test('la actualización espera al trabajador nuevo aunque ready siga teniendo el anterior', {timeout:1000}, async () => {
  let shellReady = false, oldMessages = 0, newMessages = 0;
  const listeners = new Set();
  const worker = {
    state:'installing', addEventListener(type, fn) { listeners.add(fn); }, removeEventListener(type, fn) { listeners.delete(fn); },
    postMessage(message, ports) { newMessages++; shellReady = true; ports[0].dispatch({ok:true}); }
  };
  const registration = {active:{postMessage() { oldMessages++; }}, installing:worker};
  const app = harness({registration, cacheMatch:() => shellReady ? {ok:true} : undefined});
  await app.ready();
  const pending = app.download();
  await tick();
  assert.equal(app.calls.set.length, 0);
  assert.equal(oldMessages, 0);
  registration.active = worker;
  registration.installing = null;
  worker.state = 'activated';
  [...listeners].forEach(fn => fn());
  await pending;
  assert.equal(oldMessages, 0);
  assert.equal(newMessages, 1);
  assert.equal(app.records.size, 1);
  assert.equal(app.element('offline-badge').textContent, 'Listo');
  assert.equal(app.calls.redraw, 2);
});

test('un territorio con la misma clave pero otra zona usa la descarga correcta en lugar del paquete', async () => {
  const app = harness({pack:{version:1, territories:[
    {key:'1', bounds:{south:18, west:-98, north:18.1, east:-97.9}, roads:[{wrong:true}], refs:[]},
    {key:'2', bounds:{south:'18', west:-98, north:21, east:-96}, roads:[], refs:[]}
  ]}});
  await app.ready();
  await app.download();
  assert.equal(app.calls.download.length, 1);
  assert.deepEqual(app.calls.download[0].required, app.records.get('a:1').bounds);
  assert.equal(app.records.get('a:1').roads.length, 0);
  assert.equal(app.element('offline-badge').textContent, 'Listo');
});

test('un servidor fallido deja seguir con los otros territorios y al reanudar solo descarga el pendiente', async () => {
  const app = harness({territories:[{num:1, nombre:'Primero'}, {num:2, nombre:'Segundo'}], pack:{version:1, territories:[]},
    download:(required, opts, count) => {
      if (count === 1) throw new Error('Servidor ocupado');
      return {roadElements:[], referenceElements:[]};
    }
  });
  await app.ready();
  await app.download();
  assert.equal(app.calls.download.length, 2);
  assert.equal(app.records.has('a:1'), false);
  assert.equal(app.records.has('a:2'), true);
  assert.match(app.element('offline-status').textContent, /Faltan: Primero/);
  assert.equal(app.element('offline-download-label').textContent, 'Continuar descarga');
  await app.download();
  assert.equal(app.calls.download.length, 3);
  assert.equal(app.records.size, 2);
  assert.equal(app.element('offline-badge').textContent, 'Listo');
});

test('la dirección limpia descarga el paquete y revisa la caché usando la base de recursos original', async () => {
  const app = harness({
    pageUrl:'https://example.test/Territorios/coquis-territorios-jw/?emulador=1',
    baseURI:'https://example.test/Territorios/outputs/'
  });
  await app.ready();
  await app.download();
  assert.equal(app.calls.fetch.length, 1);
  assert.equal(app.calls.fetch[0].url, 'https://example.test/Territorios/outputs/offline-map-pack.json');
  const cached = new Set(app.calls.shell);
  assert.ok(cached.has('https://example.test/Territorios/outputs/croquis_territorios.html'));
  assert.ok(cached.has('https://example.test/Territorios/outputs/favicon.svg'));
  assert.ok(cached.has('https://example.test/Territorios/coquis-territorios-jw/'));
  assert.ok(cached.has('https://example.test/Territorios/coquis-territorios-jw/index.html'));
  assert.ok(cached.has('https://example.test/Territorios/vendor/leaflet/leaflet.js'));
  assert.equal([...cached].some(url => /coquis-territorios-jw\/(?:croquis_territorios|offline-data|favicon)/.test(url)), false);
  assert.equal(app.records.size, 1);
  assert.equal(app.calls.download.length, 0);
  assert.equal(app.element('offline-badge').textContent, 'Listo');
});
