/* Verificadores de contraseña para congregaciones. La contraseña nunca se guarda. */
(function (global) {
  'use strict';

  const VERSION = 1;
  const ITERATIONS = 310000;
  const MAX_ITERATIONS = 1000000;
  const SALT_BYTES = 16;
  const HASH_BYTES = 32;
  const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

  function toBase64(bytes) {
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return global.btoa(binary);
  }

  function fromBase64(value, expectedLength) {
    if (typeof value !== 'string' || value.length !== Math.ceil(expectedLength / 3) * 4 ||
        !BASE64.test(value)) return null;
    let binary;
    try {
      binary = global.atob(value);
    } catch (_) {
      return null;
    }
    if (binary.length !== expectedLength) return null;
    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
    return toBase64(bytes) === value ? bytes : null;
  }

  function normalize(record) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) return null;
    if (record.v !== VERSION || !Number.isSafeInteger(record.iterations) ||
        record.iterations < ITERATIONS || record.iterations > MAX_ITERATIONS) return null;
    if (!fromBase64(record.salt, SALT_BYTES) || !fromBase64(record.hash, HASH_BYTES)) return null;
    return { v:VERSION, salt:record.salt, hash:record.hash, iterations:record.iterations };
  }

  function webCrypto() {
    if (!global.crypto?.subtle || typeof global.crypto.getRandomValues !== 'function' ||
        typeof global.TextEncoder !== 'function' ||
        typeof global.btoa !== 'function' || typeof global.atob !== 'function') {
      throw new Error('Este navegador no permite proteger contraseñas de forma segura.');
    }
    return global.crypto;
  }

  async function derive(password, salt, iterations) {
    const crypto = webCrypto();
    const key = await crypto.subtle.importKey('raw', new global.TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name:'PBKDF2', hash:'SHA-256', salt, iterations }, key, HASH_BYTES * 8);
    return new Uint8Array(bits);
  }

  async function create(password) {
    if (typeof password !== 'string' || !password.length) throw new TypeError('Escribe una contraseña.');
    const salt = new Uint8Array(SALT_BYTES);
    webCrypto().getRandomValues(salt);
    const hash = await derive(password, salt, ITERATIONS);
    return { v:VERSION, salt:toBase64(salt), hash:toBase64(hash), iterations:ITERATIONS };
  }

  async function verify(password, record) {
    if (typeof password !== 'string' || !password.length) return false;
    const valid = normalize(record);
    if (!valid) return false;
    const salt = fromBase64(valid.salt, SALT_BYTES);
    const expected = fromBase64(valid.hash, HASH_BYTES);
    const actual = await derive(password, salt, valid.iterations);
    let difference = 0;
    for (let i = 0; i < HASH_BYTES; i++) difference |= actual[i] ^ expected[i];
    return difference === 0;
  }

  global.CroquisPassword = Object.freeze({ create, verify, normalize });
})(window);
