const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const layout = require('../outputs/print-direction-layout.js');
const {polygonIntersectsRect} = require('../outputs/print-frame-fit.js');

const copy = value => JSON.parse(JSON.stringify(value));
const rectangle = ({x,y,w,h}) => [{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}];
const distance = (a,b) => Math.hypot(a.x-b.x,a.y-b.y);
const overlaps = (a,b) => a.x<=b.x+b.w && a.x+a.w>=b.x && a.y<=b.y+b.h && a.y+a.h>=b.y;
const labelBox = (centre,item,gap=0) => ({x:centre.x-item.width/2-gap,y:centre.y-item.height/2-gap,
  w:item.width+2*gap,h:item.height+2*gap});
function freezeDeep(value){
  if(value && typeof value==='object'){
    Object.values(value).forEach(freezeDeep);
    Object.freeze(value);
  }
  return value;
}

function arrowItem(key,start,tip,width,height,anchor,unitScale=1){
  return {key,...layout.groupedArrow({start,tip,head:1.95*unitScale,unitScale}),width,height,anchor};
}

function triple(){
  return {
    items:[
      arrowItem('Moctezuma',{x:40,y:50},{x:38,y:48},18,6,{x:116,y:20}),
      arrowItem('Zacamitla',{x:55,y:50},{x:55,y:48},17,6,{x:116,y:105}),
      arrowItem('Ocotitlan',{x:75,y:67},{x:77,y:67},16,6,{x:20,y:105})
    ],
    polygons:[rectangle({x:40,y:50,w:35,h:35})],
    occupied:[{x:105,y:85,w:18,h:6}],canvas:{w:140,h:120},gap:.6,unitScale:1
  };
}

function assertForward(centre,item,message){
  const dx=item.tip.x-item.start.x,dy=item.tip.y-item.start.y,length=Math.hypot(dx,dy);
  assert(((centre.x-item.tip.x)*dx+(centre.y-item.tip.y)*dy)/length>0,message);
}

function assertClear(results,input){
  assert.equal(results.length,input.items.length,'Every destination has one label');
  const boxes=results.map((centre,index)=>labelBox(centre,input.items[index],input.gap));
  boxes.forEach((box,index)=>{
    assert(Object.values(box).every(Number.isFinite),'No invalid projected coordinates');
    assert(box.x>=-1e-8 && box.y>=-1e-8 && box.x+box.w<=input.canvas.w+1e-8 &&
      box.y+box.h<=input.canvas.h+1e-8,'The complete label and its clearance stay on the canvas');
    for(const polygon of input.polygons) assert(!polygonIntersectsRect(polygon,box),
      `${input.items[index].key} clears the colored territory`);
    for(const occupied of input.occupied) assert(!overlaps(box,occupied),
      `${input.items[index].key} clears existing map labels`);
    for(const item of input.items){
      for(const segment of [[item.start,item.tip],[item.wings[0],item.tip],[item.tip,item.wings[1]]])
        assert(!polygonIntersectsRect(segment,box),`${input.items[index].key} clears ${item.key}'s whole arrow`);
    }
    for(let other=0;other<index;other++) assert(!overlaps(box,labelBox(results[other],input.items[other])),
      'Destination labels keep their physical clearance from one another');
  });
}

test('Grouped arrows remain readable in tiny frames and their heads do not fold behind the shaft',()=>{
  for(const unitScale of [.5,1,3,8]) for(const bearing of [{x:-1,y:-1},{x:0,y:-1},{x:1,y:0}]){
    const input=freezeDeep({start:{x:40*unitScale,y:50*unitScale},
      tip:{x:(40+bearing.x*.2)*unitScale,y:(50+bearing.y*.2)*unitScale},head:1.95*unitScale,unitScale});
    const before=JSON.stringify(input),result=layout.groupedArrow(input);
    assert.deepEqual(result.start,input.start,'The road-side anchor is retained');
    const dx=result.tip.x-result.start.x,dy=result.tip.y-result.start.y,length=Math.hypot(dx,dy);
    assert(length/unitScale>=2.6-1e-8 && length/unitScale<=4+1e-8,
      'The printed arrow remains readable without taking more than four millimetres');
    assert(Math.abs(dx*bearing.y-dy*bearing.x)<1e-8,'The printed arrow keeps the saved bearing');
    assert(dx*bearing.x+dy*bearing.y>0,'The bearing is never reversed');
    const base={x:(result.wings[0].x+result.wings[1].x)/2,y:(result.wings[0].y+result.wings[1].y)/2};
    const head=((result.tip.x-base.x)*dx+(result.tip.y-base.y)*dy)/length;
    assert(head>0 && head<=length*.42+1e-8,'The arrowhead fits in the last part of its shaft');
    assert.equal(JSON.stringify(input),before,'Rendering cannot overwrite saved coordinates');
  }
});

