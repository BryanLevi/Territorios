const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const html=fs.readFileSync(path.join(__dirname,'../outputs/croquis_territorios.html'),'utf8');
function extract(name){
  const start=html.indexOf('function '+name+'(');assert(start>=0,name);
  const opening=html.indexOf('){',start)+1;let depth=0,quote=null;
  for(let i=opening;i<html.length;i++){
    const char=html[i],next=html[i+1];
    if(quote){if(char==='\\')i++;else if(char===quote)quote=null;continue;}
    if(char==='/'&&next==='/'){i=html.indexOf('\n',i);continue;}
    if(char==='/'&&next==='*'){i=html.indexOf('*/',i+2)+1;continue;}
    if(char==='"'||char==="'"||char==='`'){quote=char;continue;}
    if(char==='{')depth++;
    if(char==='}'&&--depth===0)return html.slice(start,i+1);
  }
  throw new Error('Incomplete function '+name);
}
function classes(initial=[]){
  const values=new Set(initial);
  return {add(...names){names.forEach(name=>values.add(name));},
    remove(...names){names.forEach(name=>values.delete(name));},contains:name=>values.has(name),
    toggle(name,on){const next=on===undefined?!values.has(name):!!on;next?values.add(name):values.delete(name);return next;}};
}
const clone=value=>JSON.parse(JSON.stringify(value));
const destination=(text,lat,lng)=>({type:'destino',text,lat,lng,
  points:[[lat-.001,lng-.001],[lat,lng]],sizePt:10,strokePt:1.2,headMm:3});

