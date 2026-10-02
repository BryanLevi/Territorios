/* Publish the clean address from the same app source; relative assets stay in outputs. */
const fs = require('node:fs');
const path = require('node:path');

const ROUTE = 'coquis-territorios-jw';

function renderCleanPage(source) {
  if (!/<head\b[^>]*>/i.test(source)) throw new Error('El generador no tiene cabecera HTML.');
  if (/<base\b/i.test(source)) throw new Error('El generador ya define una ruta base.');
  return source.replace(/(<head\b[^>]*>)(\r?\n)?/i, '$1\n<base href="../outputs/">\n');
}

function preparePages(root = path.resolve(__dirname, '..')) {
  const source = fs.readFileSync(path.join(root, 'outputs/croquis_territorios.html'), 'utf8');
  const directory = path.join(root, ROUTE);
  fs.mkdirSync(directory, { recursive:true });
  const destination = path.join(directory, 'index.html');
  fs.writeFileSync(destination, renderCleanPage(source), 'utf8');
  return destination;
}

module.exports = { ROUTE, renderCleanPage, preparePages };
if (require.main === module) {
  preparePages();
  console.log('Dirección preparada: ' + ROUTE + '/');
}