test('A long grouped arrow retains its road-side anchor and bearing but occupies four printed millimetres',()=>{
  const input=freezeDeep({start:{x:20,y:70},tip:{x:80,y:10},head:1.95,unitScale:1});
  const result=layout.groupedArrow(input);
  assert.deepEqual(result.start,input.start);
  assert(Math.abs(distance(result.start,result.tip)-4)<1e-8);
  const saved={x:input.tip.x-input.start.x,y:input.tip.y-input.start.y};
  const printed={x:result.tip.x-result.start.x,y:result.tip.y-result.start.y};
  assert(Math.abs(saved.x*printed.y-saved.y*printed.x)<1e-8,'The destination bearing stays exact');
  assert(saved.x*printed.x+saved.y*printed.y>0,'A compact arrow never reverses direction');
});

test('El Crucero keeps three large compact destination names next to their NW, N and E arrows',()=>{
  const input=triple(),results=layout.placeGroupedLabels(input);
  assertClear(results,input);
  input.items.forEach((item,index)=>{
    assertForward(results[index],item,`${item.key} remains ahead of its own arrow`);
    assert(distance(results[index],item.tip)<=15*input.unitScale,
      `${item.key} stays associated with its own nearby tip`);
    assert.equal(results[index].moved,true,'Remote saved anchors are relocated for the small grouped map');
  });
  assert(results[0].x<input.items[0].tip.x && results[0].y<input.items[0].tip.y,'Moctezuma stays northwest');
  assert(results[1].y<input.items[1].tip.y,'Zacamitla stays north');
  assert(results[2].x>input.items[2].tip.x,'Ocotitlan stays east');
});

test('A clear but remote saved anchor moves next to the correct tip in the grouped PDF',()=>{
  const item=arrowItem('east',{x:45,y:55},{x:48,y:55},20,6,{x:15,y:15});
  const input={items:[item],polygons:[],occupied:[],canvas:{w:140,h:120},gap:.6,unitScale:1};
  const [result]=layout.placeGroupedLabels(input);
  assert.equal(result.moved,true);
  assertForward(result,item,'A western saved anchor must not detach the name from its eastern arrow');
  assert(distance(result,item.tip)<=15,'The correction is tied to the tip rather than a remote white patch');
  assertClear([result],input);
});

test('Three compact destinations fit a practical 57 by 44 mm secondary frame',()=>{
  const input={items:[
    arrowItem('Moctezuma',{x:18,y:15},{x:17.8,y:14.8},18,6,{x:50,y:35}),
    arrowItem('Zacamitla',{x:27,y:15},{x:27,y:14.8},17,6,{x:50,y:35}),
    arrowItem('Ocotitlan',{x:36,y:26},{x:36.2,y:26},16,6,{x:50,y:35})
  ],polygons:[rectangle({x:18,y:15,w:18,h:19})],occupied:[{x:2,y:36,w:18,h:5}],
  canvas:{w:57,h:44},gap:.6,unitScale:1};
  const results=layout.placeGroupedLabels(input);
  assertClear(results,input);
  results.forEach((result,index)=>{
    assert.equal(result.clear,true,'The plan finds real free space in the small frame');
    assertForward(result,input.items[index],'The compact name remains ahead of its own arrow');
    assert(distance(result,input.items[index].tip)<=15,'The small frame keeps each name close to its tip');
  });
});

