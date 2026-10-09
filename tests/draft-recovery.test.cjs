const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../outputs/draft-recovery.js'), 'utf8');
const KEY = 'croquis-draw-drafts-v1';
const copy = value => JSON.parse(JSON.stringify(value));
const points = [[19.01, -96.99], [19.02, -96.98], [19.03, -96.97]];
function record(overrides = {}) {
  return { version:1, congregationId:'ixhuatlan', locNum:'1', kind:'area', points,
    color:'#00aabb', opacity:45, savedAt:123456,
    camera:{center:[19.024681, -96.975319], zoom:19}, ...overrides };
}

function harness() {
  const elements = new Map(), data = new Map(), timers = new Map(), handlers = {}, movements = [], writes = [], renders = [], statuses = [], navigations = [];
  let serial = 0;
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      handlers:{}, textContent:'', hidden:false, open:false, value:'', focus() {},
      classList:{ contains:name => id === 'welcome-screen' && name === 'is-hidden' && c.editorOpen },
      addEventListener(name, fn) { this.handlers[name] = fn; },
      showModal() { this.open = true; }, close() { this.open = false; }
    });
    return elements.get(id);
  };
  const noop = () => {};
  const localStorage = {
    getItem:key => data.get(key) || null,
    setItem(key, value) { writes.push({key, value}); if(c.storageFail) throw new Error('full'); data.set(key, value); },
    removeItem(key) { writes.push({key, removed:true}); if(c.storageFail) throw new Error('full'); data.delete(key); }
  };
  const camera = { center:[19.04, -96.96], zoom:18 };
  const c = vm.createContext({
    document:{getElementById:element, visibilityState:'visible',
      addEventListener:(name, fn) => { handlers[name] = fn; }},
    window:{ addEventListener:(name, fn) => { handlers[name] = fn; }, CroquisAccess:{canEnter:() => c.accessAllowed} },
    localStorage, editorOpen:true, accessAllowed:true,
    congregacionActivaId:'ixhuatlan', currentIndex:0, LOCS:[{num:1,name:'Café'}, {num:2,name:'Tranca'}],
    claveDe:(key, id) => id === 'ixhuatlan' ? key : `${key}::${id}`,
    almacen:{
      getItem:key => localStorage.getItem(c.claveDe(key, c.congregacionActivaId)),
      setItem:(key, value) => localStorage.setItem(c.claveDe(key, c.congregacionActivaId), value),
      removeItem:key => localStorage.removeItem(c.claveDe(key, c.congregacionActivaId))
    },
    setTimeout(fn) { const id = ++serial; timers.set(id, fn); return id; }, clearTimeout:id => timers.delete(id),
    map:{
      getCenter:() => ({lat:camera.center[0], lng:camera.center[1]}), getZoom:() => camera.zoom,
      getMinZoom:() => 0, getMaxZoom:() => 21, on:(name, fn) => { handlers[`map:${name}`] = fn; }, off:noop,
      setView(center, zoom, options) { camera.center = Array.from(center); camera.zoom = zoom; movements.push(copy({center, zoom, options})); }
    },
    L:{latLng:(lat, lng) => ({lat, lng})},
    colorDrawMode:false, roadPencilMode:false, modoCarretera:false, riverPencilMode:false,
    draftPoints:[], roadDraftPoints:[], riverDraftPoints:[],
    colorInput:{value:'#00aabb'}, colorOpacityInput:{value:'45'},
    getFillOpacity:() => Number(c.colorOpacityInput.value) / 100,
    displayTerritoryTitle:loc => `#${loc.num} ${loc.name}`,
    updateColorControls:noop, setStatus:(text, level) => statuses.push({text, level})
  });
  const resetModes = () => {
    c.colorDrawMode = c.roadPencilMode = c.riverPencilMode = false;
    c.draftPoints = []; c.roadDraftPoints = []; c.riverDraftPoints = [];
    c.window.CroquisDrafts?.capture();
  };
  c.setColorDrawMode = active => { resetModes(); c.colorDrawMode = active; };
  c.setRoadPencilMode = (active, silent, highway) => { resetModes(); c.roadPencilMode = active; c.modoCarretera = !!highway; };
  c.setRiverPencilMode = active => { resetModes(); c.riverPencilMode = active; };
  c.renderDraftArea = () => { renders.push('area'); c.window.CroquisDrafts?.capture(); };
  c.renderRoadDraft = () => { renders.push('road'); c.window.CroquisDrafts?.capture(); };
  c.renderRiverDraft = () => { renders.push('river'); c.window.CroquisDrafts?.capture(); };
  c.goTo = (index, silent, fitMap) => {
    navigations.push({index,silent,fitMap});
    c.window.CroquisDrafts?.leave();
    c.currentIndex=index; resetModes(); c.window.CroquisDrafts?.offer(c.LOCS[index]);
  };
  vm.runInContext(source, c);
  const api = c.window.CroquisDrafts;
  const stored = (id = c.congregacionActivaId) => {
    const raw = data.get(c.claveDe(KEY, id));
    return raw ? JSON.parse(raw).entries : [];
  };
  const seed = (entries, id = 'ixhuatlan') => data.set(c.claveDe(KEY, id), JSON.stringify({version:1,entries}));
  const draw = (kind = 'area', next = points) => {
    if(kind === 'area') { c.setColorDrawMode(true); c.draftPoints = next.map(([lat,lng]) => ({lat,lng})); c.renderDraftArea(); }
    else if(kind === 'river') { c.setRiverPencilMode(true); c.riverDraftPoints = next.map(([lat,lng]) => ({lat,lng})); c.renderRiverDraft(); }
    else { c.setRoadPencilMode(true, false, kind === 'highway'); c.roadDraftPoints = next.map(([lat,lng]) => ({lat,lng})); c.renderRoadDraft(); }
  };
  return { c, api, elements, element, data, timers, handlers, movements, writes, renders, statuses, navigations, stored, seed, draw, camera,
    runTimers() { for (const [id, fn] of Array.from(timers)) { timers.delete(id); fn(); } }, resetModes };
}

