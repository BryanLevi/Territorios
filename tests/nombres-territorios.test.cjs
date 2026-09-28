const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '../outputs/croquis_territorios.html'), 'utf8');
function seccion(inicio, fin){
  const a = html.indexOf(inicio), b = html.indexOf(fin, a);
  assert.ok(a >= 0 && b > a, inicio);
  return html.slice(a, b);
}
const nombres = seccion('function loadNombresSettings(', 'function recargarAjustesGuardados(');
const rotulos = seccion('function displayTerritoryNumber(', 'function populateManualIconSelect(');
const selector = seccion('function populateSelect(', 'function loadLeaflet(');
const cuentas = seccion('function subterritoriosDeLoc(', 'function updateInfo(');
const respaldo = seccion('function buildBackupPayload(', 'function datosDeCongregacion(');
const leerRespaldo = seccion('function getBackupData(', 'function refreshAfterBackupImport(');
const nube = seccion('async function publicarLista(', '// Se publica solo, en cuanto se cambia algo.');
const original = { num:15, name:'Moctezuma (Colonia Moctezuma)', lat:19.05, lon:-96.92 };

function entorno({ guardados = {}, divisionCount = 8 } = {}){
  const valores = new Map(Object.entries(guardados)), escrituras = [], preguntas = [], avisos = [], enviados = [];
  const etiquetas = new Map([[15, Array.from({ length:divisionCount }, (_, i) => ({ text:String(i + 1), lat:19, lng:-97 }))]]);
  let respuestas = [], falla = false;
  const nodos = new Map();
  const $ = id => { if(!nodos.has(id)) nodos.set(id, { textContent:'' }); return nodos.get(id); };
  const locSel = { options:[], value:'0', appendChild(option){ this.options.push(option); } };
  Object.defineProperty(locSel, 'innerHTML', { set(){ this.options = []; } });
  const contexto = vm.createContext({
    $, locSel, document:{ createElement:() => ({}) }, BASE_LOCS:[{ ...original }], LOCS:[{ ...original }], currentIndex:0,
    congregacionActivaId:'ixhuatlan', NOMBRES_STORAGE_KEY:'nombres', FONDO_IMPRESION_STORAGE_KEY:'fondo',
    esCongregacionBase:() => contexto.congregacionActivaId === 'ixhuatlan',
    almacen:{
      getItem:clave => valores.get(clave + '::' + contexto.congregacionActivaId) ?? null,
      setItem(clave, valor){
        if(falla){ falla = false; throw new Error('QuotaExceededError simulado'); }
        const k = clave + '::' + contexto.congregacionActivaId;
        valores.set(k, valor); escrituras.push(k);
      }
    },
    window:{ prompt(texto, predeterminado){ preguntas.push({ texto, predeterminado }); const valor = respuestas.shift(); return valor === undefined ? predeterminado : valor; } },
    getTextLabelsForLoc:loc => etiquetas.get(loc.num) || [],
    loadHiddenTerritorySettings:() => [], loadCustomTerritorySettings:() => contexto.congregacionActivaId === 'ixhuatlan' ? [] : [{ ...original }],
    saveHiddenTerritorySettings:() => true, saveCustomTerritorySettings:() => true,
    goTo(){}, setStatus:(texto, tipo) => avisos.push({ texto, tipo }), console:{ error(){} },
    map:null, nube:null, nubeAplicando:false, nubeYo:'yo', nubeQuien:'Equipo',
    nubeEditando:() => false, limpiarMapaSinTerritorios(){}, colorFondoImpresion:() => '#ffffff',
    cargarCongregaciones:() => [{ id:contexto.congregacionActivaId }],
    safeObject:v => v && typeof v === 'object' && !Array.isArray(v) ? v : {}, safeArray:v => Array.isArray(v) ? v : [],
    normalizeCustomTerritory:v => v, BACKUP_FILE_VERSION:1, location:{ href:'http://localhost/croquis' },
    colorAreaSettings:{ 15:[{ color:'#8b2cff', points:[[19,-97],[20,-97],[19,-96]] }] },
    textLabelSettings:{}, manualIconSettings:{}, whiteRoadSettings:{}, manualRiverSettings:{},
    frameScaleSettings:{}, leyendaSettings:{}, nombresSettings:{},
    cargarRegistroCongregaciones:() => [{ id:contexto.congregacionActivaId }],
    datosDeTodasLasCongregaciones:() => ({}),
  });
  for(const match of leerRespaldo.matchAll(/data\[([A-Z_]+)\]/g)){
    if(contexto[match[1]] === undefined) contexto[match[1]] = match[1].toLowerCase();
  }
  vm.runInContext(rotulos + nombres + selector + cuentas + respaldo + leerRespaldo + nube, contexto);
  const ejecutar = codigo => vm.runInContext(codigo, contexto);
  ejecutar('nombresSettings=loadNombresSettings(); applyCustomTerritories(); populateSelect(); refreshTerritoryCounts();');
  const plano = valor => JSON.parse(JSON.stringify(valor));
  return { contexto, ejecutar, plano, valores, escrituras, preguntas, avisos, enviados, etiquetas, locSel, $,
    renombrar(...valores){ respuestas = valores; ejecutar('renombrarTerritorio()'); },
    fallarSiguiente:() => { falla = true; },
    nombres:() => plano(contexto.nombresSettings),
    rotulo:() => locSel.options[0].textContent,
    conectar(){ contexto.nube = { db:{}, fs:{ doc:() => 'lista', async setDoc(ref, datos){ enviados.push(datos); } } }; }
  };
}