function harness({draft=false,sizePt=10}={}){
  const labels=[destination('Hacia Providencia los Cedros',19,-97),destination('Hacia Ocotitlán',19.01,-97.01)]
    .map(label=>({...label,sizePt}));
  const persisted=JSON.stringify(labels),panes=new Map(),layers=new Set();
  const wrapper={classList:classes(['is-destination-editing'])};
  const elements=new Map([
    ['destination-text',{value:labels[0].text}],['destination-size',{value:String(sizePt)}],
    ['destination-preview',{checked:true}],['destination-panel',{hidden:false,classList:classes()}],
    ['destination-fit-status',{}],['destination-auto-place',{}]
  ]);
  const point=position=>Array.isArray(position)?{lat:position[0],lng:position[1]}:{...position};
  class LayerGroup{
    constructor(){this.members=[];}
    addTo(){layers.add(this);return this;}
    clearLayers(){this.members.length=0;}
    getLayers(){return this.members;}
  }
  class Marker{
    constructor(position,config){
      this.position=point(position);this.config=config;this.handlers=new Map();
      const inner=config.icon.html?.match(/class="([^"]*)"/);this.caption=inner?{
        classList:classes(inner[1].split(' ')),style:{},dataset:{},textContent:'',
        getBoundingClientRect:()=>({left:0,top:0,right:30,bottom:12,width:30,height:12})}:null;
      this.node={classList:classes((config.icon.className||'').split(' ')),
        querySelector:selector=>this.caption?.classList.contains(selector.slice(1))?this.caption:null,
        setAttribute(){},addEventListener(){}};
    }
    addTo(layer){layer?.members?.push(this);return this;}
    on(name,handler){this.handlers.set(name,handler);return this;}
    getElement(){return this.node;}
    getLatLng(){return this.position;}
    setLatLng(next){this.position=point(next);return this;}
  }
  const polyline=(positions,config)=>({positions:clone(positions),config:clone(config),handlers:new Map(),
    addTo(layer){layer.members.push(this);return this;},on(name,handler){this.handlers.set(name,handler);return this;}});
  const map={_pointScale:10,removeLayer:layer=>layers.delete(layer),
    getContainer:()=>({getBoundingClientRect:()=>({left:0,top:0,width:1000,height:700})}),
    getSize:()=>({x:1000,y:700}),
    getPane:name=>panes.get(name),createPane(name){const pane={style:{}};panes.set(name,pane);return pane;},
    latLngToContainerPoint(position){const p=point(position);return {x:p.lng*this._pointScale,y:-p.lat*this._pointScale};},
    containerPointToLatLng(p){return {lat:-p.y/this._pointScale,lng:p.x/this._pointScale};}};
  const L={Marker,point:(x,y)=>({x,y}),latLng:(lat,lng)=>({lat,lng}),layerGroup:()=>new LayerGroup(),
    marker:(position,config)=>new Marker(position,config),polyline,divIcon:config=>config,
    CRS:{EPSG3857:{project:p=>({x:p.lng,y:p.lat}),unproject:p=>({lat:p.y,lng:p.x})}},
    latLngBounds:(a,b)=>({getNorthWest:()=>({lat:Math.max(a.lat,b.lat),lng:Math.min(a.lng,b.lng)}),
      getSouthEast:()=>({lat:Math.min(a.lat,b.lat),lng:Math.max(a.lng,b.lng)})}),
    rectangle:(bounds,config)=>({bounds,config,addTo(layer){layer.members.push(this);return this;},
      setBounds(next){this.bounds=next;},setStyle(next){Object.assign(this.config,next);}}),DomEvent:{stop(){}}};
  const context=vm.createContext({map,L,document:{querySelector:selector=>selector==='.map-wrap'?wrapper:null},
    $:id=>elements.get(id),LOCS:[{num:1}],currentIndex:0,congregacionActivaId:'a',selectedTextIndex:draft?null:0,
    destinationSession:draft?{namespace:'a',locNum:'1',index:null,points:clone(labels[0].points),lat:19,lng:-97}:
      {namespace:'a',locNum:'1',index:0,fingerprint:JSON.stringify(labels[0])},
    destinationAddMode:draft,destinationStartPoint:null,destinationPreviewLayer:null,destinationPreviewDragging:false,
    destinationDraftLayer:new LayerGroup(),destinationButton:{setAttribute(){}},
    getTextLabelsForLoc:()=>labels,stateFingerprint:JSON.stringify,
    getExportColorAreasForLoc:()=>[{points:[[18.9,-97.1],[19.1,-97.1],[19.1,-96.9]]}],
    destinationPreviewContext:()=>({width:70,height:45,maxTextWidthMm:64,safeMm:.8,lamina:true}),
    measureDestinationTextMm:()=>({width:12,height:4}),setDestinationPlacementNotice(){},ajustarDobleClic(){},
    directionInteractionAllowed:()=>true,escapeHtml:text=>text});
  context.window={L,CroquisDestinationPlacement:{plan(input){
    const selected=input.labels.find(label=>label.id==='selected');
    return {fits:true,labels:[{...selected,widthMm:12,heightMm:4,
      rect:{x0:selected.anchor.x-6,y0:selected.anchor.y-2,x1:selected.anchor.x+6,y1:selected.anchor.y+2},overlaps:false}]};
  }}};
  vm.runInContext(['normalizeDestinationPoint','normalizeDestinationLabel','destinationPreviewInput',
    'refreshDestinationPlacementPreview','directionAnnotationGeometry','printDirectionTextPoints',
    'renderDirectionAnnotations','cancelDestinationInteraction'].map(extract).join('\n'),context);
  const render=(printMode=false)=>context.renderDirectionAnnotations(map,{num:1},{printMode,interactive:!printMode});
  const refresh=()=>context.refreshDestinationPlacementPreview();
  const savedCaptions=()=>map._directionLayer.getLayers().filter(layer=>layer instanceof Marker&&
    layer.config.icon.className==='destination-label-marker');
  const previewCaptions=()=>context.destinationPreviewLayer?.getLayers().filter(layer=>layer instanceof Marker)||[];
  // The media rule is validated separately; this model applies precisely its selectors.
  const visibleSaved=(print=false)=>savedCaptions().filter(marker=>print||
    !(wrapper.classList.contains('is-destination-previewing')&&marker.caption.classList.contains('is-selected')));
  return {context,labels,persisted,wrapper,elements,map,layers,render,refresh,savedCaptions,previewCaptions,visibleSaved,
    assertUnchanged(){assert.equal(JSON.stringify(labels),persisted,'Showing or hiding the preview cannot rewrite saved annotations');}};
}

test('the editor preview replaces only the selected caption and keeps its saved shaft and handles',()=>{
  const h=harness();h.render();h.refresh();
  assert.equal(h.savedCaptions().length,2,'Both persisted captions retain their marker and events');
  assert.equal(h.visibleSaved().length,1,'Only the selected saved caption is hidden');
  assert.equal(h.visibleSaved()[0].config.icon.html.includes('Hacia Ocotitlán'),true);
  assert.equal(h.previewCaptions().length,1,'One preview provides the active edited caption');
  const layers=h.map._directionLayer.getLayers();
  assert.equal(layers.filter(layer=>layer.config?.className==='destination-arrow-path').length,2);
  assert.equal(layers.filter(layer=>layer.config?.className==='destination-arrow-head').length,2);
  assert.equal(layers.filter(layer=>layer.config?.icon?.className?.startsWith('destination-handle')).length,2);
  assert(h.savedCaptions()[0].handlers.has('dragend'),'The saved marker preserves its edit event handlers');
  h.assertUnchanged();
});

