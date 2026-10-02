const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto, pbkdf2Sync } = require('node:crypto');

const source = fs.readFileSync(path.join(__dirname, '../outputs/congregation-password.js'), 'utf8');
const window = {
  crypto:webcrypto,
  TextEncoder,
  btoa:binary => Buffer.from(binary, 'binary').toString('base64'),
  atob:base64 => Buffer.from(base64, 'base64').toString('binary')
};
vm.runInNewContext(source, { window });
const password = window.CroquisPassword;

test('crea un verificador salado y comprueba la contraseña exacta', async () => {
  const secret = 'Frase privada con espacios 123';
  const first = await password.create(secret);
  const second = await password.create(secret);
  assert.deepEqual(Object.keys(first), ['v', 'salt', 'hash', 'iterations']);
  assert.equal(first.v, 1);
  assert.ok(first.iterations >= 310000);
  assert.equal(Buffer.from(first.salt, 'base64').length, 16);
  assert.equal(Buffer.from(first.hash, 'base64').length, 32);
  assert.equal(first.hash, pbkdf2Sync(secret, Buffer.from(first.salt, 'base64'), first.iterations, 32, 'sha256').toString('base64'));
  assert.notEqual(first.salt, second.salt);
  assert.notEqual(first.hash, second.hash);
  assert.ok(!JSON.stringify(first).includes(secret));
  assert.equal(await password.verify(secret, first), true);
  assert.equal(await password.verify(secret.toLowerCase(), first), false);
  assert.equal(await password.verify(` ${secret}`, first), false);
});

test('normaliza registros válidos y descarta campos ajenos', async () => {
  const record = await password.create('contraseña');
  const normalized = password.normalize({ ...record, plaintext:'nunca' });
  assert.deepEqual(JSON.parse(JSON.stringify(normalized)), JSON.parse(JSON.stringify(record)));
  assert.equal(Object.hasOwn(normalized, 'plaintext'), false);
  assert.equal(await password.verify('contraseña', normalized), true);
});

test('rechaza versiones, rondas y base64 inválidos sin intentar derivar', async () => {
  const record = await password.create('contraseña');
  const bad = [
    null, [], 'texto',
    { ...record, v:2 },
    { ...record, iterations:309999 },
    { ...record, iterations:1000001 },
    { ...record, iterations:'310000' },
    { ...record, salt:'!' + record.salt.slice(1) },
    { ...record, salt:record.salt.slice(0, -1) },
    { ...record, salt:record.salt.slice(0, -3) + 'B==' },
    { ...record, salt:record.salt + '\n' },
    { ...record, hash:record.hash.replace(/.$/, '=') + '=' },
    { ...record, hash:Buffer.alloc(31).toString('base64') }
  ];
  for (const value of bad) {
    assert.equal(password.normalize(value), null);
    assert.equal(await password.verify('contraseña', value), false);
  }
});

test('no crea verificadores para contraseñas vacías o de otro tipo', async () => {
  await assert.rejects(password.create(''), { name:'TypeError' });
  await assert.rejects(password.create(null), { name:'TypeError' });
  const record = await password.create('correcta');
  assert.equal(await password.verify('', record), false);
  assert.equal(await password.verify(123, record), false);
});

