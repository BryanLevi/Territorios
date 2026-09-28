const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '../outputs/croquis_territorios.html'), 'utf8');
function seccion(inicio, fin){
  const a = html.indexOf(inicio), b = html.indexOf(fin, a);
  assert.ok(a >= 0 && b > a, `Sección disponible: ${inicio}`);
  return html.slice(a, b);
}
const storage = seccion('const CONGREGACIONES_STORAGE_KEY', 'const CLOUD_SYNC_TOKEN_SESSION_KEY');
const crud = seccion('function activarCongregacion(', 'function boundsPlainFromCorners(');
const respaldos = seccion('function buildBackupPayload(', 'function exportBackup(');
const importar = seccion('function getBackupData(', 'function readBackupFile(');
const registroNube = seccion("const NUBE_REGISTRO = '_registro'", '// La lista de territorios tambien se comparte');
const escucha = seccion('function escucharCongregacion(', 'function aplicarTerritorioRemoto(');
const inicio = seccion('function hideWelcomeScreen(', 'function clearHeavyUndoStorage(');
const eventos = seccion("$('welcome-cong-nueva')?.addEventListener", "$('btn-nube')?.addEventListener");
const claves = [...storage.matchAll(/\['\w+', ([A-Z_]+)\]/g)].map(m => m[1]);
const llaveRegistro = 'croquis-congregaciones-v1';
const llaveActiva = 'croquis-congregacion-activa-v1';
const base = { id:'ixhuatlan', nombre:'Ixhuatlán del Café', municipio:'Ixhuatlán del Café', estado:'Veracruz' };

function entorno(guardadas = {}){
  const valores = new Map(Object.entries(guardadas));
  const escrituras = [], vistas = [], avisos = [], nodos = new Map(), escuchas = [];
  let fallar = null;
  const localStorage = {
    getItem:clave => valores.get(clave) ?? null,
    setItem(clave, valor){
      if(fallar?.(clave, valor)){ fallar = null; throw new Error('QuotaExceededError simulado'); }
      valores.set(clave, String(valor)); escrituras.push(clave);
    },
    removeItem(clave){ valores.delete(clave); escrituras.push(clave); }
  };
  const $ = id => {
    if(!nodos.has(id)){
      const clases = new Set();
      const nodo = {
        id, hidden:true, disabled:false, value:'', textContent:'', innerHTML:'', open:false, atributos:{}, opciones:[], listeners:{},
        classList:{ toggle(c, si){ if(si) clases.add(c); else clases.delete(c); }, add:c => clases.add(c), remove:c => clases.delete(c), contains:c => clases.has(c) },
        setAttribute(k, v){ this.atributos[k] = v; }, removeAttribute(k){ delete this.atributos[k]; },
        focus(){ this.enfocado = true; }, appendChild(n){ this.opciones.push(n); },
        addEventListener(k, fn){ this.listeners[k] = fn; },
        showModal(){ this.open = true; }, close(){ this.open = false; this.listeners.close?.(); },
        reset(){ for(const input of nodos.values()) if(input.id.startsWith('congregacion-')) input.value = ''; }
      };
      nodos.set(id, nodo);
    }
    return nodos.get(id);
  };
  const wrappers = [{ inert:false }, { inert:false }];
  const noOp = () => {};
  const contexto = vm.createContext({
    localStorage, $, Date, Math, console:{ error:noOp },
    document:{ createElement:() => ({}), querySelectorAll:() => wrappers },
    MUNICIPIO:base.municipio, ESTADO:base.estado, BACKUP_FILE_VERSION:1,
    location:{ href:'http://localhost/outputs/croquis_territorios.html' },
    map:null, currentIndex:0, LOCS:[{ num:1, name:'Territorio existente' }], locSel:{ value:'0', focus:noOp },
    colorAreaSettings:{}, textLabelSettings:{}, manualIconSettings:{}, whiteRoadSettings:{}, manualRiverSettings:{},
    frameScaleSettings:{}, leyendaSettings:{}, nombresSettings:{}, undoHistory:[],
    selectedAreaIndex:null, selectedTextIndex:null, selectedIconIndex:null,
    draftPoints:[], roadDraftPoints:[], riverDraftPoints:[],
    colorDrawMode:false, roadPencilMode:false, riverPencilMode:false, territoryAddMode:false,
    textAddMode:false, iconAddMode:false, contourEditMode:false,
    recargarAjustesGuardados(){ vistas.push(vm.runInContext('congregacionActivaId', contexto)); },
    applyCustomTerritories:noOp, populateSelect:noOp, limpiarMapaSinTerritorios:noOp, updateInfo:noOp, goTo:noOp, saveAllChanges:noOp,
    safeObject:v => v && typeof v === 'object' && !Array.isArray(v) ? v : {}, safeArray:v => Array.isArray(v) ? v : [],
    normalizeCustomTerritory:v => v, loadCustomTerritorySettings:() => [], loadHiddenTerritorySettings:() => [],
    setColorDrawMode:noOp, setRoadPencilMode:noOp, setRiverPencilMode:noOp, setTextAddMode:noOp,
    setIconAddMode:noOp, setContourEditMode:noOp, setTerritoryAddMode:noOp,
    setStatus:(texto, tipo) => avisos.push({ texto, tipo }), setTimeout:noOp,
    aplicarListaRemota:d => escuchas.push({ lista:d }), aplicarTerritorioRemoto:(id, d) => escuchas.push({ id, d }), pintarEstadoNube:noOp
  });
  claves.forEach(clave => { contexto[clave] = clave.toLowerCase(); });
  vm.runInContext('let nube=null, nubeAplicando=false, nubeYo="yo", nubeQuien="equipo", nubeCorte=null, nubeCorteLista=null, nubeCorteRegistro=null;', contexto);
  vm.runInContext(storage + crud + respaldos + importar + registroNube + escucha + inicio + eventos, contexto);
  const ejecutar = codigo => vm.runInContext(codigo, contexto);
  const plano = valor => JSON.parse(JSON.stringify(valor));
  return { contexto, ejecutar, plano, valores, escrituras, vistas, avisos, $, wrappers, escuchas,
    fallarUnaVez:fn => { fallar = fn; },
    activa:() => ejecutar('congregacionActivaId'),
    vivas:() => plano(ejecutar('cargarCongregaciones()')),
    registro:() => plano(ejecutar('cargarRegistroCongregaciones()')),
    crear(nombre = 'Nueva'){ contexto.datos = { nombre }; return plano(ejecutar('crearCongregacionDesdeDatos(datos)')); },
    renombrar(id, nombre){ contexto.datos = { nombre }; contexto.id = id; return plano(ejecutar('actualizarCongregacion(id, datos)')); },
    eliminar(id, nombre){ contexto.id = id; contexto.confirmacion = nombre; return plano(ejecutar('eliminarCongregacion(id, confirmacion)')); }
  };
}