test('editing a saved destination preserves its natural editor font and wrapping at every map zoom',()=>{
  const h=harness();h.render();
  for(const zoomScale of [10,2.5,40]){
    h.map._pointScale=zoomScale;h.refresh();
    const marker=h.previewCaptions()[0],style=marker.caption.style;
    assert.equal(parseFloat(style.fontSize),10*96/72,'Opening a PDF guide cannot magnify the saved caption');
    assert.equal(style.width,'max-content','The edited caption retains its natural text width');
    assert.equal(style.height,'auto','Line wrapping determines the caption height');
    assert.equal(parseFloat(style.maxWidth),64*96/25.4,'The editor wrapping limit is independent of the PDF footprint');
    assert.equal(style.padding,'2px 3px','PDF preview scaling cannot enlarge caption padding');
    assert.deepEqual(marker.getLatLng(),{lat:19,lng:-97},'Selection cannot move the saved text anchor');
    const box=h.context.destinationPreviewLayer.getLayers().find(layer=>!(layer instanceof h.context.L.Marker));
    assert(box,'The separate PDF footprint is retained without resizing the caption');
    assert.equal(h.visibleSaved().length,1,'Only one selected caption is visible');
  }
  h.assertUnchanged();
});

test('editing uses the selected text size only when the user deliberately changes it',()=>{
  const h=harness();h.render();h.refresh();
  h.elements.get('destination-size').value='16';h.refresh();
  assert.equal(parseFloat(h.previewCaptions()[0].caption.style.fontSize),16*96/72);
  assert.equal(h.previewCaptions()[0].caption.style.padding,'2px 3px');
  h.elements.get('destination-text').value='Hacia Providencia los Cedros · por el acceso principal';h.refresh();
  assert.equal(parseFloat(h.previewCaptions()[0].caption.style.fontSize),16*96/72,'Typing a longer name cannot resize its font');
  assert.equal(h.previewCaptions()[0].caption.style.height,'auto','Long names wrap naturally');
  h.assertUnchanged();
});

test('saved destinations retain custom point sizes while editing without replacing stored values',()=>{
  for(const sizePt of [7,13.5,18]){
    const h=harness({sizePt});h.render();h.refresh();
    assert.equal(parseFloat(h.previewCaptions()[0].caption.style.fontSize),sizePt*96/72);
    h.assertUnchanged();
  }
});

test('a new destination keeps the physical PDF preview scale instead of adopting saved editor sizing',()=>{
  const h=harness({draft:true});h.render();h.refresh();
  const first=h.previewCaptions()[0].caption.style;
  assert.notEqual(parseFloat(first.fontSize),10*96/72,'The new draft still previews its projected PDF footprint');
  assert.equal(first.width,'120px');assert.equal(first.height,'40px');
  const initialFont=parseFloat(first.fontSize);
  h.map._pointScale=20;h.refresh();
  const zoomed=h.previewCaptions()[0].caption.style;
  assert.equal(parseFloat(zoomed.fontSize),initialFont*2,'A draft guide continues to track physical PDF size at map zoom');
  assert.equal(zoomed.width,'240px');assert.equal(zoomed.height,'80px');
  assert.equal(h.visibleSaved().length,2,'Draft preview does not hide existing destinations');
  h.assertUnchanged();
});

test('rerendering editor controls cannot reintroduce the selected caption beside its preview',()=>{
  const h=harness();h.render();h.refresh();const oldLayer=h.map._directionLayer;
  h.elements.get('destination-text').value='Hacia Providencia los Cedros · acceso';h.refresh();h.render();
  assert(!h.layers.has(oldLayer),'The old saved direction layer is removed');
  assert.equal(h.visibleSaved().length,1);assert.equal(h.previewCaptions().length,1);
  assert.equal(h.previewCaptions()[0].caption.textContent,'Hacia Providencia los Cedros · acceso');
  h.assertUnchanged();
});

test('turning the guide off restores the saved caption and removes every preview marker',()=>{
  const h=harness();h.render();h.refresh();h.elements.get('destination-preview').checked=false;h.refresh();
  assert.equal(h.wrapper.classList.contains('is-destination-previewing'),false);
  assert.equal(h.visibleSaved().length,2);assert.equal(h.previewCaptions().length,0);
  h.elements.get('destination-preview').checked=true;h.refresh();assert.equal(h.visibleSaved().length,1);
  h.assertUnchanged();
});

