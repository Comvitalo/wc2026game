'use strict';

/**
 * One-off migration to apply the revised scoring to an EXISTING database
 * (the seed only fills empty tables, so it cannot change live data).
 *
 *   node migrate.js
 *
 * Idempotent — safe to run more than once. It:
 *   - sets match points to exact=3, diff=2, tendency=1
 *   - removes the "finalists" and "Tippspiel winner" bonus questions
 *     (and any answers already submitted for them, via cascade)
 *   - sets remaining bonus points: semi-finals = 2/team, all others = 5
 *
 * Player tips, match results and the other bonus answers are left untouched.
 */

const { db, init } = require('./db');

init();

const REMOVE_PROMPTS = [
  'Which two teams will reach the final?',
  'Which of us three wins the Tippspiel (most points)?',
];

const run = db.transaction(() => {
  // 1. Match scoring
  const setSetting = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  setSetting.run('points_exact', '3');
  setSetting.run('points_diff', '2');
  setSetting.run('points_tendency', '1');
  console.log('Match points -> exact=3, diff=2, tendency=1');

  // 2. Remove unwanted bonus questions (cascade removes their answers)
  const del = db.prepare('DELETE FROM bonus_questions WHERE prompt = ?');
  for (const p of REMOVE_PROMPTS) {
    const r = del.run(p);
    console.log(`Removed "${p}": ${r.changes} question(s)`);
  }

  // 3. Bonus points: semi-finals question = 2/team, everything else = 5
  const semis = db.prepare(
    "UPDATE bonus_questions SET points = 2 WHERE prompt LIKE '%semi-finals%'"
  ).run();
  const others = db.prepare(
    "UPDATE bonus_questions SET points = 5 WHERE prompt NOT LIKE '%semi-finals%'"
  ).run();
  console.log(`Bonus points -> semi-finals=2/team (${semis.changes}), others=5 (${others.changes})`);
});

run();

console.log('\nRemaining bonus questions:');
for (const q of db.prepare('SELECT prompt, points, answer_count FROM bonus_questions ORDER BY seq').all()) {
  console.log(`  - ${q.prompt}  [${q.points} pt${q.answer_count > 1 ? '/pick × ' + q.answer_count : ''}]`);
}
console.log('\nDone.');