test('auto guardado agrupa puntos y conserva estilo, cámara y territorio sin guardar edición', () => {
  const h = harness(); h.api.offer(); h.draw();
  h.c.draftPoints.push({lat:19.04,lng:-96.96}); h.c.renderDraftArea();
  assert.equal(h.writes.length, 0); assert.equal(h.timers.size, 1);
  h.runTimers();
  assert.equal(h.writes.length, 1);
  assert.deepEqual(h.stored()[0].points, [...points,[19.04,-96.96]]);
  assert.equal(h.stored()[0].color, '#00aabb'); assert.equal(h.stored()[0].opacity, 45);
  assert.deepEqual(h.stored()[0].camera, {center:h.camera.center,zoom:18});
  assert.equal(h.movements.length, 0);
});

test('arranque y capturas vacías no borran una recuperación pendiente antes de decidir', () => {
  const h = harness(); h.seed([record()]); h.c.editorOpen = false;
  h.api.capture(); h.api.flush(); assert.equal(h.api.offer(), false);
  assert.equal(h.stored().length,1); assert.equal(h.writes.length,0);
  h.c.editorOpen = true;
  assert.equal(h.api.offer(),true); assert.equal(h.element('draft-recovery-dialog').open,true);
  h.api.capture(); h.api.flush(); assert.equal(h.stored().length,1);
  assert.match(h.element('draft-recovery-description').textContent, /zona de color.*#1 Café.*3 puntos/);
});

for (const kind of ['area','road','highway','river']) {
  test(`recuperar ${kind} restaura sus puntos y la cámara solo después de aceptar`, () => {
    const h = harness(); h.seed([record({kind})]); h.api.offer();
    assert.equal(h.movements.length,0); assert.equal(h.renders.length,0);
    assert.equal(h.api.recover(),true);
    const got = kind === 'area' ? h.c.draftPoints : kind === 'river' ? h.c.riverDraftPoints : h.c.roadDraftPoints;
    assert.deepEqual(copy(got).map(p => [p.lat,p.lng]),points);
    assert.deepEqual(h.movements[0],{center:[19.024681,-96.975319],zoom:19,options:{animate:false}});
    assert.equal(h.element('draft-recovery-dialog').open,false);
    assert.equal(h.api.hasPending(),true);
    if(kind === 'highway') assert.equal(h.c.modoCarretera,true);
    h.api.flush(); assert.equal(h.stored().length,1);
  });
}

test('pagehide y esconder pestaña guardan puntos recientes sin esperar debounce', () => {
  const h = harness(); h.api.offer(); h.draw('road');
  h.handlers.pagehide(); assert.equal(h.stored()[0].kind,'road'); assert.equal(h.timers.size,0);
  h.c.roadDraftPoints.push({lat:19.05,lng:-96.95});
  h.c.document.visibilityState='hidden'; h.handlers.visibilitychange();
  assert.equal(h.stored()[0].points.length,4);
});

test('cambiar territorio e Inicio conserva el borrador del territorio anterior', () => {
  const h = harness(); h.api.offer(); h.draw('river'); h.api.leave();
  h.resetModes(); h.c.currentIndex=1; h.api.offer(); h.draw('road',points.slice(0,1)); h.api.flush();
  assert.deepEqual(h.stored().map(r => r.locNum).sort(),['1','2']);
  h.api.leave(); h.resetModes(); h.c.editorOpen=false; h.api.capture(); h.api.flush();
  h.c.currentIndex=0; h.c.editorOpen=true; assert.equal(h.api.offer(),true);
  assert.equal(h.api.recover(),true); assert.equal(h.c.riverDraftPoints.length,3);
});

test('escritura pendiente queda en la congregación original aunque la activa cambie', () => {
  const h = harness(); h.api.offer(); h.draw('road');
  h.c.congregacionActivaId='otra'; h.runTimers();
  assert.equal(h.stored('ixhuatlan').length,1); assert.equal(h.stored('otra').length,0);
  h.api.leave(); h.resetModes(); assert.equal(h.api.offer(),false);
  h.draw('area'); h.api.flush();
  assert.equal(h.stored('ixhuatlan')[0].kind,'road'); assert.equal(h.stored('otra')[0].kind,'area');
});

test('guardar o cancelar el trazo elimina únicamente su borrador', () => {
  const h = harness(); h.seed([record({locNum:'2'})]); h.api.offer(); h.draw('area'); h.api.flush();
  h.resetModes(); h.api.capture(); h.api.flush();
  assert.deepEqual(h.stored().map(r => r.locNum),['2']);
});

test('descartar elimina solo el borrador ofertado y habilita un dibujo nuevo', () => {
  const h = harness(); h.seed([record(),record({locNum:'2'})]); h.api.offer();
  assert.equal(h.api.discard(),true); assert.equal(h.element('draft-recovery-dialog').open,false);
  assert.deepEqual(h.stored().map(r => r.locNum),['2']);
  h.draw('highway'); h.api.flush(); assert.equal(h.stored().find(r => r.locNum==='1').kind,'highway');
});

test('acceso protegido no ofrece ni sobrescribe borradores', () => {
  const h = harness(); h.seed([record()]); h.c.accessAllowed=false;
  assert.equal(h.api.offer(),false); h.api.flush(); assert.equal(h.stored().length,1);
  h.c.accessAllowed=true; assert.equal(h.api.offer(),true);
});

test('ignora JSON, namespaces, coordenadas y cantidades inválidos sin ejecutarlos', () => {
  for(const broken of [record({congregationId:'otra'}),record({points:[[91,-97]]}),
    record({points:[[null,-97]]}),record({points:Array.from({length:2501},()=>[19,-97])}),
    record({locNum:'../2'}),record({kind:'script'})]) {
    const h = harness(); h.seed([broken]); assert.equal(h.api.offer(),false);
    assert.equal(h.movements.length,0); assert.equal(h.writes.length,0);
  }
  const h = harness(); h.data.set(KEY,'{no es JSON'); assert.equal(h.api.offer(),false);
  h.draw('road'); assert.doesNotThrow(()=>h.api.flush()); assert.equal(h.stored()[0].kind,'road');
});

test('datos de cámara inválidos no impiden recuperar puntos ni mueven la vista', () => {
  const h = harness(); h.seed([record({camera:{center:[91,-97],zoom:19}})]); h.api.offer(); h.api.recover();
  assert.equal(h.c.draftPoints.length,3); assert.equal(h.movements.length,0);
});

test('puntos inválidos de un trazo vivo no borran una copia válida anterior', () => {
  const h = harness(); h.api.offer(); h.draw('road'); h.api.flush();
  h.c.roadDraftPoints.push({lat:Infinity,lng:-97}); h.api.capture(); h.api.flush();
  assert.equal(h.stored()[0].points.length,3);
});

test('fallo de almacenamiento conserva recuperación pendiente y permite reintentar', () => {
  const h = harness(); h.seed([record()]); h.api.offer(); h.c.storageFail=true;
  assert.equal(h.api.discard(),false); assert.equal(h.element('draft-recovery-dialog').open,true);
  assert.equal(h.stored().length,1); assert.match(h.statuses[0].text,/No se pudo guardar el borrador/);
  h.c.storageFail=false; assert.equal(h.api.discard(),true); assert.equal(h.stored().length,0);
});

test('mover la cámara actualiza la recuperación sin guardar cambios del croquis', () => {
  const h = harness(); h.api.offer(); h.draw('road'); h.api.flush();
  h.camera.center=[19.12345,-96.98765]; h.camera.zoom=20;
  h.handlers['map:moveend'](); h.runTimers();
  assert.deepEqual(h.stored()[0].camera,{center:h.camera.center,zoom:20}); assert.equal(h.movements.length,0);
});

for(const kind of ['color','road','river']) {
  test(`rehacer puntos de ${kind} conserva la cámara y permite varios pasos`, () => {
    const h = harness(); h.api.offer(); h.draw(kind==='color'?'area':kind);
    const key=kind==='color'?'draftPoints':kind==='road'?'roadDraftPoints':'riverDraftPoints';
    for(let i=0;i<2;i++) { h.api.rememberPointUndo(kind,h.c[key]); h.c[key].pop(); h.api.capture(); }
    assert.equal(h.api.canRedoPoint(),true);
    assert.equal(h.api.redoPoint(),true); assert.equal(h.c[key].length,2);
    assert.equal(h.api.redoPoint(),true); assert.equal(h.c[key].length,3);
    assert.equal(h.api.canRedoPoint(),false); assert.equal(h.movements.length,0);
  });
}

test('un punto nuevo, cambio de modo o territorio invalida rehacer del borrador', () => {
  const h = harness(); h.api.offer(); h.draw('road');
  h.api.rememberPointUndo('road',h.c.roadDraftPoints); h.c.roadDraftPoints.pop(); h.api.capture();
  h.c.roadDraftPoints.push({lat:19.1,lng:-96.9}); h.api.capture(); assert.equal(h.api.canRedoPoint(),false);
  h.api.rememberPointUndo('road',h.c.roadDraftPoints); h.c.roadDraftPoints.pop(); h.api.capture();
  h.c.setRiverPencilMode(true); assert.equal(h.api.canRedoPoint(),false);
  h.draw('road'); h.api.rememberPointUndo('road',h.c.roadDraftPoints); h.c.roadDraftPoints.pop(); h.api.capture();
  h.api.leave(); assert.equal(h.api.canRedoPoint(),false);
});

test('tras recarga Inicio ofrece el borrador del territorio 18 sin navegar antes de aceptar', () => {
  const h=harness();h.c.LOCS.push({num:18,name:'San Martín'});h.seed([record({locNum:'18',kind:'road'})]);
  assert.equal(h.api.offer(h.c.LOCS[0]),false); // goTo corriente nunca busca otros territorios.
  h.api.leave();
  assert.equal(h.api.offer(h.c.LOCS[0],{latest:true}),true);
  assert.equal(h.c.currentIndex,0);assert.equal(h.navigations.length,0);assert.equal(h.movements.length,0);
  assert.match(h.element('draft-recovery-description').textContent,/#18 San Martín/);
  assert.equal(h.api.recover(),true);assert.equal(h.c.currentIndex,2);
  assert.deepEqual(h.navigations,[{index:2,silent:true,fitMap:false}]);
  assert.equal(h.c.roadDraftPoints.length,3);assert.equal(h.element('draft-recovery-dialog').open,false);
  assert.deepEqual(h.movements[0].center,[19.024681,-96.975319]);
  h.api.flush();assert.equal(h.stored()[0].locNum,'18');
});

test('Inicio prioriza territorio actual y luego el más reciente que todavía existe', () => {
  const h=harness();h.c.LOCS.push({num:18,name:'San Martín'});
  h.seed([record({locNum:'1',savedAt:1}),record({locNum:'18',savedAt:2}),record({locNum:'99',savedAt:3})]);
  h.api.offer(h.c.LOCS[0],{latest:true});assert.match(h.element('draft-recovery-description').textContent,/#1 Café/);
  h.api.discard();h.api.leave();
  h.api.offer(h.c.LOCS[0],{latest:true});assert.match(h.element('draft-recovery-description').textContent,/#18 San Martín/);
});

test('descartar recuperación reciente elimina 18 y conserva el borrador de otro territorio', () => {
  const h=harness();h.c.LOCS.push({num:18,name:'San Martín'});
  h.seed([record({locNum:'2',savedAt:1}),record({locNum:'18',savedAt:2})]);
  h.api.offer(h.c.LOCS[0],{latest:true});h.api.discard();
  assert.deepEqual(h.stored().map(r=>r.locNum),['2']);assert.equal(h.c.currentIndex,0);assert.equal(h.navigations.length,0);
  h.draw('area');h.api.flush();assert.deepEqual(h.stored().map(r=>r.locNum).sort(),['1','2']);
});

test('ofrecer reciente no lee otra congregación ni salta una protección pendiente', () => {
  const h=harness();h.c.LOCS.push({num:18,name:'San Martín'});
  h.seed([record({locNum:'18',congregationId:'otra'})],'otra');
  assert.equal(h.api.offer(h.c.LOCS[0],{latest:true}),false);assert.equal(h.navigations.length,0);
  h.api.leave();h.seed([record({locNum:'18'})]);h.c.accessAllowed=false;
  assert.equal(h.api.offer(h.c.LOCS[0],{latest:true}),false);
  assert.equal(h.stored().length,1);assert.equal(h.element('draft-recovery-dialog').open,false);
});
