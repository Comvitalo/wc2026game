'use strict';

const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'tippspiel.db');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function init() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS players (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      name      TEXT UNIQUE NOT NULL,
      pin_hash  TEXT NOT NULL,
      is_admin  INTEGER NOT NULL DEFAULT 0
    );

    -- 48 teams, grouped A..L. Names are editable (placeholders until known).
    CREATE TABLE IF NOT EXISTS teams (
      code TEXT PRIMARY KEY,   -- e.g. "A1"
      name TEXT NOT NULL,      -- editable display name
      grp  TEXT NOT NULL       -- "A".."L"
    );

    CREATE TABLE IF NOT EXISTS matches (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      round       TEXT NOT NULL,           -- 'Group', 'R32', 'R16', 'QF', 'SF', '3RD', 'FINAL'
      seq         INTEGER NOT NULL,        -- display order
      home_code   TEXT,                    -- team code for group games (FK-ish)
      away_code   TEXT,
      home_name   TEXT,                    -- override label (knockout slots / manual)
      away_name   TEXT,
      venue       TEXT,
      kickoff_at  TEXT NOT NULL,           -- ISO 8601 UTC; lock = now >= kickoff_at
      home_score  INTEGER,                 -- actual result (null until played)
      away_score  INTEGER,
      slot        TEXT,                    -- bracket slot id, e.g. 'R32-1', 'QF-3', 'FINAL'
      home_src    TEXT,                    -- '<W|L>:<slot>' feeder for knockout games
      away_src    TEXT,
      advance_side TEXT                    -- 'home'|'away' when a tie is decided on penalties
    );

    CREATE TABLE IF NOT EXISTS tips (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      player_id  INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      match_id   INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
      home_tip   INTEGER NOT NULL,
      away_tip   INTEGER NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(player_id, match_id)
    );

    CREATE TABLE IF NOT EXISTS bonus_questions (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      seq            INTEGER NOT NULL,
      prompt         TEXT NOT NULL,
      points         INTEGER NOT NULL,     -- points per correct pick
      answer_count   INTEGER NOT NULL DEFAULT 1,
      lock_at        TEXT NOT NULL,        -- ISO UTC
      correct_answer TEXT                  -- JSON array of strings (null until resolved)
    );

    CREATE TABLE IF NOT EXISTS bonus_answers (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      player_id   INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      question_id INTEGER NOT NULL REFERENCES bonus_questions(id) ON DELETE CASCADE,
      answer      TEXT NOT NULL,           -- JSON array of strings
      updated_at  TEXT NOT NULL,
      UNIQUE(player_id, question_id)
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token      TEXT PRIMARY KEY,
      player_id  INTEGER REFERENCES players(id) ON DELETE CASCADE,
      is_admin   INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_tips_match  ON tips(match_id);
    CREATE INDEX IF NOT EXISTS idx_matches_seq ON matches(seq);
  `);

  ensureColumns('matches', {
    slot: 'TEXT',
    home_src: 'TEXT',
    away_src: 'TEXT',
    advance_side: 'TEXT',
  });
}

// Add any missing columns to an existing table (CREATE TABLE IF NOT EXISTS does
// not alter a table that already exists, so older databases need this).
function ensureColumns(table, cols) {
  const have = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name));
  for (const [name, type] of Object.entries(cols)) {
    if (!have.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
  }
}

module.exports = { db, init, DB_PATH };