test('crea una contraseña de cuatro dígitos y un código aleatorio de recuperación separado', async () => {
  const {protection, code} = await password.createWithRecovery('0123');
  assert.match(code, /^(?:[0-9A-F]{4}-){7}[0-9A-F]{4}$/);
  assert.deepEqual(Object.keys(protection), ['v', 'salt', 'hash', 'iterations', 'recovery']);
  assert.deepEqual(Object.keys(protection.recovery), ['v', 'salt', 'hash', 'iterations']);
  assert.notEqual(protection.recovery.salt, protection.salt);
  const plain = code.replace(/-/g, '');
  const expected = pbkdf2Sync('croquis-recovery-v1:' + plain, Buffer.from(protection.recovery.salt, 'base64'), protection.recovery.iterations, 32, 'sha256').toString('base64');
  assert.equal(protection.recovery.hash, expected);
  assert.doesNotMatch(JSON.stringify(protection), new RegExp(code + '|' + plain));
  assert.equal(await password.verify('0123', protection), true);
  assert.equal(await password.verifyRecovery(code, protection), true);
  assert.equal(await password.verifyRecovery(code.toLowerCase().replace(/-/g, ' '), protection), true);
  assert.equal(await password.verifyRecovery(plain, protection), true);
  assert.equal(await password.verifyRecovery('0123', protection), false);
  assert.equal(await password.verifyRecovery(code, {...protection, recovery:{...protection}}), false);
  assert.equal(await password.verify(code, protection), false);
});

test('rotar contraseña y recuperación invalida el código anterior', async () => {
  const original = await password.createWithRecovery('0001');
  const rotated = await password.createWithRecovery('5678');
  assert.notEqual(original.code, rotated.code);
  assert.notEqual(original.protection.recovery.salt, rotated.protection.recovery.salt);
  assert.equal(await password.verifyRecovery(original.code, original.protection), true);
  assert.equal(await password.verifyRecovery(original.code, rotated.protection), false);
  assert.equal(await password.verifyRecovery(rotated.code, rotated.protection), true);
  assert.equal(await password.verify('0001', rotated.protection), false);
  assert.equal(await password.verify('5678', rotated.protection), true);
});

test('normaliza la recuperación sin secretos ni anidación y descarta solo un verificador de recuperación dañado', async () => {
  const current = await password.createWithRecovery('1122');
  const normalized = password.normalize({...current.protection, recovery:{...current.protection.recovery, code:current.code, recovery:current.protection.recovery}});
  assert.deepEqual(JSON.parse(JSON.stringify(normalized)), JSON.parse(JSON.stringify(current.protection)));
  assert.equal(await password.verifyRecovery(current.code, normalized), true);
  for (const recovery of [null, [], {}, {...current.protection.recovery, v:2}, {...current.protection.recovery, iterations:2}, {...current.protection.recovery, hash:'invalido'}]) {
    const malformed = {...current.protection, recovery};
    const valid = password.normalize(malformed);
    assert.equal(valid.recovery, undefined);
    assert.equal(await password.verify('1122', valid), true);
    assert.equal(await password.verifyRecovery(current.code, malformed), false);
  }
  assert.equal(await password.verifyRecovery(current.code, {...current.protection, hash:'invalido'}), false);
});

test('una clave antigua permanece válida y puede recibir recuperación sin cambiar la clave', async () => {
  const legacy = await password.create('123456');
  assert.equal(await password.verifyRecovery('A'.repeat(32), legacy), false);
  const recovery = await password.createRecovery();
  const upgraded = {...legacy, recovery:recovery.record};
  assert.equal(await password.verify('123456', upgraded), true);
  assert.equal(await password.verifyRecovery(recovery.code, upgraded), true);
  assert.deepEqual(Object.keys(recovery.record), ['v', 'salt', 'hash', 'iterations']);
});

test('rechaza formatos de recuperación y PIN nuevos inválidos sin abrir el acceso', async () => {
  for (const pin of [null, 1234, '', '123', '12345', '1A23', '１２３４', ' 1234']) {
    await assert.rejects(password.createWithRecovery(pin), {name:'TypeError'});
  }
  const current = await password.createWithRecovery('9876');
  for (const code of [null, 123, '', 'A'.repeat(31), 'A'.repeat(33), 'G'.repeat(32), current.code + '!', current.code + '\u200B', '-'.repeat(129) + current.code]) {
    assert.equal(await password.verifyRecovery(code, current.protection), false);
  }
  const other = current.code.replace(/[0-9A-F]/, character => character === '0' ? '1' : '0');
  assert.equal(await password.verifyRecovery(other, current.protection), false);
});