test('A northwest name near the source left edge fits beside its tip without a long upward detour',()=>{
  const item=arrowItem('Moctezuma',{x:18,y:15},{x:17.8,y:14.8},18,6,{x:50,y:35});
  const input={items:[item],polygons:[rectangle({x:18,y:15,w:18,h:19})],occupied:[],
    canvas:{w:57,h:44},gap:.6,unitScale:1};
  const [result]=layout.placeGroupedLabels(input);
  assert.equal(result.clear,true,'Real free space near the source edge must be used');
  assertClear([result],input);
  assertForward(result,item,'Fitting the text inside the source canvas keeps its northwest association');
  assert(result.x<item.tip.x && result.y<item.tip.y,'The name remains northwest of its own tip');
  assert(distance(result,item.tip)<8.5,
    'The wide diagonal name fits next to the tip rather than being pushed unnecessarily high');
});

test('The measured El Crucero trio fits its narrow source canvas in a fifteen-map horizontal sheet',()=>{
  // Native-pixel geometry measured from the real grouped print DOM. The old
  // placement put Moctezuma left of zero and Ocotitlan beyond pixel 10107.
  const unitScale=263.5712503600845;
  const input={items:[
    {key:'Hacia Moctezuma',start:{x:4523,y:2819},tip:{x:3788.7400092587036,y:2260.548739436197},
      wings:[{x:4226.131446560286,y:2325.4842110117547},{x:3968.12696417981,y:2664.7123267342336}],
      width:4500.650390625,height:753.1561889648438,anchor:{x:2055.7674933732187,y:942.5133048190678}},
    {key:'Hacia Zacamitla',start:{x:4594,y:2808},tip:{x:4594,y:1885.5003824235432},
      wings:[{x:4807.097411660162,y:2272.950221805655},{x:4380.902588339838,y:2272.950221805655}],
      width:4075.154296875,height:753.15673828125,anchor:{x:6702.5705544604725,y:955.4222427370441}},
    {key:'Hacia Ocotitlan',start:{x:5638,y:2873},tip:{x:6556.891138692933,y:2791.485463503046},
      wings:[{x:6189.786718372698,y:3037.985421869834},{x:6152.127002511104,y:2613.4577157936988}],
      width:3932.068359375,height:753.1556396484375,anchor:{x:8698.24405514124,y:2601.5267370439215}}
  ],polygons:[
    'M4204 3663L4414 3551L4420 3568L4426 3602L4445 3742z',
    'M5617 3030L5414 3039L5375 3045L5328 3055L5236 3100L4576 3461L4424 3542L4433 3565L4439 3598L4441 3601L4470 3601L4536 3638L4537 3643L4531 3648L4467 3611L4440 3612L4460 3751L4524 3788L4841 3854L4887 3853L4908 3824L5044 3399L5044 3320z',
    'M5619 3010L5449 2849L5336 2983L5336 2992L5343 3011L5356 3023L5364 3026L5421 3019z',
    'M4230 2974L4279 2873L5440 2841L5412 2879L5330 2975L5299 3008L5242 3060L5221 3085L5064 3173L4417 3526L4403 3496L4383 3463L4298 3343L4255 3259L4242 3217L4235 3172L4230 3037z',
    'M3958 3726L4051 3709L4074 3702L4122 3683L4175 3659L4342 3570L4402 3535L4406 3531L4391 3501L4371 3468L4287 3350L4259 3298L4243 3264L4229 3217L4222 3171L4217 3004L4136 3094z'
  ].map(svg=>[...svg.matchAll(/[ML]([\d.]+) ([\d.]+)/g)].map(match=>({x:Number(match[1]),y:Number(match[2])}))),
  occupied:[{x:4115.874414626423,y:2686.325962272799,w:790.2483643230386,h:629.3443502924027}],
  canvas:{w:10107,h:6426},gap:.6*unitScale,unitScale};
  const results=layout.placeGroupedLabels(input);
  assertClear(results,input);
  results.forEach((result,index)=>{
    assert.equal(result.clear,true,'Every measured label has a complete unclipped position');
    assertForward(result,input.items[index],'Source-edge corrections preserve the destination bearing');
    assert(distance(result,input.items[index].tip)/unitScale<=input.items[index].width/unitScale/2+6,
      'The real compact name remains near its own tip despite both source edges');
  });
  const reversed=layout.placeGroupedLabels({...input,items:[...input.items].reverse()});
  assert.deepEqual([...reversed].reverse(),results,'The real crowded trio is stable across saved annotation order');
});

