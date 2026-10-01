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
