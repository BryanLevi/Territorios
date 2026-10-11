const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname,'../outputs/croquis_territorios.html'),'utf8');
const start = html.indexOf('function printMosaicVisibleRect(');
const end = html.indexOf('\nfunction getPrintTileUrl(',start);
assert(start >= 0 && end > start);
const constants = Object.fromEntries(['PRINT_MOSAIC_DPI','PRINT_MOSAIC_MAX_PIXELS','PRINT_MOSAIC_MAX_SIDE']
  .map(name => [name,Number(html.match(new RegExp(`const ${name}\\s*=\\s*([\\d.]+)\\s*;`))[1])]));
const clone = value => JSON.parse(JSON.stringify(value));

function environment({tainted=false,renderScale=3,
  frame={left:100,top:40,width:500,height:300},size={x:1500,y:900},
  origin={x:23,y:-11},ancestors={}}={}){
  const appended=[],draws=[],scales=[],encodedSizes=[];
  let encodings=0;
  const pane={appendChild:node=>appended.push(node)};
  const context=vm.createContext({
    printRenderScale:renderScale,...constants,
    window:{innerWidth:800,innerHeight:600},
    Image:class {constructor(){this.style={};} async decode(){}},
    document:{createElement:()=>({
      getContext:()=>({scale:(...args)=>scales.push(args),drawImage:(...args)=>draws.push(args)}),
      toDataURL(){
        encodings++;encodedSizes.push({width:this.width,height:this.height});
        if(tainted)throw Object.assign(new Error(),{name:'SecurityError'});
        return 'data:image/png;base64,QA';
      }
    })}
  });
  vm.runInContext(html.slice(start,end),context);
  const container={getBoundingClientRect:()=>frame,
    closest:selector=>ancestors[selector] ? {getBoundingClientRect:()=>ancestors[selector]} : null};
  const map={
    getContainer:()=>container,getSize:()=>size,getPane:()=>pane,
    containerPointToLayerPoint:()=>origin
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
  return {context,map,tile,layer,appended,draws,scales,encodedSizes,get encodings(){return encodings;}};
}

test('The configured HD target is 1200 dpi and is reached when native tiles and memory permit it',async()=>{
  assert.equal(constants.PRINT_MOSAIC_DPI,1200);
  const e=environment(),tile=e.tile();
  tile.el.naturalWidth=tile.el.naturalHeight=2400;
  const layer=e.layer([tile]);
  const source=tile.el.src,before=JSON.stringify(layer._tiles);
  const plan=e.context.printTileMosaicPlan(e.map,layer,1);
  assert.equal(plan.pixelsX,6250);
  assert.equal(plan.pixelsY,3750);
  const [result]=await e.context.compactPrintTileLayers(e.map,[layer],1);
  assert.equal(result.dpi,1200);
  assert.equal(tile.el.src,source,'Higher output dpi keeps the same provider content');
  assert.equal(JSON.stringify(layer._tiles),before);
});

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

test('Native source resolution caps the HD mosaic without artificial upscaling',()=>{
  const e=environment({renderScale:1}),tile=e.tile();
  tile.el.naturalWidth=tile.el.naturalHeight=128;
  const layer=e.layer([tile]),plan=e.context.printTileMosaicPlan(e.map,layer,1);
  assert.equal(plan.scale,128/300);
  assert.equal(plan.pixelsX,640);
  assert.equal(plan.pixelsY,384);
  assert(plan.scale<constants.PRINT_MOSAIC_DPI/96);
  assert(plan.pieces.every(piece=>piece.w*plan.scale<=piece.image.naturalWidth
    &&piece.h*plan.scale<=piece.image.naturalHeight),'Every drawn tile uses at most its available source pixels');
});

test('Each encoded HD canvas respects the pixel and side caps before canvas storage is released',async()=>{
  assert.equal(constants.PRINT_MOSAIC_MAX_PIXELS,32000000);
  assert.equal(constants.PRINT_MOSAIC_MAX_SIDE,8192);
  const e=environment({renderScale:1,size:{x:24000,y:16000}});
  const first=e.tile(),second=e.tile(200,100);
  first.el.naturalWidth=first.el.naturalHeight=50000;
  second.el.naturalWidth=second.el.naturalHeight=50000;
  const layers=[e.layer([first]),e.layer([second])];
  const results=await e.context.compactPrintTileLayers(e.map,layers,1);
  assert.equal(e.encodings,2,'Distinct source images have separate bounded canvases');
  assert(results.every(result=>result.compacted&&result.dpi<1200),'Oversized maps are capped rather than claiming the target dpi');
  for(const dimensions of e.encodedSizes){
    assert(dimensions.width<=constants.PRINT_MOSAIC_MAX_SIDE);
    assert(dimensions.height<=constants.PRINT_MOSAIC_MAX_SIDE);
    assert(dimensions.width*dimensions.height<=constants.PRINT_MOSAIC_MAX_PIXELS);
    assert(dimensions.width>1&&dimensions.height>1,'Check the actual encoded size before the final 1×1 release');
  }
  assert.equal(results[0].width,e.encodedSizes[0].width);
  assert.equal(results[0].height,e.encodedSizes[0].height);
});

test('A very wide visible crop reaches the side limit before its total pixel budget',async()=>{
  const e=environment({renderScale:1,size:{x:96000,y:1600}}),tile=e.tile();
  tile.el.naturalWidth=tile.el.naturalHeight=50000;
  const layer=e.layer([tile]);
  const plan=e.context.printTileMosaicPlan(e.map,layer,1);
  assert.equal(plan.pixelsX,8192);
  assert(plan.pixelsX*plan.pixelsY<32000000,'The side limit independently bounds long, thin canvases');
  const [result]=await e.context.compactPrintTileLayers(e.map,[layer],1);
  assert.equal(result.width,8192);
  assert.equal(e.encodedSizes[0].width,8192);
});

test('An offscreen grouped frame crops only known print ancestors in transformed map coordinates',async()=>{
  const frame={left:20100,top:12040,width:500,height:300};
  const e=environment({frame,ancestors:{
    '.print-map-stage':frame,
    '.hoja-guardada':{left:20120,top:12060,width:280,height:220},
    '.hueco-agrupado':{left:20220,top:12100,width:180,height:120}
  }});
  const inside=e.tile(20220,12100,100,100),outside=e.tile(20100,12040,100,20);
  const layer=e.layer([inside,outside]);
  const plan=e.context.printTileMosaicPlan(e.map,layer,1);
  assert.deepEqual(clone({x:plan.x,y:plan.y,width:plan.width,height:plan.height}),
    {x:359,y:179,width:542,height:362},'One source pixel of safety padding surrounds the visible print window');
  assert.equal(plan.pieces.length,1);
  assert.equal(plan.pieces[0].image,inside.el);
  const [result]=await e.context.compactPrintTileLayers(e.map,[layer],1);
  assert.equal(result.compacted,true,'A frame outside the browser viewport still exports');
  assert.deepEqual(e.draws[0].slice(1),[1,1,300,300],'Canvas drawing subtracts the crop offset once');
  assert.equal(e.appended[0].style.left,'382px');
  assert.equal(e.appended[0].style.top,'168px');
  assert.equal(e.appended[0].style.width,'542px');
  assert.equal(e.appended[0].style.height,'362px');
});

test('Screen-sized unrelated ancestors do not crop an offscreen single print map',()=>{
  const frame={left:20100,top:12040,width:500,height:300};
  const e=environment({frame,ancestors:{'.some-scroll-panel':{left:0,top:0,width:800,height:600}}});
  const layer=e.layer([e.tile(20100,12040)]);
  const plan=e.context.printTileMosaicPlan(e.map,layer,1);
  assert(plan);
  assert.deepEqual(clone({x:plan.x,y:plan.y,width:plan.width,height:plan.height}),
    {x:0,y:0,width:1500,height:900});
});

test('Missing or entirely clipped current tiles never hide the original layer',async()=>{
  const e=environment();
  const pending=e.tile(100,40,100,100,'pending'),old=e.tile(100,40,100,100,'old');
  const broken=e.tile();broken.el.naturalWidth=0;
  const layers=[e.layer([]),e.layer([pending,old,broken])];
  assert.equal(e.context.printTileMosaicPlan(e.map,layers[1],1),null);
  assert.deepEqual(clone(await e.context.compactPrintTileLayers(e.map,layers,1)),[]);
  const clipped=environment({ancestors:{'.hueco-agrupado':{left:900,top:900,width:100,height:100}}});
  const clippedLayer=clipped.layer();
  assert.equal(clipped.context.printTileMosaicPlan(clipped.map,clippedLayer,1),null);
  assert.deepEqual(clone(await clipped.context.compactPrintTileLayers(clipped.map,[clippedLayer],1)),[]);
  for(const layer of [...layers,clippedLayer]) assert.equal(layer.getContainer().style.display,undefined);
  assert.equal(e.encodings+clipped.encodings,0);
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

test('Vector cartography replaces compatible tiles without encoding a bitmap mosaic',async()=>{
  const e=environment(),layer=e.layer(),calls=[];
  const vector={compacted:true,vectorized:true,kind:'names',blocks:1,paths:3,tiles:1};
  e.context.window.CroquisPrintCartography={vectorize:async(map,input,plan,cache)=>{
    calls.push({map,input,plan,cache});return vector;
  }};
  assert.deepEqual(clone(await e.context.compactPrintTileLayers(e.map,[layer],1)),[vector]);
  assert.equal(calls[0].map,e.map);assert.equal(calls[0].input,layer);
  assert.equal(calls[0].plan.pieces.length,1);assert.equal(e.encodings,0);
  await e.context.compactPrintTileLayers(e.map,[layer],1);
  assert.equal(calls.length,1,'An already prepared layer is reused');
});

test('An unavailable vector worker still exports the original provider content as a mosaic',async()=>{
  const e=environment(),layer=e.layer(),warnings=[];
  e.context.console={warn:(...args)=>warnings.push(args)};
  e.context.window.CroquisPrintCartography={vectorize:async()=>{throw new Error('Worker blocked');}};
  const [result]=await e.context.compactPrintTileLayers(e.map,[layer],1);
  assert.equal(result.compacted,true);assert.equal(result.vectorized,undefined);
  assert.equal(e.encodings,1);assert.equal(e.appended.length,1);
  assert.equal(layer.getContainer().style.display,'none');assert.equal(warnings.length,1);
});

test('A photograph keeps the normal raster export when vectorization declines its source',async()=>{
  const e=environment(),layer=e.layer();
  e.context.window.CroquisPrintCartography={vectorize:async()=>null};
  const [result]=await e.context.compactPrintTileLayers(e.map,[layer],1);
  assert.equal(result.compacted,true);assert.equal(e.encodings,1);
});
