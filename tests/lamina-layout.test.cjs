const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '../outputs/croquis_territorios.html'), 'utf8');

function extractFunction(name){
  const start = html.indexOf(`function ${name}(`);
  assert(start >= 0, `Function available: ${name}`);
  const open = html.indexOf('{', start);
  let depth = 0, quote = null;
  for(let i = open; i < html.length; i++){
    const char = html[i], next = html[i + 1];
    if(quote){
      if(char === '\\'){ i++; continue; }
      if(char === quote) quote = null;
      continue;
    }
    if(char === '/' && next === '/') { i = html.indexOf('\n', i); continue; }
    if(char === '/' && next === '*') { i = html.indexOf('*/', i + 2) + 1; continue; }
    if(char === '"' || char === "'" || char === '`') { quote = char; continue; }
    if(char === '{') depth++;
    if(char === '}' && --depth === 0) return html.slice(start, i + 1);
  }
  throw new Error(`Incomplete function: ${name}`);
}

function environment(orientation){
  const context = vm.createContext({
    A4_LARGO:297, A4_CORTO:210,
    AGRUPAR_MARGEN:5, AGRUPAR_HUECO:3, AGRUPAR_TITULO:15,
    agruparOrientacion:orientation
  });
  vm.runInContext(['paginaAgrupada', 'huecosDeLamina', 'decorarHuecosDeLamina',
    'puntosDeMarcoDiagonal', 'calcularAreaDeCroquis'].map(extractFunction).join('\n'), context);
  return context;
}

function overlaps(a, b){
  return a.x < b.x + b.w - 1e-8 && a.x + a.w > b.x + 1e-8
    && a.y < b.y + b.h - 1e-8 && a.y + a.h > b.y + 1e-8;
}

test('Vertical large groups use two main maps, a readable side column and a bottom grid', () => {
  const context = environment('portrait');
  const page = context.paginaAgrupada();
  for(const count of [8, 9, 12, 13]){
    const slots = context.huecosDeLamina(count);
    assert.equal(slots.length, count);
    assert(slots.every(slot => slot.x >= 5 && slot.y >= 20 &&
      slot.x + slot.w <= page.ancho - 5 && slot.y + slot.h <= page.alto - 5));
    for(let i = 0; i < slots.length; i++){
      for(let j = i + 1; j < slots.length; j++) assert(!overlaps(slots[i], slots[j]), `${count}: slots ${i} and ${j} overlap`);
    }
    assert.equal(slots[0].w, slots[1].w);
    assert.equal(slots[0].h, slots[1].h);
    assert(slots[0].w > 130 && slots[0].h > 85, `${count}: main maps stay large`);
    assert(slots[2].w >= 52 && slots[2].w <= 58, `${count}: side column width`);
    assert(slots.slice(2).every(slot => slot.h >= 16), `${count}: small maps retain usable height`);
    const bottom = slots.slice(2 + Math.min(7, Math.max(4, Math.ceil((count - 2) * .64))));
    if(bottom.length){
      const expectedAspect = 297 / 210;
      const ratio = bottom[0].w / bottom[0].h;
      assert(Math.abs(ratio - expectedAspect) < .35 || bottom.length > 6,
        `${count}: bottom maps keep a readable paper proportion`);
    }
  }
});

test('Horizontal layout remains available as a deliberate user choice', () => {
  const context = environment('landscape');
  const page = context.paginaAgrupada();
  assert.equal(page.ancho, 297);
  assert.equal(page.alto, 210);
  for(const count of [8,12,15,21]){
    const slots = context.huecosDeLamina(count);
    assert.equal(slots.length,count);
    assert(slots.every(slot => slot.x >= 5 && slot.y >= 20 &&
      slot.x + slot.w <= page.ancho - 5 && slot.y + slot.h <= page.alto - 5));
    for(let i=0;i<slots.length;i++) for(let j=i+1;j<slots.length;j++)
      assert(!overlaps(slots[i],slots[j]),`${count}: slots ${i} and ${j} overlap`);
    assert(slots[0].w >= 160 && slots[0].h >= 110,`${count}: main map remains useful`);
    assert(slots.slice(1).every(slot => slot.w >= 35 && slot.h >= 32),
      `${count}: room for a wrapped title, readable map and separate footer`);
    const side = slots.slice(1).filter(slot => slot.x > slots[0].x+slots[0].w);
    const bottom = slots.slice(1).filter(slot => slot.y > slots[0].y+slots[0].h);
    assert(side.length && bottom.length,`${count}: both lateral and lower space is used`);
    if(count>=12) assert(new Set(side.map(slot=>slot.x)).size>=2,
      `${count}: maps use several columns instead of a tall stack of tiny frames`);
  }
});

function plain(value){
  return JSON.parse(JSON.stringify(value));
}

