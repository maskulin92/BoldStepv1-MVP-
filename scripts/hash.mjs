#!/usr/bin/env node
/**
 * Generates the values you paste into .env.local — nothing is ever written to
 * disk, so no secret ends up in a file you might commit.
 *
 *   npm run hash -- "your-password"     -> OWNER_PASSWORD_HASH
 *   npm run hash -- --pin 123456        -> access_pin_hash for a client
 *   npm run hash -- --secrets           -> JWT_SECRET, ENCRYPTION_KEY, HERMES_API_KEY
 */

import { createHash, randomBytes, scryptSync } from 'node:crypto';

const args = process.argv.slice(2);

function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(password, salt, 64).toString('hex');
  return `scrypt$16384$${salt}$${derived}`;
}

if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
  console.log(`
Boldstep credential helper

  npm run hash -- "my-password"      Hash an owner password  -> OWNER_PASSWORD_HASH
  npm run hash -- --pin 123456       Hash a 6-digit client PIN -> access_pin_hash
  npm run hash -- --secrets          Generate JWT_SECRET, ENCRYPTION_KEY, HERMES_API_KEY
`);
  process.exit(0);
}

if (args[0] === '--secrets') {
  console.log(`JWT_SECRET=${randomBytes(48).toString('base64url')}`);
  console.log(`ENCRYPTION_KEY=${randomBytes(32).toString('base64url')}`);
  console.log(`HERMES_API_KEY=boldstep_sk_${randomBytes(24).toString('hex')}`);
  process.exit(0);
}

if (args[0] === '--pin') {
  const pin = (args[1] ?? '').trim();
  if (!/^\d{6}$/.test(pin)) {
    console.error('A PIN must be exactly 6 digits.');
    process.exit(1);
  }
  console.log(`access_pin_hash: ${createHash('sha256').update(pin).digest('hex')}`);
  process.exit(0);
}

const password = args.join(' ');
if (password.length < 8) {
  console.error('Use a password of at least 8 characters.');
  process.exit(1);
}

console.log(`OWNER_PASSWORD_HASH=${hashPassword(password)}`);
