const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../outputs/walk-mode.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '../outputs/croquis_territorios.html'), 'utf8');
const keyboardStart = html.indexOf("document.addEventListener('keydown', event => {\n  if(window.CroquisWalk");
assert(keyboardStart >= 0, 'Control real del teclado disponible');
const keyboardSource = html.slice(keyboardStart, html.indexOf('\n});', keyboardStart) + 5);
const mapClickStart = html.indexOf('async function handleColorMapClick(');
const mapClickSource = html.slice(mapClickStart, html.indexOf('\nfunction handleMapMouseMove(', mapClickStart));
const copy = value => JSON.parse(JSON.stringify(value));

function harness() {
  const elements = new Map(), events = new Map(), calls = [], observers = [], bodyClasses = new Set();
  const camera = {lat:19.048888123,lng:-96.981944321,zoom:19};
  const editorBar = {inert:false};
  const element = id => {
    if (!elements.has(id)) {
      const classes = new Set();
      if(id === 'welcome-screen') classes.add('is-hidden');
      const handlers = new Map(), attributes = new Map();
      elements.set(id, {
        id, dataset:{}, options:[], hidden:false, disabled:false, title:'', value:'', textContent:'', open:false,
        classList:{contains:name=>classes.has(name), toggle(name, value) { if(value) classes.add(name); else classes.delete(name); },
          add:name=>classes.add(name), remove:name=>classes.delete(name)},
        addEventListener(name, fn) { handlers.set(name,fn); },
        trigger(name, props = {}) { const handler = handlers.get(name); return handler?.({target:this,...props}); },
        click() { if(!this.disabled) return this.trigger('click'); },
        setAttribute(name,value) { attributes.set(name,String(value)); }, getAttribute:name=>attributes.get(name) || null,
        focus(options) { calls.push({type:'focus',id,options}); },
        replaceChildren() { this.options=[]; }, append(option) { this.options.push(option); },
        close() { this.open=false; calls.push({type:'close',id}); }
      });
    }
    return elements.get(id);
  };
  const noOp = () => {};
  const c = vm.createContext({
    document:{getElementById:element, querySelector:()=>editorBar,
      body:{classList:{contains:name=>bodyClasses.has(name),toggle(name,value){if(value)bodyClasses.add(name);else bodyClasses.delete(name);}}},
      createElement:tag=>({tagName:tag.toUpperCase(),value:'',textContent:''}),
      addEventListener(name,fn){if(!events.has(name))events.set(name,[]);events.get(name).push(fn);}},
    window:{CroquisAccess:{canEnter:()=>c.access},CroquisDrafts:{
      leave(){calls.push({type:'draft-leave'});},offer(loc){calls.push({type:'draft-offer',num:loc?.num});}}},
    MutationObserver:class { constructor(fn){this.fn=fn;observers.push(this);} observe(target,options){this.target=target;this.options=options;} },
    access:true, currentIndex:0, currentView:'g-road', LOCS:[{num:1,name:'Café'},{num:2,name:'Tranca'},{num:3,name:'Nevería'}],
    territorySelectorLabel:loc=>`#${loc.num} ${loc.name}`, congregacionActual:()=>({nombre:'Congregación Café'}),
    map:{getCenter:()=>({lat:camera.lat,lng:camera.lng}),getZoom:()=>camera.zoom,
      invalidateSize(options){calls.push({type:'resize',options:copy(options)});},
      setView(center,zoom,options){camera.lat=center.lat;camera.lng=center.lng;camera.zoom=zoom;calls.push({type:'view',center:copy(center),zoom,options:copy(options)});}},
    cancelDestinationInteraction(){calls.push({type:'cancel-destination'});},
    cerrarPanelReferencias(){calls.push({type:'close-references'});},closeIconPicker(){calls.push({type:'close-icon-picker'});},
    setFrameMoveMode(active){calls.push({type:'frame-mode',active});},setTerritoryAddMode(active){calls.push({type:'territory-mode',active});},
    setColorDrawMode(active){c.colorDrawMode=active;calls.push({type:'area-mode',active});},
    setRoadPencilMode(active){c.roadPencilMode=active;calls.push({type:'road-mode',active});},
    setRiverPencilMode(active){c.riverPencilMode=active;calls.push({type:'river-mode',active});},
    setTextAddMode(active){calls.push({type:'text-mode',active});},setIconAddMode(active){calls.push({type:'icon-mode',active});},
    setContourEditMode(active){calls.push({type:'contour-mode',active});},setColorEditMode(active){calls.push({type:'edit-mode',active});},
    updateColorControls(){calls.push({type:'controls'});},setStatus:noOp,
    goTo(index){c.currentIndex=index;calls.push({type:'go',index});c.window.CroquisWalk?.refresh();},
    navigate(delta){calls.push({type:'navigate',delta});c.goTo((c.currentIndex+delta+c.LOCS.length)%c.LOCS.length);},
    $:element, privacyDialog:{open:false}, destinationAddMode:false,destinationSession:null,destinationButton:{focus:noOp},
    frameMoveMode:false,territoryAddMode:false,colorDrawMode:false,roadPencilMode:false,riverPencilMode:false,textAddMode:false,iconAddMode:false,
    contourEditMode:false,colorEditMode:false,selectedAreaIndex:null,selectedTextIndex:null,selectedIconIndex:null,selectedLine:null,
    iconPickerIsOpen:()=>false,undoDraftColorPoint(){calls.push({type:'undo-edit'});},redoEditChange(){calls.push({type:'redo-edit'});},
    saveAllChanges(){calls.push({type:'save-edit'});},clearColorAreasForCurrent(){calls.push({type:'delete-edit'});},
    renderTextLabels:noOp,draftPoints:[],roadDraftPoints:[],riverDraftPoints:[],renderDraftArea:noOp
  });
  element('destination-panel').hidden=true;
  element('btn-ubicacion').title='Toca Mi ubicación para localizarte';
  element('btn-ubicacion-stop').hidden=true;
  element('btn-ubicacion').addEventListener('click',()=>calls.push({type:'gps-start'}));
  element('btn-ubicacion-stop').addEventListener('click',()=>calls.push({type:'gps-stop'}));
  // Registrar el mismo orden de control real: editor principal antes del módulo.
  vm.runInContext(keyboardSource+'\n'+mapClickSource,c);
  vm.runInContext(source,c);
  const dispatch = (key, options = {}) => {
    const event={key,ctrlKey:false,metaKey:false,shiftKey:false,prevented:false,
      target:{tagName:'DIV',closest:()=>null},preventDefault(){this.prevented=true;},...options};
    (events.get('keydown')||[]).forEach(fn=>fn(event));
    return event;
  };
  return {c,api:c.window.CroquisWalk,element,elements,calls,camera,editorBar,bodyClasses,observers,dispatch};
}

