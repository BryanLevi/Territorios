const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const mapDetails = require('../outputs/offline-map-details.js');

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
    const classes = new Set();
    if (!elements.has(id)) elements.set(id, {
      textContent:'', dataset:{}, hidden:false, disabled:false, value:0, handlers:{}, attributes:{},
      classList:{contains:name => classes.has(name) || (id === 'welcome-screen' && name === 'is-hidden'),
        toggle(name, value) { if (value) classes.add(name); else classes.delete(name); }},
      addEventListener(type, fn) { this.handlers[type] = fn; },
      querySelector() { return element(id + '-label'); },
      setAttribute(name, value) { this.attributes[name] = String(value); },
      getAttribute(name) { return this.attributes[name]; },
      focus() {}, showModal() { this.open = true; }, close() { this.open = false; }
    });
    return elements.get(id);
  };
  const records = new Map();
  const calls = {fetch:[], download:[], set:[], cache:[], shell:[], prepare:[], views:[], pause:0, resume:0, redraw:0};
  const networkHandlers = {};
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
      if (options.list) return options.list(group, records);
      return [...records].filter(([key]) => key.startsWith(group + ':'))
        .map(([key, data]) => ({key:key.slice(group.length + 1), data}));
    },
    async clear(group) {
      if (options.clear) await options.clear(group);
      [...records.keys()].filter(key => key.startsWith(group + ':')).forEach(key => records.delete(key));
    },
    async download(required, opts) {
      calls.download.push({required, opts});
      if (options.download) return options.download(required, opts, calls.download.length);
      return {roadElements:[], referenceElements:[], detailElements:[]};
    }
  };
  const context = {
    document:{getElementById:element, baseURI:options.baseURI},
    location:{href:options.pageUrl || 'https://example.test/Territorios/outputs/croquis_territorios.html'},
    navigator:{onLine:true, storage:{persist:options.persist || (async () => true)},
      serviceWorker:{register:async () => registration, ready:Promise.resolve(registration)}},
    caches:{open:async () => cache}, isSecureContext:true,
    CroquisOfflineData:dataStore, CroquisOfflineDetails:mapDetails,
    CroquisOfflineShell:{async prepare(settings) {
      calls.prepare.push(settings);
      return options.prepareShell ? options.prepareShell(settings) : true;
    }},
    addEventListener(type, fn) { networkHandlers[type] = fn; },
    pauseOnlineMapRequests() { calls.pause++; }, resumeOnlineMapRequests() { calls.resume++; },
    congregacionActivaId:'a', congregacionActual:() => ({nombre:context.congregacionActivaId}),
    LOCS:options.territories || [{num:1, nombre:'Primero'}], map:{}, DETAIL_ZOOM:16,
    getPrintBoundsPlain:loc => loc.bounds || frame, getColorAreasBoundsPlain:() => null,
    L:{latLngBounds:bounds}, displayTerritoryName:loc => loc.nombre,
    packRoadWays:ways => ways, unpackRoadWays:ways => ways,
    roadWaysFromOverpass:data => data.elements, referencesFromOverpass:data => data.elements,
    writeOverpassCache(loc, kind, value) { calls.cache.push({group:context.congregacionActivaId, key:loc.num, kind, value}); },
    currentView:'g-road', lastOnlineView:'g-road', offlineAutoView:false, runtimeRoadCache:null, runtimeReferenceCache:null,
    viewSel:{value:'g-road'},TILES:{'g-road':{name:'Google Calles - principal'},'g-sat':{name:'Google Satélite - vista previa'}},
    changeView(view) { calls.views.push(view); context.currentView=view; context.viewSel.value=view; },
    setStatus() {},
    updateRuntimeVectorRoadOverlay() { calls.redraw++; }, updateRuntimeReferenceOverlay() { calls.redraw++; },
    URL, AbortController, DOMException,
    setTimeout(fn, delay) { const id = ++timerId; timers.set(id, {fn, delay}); return id; },
    clearTimeout(id) { timers.delete(id); },
    MessageChannel:class { constructor() { this.port1 = {}; this.port2 = {dispatch:data => this.port1.onmessage({data})}; } },
    fetch:async (url, opts) => {
      calls.fetch.push({url:String(url), opts});
      return {ok:true, json:async () => options.pack || {version:2, territories:[{key:'1', bounds:broad, roads:[], refs:[], detailVersion:2, details:{areas:[],places:[]}}]}};
    }
  };
  context.window = context;
  vm.runInNewContext(source, context);
  return {context, calls, records, element, timers, networkHandlers,
    download:() => element('offline-download').handlers.click(),
    cancel:() => element('offline-cancel').handlers.click(),
    preview:() => element('offline-preview').handlers.click(),
    remove:() => element('offline-remove').handlers.click(),
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

test('la actualización comparte la preparación en curso y espera la página nueva antes de guardar mapas', {timeout:1000}, async () => {
  let shellReady = false;
  const waiting=deferred();
  const app = harness({cacheMatch:() => shellReady ? {ok:true} : undefined,
    prepareShell:async()=>{await waiting.promise;shellReady=true;return true;}});
  await app.ready();
  const pending = app.download();
  await tick();
  assert.equal(app.calls.set.length, 0);
  assert.equal(app.calls.fetch.length, 0);
  assert.equal(app.calls.prepare.length,1);
  assert.equal(app.calls.prepare[0].cacheName,'croquis-app-shell-v29');
  assert.ok(app.calls.prepare[0].files.includes('offline-shell.js'));
  assert.equal(app.element('offline-download').attributes['aria-busy'],'true');
  waiting.resolve();
  await pending;
  assert.equal(app.records.size, 1);
  assert.equal(app.element('offline-badge').textContent, 'Listo');
  assert.equal(app.element('offline-download').attributes['aria-busy'],'false');
  assert.equal(app.calls.redraw, 2);
});

test('un territorio con la misma clave pero otra zona usa la descarga correcta en lugar del paquete', async () => {
  const app = harness({pack:{version:2, territories:[
    {key:'1', bounds:{south:18, west:-98, north:18.1, east:-97.9}, roads:[{wrong:true}], refs:[],detailVersion:2,details:{areas:[],places:[]}},
    {key:'2', bounds:{south:'18', west:-98, north:21, east:-96}, roads:[], refs:[],detailVersion:2,details:{areas:[],places:[]}}
  ]}});
  await app.ready();
  await app.download();
  assert.equal(app.calls.download.length, 1);
  assert.deepEqual(app.calls.download[0].required, app.records.get('a:1').bounds);
  assert.equal(app.records.get('a:1').roads.length, 0);
  assert.equal(app.element('offline-badge').textContent, 'Listo');
});

test('un servidor fallido deja seguir con los otros territorios y al reanudar solo descarga el pendiente', async () => {
  const app = harness({territories:[{num:1, nombre:'Primero'}, {num:2, nombre:'Segundo'}], pack:{version:2, territories:[]},
    download:(required, opts, count) => {
      if (count === 1) throw new Error('Servidor ocupado');
      return {roadElements:[], referenceElements:[], detailElements:[]};
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
    pageUrl:'https://example.test/Territorios/croquis-territorios-jw/?emulador=1',
    baseURI:'https://example.test/Territorios/outputs/'
  });
  await app.ready();
  await app.download();
  assert.equal(app.calls.fetch.length, 1);
  assert.equal(app.calls.fetch[0].url, 'https://example.test/Territorios/outputs/offline-map-pack.json?v=details-2');
  const cached = new Set(app.calls.shell);
  assert.ok(cached.has('https://example.test/Territorios/outputs/croquis_territorios.html'));
  assert.ok(cached.has('https://example.test/Territorios/outputs/favicon.svg'));
  assert.ok(cached.has('https://example.test/Territorios/outputs/offline-map-details.js'));
  assert.ok(cached.has('https://example.test/Territorios/croquis-territorios-jw/'));
  assert.ok(cached.has('https://example.test/Territorios/croquis-territorios-jw/index.html'));
  assert.ok(cached.has('https://example.test/Territorios/croquis-territorio-jw/'));
  assert.ok(cached.has('https://example.test/Territorios/croquis-territorio-jw/index.html'));
  assert.ok(cached.has('https://example.test/Territorios/coquis-territorios-jw/'));
  assert.ok(cached.has('https://example.test/Territorios/coquis-territorios-jw/index.html'));
  assert.ok(cached.has('https://example.test/Territorios/vendor/leaflet/leaflet.js'));
  assert.equal([...cached].some(url => /(?:croquis-territorios-jw|croquis-territorio-jw|coquis-territorios-jw)\/(?:croquis_territorios|offline-data|favicon)/.test(url)), false);
  assert.equal(app.records.size, 1);
  assert.equal(app.calls.download.length, 0);
  assert.equal(app.element('offline-badge').textContent, 'Listo');
});

const savedRecord = () => ({bounds:{...broad}, roads:[], refs:[], details:{areas:[],places:[]}, detailVersion:2, savedAt:Date.now()});
const green = app => app.element('btn-offline').classList.contains('is-offline-ready');

test('la caché nueva completa no marca verde hasta comprobar que su versión está activa', async () => {
  const verified=deferred();
  const app=harness({prepareShell:()=>verified.promise});
  app.records.set('a:1',savedRecord());
  await app.ready();
  assert.equal(green(app),false);
  assert.equal(app.element('offline-preview').hidden,true);
  verified.resolve(true);
  await tick();
  await app.context.refreshOfflineCard();
  assert.equal(green(app),true);
  assert.equal(app.element('offline-preview').hidden,false);
  assert.equal(app.calls.fetch.length,0);
  assert.equal(app.calls.set.length,0);
});

test('el botón queda verde solo con todos los territorios cubiertos y la página completa', async () => {
  const app = harness({territories:[{num:1,nombre:'Uno'},{num:2,nombre:'Dos'}]});
  await app.ready();
  assert.equal(green(app),false);
  app.records.set('a:1',savedRecord());
  await app.context.refreshOfflineCard();
  assert.equal(green(app),false);
  assert.equal(app.element('offline-preview').hidden,true);
  app.records.set('a:2',savedRecord());
  await app.context.refreshOfflineCard();
  assert.equal(green(app),true);
  assert.equal(app.element('btn-offline').dataset.offlineState,'ready');
  assert.match(app.element('btn-offline').getAttribute('aria-label'),/Descarga completa/);
  assert.equal(app.element('offline-preview').hidden,false);
  assert.match(app.element('offline-status').textContent,/automáticamente/);
});

test('una página incompleta o un error de caché no marca verde aunque las calles estén guardadas', async () => {
  let shellReady=true;
  const app=harness({cacheMatch:()=>shellReady ? {ok:true} : {ok:false}});
  await app.ready();
  app.records.set('a:1',savedRecord());
  await app.context.refreshOfflineCard();
  assert.equal(green(app),true);
  shellReady=false;
  await app.context.refreshOfflineCard();
  assert.equal(green(app),false);
  assert.equal(app.element('offline-badge').textContent,'Por completar');
  assert.equal(app.element('offline-preview').hidden,true);
});

test('al mover el recuadro fuera de la descarga se quita verde antes de terminar la comprobación', async () => {
  const app=harness();
  await app.ready();
  app.records.set('a:1',savedRecord());
  await app.context.refreshOfflineCard();
  assert.equal(green(app),true);
  app.context.LOCS[0].bounds={south:20,west:-98,north:20.01,east:-97.99};
  const checking=app.context.refreshOfflineCard();
  assert.equal(green(app),false);
  await checking;
  assert.equal(green(app),false);
  assert.equal(app.element('offline-badge').textContent,'Sin descargar');
});

test('cambiar congregación limpia verde inmediatamente y una lectura anterior no lo restaura', async () => {
  const pending=deferred();
  let delayNext=false;
  const app=harness({list:(group,records)=>{
    if(delayNext){delayNext=false;return pending.promise;}
    return [...records].filter(([key])=>key.startsWith(group+':')).map(([key,data])=>({key:key.slice(group.length+1),data}));
  }});
  await app.ready();
  app.records.set('a:1',savedRecord());
  await app.context.refreshOfflineCard();
  assert.equal(green(app),true);
  delayNext=true;
  const previous=app.context.refreshOfflineCard();
  app.context.congregacionActivaId='b';
  const checking=app.context.refreshOfflineCard();
  assert.equal(green(app),false);
  await checking;
  pending.resolve([{key:'1',data:savedRecord()}]);
  await previous;
  assert.equal(green(app),false);
  assert.equal(app.element('offline-dialog-congregation').textContent,'b');
});

test('una lectura vieja de la misma congregación no restaura verde después de quitar su descarga', async () => {
  const pending=deferred();
  let delayNext=false;
  const app=harness({list:(group,records)=>{
    if(delayNext){delayNext=false;return pending.promise;}
    return [...records].filter(([key])=>key.startsWith(group+':')).map(([key,data])=>({key:key.slice(group.length+1),data}));
  }});
  await app.ready();
  app.records.set('a:1',savedRecord());
  await app.context.refreshOfflineCard();
  delayNext=true;
  const previous=app.context.refreshOfflineCard();
  await app.remove();
  assert.equal(green(app),false);
  pending.resolve([{key:'1',data:savedRecord()}]);
  await previous;
  assert.equal(green(app),false);
  assert.equal(app.records.size,0);
});

test('durante la eliminación ni una nueva comprobación ni la vista previa dejan verde el botón', async () => {
  const removing=deferred();
  const app=harness({clear:()=>removing.promise});
  await app.ready();
  app.records.set('a:1',savedRecord());
  await app.context.refreshOfflineCard();
  const operation=app.remove();
  assert.equal(green(app),false);
  await app.context.refreshOfflineCard();
  assert.equal(green(app),false);
  assert.equal(app.element('offline-download').disabled,true);
  assert.equal(app.element('offline-remove').disabled,true);
  removing.resolve();
  await operation;
  assert.equal(green(app),false);
});

test('un error al leer o quitar mapas elimina el estado verde y permite revisar la descarga', async () => {
  let failed=false;
  const app=harness({list:(group,records)=>{
    if(failed) throw new Error('No se pudo leer el dispositivo');
    return [...records].filter(([key])=>key.startsWith(group+':')).map(([key,data])=>({key:key.slice(group.length+1),data}));
  },clear:()=>{throw new Error('No se pudo quitar');}});
  await app.ready();
  app.records.set('a:1',savedRecord());
  await app.context.refreshOfflineCard();
  assert.equal(green(app),true);
  failed=true;
  await app.context.refreshOfflineCard();
  assert.equal(green(app),false);
  assert.equal(app.element('btn-offline').dataset.offlineState,'error');
  failed=false;
  await app.context.refreshOfflineCard();
  assert.equal(green(app),true);
  await app.remove();
  assert.equal(green(app),false);
  assert.equal(app.element('offline-download').disabled,false);
  assert.match(app.element('offline-status').textContent,/No se pudo quitar/);
});

test('elegir la vista guardada persiste al recuperar internet y permite volver a Google sin mover el encuadre', async () => {
  const app=harness();
  await app.ready();
  app.records.set('a:1',savedRecord());
  await app.context.refreshOfflineCard();
  app.context.map={center:{lat:19.049,lng:-96.982},zoom:17};
  const before=JSON.stringify(app.context.map);
  await app.preview();
  await app.ready();
  assert.equal(app.context.currentView,'offline');
  assert.equal(app.context.offlineAutoView,false);
  assert.equal(app.context.viewSel.value,'offline');
  assert.equal(app.element('offline-preview-label').textContent,'Volver a Google Calles');
  assert.equal(app.element('offline-preview').getAttribute('aria-pressed'),'true');
  assert.match(app.element('offline-status').textContent,/Estás viendo las calles y nombres guardados/);
  assert.equal(green(app),true);
  app.context.navigator.onLine=false;
  app.networkHandlers.offline();
  await app.ready();
  app.context.navigator.onLine=true;
  app.networkHandlers.online();
  await app.ready();
  assert.equal(app.context.currentView,'offline');
  assert.equal(app.context.viewSel.value,'offline');
  assert.equal(app.context.lastOnlineView,'g-road');
  assert.deepEqual(app.calls.views,['offline']);
  assert.equal(app.calls.fetch.length,0);
  await app.preview();
  await app.ready();
  assert.equal(app.context.currentView,'g-road');
  assert.equal(app.context.offlineAutoView,false);
  assert.equal(app.element('offline-preview-label').textContent,'Ver mapa guardado');
  assert.equal(JSON.stringify(app.context.map),before);
});

test('el respaldo automático se refleja en el selector y recuperarlo vuelve a la última base en línea', async () => {
  const app=harness();
  await app.ready();
  app.records.set('a:1',savedRecord());
  await app.context.refreshOfflineCard();
  app.context.currentView='g-sat';
  app.context.viewSel.value='g-sat';
  app.context.navigator.onLine=false;
  app.networkHandlers.offline();
  await app.ready();
  assert.equal(app.context.currentView,'offline');
  assert.equal(app.context.lastOnlineView,'g-sat');
  assert.equal(app.context.viewSel.value,'offline');
  assert.equal(app.context.offlineAutoView,true);
  assert.equal(green(app),true);
  assert.equal(app.element('offline-preview').disabled,true);
  app.context.navigator.onLine=true;
  app.networkHandlers.online();
  await app.ready();
  assert.equal(app.context.currentView,'g-sat');
  assert.equal(app.context.viewSel.value,'g-sat');
  assert.deepEqual(app.calls.views,['offline','g-sat']);
});

test('un clic de vista previa pendiente no abre la descarga de otra congregación', async () => {
  const pending=deferred();
  let delayNext=false;
  const app=harness({list:(group,records)=>{
    if(delayNext){delayNext=false;return pending.promise;}
    return [...records].filter(([key])=>key.startsWith(group+':')).map(([key,data])=>({key:key.slice(group.length+1),data}));
  }});
  await app.ready();
  app.records.set('a:1',savedRecord());
  app.records.set('b:1',savedRecord());
  await app.context.refreshOfflineCard();
  delayNext=true;
  const click=app.preview();
  app.context.congregacionActivaId='b';
  await app.context.refreshOfflineCard();
  assert.equal(green(app),true);
  pending.resolve([{key:'1',data:savedRecord()}]);
  await click;
  assert.equal(app.context.currentView,'g-road');
  assert.equal(app.calls.views.length,0);
});

function legacyRecord() {
  return {bounds:{...broad},roads:[{n:'Calle guardada',h:'residential',p:[[19,-97],[19.001,-97]]}],
    refs:[{name:'Escuela guardada',kind:'Escuela',lat:19,lng:-97}],savedAt:123};
}

test('una descarga antigua sigue visible y ofrece actualizar sin borrar ni marcar la mejora como lista', async () => {
  const app=harness();
  await app.ready();
  const old=legacyRecord();
  app.records.set('a:1',old);
  await app.context.refreshOfflineCard();
  assert.equal(green(app),false);
  assert.equal(app.element('offline-badge').textContent,'Actualización disponible');
  assert.equal(app.element('offline-download-label').textContent,'Actualizar mapa');
  assert.equal(app.context.offlineRecordCovers(app.context.LOCS[0],old),true);
  assert.equal(app.element('offline-preview').hidden,false);
  await app.preview();
  assert.equal(app.context.currentView,'offline');
  assert.equal(app.records.get('a:1'),old);
  assert.equal(app.calls.set.length,0);
  assert.equal(app.calls.download.length,0);
});

test('actualizar guarda detalles y nombres completos conservando las calles y referencias del paquete', async () => {
  const entry={key:'1',bounds:broad,roads:legacyRecord().roads,refs:legacyRecord().refs,detailVersion:2,
    details:{areas:[{id:'way/1',kind:'building',name:'Escuela',rings:[[[19,-97],[19.001,-97],[19.001,-96.999],[19,-97]]]}],
      places:[{name:'Centro',kind:'neighbourhood',lat:19,lng:-97}]}};
  const app=harness({pack:{version:2,territories:[entry]}});
  await app.ready();
  app.records.set('a:1',legacyRecord());
  await app.download();
  const updated=app.records.get('a:1');
  assert.equal(updated.detailVersion,2);
  assert.deepEqual(updated.details,entry.details);
  assert.deepEqual(updated.roads,entry.roads);
  assert.deepEqual(updated.refs,entry.refs);
  assert.equal(app.calls.download.length,0);
  assert.equal(app.calls.fetch[0].opts.cache,'no-store');
  assert.equal(green(app),true);
});

test('el fallo al preparar la página permanece visible al reabrir y no borra los mapas anteriores', async () => {
  let failed=true;
  const app=harness({prepareShell:async()=>{
    if(failed) throw new Error('No se pudo actualizar la página sin conexión.');
    return true;
  }});
  await app.ready();
  const old=legacyRecord();
  app.records.set('a:1',old);
  await app.download();
  const message=app.element('offline-status').textContent;
  assert.match(message,/No se pudo actualizar la página/);
  assert.equal(app.calls.fetch.length,0);
  assert.equal(app.calls.set.length,0);
  assert.equal(app.records.get('a:1'),old);
  await app.context.refreshOfflineCard();
  await app.context.refreshOfflineCard();
  assert.equal(app.element('offline-status').textContent,message);
  assert.equal(app.element('offline-badge').textContent,'Actualización pendiente');
  assert.equal(app.element('offline-download').disabled,false);
  failed=false;
  await app.download();
  assert.equal(app.records.get('a:1').detailVersion,2);
  assert.equal(green(app),true);
  assert.equal(app.element('offline-badge').textContent,'Listo');
});

test('los avisos de un intento fallido no pasan a otra congregación ni a un recuadro diferente', async () => {
  const app=harness({prepareShell:async()=>{throw new Error('Preparación antigua fallida');}});
  await app.ready();
  app.records.set('a:1',legacyRecord());
  await app.download();
  assert.match(app.element('offline-status').textContent,/Preparación antigua fallida/);
  app.context.LOCS[0].bounds={south:20,west:-98,north:20.01,east:-97.99};
  await app.context.refreshOfflineCard();
  assert.doesNotMatch(app.element('offline-status').textContent,/Preparación antigua fallida/);
  await app.download();
  app.context.congregacionActivaId='b';
  await app.context.refreshOfflineCard();
  assert.doesNotMatch(app.element('offline-status').textContent,/Preparación antigua fallida/);
});

test('cancelar mientras se prepara la actualización libera controles y no inicia el paquete al terminar la preparación', async () => {
  const waiting=deferred();
  const app=harness({prepareShell:async()=>{await waiting.promise;return true;}});
  await app.ready();
  const old=legacyRecord();
  app.records.set('a:1',old);
  const operation=app.download();
  await tick();
  app.cancel();
  await operation;
  assert.equal(app.element('offline-download').disabled,false);
  assert.equal(app.calls.fetch.length,0);
  assert.equal(app.calls.set.length,0);
  assert.equal(app.records.get('a:1'),old);
  waiting.resolve();
  await tick();
  await app.context.refreshOfflineCard();
  assert.equal(app.calls.fetch.length,0);
  assert.equal(app.calls.set.length,0);
  assert.equal(app.element('offline-badge').textContent,'Pausado');
  assert.match(app.element('offline-status').textContent,/Descarga pausada/);
});

test('una actualización fallida conserva la copia antigua y sus referencias', async () => {
  const app=harness({pack:{version:1,territories:[]},download:()=>{throw new Error('Servidor ocupado');}});
  await app.ready();
  const old=legacyRecord();
  app.records.set('a:1',old);
  await app.download();
  assert.equal(app.records.get('a:1'),old);
  assert.equal(app.calls.set.length,0);
  assert.equal(app.context.offlineRecordCovers(app.context.LOCS[0],old),true);
  assert.match(app.element('offline-status').textContent,/Servidor ocupado/);
  assert.equal(green(app),false);
  assert.equal(app.element('offline-preview').hidden,false);
  await app.preview();
  assert.equal(app.context.currentView,'offline');
});

test('cancelar una actualización no reemplaza la copia antigua por datos pendientes', async () => {
  const waiting=deferred(),began=deferred();
  const app=harness({pack:{version:2,territories:[]},download:()=>{began.resolve();return waiting.promise;}});
  await app.ready();
  const old=legacyRecord();
  app.records.set('a:1',old);
  const operation=app.download();
  await began.promise;
  app.cancel();
  waiting.resolve({roadElements:[],referenceElements:[],detailElements:[]});
  await operation;
  assert.equal(app.records.get('a:1'),old);
  assert.equal(app.calls.set.length,0);
  assert.match(app.element('offline-status').textContent,/Descarga pausada/);
  assert.equal(app.element('offline-preview').hidden,false);
});

test('si no hay espacio para actualizar, la copia anterior permanece disponible', async () => {
  const app=harness({set:()=>{throw new DOMException('No hay espacio suficiente para guardar el mapa.','QuotaExceededError');}});
  await app.ready();
  const old=legacyRecord();
  app.records.set('a:1',old);
  await app.download();
  assert.equal(app.records.get('a:1'),old);
  assert.equal(app.element('offline-preview').hidden,false);
  assert.equal(green(app),false);
  assert.match(app.element('offline-status').textContent,/No hay espacio/);
  await app.preview();
  assert.equal(app.context.currentView,'offline');
});

test('una respuesta sin la capa de detalles no se guarda sobre una descarga válida', async () => {
  const app=harness({pack:{version:2,territories:[]},download:()=>({roadElements:[],referenceElements:[]})});
  await app.ready();
  const old=legacyRecord();
  app.records.set('a:1',old);
  await app.download();
  assert.equal(app.records.get('a:1'),old);
  assert.equal(app.calls.set.length,0);
  assert.equal(green(app),false);
  assert.match(app.element('offline-status').textContent,/no incluyó todos los detalles/);
  assert.equal(app.element('offline-preview').hidden,false);
});

test('un contorno multipolígono incompleto no reemplaza la descarga anterior', async () => {
  const app=harness({pack:{version:2,territories:[]},download:()=>({roadElements:[],referenceElements:[],
    detailElements:[{type:'relation',id:10,tags:{type:'multipolygon',landuse:'forest'},
      members:[{type:'way',ref:11,role:'outer',geometry:[{lat:19,lon:-97},{lat:19.01,lon:-97}]}]}]})});
  await app.ready();
  const old=legacyRecord();
  app.records.set('a:1',old);
  await app.download();
  assert.equal(app.records.get('a:1'),old);
  assert.equal(app.calls.set.length,0);
  assert.equal(app.element('offline-preview').hidden,false);
  assert.equal(green(app),false);
});

test('continuar una actualización omite los territorios ya detallados y mantiene el resto', async () => {
  const app=harness({territories:[{num:1,nombre:'Uno'},{num:2,nombre:'Dos'}],pack:{version:2,territories:[]}});
  await app.ready();
  const upgraded=savedRecord();
  app.records.set('a:1',upgraded);
  app.records.set('a:2',legacyRecord());
  await app.download();
  assert.equal(app.records.get('a:1'),upgraded);
  assert.equal(app.calls.download.length,1);
  assert.deepEqual(app.calls.set.map(call=>call.key),['2']);
  assert.equal(app.records.get('a:2').detailVersion,2);
  assert.equal(green(app),true);
});
