const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const original = fs.readFileSync(path.join(__dirname, '../outputs/congregation-access.js'), 'utf8');
// Los hooks existen únicamente en la copia ejecutada por esta prueba.
const source = original.replace(/  refresh\(\);\s*\}\)\(\);\s*$/, `
  window.audit = {
    open, submit, setupRecovery, remove, copyRecovery, downloadRecovery,
    switchMode, canEnter, state:() => ({ pending, busy })
  };
  refresh();
})();`);
assert.notEqual(source, original, 'Se instaló el hook de la VM');

function deferred(){
  let resolve, reject;
  const promise = new Promise((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}

function environment(protection = { v:1, recovery:{ v:1, hash:'old' } }){
  const nodes = new Map();
  let entries = [{ id:'base', nombre:'Base', revision:1, proteccion:protection }];
  let saves = 0, downloads = 0;
  function element(id){
    if(!nodes.has(id)){
      const listeners = {};
      nodes.set(id, {
        id, listeners, value:'', hidden:false, disabled:false, open:false,
        textContent:'', dataset:{}, type:'password',
        classList:{ contains:() => false },
        querySelector:() => element(id + '-span'), querySelectorAll:() => [],
        setAttribute(){}, removeAttribute(){}, focus(){}, select(){},
        addEventListener(event, callback){ listeners[event] = callback; },
        reset(){ for(const node of nodes.values()) node.value = ''; },
        showModal(){ this.open = true; },
        close(){ this.open = false; listeners.close?.(); }
      });
    }
    return nodes.get(id);
  }
  const password = {
    normalize:value => value?.v === 1 ? value : null,
    verify:async () => true, verifyRecovery:async () => true,
    createWithRecovery:async () => ({ protection:{ v:1, recovery:{ v:1, hash:'new' } }, code:'NEW-CODE' }),
    createRecovery:async () => ({ record:{ v:1, hash:'new' }, code:'NEW-CODE' })
  };
  const window = { CroquisPassword:password, addEventListener(){} };
  const context = {
    window,
    document:{
      getElementById:element, activeElement:{ focus(){} },
      createElement:() => ({ click(){}, remove(){} }), body:{ appendChild(){} }
    },
    navigator:{ clipboard:{ writeText:async () => {} } },
    URL:{ createObjectURL(){ downloads++; return ''; }, revokeObjectURL(){} }, Blob, setTimeout(){},
    congregacionActivaId:'base', cargarCongregaciones:() => entries,
    cargarRegistroCongregaciones:() => entries, siguienteFechaCongregacion:() => 2,
    guardarCongregaciones(value){
      if(context.failSave) return false;
      entries = value;
      saves++;
      return true;
    },
    refrescarCongregacionesEnInicio(){}, mostrarEstadoCongregaciones(){},
    hideWelcomeScreen(){}, showWelcomeScreen(){}, renombrarCongregacion(){},
    confirmarEliminarCongregacion(){}, CONGREGACIONES_STORAGE_KEY:'registry'
  };
  vm.runInNewContext(source, context);
  return { element, password, api:window.audit, context, entries:() => entries, saves:() => saves, downloads:() => downloads };
}

const submit = environment => environment.api.submit({ preventDefault(){} });
function fillNewPassword(environment){
  environment.element('password-new').value = '0123';
  environment.element('password-confirm').value = '0123';
}

test('un resultado falso o una excepción cancelados no desbloquean una operación nueva', async () => {
  for(const reject of [false, true]){
    const e = environment(), old = deferred(), current = deferred();
    let calls = 0;
    e.password.verify = () => ++calls === 1 ? old.promise : current.promise;
    e.api.open('unlock');
    e.element('password-current').value = 'old';
    const first = submit(e);
    e.element('password-dialog').close();
    e.api.open('unlock');
    e.element('password-current').value = 'current';
    const second = submit(e);
    if(reject) old.reject(new Error('error antiguo'));
    else old.resolve(false);
    await first;
    assert.equal(e.api.state().busy, true);
    assert.equal(e.element('password-submit').disabled, true);
    assert.equal(e.element('password-error').textContent, '');
    current.resolve(false);
    await second;
    assert.equal(e.api.state().busy, false);
    assert.match(e.element('password-error').textContent, /incorrecta/);
  }
});

test('una derivación cancelada nunca guarda ni muestra su código', async () => {
  const e = environment(null), created = deferred();
  e.password.createWithRecovery = () => created.promise;
  e.api.open('set');
  fillNewPassword(e);
  const operation = submit(e);
  e.element('password-dialog').close();
  created.resolve({ protection:{ v:1, recovery:{ v:1 } }, code:'CANCELLED-CODE' });
  await operation;
  assert.equal(e.saves(), 0);
  assert.equal(e.element('password-recovery-code').value, '');
  assert.equal(e.api.state().pending, null);
});

test('un código incorrecto no deriva, no guarda y no concede entrada', async () => {
  const e = environment();
  let creates = 0;
  e.password.verifyRecovery = async () => false;
  e.password.createWithRecovery = async () => { creates++; };
  e.api.open('unlock');
  e.api.switchMode('recover');
  fillNewPassword(e);
  e.element('password-recovery').value = 'incorrecto';
  await submit(e);
  assert.equal(creates, 0);
  assert.equal(e.saves(), 0);
  assert.equal(e.api.canEnter(), false);
  assert.match(e.element('password-error').textContent, /Código.*incorrecto/);
});

test('exige la contraseña actual para añadir recuperación a una clave antigua', async () => {
  const e = environment({ v:1 });
  let creates = 0;
  e.password.verify = async () => false;
  e.password.createRecovery = async () => { creates++; };
  e.api.open('change');
  e.element('password-current').value = 'incorrecta';
  await e.api.setupRecovery();
  assert.equal(creates, 0);
  assert.equal(e.saves(), 0);
});

test('Olvidé mi contraseña no permite guardar ni entrar sin recuperación configurada', async () => {
  const e = environment({ v:1 });
  e.api.open('unlock');
  e.api.switchMode('recover');
  fillNewPassword(e);
  e.element('password-recovery').value = 'inventado';
  await submit(e);
  assert.equal(e.element('password-submit').hidden, true);
  assert.equal(e.saves(), 0);
  assert.equal(e.api.canEnter(), false);
});

test('restablecer muestra el código una vez sin conceder entrada ni permitir otro envío', async () => {
  const e = environment();
  e.api.open('unlock');
  e.api.switchMode('recover');
  fillNewPassword(e);
  e.element('password-recovery').value = 'correcto';
  await submit(e);
  assert.equal(e.saves(), 1);
  assert.equal(e.api.state().pending.mode, 'receipt');
  assert.equal(e.element('password-recovery-code').value, 'NEW-CODE');
  assert.equal(e.api.canEnter(), false);
  await submit(e);
  assert.equal(e.saves(), 1);
  assert.ok(!JSON.stringify(e.entries()).includes('NEW-CODE'));
  e.element('password-dialog').close();
  assert.equal(e.element('password-recovery-code').value, '');
  assert.equal(e.api.state().pending, null);
});

test('un fallo de guardado no entrega código ni altera la protección', async () => {
  const e = environment(), before = JSON.stringify(e.entries());
  e.context.failSave = true;
  e.api.open('change');
  e.element('password-current').value = 'correcta';
  fillNewPassword(e);
  await submit(e);
  assert.equal(JSON.stringify(e.entries()), before);
  assert.equal(e.saves(), 0);
  assert.equal(e.api.state().pending.mode, 'change');
  assert.equal(e.element('password-recovery-code').value, '');
  assert.match(e.element('password-error').textContent, /guardar/);
});

test('una rotación remota impide copiar o descargar un código obsoleto', async () => {
  const e = environment();
  e.api.open('change');
  e.element('password-current').value = 'correcta';
  fillNewPassword(e);
  await submit(e);
  e.entries()[0].proteccion = { v:1, recovery:{ v:1, hash:'remote' } };
  let copies = 0;
  e.context.navigator.clipboard.writeText = async () => { copies++; };
  await e.api.copyRecovery();
  e.api.downloadRecovery();
  assert.equal(copies, 0);
  assert.equal(e.downloads(), 0);
  assert.match(e.element('password-error').textContent, /otro equipo/);
});
