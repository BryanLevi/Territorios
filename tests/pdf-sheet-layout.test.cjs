const {test} = require('node:test');
const assert = require('node:assert/strict');
const layout = require('../outputs/pdf-sheet-layout.js');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function overlaps(a,b){
  return a.x < b.x+b.w-1e-7 && a.x+a.w > b.x+1e-7 &&
    a.y < b.y+b.h-1e-7 && a.y+a.h > b.y+1e-7;
}
const profiles = [
  {aspect:1.3,divisions:8,references:8},
  {aspect:2.2,divisions:1,references:1},
  {aspect:.75,divisions:1},{aspect:4.6,divisions:1},
  {aspect:1.8,divisions:1},{aspect:.5,divisions:1},
  {aspect:.95,divisions:2},{aspect:.6,divisions:1},
  {aspect:.7,divisions:2},{aspect:1.25,divisions:4,references:2},
  {aspect:1.7,divisions:1},{aspect:.6,divisions:1},
  {aspect:.3,divisions:1},{aspect:1.4,divisions:1},
  {aspect:.9,divisions:2,references:1},
  {aspect:.85,divisions:2},{aspect:.5,divisions:1},
  {aspect:1.3,divisions:1},{aspect:.7,divisions:1},
  {aspect:.8,divisions:1},{aspect:1.2,divisions:7,references:5}
];

test('Adaptive sheets keep every selected map inside the page without overlapping frames',()=>{
  for(const orientation of ['portrait','landscape']){
    for(const count of [1,2,3,6,8,12,15,21]){
      const input=profiles.slice(0,count), before=JSON.stringify(input);
      const slots=layout.plan(input,{orientation});
      assert.equal(slots.length,count,`${orientation}: ${count} maps`);
      const [w,h]=orientation==='portrait'?[210,297]:[297,210];
      for(let i=0;i<slots.length;i++){
        const slot=slots[i];
        assert(slot.w>=25 && slot.h>=23,`Readable frame ${orientation}/${count}/${i}`);
        assert(slot.x>=5-1e-7 && slot.y>=20-1e-7);
        assert(slot.x+slot.w<=w-5+1e-7 && slot.y+slot.h<=h-5+1e-7);
        for(let j=i+1;j<slots.length;j++) assert(!overlaps(slot,slots[j]),`Frames ${i}/${j}`);
      }
      assert.equal(JSON.stringify(input),before,'Export never edits saved profiles');
    }
  }
});

test('The second large portrait frame goes to the map with many subdivisions, not the second selected map',()=>{
  const slots=layout.plan(profiles,{orientation:'portrait'});
  assert.equal(slots[0].x,slots[20].x);
  assert.equal(slots[0].w,slots[20].w);
  assert(slots[20].w*slots[20].h > slots[1].w*slots[1].h*1.5,
    'Seven-division Tomatlán receives more paper than the one-zone Pizarrostla');
  assert(slots[1].w > slots[1].h,'The long map receives a horizontal frame');
  assert(slots[3].w > slots[3].h,'The wide Zopiloapan silhouette fits a horizontal frame');
});

test('Four numbered zones receive a proportional frame without taking a second principal section',()=>{
  const selected=profiles.slice(0,15);
  const slots=layout.plan(selected,{orientation:'portrait'});
  assert(slots[9].x>slots[0].x,'Ocotitlán belongs to the secondary side column');
  assert(slots[9].w>=45 && slots[9].h>=40,'Its four zones retain a usable frame');
  assert(slots[0].w*slots[0].h>slots[9].w*slots[9].h*2,
    'The selected principal retains substantially more paper');
});

test('A few portrait maps can use a wide principal above a compact lower row',()=>{
  const selected=[{aspect:1.164,divisions:8,references:8},
    {aspect:.63,divisions:1},{aspect:1.464,divisions:1,references:2}];
  const slots=layout.plan(selected,{orientation:'portrait'});
  assert.equal(slots[0].w,200,'The principal uses the available page width');
  assert(slots[1].y>slots[0].y+slots[0].h);
  assert.equal(slots[1].y,slots[2].y,'Secondary maps share a lower row');
  assert(slots[1].h<120 && slots[2].h<120,'No narrow secondary frame spans the whole page');
});

test('Lower rows distribute maps evenly instead of leaving one map in a wide orphan frame',()=>{
  for(const orientation of ['portrait','landscape']){
    for(const count of [8,12,15,18,21]){
      const slots=layout.plan(profiles.slice(0,count),{orientation});
      const mainBottom=Math.max(...slots.filter((slot,index)=>index===0 ||
        (orientation==='portrait' && profiles[index].divisions>=6
          && Math.abs(slot.x-slots[0].x)<1e-8 && Math.abs(slot.w-slots[0].w)<1e-8))
        .map(slot=>slot.y+slot.h));
      const bottom=slots.slice(1).filter(slot=>slot.x<slots[0].x+slots[0].w-1e-8
        && slot.y>mainBottom+1e-8);
      const rows=new Map();
      for(const slot of bottom){
        const key=slot.y.toFixed(6); rows.set(key,(rows.get(key)||0)+1);
      }
      const counts=[...rows.values()];
      if(counts.length>1) assert(Math.max(...counts)-Math.min(...counts)<=1,
        `${orientation}/${count}: lower rows share the remaining maps`);
    }
  }
});

