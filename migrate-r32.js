'use strict';

/**
 * One-off migration that fills the Round of 32 knockout matches with the
 * actual teams now that the group stage is over (the seed only fills empty
 * tables, so it cannot change a live database).
 *
 *   node migrate-r32.js
 *
 * Idempotent — safe to run more than once. Each R32 match is matched by its
 * original bracket-slot labels (e.g. "Winner H" vs "Runner-up J"); once a slot
 * has been filled with real teams it no longer matches and is left untouched.
 *
 * It also corrects one kickoff time: Spain vs Austria (SoFi Stadium, 2 Jul) was
 * stored as 15:00 PT but kicks off at 12:00 PT (3 p.m. ET). Dates, venues and
 * all other kickoff times were already correct and are left as-is.
 *
 * Team names match data/groups.json exactly so they read consistently across
 * the app. Sources: official FIFA 2026 bracket / broadcaster schedules.
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
});

run();

console.log('\nRound of 32 fixtures now in the database:');
for (const m of db.prepare("SELECT home_name, away_name, venue, kickoff_at FROM matches WHERE round = 'R32' ORDER BY kickoff_at, seq").all()) {
  console.log(`  ${m.kickoff_at}  ${m.home_name} vs ${m.away_name}  (${m.venue})`);
}
console.log('\nDone.');
