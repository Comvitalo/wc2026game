'use strict';

/**
 * One-off migration that adds the four knockout-round bonus questions to an
 * existing database (the seed only fills empty tables, so it can't add them).
 *
 *   node migrate-ko-bonus.js
 *
 * Idempotent — matched by prompt text, so re-running adds nothing. Each is
 * worth 3 points for a correct answer and locks when the first knockout game of
 * the bracket run kicks off (Brazil vs Japan, slot R32-2). Existing questions,
 * answers, tips and results are untouched.
 *
 * Note: the two "closest guess wins" questions need closest-number scoring at
 * resolution time, which the current exact-match scorer doesn't do yet — that
 * can be added before the knockout rounds finish. The other two resolve with
 * the normal admin flow (enter the correct country / player name).
 */

const { db, init } = require('./db');

init();

// Lock when the first KO game of the bracket run kicks off (Brazil vs Japan).
const r32_2 = db.prepare("SELECT kickoff_at FROM matches WHERE slot = 'R32-2'").get();
const lockAt = r32_2 ? r32_2.kickoff_at : new Date(Date.UTC(2026, 5, 29, 17, 0)).toISOString();

const QUESTIONS = [
  'How many goals will be scored across the knockout rounds? (Closest guess wins; penalty-shootout goals are not counted.)',
  'How many knockout games go to extra time? (Closest guess wins.)',
  'Which country reaches the semi-finals, other than Germany, France, Netherlands, Portugal, Spain, Brazil, England and Argentina?',
  'Who scores more goals in the knockout rounds: Ronaldo, Messi, Vinicius, Haaland, Kane or Mbappe?',
];

const exists = db.prepare('SELECT id FROM bonus_questions WHERE prompt = ?');
const insert = db.prepare(
  'INSERT INTO bonus_questions (seq, prompt, points, answer_count, lock_at, correct_answer) VALUES (?, ?, 3, 1, ?, NULL)'
);

const run = db.transaction(() => {
  let seq = db.prepare('SELECT COALESCE(MAX(seq), 0) AS m FROM bonus_questions').get().m;
  let added = 0, skipped = 0;
  for (const q of QUESTIONS) {
    if (exists.get(q)) { console.log(`  skip   already present: ${q.slice(0, 55)}…`); skipped++; continue; }
    insert.run(++seq, q, lockAt);
    console.log(`  added  ${q.slice(0, 55)}…`);
    added++;
  }
  console.log(`\n${added} added, ${skipped} skipped. Lock at ${lockAt}.`);
});

run();

console.log('\nBonus questions now:');
for (const q of db.prepare('SELECT seq, prompt, points, answer_count, lock_at FROM bonus_questions ORDER BY seq').all()) {
  console.log(`  [${q.seq}] ${q.points}pt ×${q.answer_count}  locks ${q.lock_at}\n        ${q.prompt}`);
}
console.log('\nDone.');