test('modo recorrido rechaza Inicio, falta de acceso, mapa y territorio',()=>{
  for(const block of ['welcome','access','map','territory']) {
    const h=harness();h.calls.length=0;
    if(block==='welcome')h.element('welcome-screen').classList.remove('is-hidden');
    if(block==='access')h.c.access=false;
    if(block==='map')h.c.map=null;
    if(block==='territory')h.c.LOCS=[];
    assert.equal(h.api.setActive(true),false);assert.equal(h.api.isActive(),false);
    assert.equal(h.calls.length,0);assert.equal(h.editorBar.inert,false);
  }
});

test('entrar conserva cámara y suspende borrador antes de cancelar herramientas',()=>{
  const h=harness();h.calls.length=0;const before=copy(h.camera);
  h.c.colorDrawMode=true;h.c.roadPencilMode=true;h.c.riverPencilMode=true;
  assert.equal(h.api.setActive(true),true);assert.deepEqual(h.camera,before);
  assert.equal(h.calls[0].type,'draft-leave');
  assert.equal(h.c.colorDrawMode,false);assert.equal(h.c.roadPencilMode,false);assert.equal(h.c.riverPencilMode,false);
  assert.equal(h.editorBar.inert,true);assert.equal(h.element('walk-panel').hidden,false);
  assert.equal(h.element('btn-walk-mode').getAttribute('aria-pressed'),'true');
  assert.deepEqual(h.calls.find(c=>c.type==='resize').options,{pan:false});
  assert.deepEqual(h.calls.find(c=>c.type==='view'),{type:'view',center:{lat:before.lat,lng:before.lng},zoom:19,options:{animate:false}});
  assert.equal(h.calls.some(c=>c.type==='draft-offer'),false);
  const count=h.calls.length;h.api.setActive(true);assert.equal(h.calls.length,count);
});

test('teclado real bloquea deshacer, rehacer, guardar y borrar durante recorrido',()=>{
  const h=harness();h.api.setActive(true);h.calls.length=0;
  h.c.selectedTextIndex=0;
  for(const [key,options] of [['z',{ctrlKey:true}],['z',{ctrlKey:true,shiftKey:true}],['y',{metaKey:true}],['s',{ctrlKey:true}],['Delete',{}],['Backspace',{}]]) {
    const event=h.dispatch(key,options);assert.equal(event.prevented,true,`${key} bloqueado`);
  }
  assert.equal(h.calls.some(c=>/-edit$/.test(c.type)),false);
});