test('mantiene los paréntesis autorados y el conteo automático de los datos reales', () => {
  const e = entorno();
  assert.equal(e.rotulo(), '#1 - Moctezuma (Colonia Moctezuma)  (8 subterritorios)');
  assert.equal(e.ejecutar('totalSubterritorios()'), 8);
  assert.match(e.$('meta-subterritorios').textContent, /^8 subterritorios/);
  assert.equal(e.escrituras.length, 0);
});

test('el primer prompt permite editar el paréntesis del nombre y el segundo conserva el alias', () => {
  const e = entorno();
  e.renombrar('Moctezuma (Barrio Centro)', 'Sector Norte (Antiguo)', undefined);
  assert.match(e.rotulo(), /Moctezuma \(Barrio Centro\) \/ Sector Norte \(Antiguo\).*\(8 subterritorios\)/);
  assert.equal(e.nombres()['15'].name, 'Moctezuma (Barrio Centro)');
  assert.equal(e.nombres()['15'].alias, 'Sector Norte (Antiguo)');
  assert.equal(Object.hasOwn(e.nombres()['15'], 'selectorNote'), false);
  assert.equal(e.preguntas[0].predeterminado, original.name);
});

test('personalizar el sufijo no cambia dibujos, textos numéricos, divisiones ni el título PDF', () => {
  const e = entorno();
  const dibujos = e.plano(e.contexto.colorAreaSettings), textos = e.plano(e.etiquetas.get(15));
  e.renombrar(undefined, undefined, 'Sector Norte');
  e.ejecutar('refreshTerritoryCounts()');
  assert.equal(e.nombres()['15'].selectorNote, 'Sector Norte');
  assert.match(e.rotulo(), /\(Sector Norte\)$/);
  assert.equal(e.ejecutar('totalSubterritorios()'), 8);
  assert.match(e.$('meta-subterritorios').textContent, /^8 subterritorios/);
  assert.equal(e.ejecutar('displayTerritoryName(LOCS[0])'), original.name);
  assert.deepEqual(e.contexto.colorAreaSettings, dibujos);
  assert.deepEqual(e.etiquetas.get(15), textos);
});

test('ocultar el sufijo conserva el conteo; auto recupera un conteo que sigue actualizándose', () => {
  const e = entorno();
  e.renombrar(undefined, undefined, '');
  assert.equal(e.nombres()['15'].selectorNote, '');
  assert.equal(e.rotulo(), '#1 - ' + original.name);
  assert.equal(e.ejecutar('totalSubterritorios()'), 8);
  e.renombrar(undefined, undefined, ' AUTO ');
  assert.deepEqual(e.nombres(), {});
  e.etiquetas.get(15).push({ text:'9' }); e.ejecutar('refreshTerritoryCounts()');
  assert.match(e.rotulo(), /\(9 subterritorios\)$/);
  assert.equal(e.ejecutar('totalSubterritorios()'), 9);
});

test('un sufijo personalizado permanece estable al cambiar los textos reales', () => {
  const e = entorno(); e.renombrar(undefined, undefined, 'Zona 8');
  e.etiquetas.get(15).push({ text:'9' }); e.ejecutar('refreshTerritoryCounts()');
  assert.match(e.rotulo(), /\(Zona 8\)$/);
  assert.equal(e.$('territory-counter-total').textContent, '9');
  assert.match(e.$('meta-subterritorios').textContent, /^9 subterritorios/);
});

test('permite una descripción cuando no hay divisiones y evita paréntesis duplicados', () => {
  const e = entorno({ divisionCount:0 });
  e.renombrar(undefined, undefined, ' (Colonia nueva) ');
  assert.equal(e.nombres()['15'].selectorNote, 'Colonia nueva');
  assert.match(e.rotulo(), /  \(Colonia nueva\)$/);
  assert.equal(e.ejecutar('totalSubterritorios()'), 0);
  assert.equal(e.$('meta-subterritorios').textContent, 'Sin subterritorios marcados');
});

test('cancelar cualquiera de los tres prompts no escribe ni modifica los nombres', () => {
  for(const respuestas of [[null], ['Nuevo', null], ['Nuevo', 'Alias', null]]){
    const e = entorno();
    const antes = e.rotulo();
    e.renombrar(...respuestas);
    assert.equal(e.rotulo(), antes);
    assert.deepEqual(e.nombres(), {});
    assert.equal(e.escrituras.length, 0);
  }
});

