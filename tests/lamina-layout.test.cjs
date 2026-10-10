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
    'calcularAreaDeCroquis'].map(extractFunction).join('\n'), context);
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
  return point.x >= -1e-8 && point.y >= -1e-8
    && point.x <= slot.w + 1e-8 && point.y <= slot.h + 1e-8
    && point.x - point.y <= slot.w - cut + 1e-8;
}

function assertRectangleInside(rect, slot, message){
  assert(rect && rect.w > 0 && rect.h > 0, `${message}: usable rectangle`);
  for(const x of [rect.x,rect.x+rect.w]){
    for(const y of [rect.y,rect.y+rect.h]){
      assert(insideFrame({x,y},slot), `${message}: corner (${x},${y}) stays inside the frame`);
    }
  }
}

test('Diagonal corners decorate selected secondary maps and preserve small and principal frames', () => {
  const context = environment('portrait');
  const slots = [
    {x:5,y:20,w:180,h:145},
    {x:190,y:20,w:50,h:35},
    {x:190,y:58,w:50,h:35},
    {x:190,y:96,w:50,h:35},
    {x:190,y:134,w:34,h:35},
    {x:5,y:168,w:120,h:70},
    {x:5,y:242,w:50,h:29},
    {x:58,y:242,w:45,h:35}
  ];
  const territories = slots.map((_,index) => ({num:index+1,name:[2,5,6].includes(index) ? 'Cruz Verde' : `Mapa ${index+1}`}));
  const before = plain(slots), selectedBefore = plain(territories);
  slots.forEach(Object.freeze); territories.forEach(Object.freeze);
  Object.freeze(slots); Object.freeze(territories);
  const returned = context.decorarHuecosDeLamina(slots,territories);
  const decorated = plain(returned);
  assert.equal(decorated.length,slots.length);
  assert.equal(decorated[0].corteDiagonal,0,'The principal map keeps its full frame');
  assert.equal(decorated[4].corteDiagonal,0,'A narrow map does not lose useful space');
  assert.equal(decorated[5].corteDiagonal,0,'A large map keeps its full frame even when named Cruz Verde');
  assert.equal(decorated[6].corteDiagonal,0,'A short map keeps its full frame even when named Cruz Verde');
  assert(decorated[2].corteDiagonal > 0,'Cruz Verde receives the requested diagonal even outside the alternating selection');
  const cuts = decorated.filter(slot => slot.corteDiagonal > 0);
  assert(cuts.length > 1 && cuts.length < decorated.length-1,'Only some secondary frames have diagonal corners');
  assert(cuts.every(slot => slot.corteDiagonal <= 12 && slot.corteDiagonal < slot.w*.2 && slot.corteDiagonal < slot.h*.25),
    'The corner is visible without consuming the frame');
  assert.deepEqual(decorated.map(({corteDiagonal,...slot}) => slot),before,'Decoration leaves the layout coordinates and sizes unchanged');
  assert.deepEqual(plain(slots),before,'Saved input frames are not mutated');
  assert.deepEqual(plain(territories),selectedBefore,'Territory selections and names are not mutated');
  assert(returned.every((slot,index) => slot !== slots[index]),'Decoration returns independent frames');
  for(const count of [1,2]){
    const smallSelection = context.decorarHuecosDeLamina(slots.slice(0,count),territories.slice(0,count));
    assert(smallSelection.every(slot => slot.corteDiagonal === 0),'One or two maps preserve rectangular frames');
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
          assertRectangleInside({x:0,y:0,w:slot.w-slot.corteDiagonal,h:titleHeight},slot,`${location}: wrapped title`);
          assert(!overlaps(plan.mapRect,plan.legendRect) && !overlaps(plan.mapRect,plan.compassRect),
            `${location}: the map remains separate from its footer`);
          assert(!overlaps(plan.legendRect,plan.compassRect),`${location}: footer ornaments do not overlap`);
          const full = plain(context.calcularAreaDeCroquis({...slot,corteDiagonal:0},titleHeight,legend,compass));
          assert.equal(plan.mapRect.y,full.mapRect.y,`${location}: the corner does not push the map down`);
          assert.equal(plan.mapRect.h,full.mapRect.h,`${location}: the corner preserves map height`);
          assert.deepEqual(plan.legendRect,full.legendRect,`${location}: references keep their lower-left position`);
          assert.deepEqual(plan.compassRect,full.compassRect,`${location}: the compass keeps its lower-right position`);
          assert(plan.mapRect.w >= full.mapRect.w*.8,`${location}: most of the map width remains available`);
        }
      }
      assert.deepEqual(plain(slots),before,`${orientation}, ${count}: the saved layout is unchanged`);
    }
  }
  assert(checkedDiagonal > 10,'Geometry covers multiple diagonal frames and page layouts');
});