test('Text avoids a later arrow even when it crosses the first destination preferred position',()=>{
  const input={items:[
    arrowItem('first',{x:40,y:50},{x:42,y:50},22,6,{x:20,y:15}),
    arrowItem('later',{x:60,y:50},{x:65,y:50},16,6,{x:110,y:90})
  ],polygons:[],occupied:[],canvas:{w:150,h:100},gap:.6,unitScale:1};
  const results=layout.placeGroupedLabels(input);
  assertClear(results,input);
  results.forEach((result,index)=>assertForward(result,input.items[index],
    'Avoiding another arrow preserves the association with the own destination'));
});

test('Grouped destination layout is stable when the persisted destination order is reversed',()=>{
  const input=triple(),forward=layout.placeGroupedLabels(input);
  const backward=layout.placeGroupedLabels({...input,items:[...input.items].reverse()});
  const byKey=(items,results)=>Object.fromEntries(items.map((item,index)=>[item.key,results[index]]));
  assert.deepEqual(byKey(input.items,forward),byKey([...input.items].reverse(),backward),
    'The same territory cannot change label positions when annotations are loaded in another order');
});

test('The physical grouped layout is independent of raster resolution and does not mutate inputs',()=>{
  const input=freezeDeep(triple()),before=JSON.stringify(input),expected=layout.placeGroupedLabels(input);
  for(const scale of [.5,3,8]){
    const p=point=>({x:point.x*scale,y:point.y*scale});
    const scaled=freezeDeep({
      items:input.items.map(item=>({...item,start:p(item.start),tip:p(item.tip),wings:item.wings.map(p),
        anchor:p(item.anchor),width:item.width*scale,height:item.height*scale})),
      polygons:input.polygons.map(polygon=>polygon.map(p)),
      occupied:input.occupied.map(box=>({x:box.x*scale,y:box.y*scale,w:box.w*scale,h:box.h*scale})),
      canvas:{w:input.canvas.w*scale,h:input.canvas.h*scale},gap:input.gap*scale,unitScale:input.unitScale*scale
    });
    const scaledBefore=JSON.stringify(scaled),actual=layout.placeGroupedLabels(scaled);
    actual.forEach((result,index)=>{
      assert(Math.abs(result.x/scale-expected[index].x)<1e-7,'Resolution does not change physical horizontal placement');
      assert(Math.abs(result.y/scale-expected[index].y)<1e-7,'Resolution does not change physical vertical placement');
      assert.equal(result.moved,expected[index].moved);
    });
    assertClear(actual,scaled);
    assert.equal(JSON.stringify(scaled),scaledBefore,'Scaled frozen inputs remain intact');
  }
  assert.equal(JSON.stringify(input),before,'Original labels, obstacles and geometry remain intact');
});

function extractFunction(html,name){
  const start=html.indexOf(`function ${name}(`);
  assert(start>=0,`Available application function: ${name}`);
  const open=html.indexOf('{',html.indexOf('){',start));
  let depth=0,quote=null;
  for(let i=open;i<html.length;i++){
    const char=html[i],next=html[i+1];
    if(quote){if(char==='\\'){i++;continue;}if(char===quote)quote=null;continue;}
    if(char==='/' && next==='/'){i=html.indexOf('\n',i);continue;}
    if(char==='/' && next==='*'){i=html.indexOf('*/',i+2)+1;continue;}
    if(char==='"' || char==="'" || char==='`'){quote=char;continue;}
    if(char==='{')depth++;
    if(char==='}' && --depth===0)return html.slice(start,i+1);
  }
  throw new Error(`Incomplete application function: ${name}`);
}