test('migra la lista antigua en lectura y conserva el espacio de la congregación base', () => {
  const e = entorno({ [llaveRegistro]:JSON.stringify([{ id:'cong-antigua', nombre:' Antigua ', municipio:' Córdoba ' }]), color_areas_storage_key:'BASE' });
  assert.deepEqual(e.vivas().map(c => c.nombre), [base.nombre, 'Antigua']);
  assert.equal(e.activa(), base.id);
  assert.equal(e.ejecutar("claveDe(COLOR_AREAS_STORAGE_KEY, 'ixhuatlan')"), 'color_areas_storage_key');
  assert.equal(e.valores.get('color_areas_storage_key'), 'BASE');
  assert.equal(e.escrituras.length, 0);
});

test('renombra la base conservando su ID, sus territorios y sus datos', () => {
  const e = entorno({ color_areas_storage_key:'TRABAJO BASE', custom_territories_storage_key:'TERRITORIOS' });
  assert.equal(e.renombrar(base.id, ' Centro ').ok, true);
  assert.equal(e.vivas()[0].nombre, 'Centro');
  assert.equal(e.vivas()[0].id, base.id);
  assert.equal(e.ejecutar('esCongregacionBase()'), true);
  assert.equal(e.valores.get('color_areas_storage_key'), 'TRABAJO BASE');
  assert.equal(e.valores.get('custom_territories_storage_key'), 'TERRITORIOS');
  const recargado = entorno(Object.fromEntries(e.valores));
  assert.equal(recargado.vivas()[0].nombre, 'Centro');
  assert.equal(recargado.vivas()[0].revision, 1);
});

