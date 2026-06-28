'use strict';

/**
 * One-off migration that brings the knockout fixtures in line with the
 * official FIFA 2026 schedule now that the group stage is over (the seed only
 * fills empty tables, so it cannot change a live database).
 *
 *   node migrate-ko.js
 *
 * Idempotent — safe to run more than once. It does two things:
 *
 *   1. Fills the 16 Round of 32 matches with the real qualified teams. Each is
 *      matched by its original bracket-slot labels (e.g. "Winner H" vs
 *      "Runner-up J"); once a slot has been filled it no longer matches and is
 *      left untouched.
 *
 *   2. Corrects two kickoff times that were stored wrong (an ET/CT/PT mix-up):
 *        - Spain vs Austria (SoFi, 2 Jul): 15:00 PT -> 12:00 PT (3 p.m. ET)
 *        - Semi-final (AT&T Stadium, Dallas, 14 Jul): 19:00 CT -> 14:00 CT
 *          (3 p.m. ET). This game still has TBD teams; only the time changes.
 *
 * All other knockout dates, venues and kickoff times were already correct
 * (verified against the official bracket and host-city schedules) and are left
 * as-is. The Round of 16 -> final matchups stay TBD until the bracket resolves.
 *
 * Team names match data/groups.json exactly so they read consistently across
 * the app. Player tips and results are never touched.
 */

const { db, init } = require('./db');

init();

// venue-local -> UTC ISO, mirroring seed.js (summer offsets; Mexico = CST/no DST)
function tzOffset(tz) {
  if (!tz) return -6;
  if (tz.includes('MX')) return -6; // Mexico CST, no DST
  if (tz.startsWith('ET')) return -4; // EDT
  if (tz.startsWith('CT')) return -5; // CDT
  if (tz.startsWith('MT')) return -6; // MDT
  if (tz.startsWith('PT')) return -7; // PDT
  return -6;
}
function localToUtcISO(dateStr, timeStr, tz) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = (timeStr || '12:00').split(':').map(Number);
  const off = tzOffset(tz);
  return new Date(Date.UTC(y, m - 1, d, hh - off, mm)).toISOString();
}

// Bracket-slot label (as seeded) -> the team that won that slot in the group
// stage. Each row is one Round of 32 fixture; kickoff is only set where the
// originally seeded time needs correcting.
const R32 = [
  { fromHome: 'Runner-up A', fromAway: 'Runner-up B', home: 'South Africa', away: 'Canada' },
  { fromHome: 'Winner C', fromAway: 'Runner-up F', home: 'Brazil', away: 'Japan' },
  { fromHome: 'Winner E', fromAway: '3rd A/B/C/D/F', home: 'Germany', away: 'Paraguay' },
  { fromHome: 'Winner F', fromAway: 'Runner-up C', home: 'Netherlands', away: 'Morocco' },
  { fromHome: 'Runner-up E', fromAway: 'Runner-up I', home: 'Ivory Coast', away: 'Norway' },
  { fromHome: 'Winner I', fromAway: '3rd C/D/F/G/H', home: 'France', away: 'Sweden' },
  { fromHome: 'Winner A', fromAway: '3rd C/E/F/H/I', home: 'Mexico', away: 'Ecuador' },
  { fromHome: 'Winner L', fromAway: '3rd E/H/I/J/K', home: 'England', away: 'Congo DR' },
  { fromHome: 'Winner G', fromAway: '3rd A/E/H/I/J', home: 'Belgium', away: 'Senegal' },
  { fromHome: 'Winner D', fromAway: '3rd B/E/F/I/J', home: 'United States', away: 'Bosnia-Herzegovina' },
  { fromHome: 'Winner H', fromAway: 'Runner-up J', home: 'Spain', away: 'Austria',
    kickoff_at: localToUtcISO('2026-07-02', '12:00', 'PT') }, // was 15:00 PT, correct to 12:00 PT (3 p.m. ET)
  { fromHome: 'Runner-up K', fromAway: 'Runner-up L', home: 'Portugal', away: 'Croatia' },
  { fromHome: 'Winner B', fromAway: '3rd E/F/G/I/J', home: 'Switzerland', away: 'Algeria' },
  { fromHome: 'Runner-up D', fromAway: 'Runner-up G', home: 'Australia', away: 'Egypt' },
  { fromHome: 'Winner J', fromAway: 'Runner-up H', home: 'Argentina', away: 'Cape Verde' },
  { fromHome: 'Winner K', fromAway: '3rd D/E/I/J/L', home: 'Colombia', away: 'Ghana' },
];

const find = db.prepare(
  "SELECT id, kickoff_at FROM matches WHERE round = 'R32' AND home_name = ? AND away_name = ?"
);
const update = db.prepare(
  'UPDATE matches SET home_name = @home, away_name = @away, kickoff_at = COALESCE(@kickoff_at, kickoff_at) WHERE id = @id'
);

const run = db.transaction(() => {
  let filled = 0;
  let skipped = 0;
  for (const r of R32) {
    const row = find.get(r.fromHome, r.fromAway);
    if (!row) {
      console.log(`  skip   ${r.home} vs ${r.away} (slot "${r.fromHome}" / "${r.fromAway}" not found — already filled?)`);
      skipped++;
      continue;
    }
    update.run({ id: row.id, home: r.home, away: r.away, kickoff_at: r.kickoff_at ?? null });
    const note = r.kickoff_at ? `  (kickoff -> ${r.kickoff_at})` : '';
    console.log(`  set    ${r.home} vs ${r.away}${note}`);
    filled++;
  }
  console.log(`\nRound of 32: ${filled} filled, ${skipped} skipped.`);

  // Correct the Dallas semi-final kickoff (19:00 CT -> 14:00 CT / 3 p.m. ET).
  // Matched by round + venue so it works whether or not the teams are filled.
  const sfKickoff = localToUtcISO('2026-07-14', '14:00', 'CT');
  const sf = db.prepare(
    "SELECT id, kickoff_at FROM matches WHERE round = 'SF' AND venue LIKE '%AT&T%'"
  ).get();
  if (!sf) {
    console.log('  skip   Dallas semi-final time (match not found)');
  } else if (sf.kickoff_at === sfKickoff) {
    console.log('  ok     Dallas semi-final time already correct');
  } else {
    db.prepare('UPDATE matches SET kickoff_at = ? WHERE id = ?').run(sfKickoff, sf.id);
    console.log(`  set    Dallas semi-final kickoff -> ${sfKickoff}`);
  }
});

run();

console.log('\nRound of 32 fixtures now in the database:');
for (const m of db.prepare("SELECT home_name, away_name, venue, kickoff_at FROM matches WHERE round = 'R32' ORDER BY kickoff_at, seq").all()) {
  console.log(`  ${m.kickoff_at}  ${m.home_name} vs ${m.away_name}  (${m.venue})`);
}
console.log('\nDone.');
