const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { ROUTE, LEGACY_ROUTE, LEGACY_ROUTES, renderCleanPage, renderLegacyRedirect, preparePages } = require('../tools/prepare-pages.cjs');
const repo = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(repo, 'outputs/croquis_territorios.html'), 'utf8');

test('la dirección limpia publica el generador completo sin iframe ni una segunda fuente', () => {
  const page = renderCleanPage(source);
  assert.equal(page.replace('<base href="../outputs/">\n', '').replace(/\r\n/g, '\n'), source.replace(/\r\n/g, '\n'));
  assert.equal((page.match(/<base\b/g) || []).length, 1);
  assert.ok(page.indexOf('<base ') < page.indexOf('<link '));
  assert.equal(ROUTE, 'croquis-territorios-jw');
  assert.equal(LEGACY_ROUTE, 'coquis-territorios-jw');
  assert.deepEqual(LEGACY_ROUTES, ['coquis-territorios-jw', 'croquis-territorio-jw']);
});

test('la ruta base mantiene scripts, estilos e icono tanto en proyecto como en dominio propio', () => {
  const page = renderCleanPage(source);
  const localAssets = [...page.matchAll(/<(?:script|link)\b[^>]*(?:src|href)=["']([^"']+)["']/gi)]
    .map(match => match[1]).filter(value => !/^(?:https?:|data:)/.test(value));
  assert.ok(localAssets.length >= 8);
  for (const project of ['/Territorios/', '/']) {
    const clean = new URL(project + ROUTE + '/', 'https://example.test');
    const base = new URL('../outputs/', clean);
    for (const asset of localAssets) {
      const url = new URL(asset, base);
      assert.ok(url.pathname.startsWith(project), asset + ' debe permanecer en el proyecto');
      const relative = decodeURIComponent(url.pathname.slice(project.length));
      assert.ok(fs.existsSync(path.join(repo, relative)), 'Falta el recurso ' + relative);
    }
    assert.equal(new URL('offline-map-pack.json', base).pathname, project + 'outputs/offline-map-pack.json');
    assert.equal(new URL('../sw.js', base).pathname, project + 'sw.js');
    assert.equal(new URL('../', base).pathname, project);
  }
});

test('preparar la publicación usa la fuente más reciente y se puede repetir', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'croquis-pages-'));
  t.after(() => {
    const relative = path.relative(os.tmpdir(), root);
    assert.ok(!relative.startsWith('..') && !path.isAbsolute(relative) && /^croquis-pages-/.test(path.basename(root)));
    fs.rmSync(root, { recursive:true, force:true });
  });
  fs.mkdirSync(path.join(root, 'outputs'));
  const original = '<!doctype html>\n<html><head>\n<title>Primero</title></head><body>Mapa</body></html>';
  const file = path.join(root, 'outputs/croquis_territorios.html');
  fs.writeFileSync(file, original);
  const target = preparePages(root);
  assert.equal(target, path.join(root, ROUTE, 'index.html'));
  assert.equal(fs.readFileSync(target, 'utf8'), renderCleanPage(original));
  for (const route of LEGACY_ROUTES) {
    assert.equal(fs.readFileSync(path.join(root, route, 'index.html'), 'utf8'), renderLegacyRedirect());
  }
  fs.writeFileSync(file, original.replace('Primero', 'Actualizado'));
  preparePages(root);
  assert.match(fs.readFileSync(target, 'utf8'), /Actualizado/);
  assert.equal(fs.readFileSync(file, 'utf8'), original.replace('Primero', 'Actualizado'));
});

test('la dirección anterior redirige a la nueva conservando parámetros y fragmento', () => {
  const page = renderLegacyRedirect();
  const script = page.match(/<script>([\s\S]*?)<\/script>/)[1];
  assert.doesNotMatch(page, /<base\b|<iframe\b|offline-data\.js/);
  for (const project of ['/Territorios/', '/']) for (const legacy of LEGACY_ROUTES) {
    for (const end of ['/', '/index.html']) {
      const current = new URL('https://example.test' + project + legacy + end + '?emulador=1#inicio');
      let destination;
      vm.runInNewContext(script, {URL, location:{href:current.href, search:current.search,
        hash:current.hash, replace:url => { destination = new URL(url); }}});
      assert.equal(destination.pathname, project + ROUTE + '/');
      assert.equal(destination.search, '?emulador=1');
      assert.equal(destination.hash, '#inicio');
      const fallback = page.match(/<a href="([^"]+)"/)[1];
      assert.equal(new URL(fallback, current).pathname, project + ROUTE + '/');
    }
  }
});

test('una fuente sin cabecera o con otra base no genera una dirección equivocada', () => {
  assert.throws(() => renderCleanPage('<body>Mapa</body>'), /cabecera/);
  assert.throws(() => renderCleanPage('<head><base href="otra/"></head>'), /ruta base/);
});

test('la entrada conserva parámetros y fragmento al abrir la dirección nueva', () => {
  const index = fs.readFileSync(path.join(repo, 'index.html'), 'utf8');
  const script = index.match(/<script>([\s\S]*?)<\/script>/)[1];
  for (const href of ['https://example.test/Territorios/?emulador=1#inicio', 'file:///C:/croquis/index.html?emulador=1#inicio']) {
    const current = new URL(href);
    let destination;
    vm.runInNewContext(script, {URL, location:{href, protocol:current.protocol, search:current.search,
      hash:current.hash, replace:url => { destination = new URL(url); }}});
    assert.equal(destination.search, '?emulador=1');
    assert.equal(destination.hash, '#inicio');
    assert.ok(destination.pathname.endsWith(current.protocol === 'file:' ? '/outputs/croquis_territorios.html' : '/' + ROUTE + '/'));
  }
});

test('Pages prepara la dirección antes de subir el sitio', () => {
  const workflow = fs.readFileSync(path.join(repo, '.github/workflows/pages.yml'), 'utf8');
  assert.ok(workflow.indexOf('node tools/prepare-pages.cjs') < workflow.indexOf('actions/upload-pages-artifact'));
});