test('dragging the guide preserves a single preview and keeps the saved caption hidden',()=>{
  const h=harness();h.render();h.refresh();
  const marker=h.previewCaptions()[0],box=h.context.destinationPreviewLayer.getLayers().find(layer=>!(layer instanceof h.context.L.Marker));
  h.context.destinationPreviewDragging=true;
  h.context.destinationSession.previewPosition={lat:19.02,lng:-97.02};
  h.context.refreshDestinationPlacementPreview({marker,box});h.render();
  assert.equal(h.previewCaptions().length,1);assert.equal(h.previewCaptions()[0],marker,'Dragging reuses its active marker');
  assert.equal(h.visibleSaved().length,1,'Rerendering arrows while dragging cannot reveal the saved caption');
  h.context.destinationPreviewDragging=false;h.refresh();
  assert.equal(h.previewCaptions().length,1);assert.equal(h.visibleSaved().length,1);h.assertUnchanged();
});

test('stale destination data, another locality or congregation, and incomplete text restore saved captions',()=>{
  for(const invalidate of [h=>{h.context.destinationSession.fingerprint='older annotation';},
    h=>{h.context.destinationSession.locNum='2';},h=>{h.context.destinationSession.namespace='b';},
    h=>{h.elements.get('destination-text').value='';},h=>{h.context.destinationSession=null;}]){
    const h=harness();h.render();h.refresh();invalidate(h);h.refresh();
    assert.equal(h.wrapper.classList.contains('is-destination-previewing'),false);
    assert.equal(h.visibleSaved().length,2);assert.equal(h.previewCaptions().length,0);h.assertUnchanged();
  }
});

test('a draft destination previews its new caption without hiding unrelated saved captions',()=>{
  const h=harness({draft:true});h.render();h.refresh();
  assert.equal(h.wrapper.classList.contains('is-destination-previewing'),false);
  assert.equal(h.visibleSaved().length,2);assert.equal(h.previewCaptions().length,1);h.assertUnchanged();
});

test('canceling the destination restores the saved label and clears the preview and draft only',()=>{
  for(const clearSelection of [true,false]){
    const h=harness();h.render();h.refresh();const savedLayer=h.map._directionLayer;
    h.context.cancelDestinationInteraction(clearSelection);
    assert.equal(h.wrapper.classList.contains('is-destination-previewing'),false);
    assert.equal(h.visibleSaved().length,2);assert.equal(h.previewCaptions().length,0);
    assert.equal(h.map._directionLayer,savedLayer,'Canceling a guide preserves saved arrow geometry');
    assert.equal(h.context.destinationSession,null);assert.equal(h.context.selectedTextIndex,clearSelection?null:0);h.assertUnchanged();
  }
});

test('the visibility rule is screen-only and cannot hide saved destination captions in printed PDFs',()=>{
  const rule=html.match(/@media\s+screen\s*\{\s*\.map-wrap\.is-destination-previewing\s+\.destination-text-label\.is-selected\s*\{([^}]*)\}\s*\}/);
  assert(rule,'The editor-only caption replacement has an explicitly screen-only media rule');
  assert.match(rule[1],/visibility\s*:\s*hidden\s*(?:;|$)/);
  assert.match(rule[1],/pointer-events\s*:\s*none\s*(?:;|$)/);
  const h=harness();h.render();h.refresh();
  const editorLayer=h.map._directionLayer,printedMap={...h.map,_directionLayer:null};
  h.context.renderDirectionAnnotations(printedMap,{num:1},{printMode:true,interactive:false});
  const printedCaptions=printedMap._directionLayer.getLayers().filter(layer=>
    layer instanceof h.context.L.Marker&&layer.config.icon.className==='destination-label-marker');
  assert.equal(printedCaptions.length,2,'Both saved captions remain available to the print pipeline');
  assert(printedCaptions.every(marker=>!marker.caption.classList.contains('is-selected')),
    'Printed captions never inherit editor selection styling');
  assert(printedMap._directionLayer.getLayers().every(layer=>layer.config?.icon?.className!=='destination-preview-marker'),
    'The PDF direction layer excludes editor preview captions');
  assert.equal(h.map._directionLayer,editorLayer,'Preparing a separate print map cannot replace the editor layer');
  assert.equal(h.previewCaptions().length,1,'The editor keeps its own active guide during print preparation');
  h.assertUnchanged();
});
