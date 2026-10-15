const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '../outputs/croquis_territorios.html'), 'utf8');

function sourceFunction(name) {
  const start = html.indexOf('function ' + name + '(');
  assert.notEqual(start, -1, 'Missing application function: ' + name);
  const rest = html.slice(start);
  const end = rest.slice(1).search(/^\s*(?:async )?function [A-Za-z_$][\w$]*\(/m);
  return end < 0 ? rest : rest.slice(0, end + 1);
}

function environment() {
  const elements = new Map();
  let focused = null;
  const element = id => {
    if (!elements.has(id)) {
      const attributes = new Map();
      elements.set(id, {
        value: '', hidden: true, textContent: '', open: false,
        setAttribute: (name, value) => attributes.set(name, value),
        removeAttribute: name => attributes.delete(name),
        getAttribute: name => attributes.get(name),
        focus: () => { focused = id; },
        showModal() { this.open = true; },
        close() { this.open = false; },
        reset() {
          element('new-territory-name').value = '';
          element('new-territory-municipio').value = '';
        }
      });
    }
    return elements.get(id);
  };
  let stored = [{num: 'existing', name: 'Existing', lat: 19, lon: -96}];
  const calls = {saves: [], selected: [], published: 0, applied: 0, populated: 0, prevented: 0, statuses: []};
  const c = vm.createContext({
    $: element,
    LOCS: [{num: 'existing', municipio: 'Municipio seleccionado'}], currentIndex: 0,
    newTerritoryDraft: null, congregacionActivaId: 'ixhuatlan',
    registry: [{id: 'ixhuatlan'}], accessAllowed: true, saveAllowed: true,
    DETAIL_PAD: .01, DETAIL_ZOOM: 16, ESTADO: 'Veracruz',
    municipioActual: () => 'Municipio de congregación',
    estadoActual: () => 'Estado inicial',
    congregacionActual: () => ({nombre: 'Congregación inicial'}),
    cargarCongregaciones: () => c.registry,
    window: {CroquisAccess: {canEnter: () => c.accessAllowed}},
    Date: {now: () => 1234567890},
    loadCustomTerritorySettings: () => structuredClone(stored),
    saveCustomTerritorySettings(items) {
      calls.saves.push(structuredClone(items));
      if (!c.saveAllowed) return false;
      stored = structuredClone(items);
      return true;
    },
    applyCustomTerritories() {
      calls.applied++;
      // The new locality need not be last when a saved order is reapplied.
      c.LOCS = [stored.at(-1), stored[0], {num: 'last-existing'}];
    },
    populateSelect: () => { calls.populated++; },
    goTo: index => { calls.selected.push(index); },
    publicarLista: () => { calls.published++; },
    setStatus: (...args) => { calls.statuses.push(args); }
  });
  const names = ['centerFromBoundsPlain', 'normalizeCustomTerritory', 'addCustomTerritoryFromBounds',
    'closeNewTerritoryDialog', 'validateNewTerritoryName', 'submitNewTerritory'];
  vm.runInContext(names.map(sourceFunction).join('\n'), c);
  const bounds = {south: 19, north: 19.04, west: -96.94, east: -96.90};
  const open = () => c.addCustomTerritoryFromBounds(bounds);
  const submit = () => c.submitNewTerritory({preventDefault() { calls.prevented++; }});
  return {c, element, calls, bounds, open, submit, focused: () => focused, stored: () => structuredClone(stored)};
}

test('canceling a new territory leaves saved localities untouched', () => {
  const e = environment();
  const before = e.stored();
  e.open();
  e.element('new-territory-name').value = 'Unsaved name';
  assert.equal(e.element('new-territory-dialog').open, true);
  assert.equal(e.focused(), 'new-territory-name');
  e.c.closeNewTerritoryDialog();
  e.submit();
  assert.equal(e.c.newTerritoryDraft, null);
  assert.equal(e.element('new-territory-dialog').open, false);
  assert.deepEqual(e.stored(), before);
  assert.equal(e.calls.saves.length, 0);
  assert.equal(e.calls.published, 0);
});

test('a whitespace-only name reports validation and never persists', () => {
  const e = environment();
  e.open();
  e.element('new-territory-name').value = '  \t  ';
  e.submit();
  assert.equal(e.calls.prevented, 1);
  assert.equal(e.calls.saves.length, 0);
  assert.equal(e.element('new-territory-dialog').open, true);
  assert.equal(e.element('new-territory-name-error').hidden, false);
  assert.equal(e.element('new-territory-name').getAttribute('aria-invalid'), 'true');
  assert.equal(e.focused(), 'new-territory-name');
  e.element('new-territory-name').value = '  Centro  ';
  assert.equal(e.c.validateNewTerritoryName(), true);
  assert.equal(e.element('new-territory-name-error').hidden, true);
  assert.equal(e.element('new-territory-name').getAttribute('aria-invalid'), 'false');
});

test('creation trims the name and the municipality while preserving the selected area', () => {
  const e = environment();
  e.open();
  e.element('new-territory-name').value = '  Colonia Centro  ';
  e.element('new-territory-municipio').value = '  Otro municipio  ';
  e.submit();
  const created = e.stored().at(-1);
  assert.equal(created.name, 'Colonia Centro');
  assert.equal(created.municipio, 'Otro municipio');
  assert.equal(created.estado, 'Estado inicial');
  assert.equal(created.num, 'custom-1234567890');
  assert.equal(created.custom, true);
  assert.equal(created.lat, 19.02);
  assert.equal(created.lon, -96.92);
  assert.deepEqual(created.printBounds, e.bounds);
  assert.equal(e.element('new-territory-dialog').open, false);
  assert.equal(e.c.newTerritoryDraft, null);
  assert.equal(e.calls.applied, 1);
  assert.equal(e.calls.populated, 1);
  assert.equal(e.calls.published, 1);
});

test('blank municipality falls back to the captured locality municipality', () => {
  const e = environment();
  e.open();
  e.element('new-territory-name').value = 'Centro';
  e.element('new-territory-municipio').value = '   ';
  e.c.LOCS = [{num: 'changed-selection', municipio: 'Different municipality'}];
  e.submit();
  assert.equal(e.stored().at(-1).municipio, 'Municipio seleccionado');
});

test('an empty congregation obtains the municipality from its congregation default', () => {
  const e = environment();
  e.c.LOCS = [];
  e.open();
  assert.equal(e.element('new-territory-municipio').value, 'Municipio de congregación');
  e.element('new-territory-name').value = 'Primero';
  e.element('new-territory-municipio').value = '';
  e.submit();
  assert.equal(e.stored().at(-1).municipio, 'Municipio de congregación');
});

test('the pending area is cloned and its original center survives selection changes', () => {
  const e = environment();
  e.open();
  assert.notEqual(e.c.newTerritoryDraft.bounds, e.bounds);
  const originalBounds = {...e.bounds};
  e.bounds.south = 1;
  e.bounds.west = 2;
  e.c.LOCS = [{num: 'other', municipio: 'Elsewhere', lat: 3, lon: 4}];
  e.element('new-territory-name').value = 'Selected area';
  e.submit();
  const created = e.stored().at(-1);
  assert.deepEqual(created.printBounds, originalBounds);
  assert.equal(created.lat, 19.02);
  assert.equal(created.lon, -96.92);
});

test('failed persistence retains the dialog, pending draft and entered values for retry', () => {
  const e = environment();
  e.open();
  e.element('new-territory-name').value = '  My area  ';
  e.element('new-territory-municipio').value = '  My municipality  ';
  e.c.saveAllowed = false;
  const before = e.stored();
  e.submit();
  assert.equal(e.element('new-territory-dialog').open, true);
  assert.ok(e.c.newTerritoryDraft);
  assert.equal(e.element('new-territory-name').value, '  My area  ');
  assert.equal(e.element('new-territory-municipio').value, '  My municipality  ');
  assert.equal(e.element('new-territory-error').hidden, false);
  assert.match(e.element('new-territory-error').textContent, /No se pudo guardar/);
  assert.deepEqual(e.stored(), before);
  assert.equal(e.calls.applied, 0);
  assert.equal(e.calls.published, 0);
  e.c.saveAllowed = true;
  e.submit();
  assert.equal(e.stored().length, before.length + 1);
  assert.equal(e.element('new-territory-dialog').open, false);
});

for (const [scenario, invalidate] of [
  ['the active congregation changes', c => { c.congregacionActivaId = 'other'; }],
  ['the congregation is deleted', c => { c.registry = []; }],
  ['access becomes locked', c => { c.accessAllowed = false; }]
]) {
  test('a pending territory is not persisted when ' + scenario, () => {
    const e = environment();
    e.open();
    e.element('new-territory-name').value = 'Pending area';
    invalidate(e.c);
    e.submit();
    assert.equal(e.calls.saves.length, 0);
    assert.equal(e.calls.published, 0);
    assert.equal(e.element('new-territory-error').hidden, false);
    assert.match(e.element('new-territory-error').textContent, /congregación cambió/);
    assert.equal(e.element('new-territory-dialog').open, true);
  });
}

test('a repeated submit creates one territory and selects its ID rather than the last row', () => {
  const e = environment();
  e.open();
  e.element('new-territory-name').value = 'New area';
  e.submit();
  e.submit();
  assert.equal(e.calls.saves.length, 1);
  assert.equal(e.stored().filter(loc => loc.num === 'custom-1234567890').length, 1);
  assert.deepEqual(e.calls.selected, [0]);
  assert.equal(e.c.LOCS[0].num, 'custom-1234567890');
  assert.equal(e.calls.published, 1);
});
