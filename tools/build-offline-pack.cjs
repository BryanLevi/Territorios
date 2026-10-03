/* Build the public map pack with the same road/reference conversion as the app.
   Usage: node tools/build-offline-pack.cjs bounds.json checkpoint.json [raw-directory] */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const detailsApi = require('../outputs/offline-map-details.js');
const repo = path.resolve(__dirname, '..');
const boundsFile = process.argv[2];
const checkpointFile = process.argv[3];
const rawDirectory = process.argv[4];
if (!boundsFile || !checkpointFile) throw new Error('Specify the territory bounds and a checkpoint file.');
const snapshot = JSON.parse(fs.readFileSync(boundsFile, 'utf8'));
const html = fs.readFileSync(path.join(repo, 'outputs/croquis_territorios.html'), 'utf8');
function extractFunction(name) {
  const pattern = new RegExp('function ' + name + '\\([^\\n]*\\)\\s*\\{');
  const match = pattern.exec(html);
  if (!match) throw new Error('Missing app converter: ' + name);
  const start = match.index;
  const opening = start + match[0].length - 1;
  let level = 0, quote = null;
  for (let i = opening; i < html.length; i++) {
    const char = html[i], next = html[i + 1];
    if (quote) { if (char === '\\') i++; else if (char === quote) quote = null; continue; }
    if (char === '/' && next === '/') { i = html.indexOf('\n', i); continue; }
    if (char === '/' && next === '*') { i = html.indexOf('*/', i + 2) + 1; continue; }
    if (char === '"' || char === "'" || char === '`') { quote = char; continue; }
    if (char === '{') level++;
    if (char === '}' && --level === 0) return html.slice(start, i + 1);
  }
  throw new Error('Incomplete app converter: ' + name);
}
const app = vm.createContext({L:{latLng:(lat,lng) => ({lat,lng})}});
const constants = ['REFERENCE_SAME_PLACE_M','REFERENCE_SAME_NAME_M','REFERENCE_SAME_TITLE_M','REFERENCE_GENERIC_NEAR_M']
  .map(name => html.match(new RegExp('const ' + name + ' = [^;]+;'))[0]).join('\n');
const noise = html.slice(html.indexOf('const REFERENCE_TAG_NOISE'), html.indexOf('function referenceIsNoise')) + extractFunction('referenceIsNoise');
const converters = ['roadDisplayName','roadWaysFromOverpass','packRoadWays','referenceKind','referenceFallbackName',
  'referencePriority','distanciaEnMetros','normalizarNombre','esMismoSitio','dedupeReferences','referencesFromOverpass'];
vm.runInContext(constants + '\n' + noise + '\n' + converters.map(extractFunction).join('\n'), app);
const runtime = {fetch:(url,options) => fetch(url,{...options,headers:{...options.headers,
  'User-Agent':'Territorios offline map preparation (https://github.com/BryanLevi/Territorios)'}})};
vm.runInNewContext(fs.readFileSync(path.join(repo,'outputs/offline-data.js'),'utf8'), {
  window:runtime, AbortController, DOMException, setTimeout, clearTimeout, Date
});
(async () => {
  const entries = fs.existsSync(checkpointFile) ? JSON.parse(fs.readFileSync(checkpointFile,'utf8')) : [];
  for (const territory of snapshot.territories) {
    if (entries.some(entry => entry.key === territory.key && JSON.stringify(entry.bounds) === JSON.stringify(territory.bounds) && entry.detailVersion===detailsApi.VERSION && detailsApi.valid(entry.details))) continue;
    const began = Date.now();
    const rawFile = rawDirectory && path.join(rawDirectory, territory.key + '.json');
    const elements = rawFile && fs.existsSync(rawFile) ? JSON.parse(fs.readFileSync(rawFile,'utf8')) : await runtime.CroquisOfflineData.download(territory.bounds, {
      onProgress:event => console.log(territory.name + ': ' + event.message)
    });
    if (!Array.isArray(elements.detailElements)) throw new Error('The source lacks complete map details: ' + territory.name);
    const details = detailsApi.fromElements(elements.detailElements);
    if (!detailsApi.valid(details)) throw new Error('Invalid map details: ' + territory.name);
    const record = {...territory,detailVersion:detailsApi.VERSION,details,
      roads:app.packRoadWays(app.roadWaysFromOverpass({elements:elements.roadElements})),
      refs:app.referencesFromOverpass({elements:elements.referenceElements}), savedAt:Date.now()};
    const index = entries.findIndex(entry => entry.key === territory.key);
    if (index < 0) entries.push(record); else entries[index] = record;
    fs.writeFileSync(checkpointFile,JSON.stringify(entries));
    console.log(JSON.stringify({key:record.key,name:record.name,roads:record.roads.length,refs:record.refs.length,areas:details.areas.length,places:details.places.length,seconds:(Date.now()-began)/1000}));
    await new Promise(resolve => setTimeout(resolve,1000));
  }
  const territories = snapshot.territories.map(territory => entries.find(entry => entry.key === territory.key));
  if (territories.some(entry => !entry)) throw new Error('Incomplete map pack.');
  const pack = {version:detailsApi.VERSION,generatedAt:Date.now(),attribution:'© OpenStreetMap contributors',
    license:'https://www.openstreetmap.org/copyright',territories};
  const output = path.join(repo,'outputs/offline-map-pack.json');
  fs.writeFileSync(output,JSON.stringify(pack));
  console.log(JSON.stringify({output,territories:territories.length,bytes:fs.statSync(output).size}));
})().catch(error => {console.error(error);process.exitCode=1;});
