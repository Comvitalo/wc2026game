'use strict';

/**
 * One-off, idempotent fix: record Alex's tip for the Morocco–Canada match
 * (Round of 16, Saturday 4 July 2026) that failed to save at the time.
 *
 *   node add-alex-morocco-canada-tip.js
 *
 * Alex tipped 2–1 to Morocco, i.e. Morocco 2 : Canada 1. This script finds the
 * match regardless of which team is stored as "home" and writes the tip with
 * the goals oriented correctly. Run it against the live database (the seed only
 * fills empty tables, so it cannot add a single tip). Safe to run more than once.
 */

const { db, init } = require('./db');

init();

const PLAYER = 'Alex';
const MOROCCO = 'Morocco';
const CANADA = 'Canada';
const MOROCCO_GOALS = 2;
const CANADA_GOALS = 1;

const now = () => new Date().toISOString();

// Resolve a match side to its display name, mirroring server.js sideName():
// group games carry a team code (name lives in `teams`), knockout slots store
// the name directly in home_name/away_name.
const teamNames = {};
for (const t of db.prepare('SELECT code, name FROM teams').all()) teamNames[t.code] = t.name;
function sideName(match, side) {
  const code = match[`${side}_code`];
  const override = match[`${side}_name`];
  if (code && teamNames[code]) return teamNames[code];
  if (override) return override;
  return code || '';
}
const eq = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();

const run = db.transaction(() => {
  const player = db.prepare('SELECT id, name FROM players WHERE name = ?').get(PLAYER);
  if (!player) throw new Error(`Player "${PLAYER}" not found.`);

  // Find the Morocco vs Canada match (either orientation).
  const matches = db.prepare('SELECT * FROM matches').all();
  const found = matches.filter((m) => {
    const h = sideName(m, 'home');
    const a = sideName(m, 'away');
    return (eq(h, MOROCCO) && eq(a, CANADA)) || (eq(h, CANADA) && eq(a, MOROCCO));
  });

  if (found.length === 0) {
    throw new Error(
      'No Morocco–Canada match found. If the R16 bracket team names have not ' +
      'been filled in yet, set them first (admin), then re-run this script.'
    );
  }
  if (found.length > 1) {
    throw new Error(`Expected exactly one Morocco–Canada match, found ${found.length}.`);
  }

  const match = found[0];
  const moroccoIsHome = eq(sideName(match, 'home'), MOROCCO);
  const homeTip = moroccoIsHome ? MOROCCO_GOALS : CANADA_GOALS;
  const awayTip = moroccoIsHome ? CANADA_GOALS : MOROCCO_GOALS;

  const info = db.prepare(`
    INSERT INTO tips (player_id, match_id, home_tip, away_tip, updated_at)
    VALUES (@pid, @mid, @home, @away, @now)
    ON CONFLICT(player_id, match_id)
    DO UPDATE SET home_tip = @home, away_tip = @away, updated_at = @now
  `).run({ pid: player.id, mid: match.id, home: homeTip, away: awayTip, now: now() });

  const label = `${sideName(match, 'home')} ${homeTip}:${awayTip} ${sideName(match, 'away')}`;
  const verb = info.changes && info.lastInsertRowid ? 'Inserted' : 'Updated';
  console.log(`${verb} ${PLAYER}'s tip for match #${match.id} (${match.round}): ${label}`);
  console.log(`  -> Morocco ${MOROCCO_GOALS} : ${CANADA_GOALS} Canada`);
});

run();
console.log('Done.');