function insideFrame(point, slot){
  const cut = Number(slot.corteDiagonal) || 0;
  if(!(point.x >= -1e-8 && point.y >= -1e-8
    && point.x <= slot.w + 1e-8 && point.y <= slot.h + 1e-8
  )) return false;
  if(!cut) return true;
  switch(slot.esquinaDiagonal){
    case 'top-left': return point.x + point.y >= cut - 1e-8;
    case 'bottom-left': return point.y - point.x <= slot.h - cut + 1e-8;
    case 'bottom-right': return point.x + point.y <= slot.w + slot.h - cut + 1e-8;
    default: return point.x - point.y <= slot.w - cut + 1e-8;
  }
}

function assertRectangleInside(rect, slot, message){
  assert(rect && rect.w > 0 && rect.h > 0, `${message}: usable rectangle`);
  for(const x of [rect.x,rect.x+rect.w]){
    for(const y of [rect.y,rect.y+rect.h]){
      assert(insideFrame({x,y},slot), `${message}: corner (${x},${y}) stays inside the frame`);
    }
  }
}

test('Only the four exterior corners receive outward diagonals regardless of names or selection order', () => {
  const context = environment('portrait');
  const slots = Array.from({length:9},(_,index)=>({
    x:5+(index%3)*48,y:20+Math.floor(index/3)*38,w:45,h:35
  }));
  const territories = slots.map((_,index) => ({num:index+1,name:[1,3,4].includes(index) ? 'Cruz Verde' : `Mapa ${index+1}`}));
  const before = plain(slots), selectedBefore = plain(territories);
  slots.forEach(Object.freeze); territories.forEach(Object.freeze);
  Object.freeze(slots); Object.freeze(territories);
  const returned = context.decorarHuecosDeLamina(slots,territories);
  const decorated = plain(returned);
  assert.equal(decorated.length,slots.length);
  const corners=new Map([[0,'top-left'],[2,'top-right'],[6,'bottom-left'],[8,'bottom-right']]);
  for(const [index,slot] of decorated.entries()){
    assert.equal(slot.esquinaDiagonal,corners.get(index)||null);
    assert.equal(slot.corteDiagonal>0,corners.has(index),'An edge frame without two exterior edges remains rectangular');
  }
  const cuts = decorated.filter(slot => slot.corteDiagonal > 0);
  assert.equal(cuts.length,4,'The grid has four exterior corners');
  assert(cuts.every(slot => slot.corteDiagonal <= 6 && slot.corteDiagonal <= slot.w*.12 && slot.corteDiagonal <= slot.h*.16),
    'The corner is visible without consuming the frame');
  assert.deepEqual(decorated.map(({corteDiagonal,esquinaDiagonal,...slot}) => slot),before,'Decoration leaves the layout coordinates and sizes unchanged');
  assert.deepEqual(plain(slots),before,'Saved input frames are not mutated');
  assert.deepEqual(plain(territories),selectedBefore,'Territory selections and names are not mutated');
  assert(returned.every((slot,index) => slot !== slots[index]),'Decoration returns independent frames');
  const shuffledIndices=[4,8,3,0,2,7,6,1,5];
  const shuffled=context.decorarHuecosDeLamina(shuffledIndices.map(index=>slots[index]),
    shuffledIndices.map(index=>({...territories[index],name:'Otro nombre'})));
  assert.deepEqual(plain(shuffled),shuffledIndices.map(index=>decorated[index]),
    'Only physical positions choose corner cuts after selection order and names change');
  for(const count of [1,2]){
    const smallSelection = context.decorarHuecosDeLamina(slots.slice(0,count),territories.slice(0,count));
    assert(smallSelection.every(slot => slot.corteDiagonal === 0),'One or two maps preserve rectangular frames');
  }
});

test('Small exterior frames remain rectangular and submillimetric layout rounding preserves corner identity', () => {
  const context=environment('portrait');
  assert.deepEqual(plain(context.decorarHuecosDeLamina([],[])),[]);
  const small=[{x:5,y:20,w:100,h:80},{x:108,y:20,w:34,h:80},
    {x:5,y:103,w:100,h:29},{x:108,y:103,w:34,h:29}];
  const selected=small.map((_,index)=>({num:index+1,name:'Cruz Verde'}));
  const decorated=plain(context.decorarHuecosDeLamina(small,selected));
  assert.equal(decorated[0].esquinaDiagonal,'top-left','The main exterior corner receives its outward cut');
  assert(decorated[0].corteDiagonal>0);
  assert(decorated.slice(1).every(slot=>slot.corteDiagonal===0&&slot.esquinaDiagonal===null),
    'Narrow or short exterior frames keep their complete space');
  for(const delta of [.03,.08]){
    const grid=[{x:5,y:20,w:45,h:35},{x:53,y:20,w:45,h:35},
      {x:5+delta,y:58,w:45,h:35},{x:53,y:58,w:45,h:35}];
    const corners=plain(context.decorarHuecosDeLamina(grid,selected));
    assert.equal(corners[2].esquinaDiagonal,delta<.05?'bottom-left':null,
      'Only a rounding error within .05 mm counts as the exterior left edge');
  }
});