test('un fallo de almacenamiento conserva los nombres y el selector previos', () => {
  const e = entorno({ guardados:{ 'nombres::ixhuatlan':JSON.stringify({ 15:{ name:'Centro', alias:'Viejo', selectorNote:'Actual' } }) } });
  const antes = e.nombres(), rotulo = e.rotulo(), raw = e.valores.get('nombres::ixhuatlan');
  e.fallarSiguiente(); e.renombrar('Nuevo', 'Otro', 'Cambio');
  assert.deepEqual(e.nombres(), antes);
  assert.equal(e.rotulo(), rotulo);
  assert.equal(e.valores.get('nombres::ixhuatlan'), raw);
  assert.equal(e.avisos.at(-1).tipo, 'error');
});

test('persiste el texto en recarga y en espacios separados por congregación', () => {
  const e = entorno(); e.renombrar(undefined, undefined, 'Base');
  e.contexto.congregacionActivaId = 'cong-otra';
  e.ejecutar('nombresSettings=loadNombresSettings(); applyCustomTerritories(); populateSelect();');
  assert.match(e.rotulo(), /\(8 subterritorios\)$/);
  e.renombrar(undefined, undefined, 'Otra');
  e.contexto.congregacionActivaId = 'ixhuatlan';
  e.ejecutar('nombresSettings=loadNombresSettings(); applyCustomTerritories(); populateSelect();');
  assert.match(e.rotulo(), /\(Base\)$/);
  const recargado = entorno({ guardados:Object.fromEntries(e.valores) });
  assert.match(recargado.rotulo(), /\(Base\)$/);
  assert.equal(JSON.parse(e.valores.get('nombres::cong-otra'))['15'].selectorNote, 'Otra');
});

test('los respaldos preservan la descripción y también el sufijo oculto', () => {
  for(const nota of ['Descripción', '']){
    const e = entorno(); e.renombrar(undefined, undefined, nota);
    const payload = e.plano(e.ejecutar('buildBackupPayload()'));
    e.contexto.payload = JSON.parse(JSON.stringify(payload));
    const datos = e.plano(e.ejecutar('getBackupData(payload)'));
    assert.equal(datos.nombres['15'].selectorNote, nota);
    const recargado = entorno({ guardados:{ 'nombres::ixhuatlan':JSON.stringify(datos.nombres) } });
    assert.equal(recargado.rotulo(), e.rotulo());
    assert.deepEqual(payload.data.colorAreas, e.plano(e.contexto.colorAreaSettings));
  }
});

test('la lista compartida transmite y recibe selectorNote sin cambiar las divisiones', async () => {
  const e = entorno(); e.renombrar(undefined, undefined, 'Compartido'); e.conectar();
  await e.ejecutar('publicarLista()');
  const d = e.enviados.at(-1);
  assert.equal(JSON.parse(d.nombres)['15'].selectorNote, 'Compartido');
  const receptor = entorno(); receptor.contexto.d = d;
  receptor.ejecutar('aplicarListaRemota(d); refreshTerritoryCounts();');
  assert.match(receptor.rotulo(), /\(Compartido\)$/);
  assert.equal(receptor.ejecutar('totalSubterritorios()'), 8);
  assert.equal(JSON.parse(receptor.valores.get('nombres::ixhuatlan'))['15'].selectorNote, 'Compartido');
});

test('un registro antiguo de nombres sigue usando el conteo automático', () => {
  const e = entorno({ guardados:{ 'nombres::ixhuatlan':JSON.stringify({ 15:{ name:'Centro', alias:'La Colonia' } }) } });
  assert.equal(e.rotulo(), '#1 - Centro / La Colonia  (8 subterritorios)');
  assert.equal(e.nombres()['15'].name, 'Centro');
});

test('cargar, respaldar y recibir notas normaliza espacios y paréntesis sin afectar el nombre', () => {
  const datos = { 15:{ name:'Centro (Histórico)', alias:'La Colonia', selectorNote:' (Zona Norte) ' } };
  const e = entorno({ guardados:{ 'nombres::ixhuatlan':JSON.stringify(datos) } });
  assert.equal(e.nombres()['15'].selectorNote, 'Zona Norte');
  assert.match(e.rotulo(), /Centro \(Histórico\).*\(Zona Norte\)$/);
  e.contexto.payload = { data:{ nombres:datos } };
  assert.equal(e.plano(e.ejecutar('getBackupData(payload)')).nombres['15'].selectorNote, 'Zona Norte');
  e.contexto.d = { nombres:JSON.stringify(datos) };
  e.ejecutar('aplicarListaRemota(d)');
  assert.equal(JSON.parse(e.valores.get('nombres::ixhuatlan'))['15'].selectorNote, 'Zona Norte');
  assert.equal(e.ejecutar('normalizeTerritorySelectorNote(" ((Zona Norte)) ")'), 'Zona Norte');
  assert.equal(e.ejecutar('normalizeTerritorySelectorNote("(Norte) (Sur)")'), '(Norte) (Sur)');
});