function measuredTextBox(html,text){
  const styles=Object.fromEntries((html.match(/style="([^"]*)"/)?.[1]||'').split(';')
    .filter(Boolean).map(style=>{const at=style.indexOf(':');return [style.slice(0,at),style.slice(at+1)];}));
  const font=parseFloat(styles['font-size'])||8;
  const padding=(styles.padding||'0').split(/\s+/).map(Number.parseFloat);
  const padY=padding[0]||0,padX=padding[1]??padY;
  const advance=value=>[...value].reduce((width,char)=>width+font*(/\s/.test(char)?.28:
    /[MWmw]/.test(char)?.83:/[ilIjt]/.test(char)?.28:/[fr]/.test(char)?.34:.62),0);
  const words=text.trim().split(/\s+/),natural=advance(text)+padX*2;
  const minContent=styles['min-width']==='min-content' ? Math.max(...words.map(advance))+padX*2 : 0;
  const width=Math.max(minContent,Math.min(natural,parseFloat(styles['max-width'])||Infinity));
  const contentWidth=Math.max(1e-8,width-padX*2),parts=[];
  for(const word of words){
    if(advance(word)<=contentWidth+1e-8 || styles['overflow-wrap']==='normal') parts.push(word);
    else {
      let part='';
      for(const char of word){
        if(part && advance(part+char)>contentWidth+1e-8){parts.push(part);part='';}
        part+=char;
      }
      if(part)parts.push(part);
    }
  }
  const lines=[];
  for(const part of parts){
    const previous=lines.at(-1),joined=previous?previous+' '+part:part;
    if(!previous || advance(joined)>contentWidth+1e-8)lines.push(part);
    else lines[lines.length-1]=joined;
  }
  return {width,height:Math.max(1,lines.length)*font*1.2+padY*2,font,lines};
}

function renderHarness(labels,options,geometry={}){
  const paths=[],markers=[],panes=new Map();
  const projectionScale=geometry.projectionScale||10,canvas=geometry.canvas||{w:240,h:200};
  const project=point=>({x:(Array.isArray(point)?point[1]:point.lng)*projectionScale,
    y:(Array.isArray(point)?point[0]:point.lat)*projectionScale});
  const unproject=point=>({lat:point.y/projectionScale,lng:point.x/projectionScale});
  const coordinate=position=>Array.isArray(position)?{lat:position[0],lng:position[1]}:{...position};
  const L={
    point:(x,y)=>({x,y}),
    layerGroup:()=>({addTo(){return this;}}),
    polyline:(points,style)=>{
      const record={points:copy(points),style:copy(style)};paths.push(record);
      return {addTo(){return this;},setLatLngs(next){record.points=copy(next);return this;}};
    },
    divIcon:icon=>icon,
    marker:(position,config)=>{
      const text=config.icon.html.match(/>([^<>]*)<\/div>/)?.[1]||'';
      const measured=measuredTextBox(config.icon.html,text),{width,height}=measured;
      const record={position:coordinate(position),config,text,...measured};markers.push(record);
      const element={dataset:{},getBoundingClientRect:()=>{
        const p=project(record.position);
        return {left:p.x-width/2,right:p.x+width/2,top:p.y-height/2,bottom:p.y+height/2,width,height};
      }};
      record.element=element;
      const node={querySelector:()=>element,setAttribute(){}};
      return {addTo(){return this;},getElement:()=>node,getLatLng:()=>record.position,
        setLatLng(next){record.position=coordinate(next);return this;}};
    }
  };
  const polygon=rectangle({x:70,y:70,w:50,h:50});
  const polygons=geometry.polygons||[polygon],occupied=geometry.occupied||[];
  const map={removeLayer(){},getPane:name=>panes.get(name),createPane:name=>panes.set(name,{style:{}}),
    latLngToContainerPoint:project,containerPointToLatLng:unproject,getSize:()=>({x:canvas.w,y:canvas.h}),
    _printNameBoxes:occupied.map(box=>({x0:box.x,y0:box.y,x1:box.x+box.w,y1:box.y+box.h})),
    getContainer:()=>({getBoundingClientRect:()=>({left:0,top:0,width:canvas.w,height:canvas.h}),querySelectorAll:()=>[]})};
  const html=fs.readFileSync(path.join(__dirname,'../outputs/croquis_territorios.html'),'utf8');
  const names=['normalizeDestinationPoint','normalizeDestinationLabel','directionAnnotationGeometry',
    'printDirectionTextPoints','obstaculosDeDestinosImpresos','renderDirectionAnnotations'];
  const context=vm.createContext({window:{L,CroquisPrintDirectionLayout:geometry.layout||layout},L,
    getTextLabelsForLoc:()=>labels,getExportColorAreasForLoc:()=>polygons.map(points=>
      ({points:points.map(p=>[p.y/projectionScale,p.x/projectionScale])})),
    directionInteractionAllowed:()=>true,congregacionActivaId:'a',selectedTextIndex:null,
    stateFingerprint:JSON.stringify,escapeHtml:text=>text});
  vm.runInContext(names.map(name=>extractFunction(html,name)).join('\n'),context);
  const output=context.renderDirectionAnnotations(map,{num:1},options);
  return {paths,markers,project,polygon,polygons,occupied,canvas,output,map};
}

