'use strict';

/**
 * Seeds the database with players, the 48-team / 104-match WC 2026 skeleton,
 * default bonus questions and settings.
 *
 *   node seed.js          -> create tables and fill any that are empty
 *   node seed.js --reset  -> wipe game data and re-seed from scratch
 *
 * All kickoff/lock times are stored in UTC. They are generated from local
 * America/Mexico_City wall-clock times (UTC-6, no DST) as a sensible default;
 * the admin can adjust exact dates/times once the official schedule is set.
 */

const { db, init } = require('./db');
const { hashPin } = require('./auth');

const RESET = process.argv.includes('--reset');
const MX_OFFSET_HOURS = 6; // America/Mexico_City = UTC-6 (no DST)

// Convert a Mexico City wall-clock time to a UTC ISO string.
function mxToUtcISO(year, month, day, hour, minute = 0) {
  return new Date(Date.UTC(year, month - 1, day, hour + MX_OFFSET_HOURS, minute)).toISOString();
}

const GROUPS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];

const VENUES = [
  'Mexico City', 'Guadalajara', 'Monterrey', 'Los Angeles', 'San Francisco',
  'Seattle', 'Dallas', 'Houston', 'Kansas City', 'Atlanta', 'Miami',
  'New York/NJ', 'Philadelphia', 'Boston', 'Toronto', 'Vancouver',
];

// Standard 4-team round-robin order (team indices 1..4): 6 matches per group.
const GROUP_PAIRS = [
  [1, 2], [3, 4], [1, 3], [4, 2], [4, 1], [2, 3],
];

function seedTeams() {
  const insert = db.prepare('INSERT INTO teams (code, name, grp) VALUES (?, ?, ?)');
  for (const g of GROUPS) {
    for (let i = 1; i <= 4; i++) {
      insert.run(`${g}${i}`, `Team ${g}${i}`, g);
    }
  }
}

function seedMatches() {
  const insert = db.prepare(`
    INSERT INTO matches (round, seq, home_code, away_code, home_name, away_name, venue, kickoff_at)
    VALUES (@round, @seq, @home_code, @away_code, @home_name, @away_name, @venue, @kickoff_at)
  `);

  let seq = 0;
  let venueIdx = 0;
  const nextVenue = () => VENUES[venueIdx++ % VENUES.length];
  const slots = [12, 15, 18, 21]; // local kickoff hours

  // ---- Group stage: 12 groups x 6 = 72 matches, matchdays June 11-26 ----
  // Play matchday by matchday so dates progress naturally.
  for (let md = 0; md < GROUP_PAIRS.length; md++) {
    const [a, b] = GROUP_PAIRS[md];
    GROUPS.forEach((g, gi) => {
      // 2 matchdays' worth of dates per ~3 calendar days; keep it simple/sequential.
      const day = 11 + md * 2 + Math.floor(gi / 6);
      const hour = slots[gi % slots.length];
      insert.run({
        round: 'Group',
        seq: ++seq,
        home_code: `${g}${a}`,
        away_code: `${g}${b}`,
        home_name: null,
        away_name: null,
        venue: nextVenue(),
        kickoff_at: mxToUtcISO(2026, 6, day, hour),
      });
    });
  }

  // ---- Knockout rounds: teams TBD (admin fills once known) ----
  const knockout = [
    { round: 'R32', count: 16, startDay: 28, month: 6 },
    { round: 'R16', count: 8, startDay: 4, month: 7 },
    { round: 'QF', count: 4, startDay: 9, month: 7 },
    { round: 'SF', count: 2, startDay: 14, month: 7 },
    { round: '3RD', count: 1, startDay: 18, month: 7 },
    { round: 'FINAL', count: 1, startDay: 19, month: 7 },
  ];

  for (const ko of knockout) {
    for (let i = 1; i <= ko.count; i++) {
      const day = ko.startDay + Math.floor((i - 1) / 2);
      const hour = slots[(i - 1) % 2 === 0 ? 1 : 3]; // 15:00 / 21:00
      insert.run({
        round: ko.round,
        seq: ++seq,
        home_code: null,
        away_code: null,
        home_name: 'TBD',
        away_name: 'TBD',
        venue: nextVenue(),
        kickoff_at: mxToUtcISO(2026, ko.month, day, hour),
      });
    }
  }
}

function seedBonusQuestions() {
  // Lock bonus questions at the tournament start (first kickoff).
  const lockAt = mxToUtcISO(2026, 6, 11, 12);
  const insert = db.prepare(`
    INSERT INTO bonus_questions (seq, prompt, points, answer_count, lock_at, correct_answer)
    VALUES (?, ?, ?, ?, ?, NULL)
  `);
  const questions = [
    ['Who will win the World Cup?', 15, 1],
    ['Which two teams will reach the final?', 8, 2],
    ['Which four teams will reach the semi-finals?', 5, 4],
    ['Who will be the top scorer of the tournament?', 10, 1],
    ['Which team scores the most goals in the group stage?', 6, 1],
    ['Which of us three wins the Tippspiel (most points)?', 5, 1],
  ];
  questions.forEach((q, i) => insert.run(i + 1, q[0], q[1], q[2], lockAt));
}

function seedPlayers() {
  // Default PINs — CHANGE THESE. See README.
  const insert = db.prepare('INSERT INTO players (name, pin_hash, is_admin) VALUES (?, ?, 0)');
  insert.run('Ali', hashPin('1111'));
  insert.run('Alex', hashPin('2222'));
  insert.run('Will', hashPin('3333'));
}

function seedSettings() {
  const set = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  set.run('points_exact', '5');
  set.run('points_diff', '3');
  set.run('points_tendency', '1');
  set.run('admin_pin_hash', hashPin('9999')); // shared admin PIN — CHANGE THIS
  set.run('timezone', 'America/Mexico_City');
}

function main() {
  init();

  if (RESET) {
    db.exec(`
      DELETE FROM sessions;
      DELETE FROM bonus_answers;
      DELETE FROM bonus_questions;
      DELETE FROM tips;
      DELETE FROM matches;
      DELETE FROM teams;
      DELETE FROM players;
      DELETE FROM settings;
      DELETE FROM sqlite_sequence;
    `);
    console.log('Reset: cleared all game data.');
  }

  const count = (t) => db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c;

  if (count('teams') === 0) { seedTeams(); console.log('Seeded 48 teams.'); }
  if (count('matches') === 0) { seedMatches(); console.log(`Seeded ${count('matches')} matches.`); }
  if (count('bonus_questions') === 0) { seedBonusQuestions(); console.log('Seeded bonus questions.'); }
  if (count('players') === 0) { seedPlayers(); console.log('Seeded players: Ali, Alex, Will.'); }
  if (count('settings') === 0) { seedSettings(); console.log('Seeded settings.'); }

  console.log('Done.');
}

main();
