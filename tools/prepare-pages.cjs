/* Publish the clean address from the same app source; relative assets stay in outputs. */
const fs = require('node:fs');
const path = require('node:path');

const ROUTE = 'croquis-territorios-jw';
const LEGACY_ROUTE = 'coquis-territorios-jw';
const LEGACY_ROUTES = [LEGACY_ROUTE, 'croquis-territorio-jw'];

function renderCleanPage(source) {
  if (!/<head\b[^>]*>/i.test(source)) throw new Error('El generador no tiene cabecera HTML.');
  if (/<base\b/i.test(source)) throw new Error('El generador ya define una ruta base.');
  return source.replace(/(<head\b[^>]*>)(\r?\n)?/i, '$1\n<base href="../outputs/">\n');
}

function renderLegacyRedirect() {
  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Croquis de territorios · Bryan Levi</title>
  <link rel="icon" type="image/svg+xml" href="../outputs/favicon.svg?v=1">
  <script>
    const destination = new URL('../${ROUTE}/', location.href);
    destination.search = location.search;
    destination.hash = location.hash;
    location.replace(destination.href);
  </script>
  <meta http-equiv="refresh" content="0; url=../${ROUTE}/">
</head>
<body>
  <p>Abriendo el generador de croquis...</p>
  <p><a href="../${ROUTE}/">Entrar al generador</a></p>
</body>
</html>
`;
}

function preparePages(root = path.resolve(__dirname, '..')) {
  const source = fs.readFileSync(path.join(root, 'outputs/croquis_territorios.html'), 'utf8');
  const directory = path.join(root, ROUTE);
  fs.mkdirSync(directory, { recursive:true });
  const destination = path.join(directory, 'index.html');
  fs.writeFileSync(destination, renderCleanPage(source), 'utf8');
  for (const route of LEGACY_ROUTES) {
    const legacyDirectory = path.join(root, route);
    fs.mkdirSync(legacyDirectory, { recursive:true });
    fs.writeFileSync(path.join(legacyDirectory, 'index.html'), renderLegacyRedirect(), 'utf8');
  }
  return destination;
}

module.exports = { ROUTE, LEGACY_ROUTE, LEGACY_ROUTES, renderCleanPage, renderLegacyRedirect, preparePages };
if (require.main === module) {
  preparePages();
  console.log('Dirección preparada: ' + ROUTE + '/');
}
