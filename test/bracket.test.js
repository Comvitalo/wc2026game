'use strict';

// Tests for knockout-bracket advancement (bracket.js), using an in-memory DB.

const assert = require('assert');
const Database = require('better-sqlite3');
const { recomputeBracket, decideWinner } = require('../bracket');

let passed = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); console.log(`  ok - ${msg}`); passed++; };
const eq = (a, b, msg) => { assert.strictEqual(a, b, `${msg} (got ${a})`); console.log(`  ok - ${msg}`); passed++; };

// Minimal matches table with just the columns bracket.js touches.
function freshDb() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE matches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    round TEXT, slot TEXT, home_name TEXT, away_name TEXT,
    home_score INTEGER, away_score INTEGER,
    home_src TEXT, away_src TEXT, advance_side TEXT
  )`);
  const ins = db.prepare(
    'INSERT INTO matches (round, slot, home_name, away_name, home_src, away_src) VALUES (?,?,?,?,?,?)'
  );
  // Tiny 4-team bracket: two R32 feeding one R16; an SF/3RD/FINAL chain reuses
  // the same idea for losers.
  ins.run('R32', 'A', 'Alpha', 'Beta', null, null);
  ins.run('R32', 'B', 'Gamma', 'Delta', null, null);
  ins.run('R16', 'C', 'TBD', 'TBD', 'W:A', 'W:B');
  return db;
}
const slot = (db, s) => db.prepare('SELECT * FROM matches WHERE slot=?').get(s);
const score = (db, s, h, a, adv) =>
  db.prepare('UPDATE matches SET home_score=?, away_score=?, advance_side=? WHERE slot=?').run(h, a, adv ?? null, s);

// decideWinner
eq(decideWinner({ home_score: 2, away_score: 1 }), 'home', 'higher home score wins');
eq(decideWinner({ home_score: 0, away_score: 3 }), 'away', 'higher away score wins');
eq(decideWinner({ home_score: 1, away_score: 1 }), null, 'level score with no shootout pick is undecided');
eq(decideWinner({ home_score: 1, away_score: 1, advance_side: 'away' }), 'away', 'level score uses advance_side');
eq(decideWinner({ home_score: null, away_score: null }), null, 'unplayed is undecided');

// Placeholder before any result references the real feeder teams.
let db = freshDb();
recomputeBracket(db);
eq(slot(db, 'C').home_name, 'Winner of Alpha/Beta', 'undecided home shows feeder matchup');
eq(slot(db, 'C').away_name, 'Winner of Gamma/Delta', 'undecided away shows feeder matchup');

// Decisive results advance the winners.
score(db, 'A', 3, 0);
score(db, 'B', 1, 2);
recomputeBracket(db);
eq(slot(db, 'C').home_name, 'Alpha', 'winner of A advances');
eq(slot(db, 'C').away_name, 'Delta', 'winner of B advances');

// Penalty shootout: level score + advance_side decides who goes through.
score(db, 'A', 1, 1, 'away');
recomputeBracket(db);
eq(slot(db, 'C').home_name, 'Beta', 'shootout winner (advance_side) advances');

// Changing a result re-propagates.
score(db, 'A', 0, 5);
recomputeBracket(db);
eq(slot(db, 'C').home_name, 'Beta', 'away win re-propagates');

// Loser feed (third-place style): L:<slot> takes the eliminated team.
db = freshDb();
db.prepare("UPDATE matches SET round='3RD', slot='D', home_src='L:A', away_src='L:B' WHERE slot='C'").run();
score(db, 'A', 2, 0); // Alpha wins -> Beta loses
score(db, 'B', 0, 1); // Delta wins -> Gamma loses
recomputeBracket(db);
eq(slot(db, 'D').home_name, 'Beta', 'loser of A feeds third-place game');
eq(slot(db, 'D').away_name, 'Gamma', 'loser of B feeds third-place game');

console.log(`\nAll ${passed} assertions passed.`);
