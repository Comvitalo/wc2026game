'use strict';

/**
 * One-off migration that wires up automatic knockout-bracket advancement on an
 * existing database (the seed only fills empty tables, so it can't add this).
 *
 *   node migrate-bracket.js
 *
 * Idempotent — safe to run more than once. It:
 *   1. adds the new columns (slot, home_src, away_src, advance_side) if missing,
 *   2. tags each knockout match with its bracket slot and feeder sources, read
 *      straight from data/schedule.json so there's a single source of truth,
 *   3. recomputes the bracket so any results already entered flow through to the
 *      next games immediately.
 *
 * Matching is by round + venue (unique within R16/QF/SF/3RD/FINAL); the two
 * venues that host two Round-of-32 games each (Los Angeles, Dallas) are split by
 * kickoff date. Player tips, scores and bonus answers are never touched.
 */

const fs = require('fs');
const path = require('path');
const { db, init } = require('./db');
const { recomputeBracket } = require('./bracket');

init(); // also runs ensureColumns(), adding slot/home_src/away_src/advance_side

const schedule = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'data', 'schedule.json'), 'utf8')
);

// Re-derive the stored venue string exactly as the seed does.
function venueOf(m) {
  return m.stadium ? `${m.city} · ${m.stadium}` : (m.city || null);
}

const byVenue = db.prepare('SELECT id, kickoff_at FROM matches WHERE round = ? AND venue = ?');
const setSlot = db.prepare('UPDATE matches SET slot = ?, home_src = ?, away_src = ? WHERE id = ?');

const run = db.transaction(() => {
  let tagged = 0;
  let missing = 0;
  for (const m of schedule) {
    if (!m.slot) continue; // group games carry no slot
    const venue = venueOf(m);
    const rows = byVenue.all(m.round, venue);
    let row;
    if (rows.length === 1) {
      row = rows[0];
    } else {
      // Repeated venue (R32 in LA / Dallas): pick the one on this match's date.
      row = rows.find((r) => (r.kickoff_at || '').slice(0, 10) === m.date);
    }
    if (!row) {
      console.log(`  miss   ${m.slot} (${m.round} @ ${venue}) — no matching row`);
      missing++;
      continue;
    }
    setSlot.run(m.slot, m.homeSrc || null, m.awaySrc || null, row.id);
    tagged++;
  }
  console.log(`Tagged ${tagged} knockout matches with bracket slots (${missing} missing).`);

  const changed = recomputeBracket(db);
  console.log(`Recomputed bracket: ${changed} matchup(s) filled from current results.`);
});

run();

console.log('\nKnockout bracket now in the database:');
for (const m of db.prepare(
  "SELECT round, slot, home_name, away_name, kickoff_at FROM matches WHERE slot IS NOT NULL AND round != 'R32' ORDER BY kickoff_at, seq"
).all()) {
  console.log(`  ${m.slot.padEnd(6)} ${m.home_name} vs ${m.away_name}`);
}
console.log('\nDone.');
