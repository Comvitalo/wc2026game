'use strict';

/**
 * One-off migration to add the player "Jeff" to an existing database (the seed
 * only fills empty tables, so it won't add a player once others exist).
 *
 *   node migrate-add-jeff.js
 *
 * Idempotent — if Jeff already exists nothing changes. His PIN comes from
 * PIN_JEFF (e.g. a Fly secret) or defaults to 4444; change it before sharing.
 * Existing players, tips, results and bonus answers are untouched.
 */

const { db, init } = require('./db');
const { hashPin } = require('./auth');

init();

const existing = db.prepare('SELECT id FROM players WHERE name = ?').get('Jeff');
if (existing) {
  console.log('Jeff already exists — nothing to do.');
} else {
  db.prepare('INSERT INTO players (name, pin_hash, is_admin) VALUES (?, ?, 0)')
    .run('Jeff', hashPin(process.env.PIN_JEFF || '4444'));
  console.log(`Added player Jeff (PIN ${process.env.PIN_JEFF ? 'from PIN_JEFF' : 'default 4444'}).`);
}

console.log('\nPlayers now:');
for (const p of db.prepare('SELECT name FROM players ORDER BY id').all()) console.log(`  - ${p.name}`);
console.log('\nDone.');
