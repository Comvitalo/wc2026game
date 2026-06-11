'use strict';

const crypto = require('crypto');

/** Hash a PIN/password with scrypt. Returns "salt:hash" (hex). */
function hashPin(pin) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(pin), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

/** Constant-time verify of a PIN against a stored "salt:hash". */
function verifyPin(pin, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  const expected = Buffer.from(hash, 'hex');
  const actual = crypto.scryptSync(String(pin), salt, 64);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

/** Opaque random session token. */
function newToken() {
  return crypto.randomBytes(32).toString('hex');
}

module.exports = { hashPin, verifyPin, newToken };