test('The preview and exported frame points cut the corresponding exterior corner in each orientation', () => {
  const context=environment('portrait'),base={w:50,h:35,corteDiagonal:6};
  const expected={
    'top-left':[[6,0],[50,0],[50,35],[0,35],[0,6]],
    'top-right':[[0,0],[44,0],[50,6],[50,35],[0,35]],
    'bottom-left':[[0,0],[50,0],[50,35],[6,35],[0,29]],
    'bottom-right':[[0,0],[50,0],[50,29],[44,35],[0,35]]
  };
  const removed={'top-left':{x:0,y:0},'top-right':{x:50,y:0},
    'bottom-left':{x:0,y:35},'bottom-right':{x:50,y:35}};
  for(const esquinaDiagonal of Object.keys(expected)){
    const slot={...base,esquinaDiagonal};
    const points=plain(context.puntosDeMarcoDiagonal(slot));
    assert.deepEqual(points,expected[esquinaDiagonal]);
    assert(points.every(([x,y])=>insideFrame({x,y},slot)),'Every frame vertex lies on its oriented boundary');
    assert(!insideFrame(removed[esquinaDiagonal],slot),'The outer corner is the only removed corner');
    assert(Object.entries(removed).filter(([corner])=>corner!==esquinaDiagonal)
      .every(([,point])=>insideFrame(point,slot)),'The three remaining corners are complete');
  }
});

test('Maps, complete names and footer ornaments remain inside diagonal frames in both PDF orientations', () => {
  let checkedDiagonal = 0;
  for(const orientation of ['portrait','landscape']){
    const context = environment(orientation);
    for(const count of [3,6,8,12,15,21]){
      const slots = context.huecosDeLamina(count);
      const territories = slots.map((_,index) => ({num:index+1,name:index===2 ? 'Cruz Verde' : `Mapa ${index+1}`}));
      const before = plain(slots);
      const decorated = context.decorarHuecosDeLamina(slots,territories);
      for(const [index,slot] of decorated.entries()){
        if(!slot.corteDiagonal) continue;
        checkedDiagonal++;
        for(const titleHeight of [4.2,8,14]){
          const legend = {w:Math.min(32,slot.w-15),h:9};
          const compass = {w:6,h:8};
          const plan = plain(context.calcularAreaDeCroquis(slot,titleHeight,legend,compass));
          const location = `${orientation}, ${count} maps, slot ${index}, title ${titleHeight}`;
          assertRectangleInside(plan.mapRect,slot,`${location}: map and its fitted labels`);
          assertRectangleInside(plan.legendRect,slot,`${location}: references`);
          assertRectangleInside(plan.compassRect,slot,`${location}: compass`);
          const left=slot.esquinaDiagonal==='top-left'?slot.corteDiagonal:0;
          const right=slot.esquinaDiagonal==='top-right'?slot.corteDiagonal:0;
          assertRectangleInside({x:left,y:0,w:slot.w-left-right,h:titleHeight},slot,`${location}: wrapped title`);
          assert(!overlaps(plan.safeMapRect,plan.legendRect) && !overlaps(plan.safeMapRect,plan.compassRect),
            `${location}: fallback protects names when a silhouette cannot be measured`);
          assert(!overlaps(plan.legendRect,plan.compassRect),`${location}: footer ornaments do not overlap`);
          const full = plain(context.calcularAreaDeCroquis({...slot,corteDiagonal:0},titleHeight,legend,compass));
          assert.equal(plan.mapRect.y,full.mapRect.y,`${location}: the corner does not push the map down`);
          assert.equal(plan.mapRect.h,full.mapRect.h,`${location}: the corner preserves map height`);
          assert.equal(plan.legendRect.x,full.legendRect.x,`${location}: references keep their left position`);
          assert.equal(plan.compassRect.x,full.compassRect.x,`${location}: compass keeps its right position`);
          if(slot.esquinaDiagonal==='bottom-left'){
            assert(plan.legendRect.y<full.legendRect.y,`${location}: references rise above the exterior cut`);
          }else assert.deepEqual(plan.legendRect,full.legendRect,`${location}: references keep their lower-left position`);
          if(slot.esquinaDiagonal==='bottom-right'){
            assert(plan.compassRect.y<full.compassRect.y,`${location}: compass rises above the exterior cut`);
          }else assert.deepEqual(plan.compassRect,full.compassRect,`${location}: compass keeps its lower-right position`);
          assert(plan.mapRect.w >= full.mapRect.w*.8,`${location}: most of the map width remains available`);
        }
      }
      assert.deepEqual(plain(slots),before,`${orientation}, ${count}: the saved layout is unchanged`);
    }
  }
  assert(checkedDiagonal > 10,'Geometry covers multiple diagonal frames and page layouts');
});