test('Actual grouped rendering measures DOM labels and preserves the editor and individual shaft geometry',()=>{
  const labels=freezeDeep([
    {type:'destino',text:'Hacia Moctezuma',points:[[7,7],[6.8,6.8]],lat:3,lng:18.5},
    {type:'destino',text:'Hacia Zacamitla',points:[[7,9.5],[6.8,9.5]],lat:17,lng:16},
    {type:'destino',text:'Hacia Ocotitlan',points:[[9.5,12],[9.5,12.2]],lat:15.5,lng:3.5}
  ].map(label=>({...label,sizePt:10,headMm:3,strokePt:1.2})));
  const before=JSON.stringify(labels);
  const grouped=renderHarness(labels,{printMode:true,grouped:true,scale:1,layoutScale:1,
    maxTextWidthMm:40,interactive:false});
  const shafts=grouped.paths.filter(record=>record.style.className==='destination-arrow-path');
  const heads=grouped.paths.filter(record=>record.style.className==='destination-arrow-head');
  assert.equal(shafts.length,3);assert.equal(heads.length,3);assert.equal(grouped.markers.length,3);
  const items=shafts.map((shaft,index)=>({key:labels[index].text,
    start:grouped.project(shaft.points[0]),tip:grouped.project(shaft.points[1]),
    wings:[grouped.project(heads[index].points[0]),grouped.project(heads[index].points[2])],
    width:grouped.markers[index].width,height:grouped.markers[index].height}));
  const results=grouped.markers.map(marker=>grouped.project(marker.position));
  assertClear(results,{items,polygons:[grouped.polygon],occupied:[],canvas:{w:240,h:200},gap:0,unitScale:96/25.4});
  results.forEach((centre,index)=>{
    const box=labelBox(centre,items[index]);
    assert(box.x>=grouped.output.bounds.x0-1e-8 && box.y>=grouped.output.bounds.y0-1e-8 &&
      box.x+box.w<=grouped.output.bounds.x1+1e-8 && box.y+box.h<=grouped.output.bounds.y1+1e-8,
    'The crop includes the entire measured label at its final position');
  });
  assert(grouped.output.bounds.y1<140,'Remote original anchors no longer enlarge the grouped crop');
  items.forEach((item,index)=>{
    const length=distance(item.start,item.tip)/(96/25.4);
    assert(length>=2.6-1e-7 && length<=4+1e-7,'The grouped renderer uses bounded compact shafts');
    assertForward(results[index],item,'Measured DOM text stays with the forward part of the rendered arrow');
    assert(distance(results[index],item.tip)/(96/25.4)<20,'A saved distant DOM label is visibly moved near its tip');
  });
  const reversed=renderHarness([...labels].reverse(),{printMode:true,grouped:true,scale:1,layoutScale:1,
    maxTextWidthMm:40,interactive:false});
  const byText=render=>Object.fromEntries(render.markers.map(marker=>[marker.text,marker.position]));
  assert.deepEqual(byText(reversed),byText(grouped),'Actual DOM rendering is stable across stored annotation order');
  for(const options of [{printMode:false},{printMode:true,grouped:false}]){
    const ordinary=renderHarness(labels,{...options,scale:1,layoutScale:1,maxTextWidthMm:64,interactive:false});
    const ordinaryShafts=ordinary.paths.filter(record=>record.style.className==='destination-arrow-path');
    ordinaryShafts.forEach((shaft,index)=>assert.deepEqual(shaft.points,labels[index].points,
      'Editor and individual PDF keep the original geographical endpoints'));
    ordinary.markers.forEach(marker=>assert(Math.abs(marker.font*72/96-(options.printMode?6:10))<1e-8,
      'Only grouped names shrink; editor and individual PDF fonts keep their prior sizes'));
    ordinaryShafts.forEach(shaft=>assert(Math.abs(shaft.style.weight-1.2*96/72*(options.printMode?.65:1))<1e-8,
      'Only grouped strokes change; editor and individual PDF weights remain intact'));
  }
  assert.equal(JSON.stringify(labels),before,'All rendering modes leave persisted destination annotations untouched');
});