test('Sheet planning responds to geometry and remains deterministic for a manual preview',()=>{
  const compact=Array.from({length:9},()=>({aspect:1,divisions:1}));
  const wide=compact.map((p,i)=>({...p,aspect:i===2?6:1}));
  const first=layout.plan(compact,{orientation:'portrait'});
  const next=layout.plan(wide,{orientation:'portrait'});
  assert.notDeepEqual(first,next,'The shape changes the layout instead of only decorating the border');
  assert.deepEqual(layout.plan(wide,{orientation:'portrait'}),next);
  assert.deepEqual(layout.plan([],{}),[]);
  const malformed=layout.plan([{aspect:Infinity,divisions:-2},{aspect:NaN}],{orientation:'landscape'});
  assert(malformed.flatMap(Object.values).every(Number.isFinite));
});

test('Moving maps manually keeps the chosen frames while a new orientation recalculates them',()=>{
  const html=fs.readFileSync(path.join(__dirname,'../outputs/croquis_territorios.html'),'utf8');
  const start=html.indexOf('function fijarDistribucionManualDeLamina(');
  const end=html.indexOf('// Una hoja por pagina:',start);
  assert(start>=0&&end>start);
  const original=layout.plan(profiles.slice(0,15),{orientation:'portrait'});
  const context=vm.createContext({window:{CroquisSheetLayout:layout},agruparOrientacion:'portrait',agruparModo:'lamina',
    agruparHuecosManuales:null,AGRUPAR_MARGEN:5,AGRUPAR_HUECO:3,AGRUPAR_TITULO:15,
    A4_CORTO:210,A4_LARGO:297,cuentasAgrupadas:()=>({huecos:original}),
    paginaAgrupada:()=>({ancho:210,alto:297})});
  vm.runInContext(html.slice(start,end),context);
  context.fijarDistribucionManualDeLamina();
  context.agruparModo='sueltas';
  context.cuentasAgrupadas=()=>({huecos:[{x:5,y:20,w:200,h:272}]});
  context.fijarDistribucionManualDeLamina();
  context.agruparModo='lamina';
  const swapped=profiles.slice(0,15); [swapped[1],swapped[9]]=[swapped[9],swapped[1]];
  assert.deepEqual(JSON.parse(JSON.stringify(context.huecosDeLamina(15,swapped))),original,
    'An automatic importance ranking cannot undo a deliberate drag');
  context.agruparOrientacion='landscape';
  const rotated=JSON.parse(JSON.stringify(context.huecosDeLamina(15,swapped)));
  assert.notDeepEqual(rotated,original,'Portrait coordinates never leak into a horizontal page');
  assert(rotated.every(slot=>slot.y+slot.h<=205+1e-8));
});

test('Many brush fragments do not turn eight numbered subdivisions into ninety-eight territories',()=>{
  const html=fs.readFileSync(path.join(__dirname,'../outputs/croquis_territorios.html'),'utf8');
  const start=html.indexOf('function perfilDeCroquisParaLamina(');
  const end=html.indexOf('function fijarDistribucionManualDeLamina(',start);
  const areas=Array.from({length:98},(_,i)=>({color:['#00ffcc','#9933ff'][i%2],
    points:[[19.04,-96.99],[19.05,-96.98],[19.04,-96.97]]}));
  let labels=Array.from({length:8},(_,i)=>({text:String(i+1)}));
  let references=[{kind:'Escuela',ver:true}];
  labels.push({text:'Hacia Tomatlán'});
  const context=vm.createContext({getExportColorAreasForLoc:()=>areas,
    getExportBoundsPlain:()=>({south:19.04,north:19.05,west:-96.99,east:-96.97}),
    DETAIL_ZOOM:15,getTextLabelsForLoc:()=>labels,isPrintZoneNumber:label=>/^\d+$/.test(label.text),
    referenciasDeLoc:()=>references});
  vm.runInContext(html.slice(start,end),context);
  const numbered=context.perfilDeCroquisParaLamina({num:1});
  assert.equal(numbered.divisions,8);
  assert.equal(numbered.references,1);
  assert(numbered.aspect>1.8&&numbered.aspect<2);
  labels=[];
  assert.equal(context.perfilDeCroquisParaLamina({num:1}).divisions,2,
    'Without numbers, distinct zone colors are a conservative fallback');
  references=[{kind:'Escuela',ver:false}];
  assert.equal(context.perfilDeCroquisParaLamina({num:1}).references,0,
    'A deselected manual reference reserves no legend space');
  references=[];
  assert.equal(context.perfilDeCroquisParaLamina({num:1}).references,0,
    'A map with no manual reference rows reserves no legend space');
});