test('clic real en mapa durante recorrido no agrega puntos aunque quede un modo activo',async()=>{
  const h=harness();h.api.setActive(true);h.c.colorDrawMode=true;h.c.draftPoints=[];
  await h.c.handleColorMapClick({latlng:{lat:19.01,lng:-96.99},originalEvent:{preventDefault(){},stopPropagation(){}}});
  assert.equal(h.c.draftPoints.length,0);
});

test('territorio siguiente, anterior y selector navegan sin salir del recorrido',()=>{
  const h=harness();h.api.setActive(true);h.calls.length=0;
  h.element('route-next').click();assert.equal(h.c.currentIndex,1);
  h.element('route-prev').click();assert.equal(h.c.currentIndex,0);
  h.element('route-territory').value='2';h.element('route-territory').trigger('change');
  assert.equal(h.c.currentIndex,2);assert.equal(h.api.isActive(),true);
  assert.equal(h.element('route-territory').value,'2');
  h.dispatch('ArrowRight');assert.equal(h.c.currentIndex,0);
  h.dispatch('ArrowLeft');assert.equal(h.c.currentIndex,2);
  const before=h.calls.length;
  h.dispatch('ArrowLeft',{target:{tagName:'SELECT',closest:()=>null}});
  assert.equal(h.calls.length,before);
  assert.deepEqual(h.element('route-territory').options.map(o=>o.textContent),['#1 Café','#2 Tranca','#3 Nevería']);
});

test('ubicación delega inicio y parada a los controles GPS existentes',()=>{
  const h=harness();h.api.setActive(true);h.calls.length=0;
  h.element('route-location').click();assert.equal(h.calls.filter(c=>c.type==='gps-start').length,1);
  const gps=h.element('btn-ubicacion');gps.classList.add('is-on');gps.title='Ubicación encontrada';
  gps.setAttribute('aria-label','Ubicación activa');gps.setAttribute('aria-pressed','true');
  h.element('btn-ubicacion-stop').hidden=false;
  assert.equal(h.observers.length,1);h.observers[0].fn();
  assert.equal(h.element('route-location').classList.contains('is-on'),true);
  assert.equal(h.element('route-location').getAttribute('aria-pressed'),'true');
  assert.equal(h.element('route-gps-status').textContent,'Ubicación encontrada');
  assert.equal(h.element('route-stop-location').hidden,false);
  h.element('route-stop-location').click();assert.equal(h.calls.filter(c=>c.type==='gps-stop').length,1);
  assert.equal(h.api.isActive(),true);
});

test('salir preserva la vista actual del recorrido y ofrece el borrador del territorio actual',()=>{
  const h=harness();h.api.setActive(true);
  h.camera.lat=19.1234567;h.camera.lng=-96.9876543;h.camera.zoom=20;h.c.currentIndex=2;
  const before=copy(h.camera);h.calls.length=0;
  h.element('route-exit').click();assert.equal(h.api.isActive(),false);assert.deepEqual(h.camera,before);
  assert.equal(h.editorBar.inert,false);assert.equal(h.element('walk-panel').hidden,true);
  assert.equal(h.element('btn-walk-mode').getAttribute('aria-pressed'),'false');
  assert.deepEqual(h.calls.find(c=>c.type==='draft-offer'),{type:'draft-offer',num:3});
  assert.equal(h.calls.find(c=>c.type==='view').zoom,20);
  assert.equal(h.calls.filter(c=>c.type==='gps-stop').length,0);
});

test('salir para Inicio omite recuperación y foco, Escape vuelve al editor',()=>{
  const h=harness();h.api.setActive(true);h.calls.length=0;
  h.api.setActive(false,{offer:false,focus:false});
  assert.equal(h.calls.some(c=>c.type==='draft-offer'||c.type==='focus'),false);
  h.api.setActive(true);h.calls.length=0;
  const event=h.dispatch('Escape');assert.equal(event.prevented,true);assert.equal(h.api.isActive(),false);
  assert.equal(h.calls.filter(c=>c.type==='draft-offer').length,1);
});

test('refrescar actualiza catálogo, nombre de mapa y disponibilidad cuando cambia territorio',()=>{
  const h=harness();h.c.currentView='offline';h.c.LOCS=[{num:'custom-1',name:'Nuevo'}];h.c.currentIndex=0;
  h.api.refresh();assert.equal(h.element('route-map-name').textContent,'Mapa sin conexión');
  assert.equal(h.element('route-territory').options.length,1);
  assert.equal(h.element('route-next').disabled,true);assert.equal(h.element('route-prev').disabled,true);
  h.c.currentView='g-sat';h.api.refresh();assert.equal(h.element('route-map-name').textContent,'Google Satélite');
  h.c.LOCS=[];h.api.refresh();assert.equal(h.element('route-territory').disabled,true);
  assert.equal(h.element('btn-walk-mode').disabled,true);
});
