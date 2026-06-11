'use strict';

/**
 * Seeds the database with players, the WC 2026 teams & fixtures, default
 * bonus questions and settings.
 *
 *   node seed.js          -> create tables and fill any that are empty
 *   node seed.js --reset  -> wipe game data and re-seed from scratch
 *
 * Data sources (in ./data):
 *   groups.json    – the 12 groups (A–L) with their 4 real teams.
 *   schedule.json  – the official 104-match schedule (optional). When present
 *                    it is the source of truth for fixtures, dates and venues.
 *                    When absent, a date-correct skeleton is generated so the
 *                    app still works; the admin can refine it later.
 *
 * All kickoff/lock times are stored in UTC. Local kickoff times in
 * schedule.json are converted using the host city's summer UTC offset.
 */

const fs = require('fs');
const path = require('path');
const { db, init } = require('./db');
const { hashPin } = require('./auth');

const RESET = process.argv.includes('--reset');
const DATA = path.join(__dirname, 'data');

const groups = JSON.parse(fs.readFileSync(path.join(DATA, 'groups.json'), 'utf8'));
const GROUPS = Object.keys(groups);

// UTC offset of each venue's timezone during the tournament (June–July 2026).
// US/Canada cities observe daylight time; Mexican venues use CST (no DST).
const DEFAULT_OFFSET = -6; // fall back to Mexico City time
function tzOffset(tz) {
  if (!tz) return DEFAULT_OFFSET;
  if (tz.includes('MX')) return -6;        // Mexico CST, no DST
  if (tz.startsWith('ET')) return -4;      // EDT
  if (tz.startsWith('CT')) return -5;      // CDT
  if (tz.startsWith('MT')) return -6;      // MDT
  if (tz.startsWith('PT')) return -7;      // PDT
  return DEFAULT_OFFSET;
}

// Convert a venue-local date + time + tz to a UTC ISO string.
function localToUtcISO(dateStr, timeStr, tz) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = (timeStr || '12:00').split(':').map(Number);
  const off = tzOffset(tz); // e.g. -4
  // local = UTC + off  =>  UTC = local - off
  return new Date(Date.UTC(y, m - 1, d, hh - off, mm)).toISOString();
}

// Some sources abbreviate team names; map them to the names in groups.json.
const ALIASES = { usa: 'United States', 'u.s.a.': 'United States', 'united states of america': 'United States' };
function normalize(s) {
  const n = String(s).trim().toLowerCase();
  return ALIASES[n] ? ALIASES[n].toLowerCase() : n;
}

// Map a team name to its group team code (e.g. "Mexico" -> "A1").
const teamToCode = {};
for (const g of GROUPS) {
  groups[g].forEach((name, i) => { teamToCode[normalize(name)] = `${g}${i + 1}`; });
}

const ROUND_ORDER = { Group: 0, R32: 1, R16: 2, QF: 3, SF: 4, '3RD': 5, FINAL: 6 };

function seedTeams() {
  const insert = db.prepare('INSERT INTO teams (code, name, grp) VALUES (?, ?, ?)');
  for (const g of GROUPS) {
    groups[g].forEach((name, i) => insert.run(`${g}${i + 1}`, name, g));
  }
}

function seedMatchesFromSchedule(schedule) {
  const insert = db.prepare(`
    INSERT INTO matches (round, seq, home_code, away_code, home_name, away_name, venue, kickoff_at)
    VALUES (@round, @seq, @home_code, @away_code, @home_name, @away_name, @venue, @kickoff_at)
  `);
  // Order by date/time, then by round.
  const sorted = [...schedule].sort((a, b) => {
    const ka = `${a.date} ${a.timeLocal || '00:00'}`;
    const kb = `${b.date} ${b.timeLocal || '00:00'}`;
    if (ka !== kb) return ka < kb ? -1 : 1;
    return (ROUND_ORDER[a.round] ?? 9) - (ROUND_ORDER[b.round] ?? 9);
  });

  let seq = 0;
  for (const mtch of sorted) {
    const isGroup = mtch.round === 'Group';
    const homeCode = isGroup ? (teamToCode[normalize(mtch.home)] || null) : null;
    const awayCode = isGroup ? (teamToCode[normalize(mtch.away)] || null) : null;
    const venue = mtch.stadium ? `${mtch.city} · ${mtch.stadium}` : (mtch.city || null);
    insert.run({
      round: mtch.round,
      seq: ++seq,
      home_code: homeCode,
      away_code: awayCode,
      // For group games we resolve the name from the team code; only store an
      // override name when there is no code (knockout slots / unmatched teams).
      home_name: homeCode ? null : (mtch.home || 'TBD'),
      away_name: awayCode ? null : (mtch.away || 'TBD'),
      venue,
      kickoff_at: localToUtcISO(mtch.date, mtch.timeLocal, mtch.tz),
    });
  }
  return seq;
}

