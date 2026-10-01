const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const window={};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../outputs/destination-placement.js'),'utf8'),{window});
const api=window.CroquisDestinationPlacement;
const polygon=[{x:0,y:0},{x:100,y:0},{x:100,y:100},{x:0,y:100}];
const label=extra=>({id:'selected',text:'Hacia Tomatlán',sizePt:10,anchor:{x:90,y:50},points:[{x:50,y:50},{x:110,y:50}],...extra});
const input=extra=>({polygons:[polygon],contentBounds:{x0:0,y0:0,x1:100,y1:100},availableMm:{width:80,height:60},maxTextWidthMm:64,labels:[label()],...extra});

test('detecta texto sobre el territorio aunque el ancla esté fuera de su contorno',()=>{
  const result=api.plan(input({labels:[label({anchor:{x:110,y:50}})]}));
  assert.equal(result.labels[0].overlapArea,true);
  assert.ok(result.labels[0].rect.x0<100);
});

test('detecta cruces de bordes y un polígono dentro del texto sin depender de sus esquinas',()=>{
  const thin=[{x:-10,y:4},{x:20,y:4},{x:20,y:6},{x:-10,y:6}];
  assert.equal(api.polygonIntersectsRect(thin,{x0:0,y0:0,x1:10,y1:10}),true);
  assert.equal(api.polygonIntersectsRect(polygon,{x0:-1,y0:-1,x1:101,y1:101}),true);
  assert.equal(api.polygonIntersectsRect(polygon,{x0:110,y0:0,x1:120,y1:10}),false);
});

test('los huecos de una silueta cóncava permanecen libres',()=>{
  const shape=[{x:0,y:0},{x:10,y:0},{x:10,y:2},{x:2,y:2},{x:2,y:8},{x:10,y:8},{x:10,y:10},{x:0,y:10}];
  assert.equal(api.polygonIntersectsRect(shape,{x0:4,y0:4,x1:6,y1:6}),false);
});

test('propone un espacio fuera de la zona y de la flecha sin modificar el destino original',()=>{
  const fixture=input(),before=JSON.stringify(fixture),result=api.suggest(fixture,'selected');
  assert.ok(result);
  assert.equal(result.plan.labels[0].overlaps,false);
  assert.notDeepEqual(result.anchor,fixture.labels[0].anchor);
  assert.equal(JSON.stringify(fixture),before);
});

test('una lámina pequeña reserva más territorio geográfico para los mismos puntos de texto',()=>{
  const large=api.plan(input({availableMm:{width:297,height:189}}));
  const small=api.plan(input({availableMm:{width:70,height:45}}));
  assert.ok(small.labels[0].rect.x1-small.labels[0].rect.x0>large.labels[0].rect.x1-large.labels[0].rect.x0);
  const largerType=api.plan(input({labels:[label({sizePt:18})]}));
  const normalType=api.plan(input());
  assert.ok(largerType.labels[0].widthMm>normalType.labels[0].widthMm);
});

test('comprueba también otro destino y detecta tamaños que no caben en el recuadro',()=>{
  const result=api.plan(input({polygons:[],labels:[label(),label({id:'other'})]}));
  assert.equal(result.labels[0].overlapLabels[0],'other');
  const impossible=input({availableMm:{width:20,height:10},measure:()=>({width:25,height:15})});
  assert.equal(api.plan(impossible).fits,false);
  assert.equal(api.suggest(impossible,'selected'),null);
});

test('tolera un texto vacío o coordenadas dañadas sin fabricar una posición',()=>{
  assert.equal(api.plan(input({contentBounds:{x0:0,y0:0,x1:0,y1:0}})),null);
  assert.equal(api.plan(input({labels:[label({anchor:{x:NaN,y:0}})]})).labels.length,0);
  assert.equal(api.plan(input({labels:[label({text:''})]})).labels.length,0);
  assert.equal(api.suggest(input(),'missing'),null);
});

test('la guía respeta el encuadre de la hoja individual cuando reserva espacio adicional',()=>{
  const normal=api.plan(input());
  const reserved=api.plan(input({resolveContentBounds:()=>({x0:-100,y0:-100,x1:200,y1:200})}));
  assert.ok(reserved.scale<normal.scale);
  assert.ok(reserved.labels[0].rect.x1-reserved.labels[0].rect.x0>normal.labels[0].rect.x1-normal.labels[0].rect.x0);
  assert.ok(reserved.bounds.x0<=-100&&reserved.bounds.x1>=200);
});
