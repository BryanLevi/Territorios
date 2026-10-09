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
  vm.runInContext(['paginaAgrupada', 'huecosDeLamina'].map(extractFunction).join('\n'), context);
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
