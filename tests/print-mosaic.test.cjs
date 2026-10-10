const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname,'../outputs/croquis_territorios.html'),'utf8');
const start = html.indexOf('function printTileMosaicPlan(');
const end = html.indexOf('\nfunction getPrintTileUrl(',start);
assert(start >= 0 && end > start);

function environment({tainted=false,renderScale=3}={}){
  const appended=[],draws=[];
  let encodings=0;
  const pane={appendChild:node=>appended.push(node)};
  const context=vm.createContext({
    printRenderScale:renderScale,PRINT_MOSAIC_DPI:600,
    PRINT_MOSAIC_MAX_PIXELS:32000000,PRINT_MOSAIC_MAX_SIDE:8192,
    Image:class {constructor(){this.style={};} async decode(){}},
    document:{createElement:()=>({
      getContext:()=>({scale:()=>{},drawImage:(...args)=>draws.push(args)}),
      toDataURL:()=>{encodings++;if(tainted)throw Object.assign(new Error(),{name:'SecurityError'});return 'data:image/png;base64,QA';}
    })}
  });
  vm.runInContext(html.slice(start,end),context);
  const map={
    getContainer:()=>({getBoundingClientRect:()=>({left:100,top:40,width:500,height:300})}),
    getSize:()=>({x:1500,y:900}),getPane:()=>pane,
    containerPointToLayerPoint:()=>({x:23,y:-11})
  };
  const tile=(left=100,top=40,width=100,height=100,status='ready')=>({
    current:status!=='old',el:{complete:status!=='pending',naturalWidth:600,naturalHeight:600,src:'tile-'+left,
      getBoundingClientRect:()=>({left,top,width,height})}
  });
  const layer=(pieces=[tile()])=>{
    const container={style:{},parentElement:pane};
    return {_tiles:Object.fromEntries(pieces.map((piece,i)=>[i,piece])),options:{opacity:.6},
      getContainer:()=>container};
  };
  return {context,map,tile,layer,appended,draws,get encodings(){return encodings;}};
}

test('PDF mosaics preserve transformed map coordinates and native detail without changing provider zoom',()=>{
  const e=environment();
  const layer=e.layer([e.tile(150,60),e.tile(80,20),e.tile(700,50),e.tile(150,60,100,100,'pending')]);
  const plan=e.context.printTileMosaicPlan(e.map,layer,1);
  assert.equal(plan.pieces.length,2,'Only completed visible current images belong in the mosaic');
  assert.deepEqual(JSON.parse(JSON.stringify(plan.pieces.map(({x,y,w,h})=>({x,y,w,h})))),[
    {x:150,y:60,w:300,h:300},{x:-60,y:-60,w:300,h:300}
  ]);
  assert.equal(plan.scale,2,'Do not invent pixels beyond native tile resolution');
  assert.equal(plan.pixelsX,3000); assert.equal(plan.pixelsY,1800);
  assert.equal(layer.options.opacity,.6);
});

test('Small paper frames retain the same provider images while raster memory has a bounded pixel budget',()=>{
  const e=environment({renderScale:9}),layer=e.layer();
  const full=e.context.printTileMosaicPlan(e.map,layer,1);
  const small=e.context.printTileMosaicPlan(e.map,layer,.2);
  assert.equal(small.pieces[0].image,full.pieces[0].image,'Frame size never changes the source street/place names');
  assert(Math.abs(small.scale/full.scale-.2)<1e-9);
  const huge={...e.map,getSize:()=>({x:24000,y:16000})};
  const plan=e.context.printTileMosaicPlan(huge,layer,1);
  assert(plan.pixelsX<=8192 && plan.pixelsY<=8192);
  assert(plan.pixelsX*plan.pixelsY<=32000000);
});

test('Repeated silhouette passes reuse one PNG without changing opacity or vector panes',async()=>{
  const e=environment(),first=e.layer(),second=e.layer();
  const before=JSON.stringify(first._tiles);
  const results=await e.context.compactPrintTileLayers(e.map,[first,second],1);
  assert.equal(e.encodings,1,'Identical source tile mosaics are encoded once');
  assert.equal(e.appended.length,2);
  assert(e.appended.every(image=>image.style.opacity==='.6'||image.style.opacity==='0.6'));
  assert(e.appended.every(image=>image.style.left==='23px'&&image.style.top==='-11px'));
  assert.equal(first.getContainer().style.display,'none');
  assert.equal(second.getContainer().style.display,'none');
  assert(results.every(result=>result.compacted));
  assert.equal(JSON.stringify(first._tiles),before,'Source tile inventory is preserved for diagnostics');
});

test('A source that disallows canvas reading retains its complete original map layer',async()=>{
  const e=environment({tainted:true}),layer=e.layer();
  const results=await e.context.compactPrintTileLayers(e.map,[layer],.2);
  assert.equal(results[0].compacted,false);
  assert.equal(results[0].reason,'SecurityError');
  assert.equal(layer.getContainer().style.display,undefined,'Never hide the original until replacement is decoded');
  assert.equal(e.appended.length,0);
});

test('A print tile blocked by CORS retries as an ordinary image before reporting a terminal failure',()=>{
  const e=environment(),errors=[];
  const layer={options:{crossOrigin:'anonymous'},_tileOnError:(...args)=>errors.push(args)};
  e.context.enablePrintTileCorsFallback(layer);
  const image={crossOrigin:'anonymous',src:'https://map.test/tile.png',
    getAttribute:()=>image.src,removeAttribute:()=>{image.crossOrigin=null;}};
  const done=()=>{},error={kind:'cors'};
  layer._tileOnError(done,image,error);
  assert.equal(errors.length,0,'The asynchronous tile waiter must not finish during the retry');
  assert.equal(image.crossOrigin,null);
  assert.equal(image.src,'https://map.test/tile.png');
  layer._tileOnError(done,image,error);
  assert.equal(errors.length,1,'A genuine network failure is reported after one bounded retry');
  assert.equal(errors[0][0],done);
});