test('El Crucero keeps four smaller complete destinations clear of its silhouette and gains space against previous printed dimensions',()=>{
  const unitScale=96/25.4,polygon=rectangle({x:85,y:68,w:42,h:78});
  const labels=freezeDeep([
    {text:'Hacia Moctezuma',start:{x:91,y:68},tip:{x:80,y:57}},
    {text:'Hacia providencia los cedros',start:{x:105,y:68},tip:{x:105,y:49}},
    {text:'Hacia Ocotitlán',start:{x:127,y:81},tip:{x:157,y:81}},
    {text:'Hacia los lirios',start:{x:120,y:146},tip:{x:146,y:160}}
  ].map(item=>({type:'destino',text:item.text,points:[[item.start.y/10,item.start.x/10],
    [item.tip.y/10,item.tip.x/10]],lat:1,lng:1,sizePt:10,headMm:3,strokePt:1.2})));
  const before=JSON.stringify(labels),geometry={canvas:{w:57*unitScale,h:64*unitScale},polygons:[polygon]};
  const options={printMode:true,grouped:true,scale:1,layoutScale:1,maxTextWidthMm:44,interactive:false};
  const printed=renderHarness(labels,options,geometry);
  const shafts=printed.paths.filter(record=>record.style.className==='destination-arrow-path');
  const heads=printed.paths.filter(record=>record.style.className==='destination-arrow-head');
  const items=shafts.map((shaft,index)=>({key:labels[index].text,start:printed.project(shaft.points[0]),
    tip:printed.project(shaft.points[1]),wings:[printed.project(heads[index].points[0]),
      printed.project(heads[index].points[2])],width:printed.markers[index].width,height:printed.markers[index].height}));
  const centres=printed.markers.map(marker=>printed.project(marker.position));
  assertClear(centres,{items,polygons:[polygon],occupied:[],canvas:geometry.canvas,gap:.4*unitScale,unitScale});
  printed.markers.forEach((marker,index)=>{
    assert.equal(marker.lines.join(' '),labels[index].text,'Every authored destination remains complete');
    assert.equal(marker.element.dataset.printDirectionClear,'true','All four names have measured free space');
    assertForward(centres[index],items[index],'Every name stays ahead of its own compact arrow');
    assert(Math.abs(marker.font*72/96-4.4)<1e-8,'The shared frame uses a smaller measured font');
    const shaftMm=distance(items[index].start,items[index].tip)/unitScale;
    assert(shaftMm>=2.6-1e-8 && shaftMm<=4+1e-8,'A long saved direction remains a small printed cue');
  });
  const legacy={...layout,textPoints:(size,width)=>layout.textPoints(size,width),groupedArrow:input=>{
    const {start}=input,dx=input.tip.x-start.x,dy=input.tip.y-start.y,length=Math.hypot(dx,dy);
    const ux=dx/length,uy=dy/length,printedLength=Math.max(length,3.5*input.unitScale);
    const tip={x:start.x+ux*printedLength,y:start.y+uy*printedLength};
    const head=Math.min(1.95*input.unitScale,printedLength*.42);
    return {start:{...start},tip,wings:[{x:tip.x-ux*head-uy*head*.55,y:tip.y-uy*head+ux*head*.55},
      {x:tip.x-ux*head+uy*head*.55,y:tip.y-uy*head-ux*head*.55}]};
  }};
  const old=renderHarness(labels,options,{...geometry,layout:legacy});
  const crop=render=>({x:Math.min(85,render.output.bounds.x0),y:Math.min(68,render.output.bounds.y0),
    w:Math.max(127,render.output.bounds.x1)-Math.min(85,render.output.bounds.x0),
    h:Math.max(146,render.output.bounds.y1)-Math.min(68,render.output.bounds.y0)});
  const newCrop=crop(printed),oldCrop=crop(old);
  const {fit}=require('../outputs/print-frame-fit.js');
  const plan={mapRect:{x:0,y:0,w:57,h:64}};
  const newFit=fit(newCrop,plan),oldFit=fit(oldCrop,plan);
  assert(newCrop.w*newCrop.h<oldCrop.w*oldCrop.h,'The complete compact annotations need less surrounding paper');
  assert(newFit.scale>oldFit.scale*1.1,'The same territory can occupy at least ten percent more of this frame');
  assert.equal(JSON.stringify(labels),before,'The printed refinement never rewrites stored destinations');
});