test('el formulario crea, selecciona y conserva Inicio visible hasta Abrir editor', () => {
  const e = entorno();
  e.ejecutar('crearCongregacion()');
  e.$('congregacion-nombre').value = ' Nueva ';
  e.$('congregacion-municipio').value = ' Córdoba ';
  e.contexto.evento = { preventDefault(){} };
  e.ejecutar('enviarFormularioCongregacion(evento)');
  assert.equal(e.vivas().length, 2);
  assert.equal(e.vivas().find(c => c.id === e.activa()).nombre, 'Nueva');
  assert.equal(e.vivas().find(c => c.id === e.activa()).municipio, 'Córdoba');
  assert.equal(e.$('welcome-screen').classList.contains('is-hidden'), false);
  assert.equal(e.$('congregacion-dialog').open, false);
  assert.deepEqual(e.vistas, [e.activa()]);
  assert.match(e.$('welcome-status').textContent, /creada y seleccionada/);
});

test('valida nombres vacíos, duplicados y largos sin escribir', () => {
  const e = entorno();
  for(const nombre of [' ', base.nombre.toUpperCase(), 'x'.repeat(101)]) assert.equal(e.crear(nombre).ok, false);
  assert.equal(e.escrituras.length, 0);
});

test('Cancelar y Escape descartan crear, editar y eliminar sin escrituras', () => {
  const e = entorno(); e.crear(); e.escrituras.length = 0;
  for(const modo of ['crear', 'editar', 'eliminar']){
    e.contexto.modo = modo;
    e.ejecutar('abrirFormularioCongregacion(modo)');
    e.$('congregacion-nombre').value = 'No guardar';
    e.$('congregacion-confirm-name').value = 'Nueva';
    e.$('congregacion-dialog').listeners.cancel({ preventDefault(){} });
    assert.equal(e.$('congregacion-dialog').open, false);
  }
  assert.equal(e.escrituras.length, 0);
  assert.equal(e.vivas().find(c => c.id === e.activa()).nombre, 'Nueva');
});

test('protege la última congregación tanto en controles como en la mutación', () => {
  const e = entorno(); e.ejecutar('refrescarCongregacionesEnInicio()');
  assert.equal(e.$('welcome-cong-eliminar').disabled, true);
  assert.match(e.$('welcome-cong-note').textContent, /última/);
  assert.equal(e.eliminar(base.id, base.nombre).ok, false);
  e.ejecutar('confirmarEliminarCongregacion()');
  assert.equal(e.$('congregacion-dialog').open, false);
  assert.equal(e.escrituras.length, 0);
});

test('exige el nombre exacto antes de retirar y conserva datos del ID retirado', () => {
  const e = entorno({ color_areas_storage_key:'BASE', 'color_areas_storage_key::cong-extra':'OTRA' });
  e.crear();
  assert.equal(e.eliminar(base.id, base.nombre.toLowerCase()).ok, false);
  assert.equal(e.eliminar(base.id, ' ' + base.nombre + ' ').ok, true);
  assert.equal(e.vivas().some(c => c.id === base.id), false);
  assert.ok(e.registro().find(c => c.id === base.id).deletedAt > 0);
  assert.equal(e.valores.get('color_areas_storage_key'), 'BASE');
  assert.equal(e.valores.get('color_areas_storage_key::cong-extra'), 'OTRA');
  const recargado = entorno(Object.fromEntries(e.valores));
  assert.equal(recargado.vivas().some(c => c.id === base.id), false);
  assert.notEqual(recargado.activa(), base.id);
});

test('eliminar la seleccionada recarga los ajustes de la sobreviviente', () => {
  const e = entorno(); e.crear();
  e.ejecutar('confirmarEliminarCongregacion()');
  e.$('congregacion-confirm-name').value = 'Nueva';
  e.contexto.evento = { preventDefault(){} };
  e.ejecutar('enviarFormularioCongregacion(evento)');
  assert.equal(e.activa(), base.id);
  assert.deepEqual(e.vistas, [base.id]);
  assert.equal(e.$('welcome-cong-eliminar').disabled, true);
});

test('al cambiar a una congregación sin territorios cancela el borrador del editor anterior', () => {
  const e = entorno(); e.crear();
  e.contexto.LOCS.length = 0;
  e.contexto.colorDrawMode = true;
  e.contexto.draftPoints = [{ lat:19, lng:-97 }];
  e.contexto.setColorDrawMode = activo => { e.contexto.colorDrawMode = activo; e.contexto.draftPoints = []; };
  e.ejecutar('actualizarVistaCongregacion(true)');
  assert.equal(e.contexto.colorDrawMode, false);
  assert.deepEqual(e.contexto.draftPoints, []);
});