// Fallback: real teams, plausible dates, when no official schedule file exists.
function seedSkeleton() {
  const insert = db.prepare(`
    INSERT INTO matches (round, seq, home_code, away_code, home_name, away_name, venue, kickoff_at)
    VALUES (@round, @seq, @home_code, @away_code, @home_name, @away_name, @venue, @kickoff_at)
  `);
  const pairs = [[1, 2], [3, 4], [1, 3], [4, 2], [4, 1], [2, 3]];
  const mxISO = (mo, d, h) => new Date(Date.UTC(2026, mo - 1, d, h + 6, 0)).toISOString();
  let seq = 0;
  for (let md = 0; md < pairs.length; md++) {
    const [a, b] = pairs[md];
    GROUPS.forEach((g, gi) => {
      insert.run({
        round: 'Group', seq: ++seq,
        home_code: `${g}${a}`, away_code: `${g}${b}`, home_name: null, away_name: null,
        venue: null, kickoff_at: mxISO(6, 11 + md * 2 + Math.floor(gi / 6), [12, 15, 18, 21][gi % 4]),
      });
    });
  }
  const ko = [['R32', 16, 28, 6], ['R16', 8, 4, 7], ['QF', 4, 9, 7], ['SF', 2, 14, 7], ['3RD', 1, 18, 7], ['FINAL', 1, 19, 7]];
  for (const [round, count, startDay, month] of ko) {
    for (let i = 1; i <= count; i++) {
      insert.run({
        round, seq: ++seq, home_code: null, away_code: null, home_name: 'TBD', away_name: 'TBD',
        venue: null, kickoff_at: mxISO(month, startDay + Math.floor((i - 1) / 2), (i - 1) % 2 ? 21 : 15),
      });
    }
  }
  return seq;
}

function seedMatches() {
  const file = path.join(DATA, 'schedule.json');
  if (fs.existsSync(file)) {
    const schedule = JSON.parse(fs.readFileSync(file, 'utf8'));
    const n = seedMatchesFromSchedule(schedule);
    console.log(`Seeded ${n} matches from official schedule.json.`);
  } else {
    const n = seedSkeleton();
    console.log(`Seeded ${n} matches from skeleton (no schedule.json found yet).`);
  }
}

function seedBonusQuestions() {
  // Lock bonus questions at the tournament start (first kickoff, 11 Jun 2026).
  const lockAt = localToUtcISO('2026-06-11', '13:00', 'MX (CST)');
  const insert = db.prepare(`
    INSERT INTO bonus_questions (seq, prompt, points, answer_count, lock_at, correct_answer)
    VALUES (?, ?, ?, ?, ?, NULL)
  `);
  const questions = [
    ['Who will win the World Cup?', 5, 1],
    ['Which four teams will reach the semi-finals?', 2, 4],
    ['Who will be the top scorer of the tournament?', 5, 1],
    ['Which team scores the most goals in the group stage?', 5, 1],
  ];
  questions.forEach((q, i) => insert.run(i + 1, q[0], q[1], q[2], lockAt));
}

function seedPlayers() {
  // PINs can be supplied via env (e.g. Fly secrets) on first seed; otherwise
  // the documented defaults are used. Change them before sharing publicly.
  const insert = db.prepare('INSERT INTO players (name, pin_hash, is_admin) VALUES (?, ?, 0)');
  insert.run('Ali', hashPin(process.env.PIN_ALI || '1111'));
  insert.run('Alex', hashPin(process.env.PIN_ALEX || '2222'));
  insert.run('Will', hashPin(process.env.PIN_WILL || '3333'));
}

function seedSettings() {
  const set = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  set.run('points_exact', '3');
  set.run('points_diff', '2');
  set.run('points_tendency', '1');
  set.run('admin_pin_hash', hashPin(process.env.ADMIN_PIN || '9999')); // shared admin PIN
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

  if (count('teams') === 0) { seedTeams(); console.log(`Seeded ${count('teams')} teams.`); }
  if (count('matches') === 0) { seedMatches(); }
  if (count('bonus_questions') === 0) { seedBonusQuestions(); console.log('Seeded bonus questions.'); }
  if (count('players') === 0) { seedPlayers(); console.log('Seeded players: Ali, Alex, Will.'); }
  if (count('settings') === 0) { seedSettings(); console.log('Seeded settings.'); }

  console.log('Done.');
}

main();