test('Wrapped whole destination words remain complete in the real 32.8 by 20.9 mm source canvas',()=>{
  const unitScale=96/25.4,nativeToCss=.012274008683260982;
  const point=(x,y)=>({x:x*nativeToCss,y:y*nativeToCss});
  const coordinate=p=>[p.y/10,p.x/10];
  const nativeArrows=[
    {text:'Hacia Moctezuma',start:point(4523,2819),tip:point(3665.1668138136065,2166.5634921962637)},
    {text:'Hacia Zacamitla',start:point(4594,2808),tip:point(4594,1730.247165609)},
    {text:'Hacia Ocotitlán',start:point(5638,2873),tip:point(6711.5370620801405,2777.7668735251486)}
  ];
  const labels=freezeDeep(nativeArrows.map(arrow=>({type:'destino',text:arrow.text,
    points:[coordinate(arrow.start),coordinate(arrow.tip)],lat:1,lng:1,sizePt:10,headMm:3,strokePt:1.2})));
  const before=JSON.stringify(labels);
  const polygons=[rectangle({x:3958*nativeToCss,y:2841*nativeToCss,w:1661*nativeToCss,h:1013*nativeToCss})];
  const geometry={canvas:{w:32.8*unitScale,h:20.9*unitScale},polygons,
    occupied:[{x:3903.5793745212154*nativeToCss,y:2581.5617631559194*nativeToCss,
      w:922.8440472799142*nativeToCss,h:734.8782334082156*nativeToCss}]};
  const options={printMode:true,grouped:true,scale:1,layoutScale:1,maxTextWidthMm:27.73,interactive:false};
  const grouped=renderHarness(labels,options,geometry);
  const shafts=grouped.paths.filter(record=>record.style.className==='destination-arrow-path');
  const heads=grouped.paths.filter(record=>record.style.className==='destination-arrow-head');
  const items=shafts.map((shaft,index)=>({key:labels[index].text,
    start:grouped.project(shaft.points[0]),tip:grouped.project(shaft.points[1]),
    wings:[grouped.project(heads[index].points[0]),grouped.project(heads[index].points[2])],
    width:grouped.markers[index].width,height:grouped.markers[index].height}));
  const centres=grouped.markers.map(marker=>grouped.project(marker.position));
  assertClear(centres,{items,polygons,occupied:geometry.occupied,canvas:geometry.canvas,gap:.4*unitScale,unitScale});
  grouped.markers.forEach((marker,index)=>{
    assert.equal(marker.element.dataset.printDirectionClear,'true','Every fully measured wrapped name finds free space');
    assert.equal(marker.lines.length,2,'Each complete destination is legible on two lines');
    const town=labels[index].text.split(' ').slice(1).join(' ');
    assert(marker.lines.includes(town),'The town name remains intact rather than splitting its final letter');
    assert.equal(marker.lines.join(' '),labels[index].text,'Wrapping retains every authored word');
    assert(Math.abs(marker.font*72/96-4.4)<1e-8,'The grouped name uses the smaller physical font size');
    assert(marker.width/unitScale<=13,'The complete wrapped name leaves space for the neighboring destinations');
    assertForward(centres[index],items[index],'The complete wrapped name remains ahead of its own arrow');
    const box=labelBox(centres[index],items[index]);
    assert(box.x>=grouped.output.bounds.x0-1e-7 && box.y>=grouped.output.bounds.y0-1e-7 &&
      box.x+box.w<=grouped.output.bounds.x1+1e-7 && box.y+box.h<=grouped.output.bounds.y1+1e-7,
    'The final crop includes both complete measured lines');
  });
  const individual=renderHarness(labels,{...options,grouped:false},geometry);
  assert(individual.markers.every(marker=>marker.lines.length===1),'The individual PDF keeps its existing one-line names');
  const single=renderHarness([labels[0]],options,geometry);
  assert.equal(single.markers[0].lines.length,1,'A single grouped destination keeps its original line layout');
  assert.equal(JSON.stringify(labels),before,'Wrapping cannot change authored text or saved geometry');
});