test('un registro remoto antiguo no borra renombres ni revive retiradas', () => {
  const e = entorno(); e.renombrar(base.id, 'Centro'); e.crear();
  e.contexto.remoto = [base];
  let fusion = e.plano(e.ejecutar('fusionarRegistro(remoto)'));
  assert.equal(fusion.find(c => c.id === base.id).nombre, 'Centro');
  e.eliminar(base.id, 'Centro');
  fusion = e.plano(e.ejecutar('fusionarRegistro(remoto)'));
  assert.ok(fusion.find(c => c.id === base.id).deletedAt);
});

test('la fusión es determinista y una retirada vence una edición concurrente', () => {
  const e = entorno();
  e.contexto.a = [{ ...base, nombre:'A', updatedAt:10, revision:1 }];
  e.contexto.b = [{ ...base, nombre:'B', updatedAt:10, revision:1 }];
  assert.equal(e.ejecutar('JSON.stringify(combinarEntradasCongregaciones(a,b))'), e.ejecutar('JSON.stringify(combinarEntradasCongregaciones(b,a))'));
  e.contexto.b = [{ ...base, deletedAt:5, updatedAt:5, revision:1 }];
  assert.ok(e.plano(e.ejecutar('combinarEntradasCongregaciones(a,b)'))[0].deletedAt);
});

test('un formulario desactualizado no pisa un renombre recibido ni revive una retirada', () => {
  const e = entorno(); e.crear();
  e.ejecutar('renombrarCongregacion()');
  e.renombrar(e.activa(), 'Actualizada');
  e.$('congregacion-nombre').value = 'Vieja';
  e.contexto.evento = { preventDefault(){} };
  e.ejecutar('enviarFormularioCongregacion(evento)');
  assert.match(e.$('congregacion-error').textContent, /cambió/);
  assert.equal(e.vivas().find(c => c.id === e.activa()).nombre, 'Actualizada');
  assert.equal(e.$('congregacion-dialog').open, true);
});

test('dos retiradas concurrentes permiten una lista vacía sin fabricar la base', () => {
  const e = entorno(); const creada = e.crear().congregacion;
  e.contexto.remotas = e.registro().map(c => ({ ...c, updatedAt:Date.now()+100, deletedAt:Date.now()+100, revision:2 }));
  assert.equal(e.ejecutar('aplicarRegistroCompartido(remotas)'), true);
  assert.deepEqual(e.vivas(), []);
  assert.equal(e.activa(), '');
  assert.equal(e.$('welcome-start').disabled, true);
  assert.equal(e.$('welcome-cong-nueva').disabled, false);
  assert.equal(e.ejecutar('almacen.getItem(COLOR_AREAS_STORAGE_KEY)'), null);
  const recargado = entorno(Object.fromEntries(e.valores));
  assert.deepEqual(recargado.vivas(), []);
  assert.equal(recargado.crear('Después').ok, true);
  assert.notEqual(recargado.activa(), creada.id);
});

test('una cuota llena revierte registro y selección sin cambiar datos o memoria', () => {
  const e = entorno(); e.crear();
  const antes = Object.fromEntries(e.valores), id = e.activa();
  e.fallarUnaVez(clave => clave === llaveActiva);
  assert.equal(e.eliminar(id, 'Nueva').ok, false);
  assert.deepEqual(Object.fromEntries(e.valores), antes);
  assert.equal(e.activa(), id);
  assert.equal(e.vivas().length, 2);
});

test('el respaldo incluye nombres de la base y datos de las retiradas y hace roundtrip', () => {
  const e = entorno({ color_areas_storage_key:'{"1":["BASE"]}' });
  e.renombrar(base.id, 'Centro'); e.crear(); e.eliminar(base.id, 'Centro');
  const payload = e.plano(e.ejecutar('buildBackupPayload()'));
  assert.ok(payload.registroCongregaciones.entradas.find(c => c.id === base.id).deletedAt);
  assert.equal(payload.porCongregacion[base.id].colorAreas, '{"1":["BASE"]}');
  const otro = entorno(); otro.contexto.payload = payload;
  assert.equal(otro.ejecutar('importBackupPayload(payload)'), true);
  assert.equal(otro.vivas().some(c => c.id === base.id), false);
  assert.equal(otro.valores.get('color_areas_storage_key'), '{"1":["BASE"]}');
  assert.equal(otro.activa(), payload.congregacionActiva);
});

test('un respaldo antiguo de la base retirada no contamina a la sobreviviente', () => {
  const e = entorno(); const nueva = e.crear().congregacion;
  const sentinel = '{"7":["SOBREVIVIENTE"]}';
  e.valores.set('color_areas_storage_key::' + nueva.id, sentinel);
  e.eliminar(base.id, base.nombre);
  e.contexto.payload = { congregaciones:[base], congregacionActiva:base.id, data:{ colorAreas:{ 1:['VIEJA'] } } };
  assert.equal(e.ejecutar('importBackupPayload(payload)'), true);
  assert.equal(e.activa(), nueva.id);
  assert.equal(e.valores.get('color_areas_storage_key::' + nueva.id), sentinel);
  assert.equal(e.vivas().some(c => c.id === base.id), false);
});

test('un fallo de importación revierte todas las claves del respaldo', () => {
  const e = entorno({ color_areas_storage_key:'{"1":["ANTES"]}' });
  const antes = Object.fromEntries(e.valores);
  e.contexto.payload = { congregaciones:[base], congregacionActiva:base.id, data:{ colorAreas:{ 1:['DESPUÉS'] } } };
  e.fallarUnaVez(clave => clave === 'manual_icons_storage_key');
  assert.equal(e.ejecutar('importBackupPayload(payload)'), false);
  assert.deepEqual(Object.fromEntries(e.valores), antes);
  assert.equal(e.activa(), base.id);
});

test('publicar en transacción conserva una congregación remota que el cliente no conocía', async () => {
  const e = entorno(); e.renombrar(base.id, 'Centro');
  const remota = { id:'cong-remota', nombre:'Remota', updatedAt:1, revision:1 };
  const tombstone = { id:'cong-retirada', nombre:'Retirada', updatedAt:3, deletedAt:3, revision:2 };
  let escrito, lecturas = 0;
  e.contexto.nubeMock = { db:{}, fs:{
    doc:() => 'registro',
    async runTransaction(db, fn){
      return fn({ get:async () => { lecturas++; return { data:() => ({ lista:JSON.stringify({ version:2, entradas:[base, remota, tombstone] }) }) }; }, set(ref, d){ escrito = d; } });
    },
    onSnapshot:() => () => {}, collection:() => ({})
  } };
  e.ejecutar('nube=nubeMock');
  await e.ejecutar('publicarRegistro()');
  assert.equal(lecturas, 1);
  const entradas = JSON.parse(escrito.lista).entradas;
  assert.equal(entradas.find(c => c.id === base.id).nombre, 'Centro');
  assert.ok(entradas.some(c => c.id === remota.id));
  assert.ok(entradas.find(c => c.id === tombstone.id).deletedAt);
  assert.ok(e.vivas().some(c => c.id === remota.id));
});

test('callbacks pendientes de una congregación anterior no afectan la nueva', () => {
  const e = entorno(); const suscripciones = [];
  e.contexto.nubeMock = { db:{}, fs:{ doc:() => 'lista', collection:() => 'territorios', onSnapshot(ref, fn){ suscripciones.push(fn); return () => {}; } } };
  e.ejecutar('nube=nubeMock; escucharCongregacion()');
  e.ejecutar('nube=null'); e.crear();
  suscripciones[0]({ data:() => ({ de:'otro', lista:'datos antiguos' }) });
  suscripciones[1]({ docChanges:() => [{ type:'added', doc:{ id:'1', data:() => ({ de:'otro' }) } }] });
  assert.equal(e.escuchas.length, 0);
});

test('Inicio vuelve inerte al editor y lo reactiva al abrir, sin bloquear el diálogo', () => {
  const e = entorno(); e.ejecutar('showWelcomeScreen()');
  assert.equal(e.wrappers.every(w => w.inert), true);
  assert.equal(e.$('welcome-cong-sel').enfocado, true);
  e.ejecutar('crearCongregacion()'); assert.equal(e.$('congregacion-dialog').open, true);
  e.ejecutar('cancelarFormularioCongregacion(); hideWelcomeScreen()');
  assert.equal(e.wrappers.every(w => !w.inert), true);
});
