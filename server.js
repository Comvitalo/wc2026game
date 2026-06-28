'use strict';

const path = require('path');
const express = require('express');
const { db, init } = require('./db');
const { hashPin, verifyPin, newToken } = require('./auth');
const { scoreTip, scoreBonus } = require('./scoring');
const { recomputeBracket } = require('./bracket');

init();

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
const now = () => new Date().toISOString();

// Health check for the platform (Fly) load balancer.
app.get('/healthz', (req, res) => res.json({ ok: true }));

// ---------------------------------------------------------------------------
// Settings helpers
// ---------------------------------------------------------------------------
function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}
function scoringPoints() {
  return {
    exact: Number(getSetting('points_exact') ?? 5),
    diff: Number(getSetting('points_diff') ?? 3),
    tendency: Number(getSetting('points_tendency') ?? 1),
  };
}

// ---------------------------------------------------------------------------
// Display name resolution for a match side
// ---------------------------------------------------------------------------
function teamNameMap() {
  const map = {};
  for (const t of db.prepare('SELECT code, name FROM teams').all()) map[t.code] = t.name;
  return map;
}
function sideName(match, side, names) {
  const code = match[`${side}_code`];
  const override = match[`${side}_name`];
  if (code && names[code]) return names[code];
  if (override) return override;
  return code || 'TBD';
}
const isLocked = (match) => now() >= match.kickoff_at;

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------
function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Not logged in' });
  const session = db.prepare('SELECT * FROM sessions WHERE token = ?').get(token);
  if (!session) return res.status(401).json({ error: 'Invalid session' });
  req.session = session;
  next();
}
function adminOnly(req, res, next) {
  if (!req.session || !req.session.is_admin) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

app.post('/api/login', (req, res) => {
  const { name, pin } = req.body || {};
  const player = db.prepare('SELECT * FROM players WHERE name = ?').get(String(name || '').trim());
  if (!player || !verifyPin(pin, player.pin_hash)) {
    return res.status(401).json({ error: 'Wrong name or PIN' });
  }
  const token = newToken();
  db.prepare('INSERT INTO sessions (token, player_id, is_admin, created_at) VALUES (?, ?, 0, ?)')
    .run(token, player.id, now());
  res.json({ token, player: { id: player.id, name: player.name }, isAdmin: false });
});

app.post('/api/admin/login', (req, res) => {
  const { pin } = req.body || {};
  if (!verifyPin(pin, getSetting('admin_pin_hash'))) {
    return res.status(401).json({ error: 'Wrong admin PIN' });
  }
  const token = newToken();
  db.prepare('INSERT INTO sessions (token, player_id, is_admin, created_at) VALUES (?, NULL, 1, ?)')
    .run(token, now());
  res.json({ token, isAdmin: true });
});

app.post('/api/logout', auth, (req, res) => {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(req.session.token);
  res.json({ ok: true });
});

app.get('/api/me', auth, (req, res) => {
  let player = null;
  if (req.session.player_id) {
    player = db.prepare('SELECT id, name FROM players WHERE id = ?').get(req.session.player_id);
  }
  res.json({ player, isAdmin: !!req.session.is_admin, points: scoringPoints() });
});

// ---------------------------------------------------------------------------
// Matches & tips
// ---------------------------------------------------------------------------
const ROUND_LABELS = {
  Group: 'Group Stage', R32: 'Round of 32', R16: 'Round of 16',
  QF: 'Quarter-final', SF: 'Semi-final', '3RD': 'Third place', FINAL: 'Final',
};

app.get('/api/matches', auth, (req, res) => {
  const names = teamNameMap();
  const pts = scoringPoints();
  const matches = db.prepare('SELECT * FROM matches ORDER BY kickoff_at, seq').all();
  const myId = req.session.player_id;

  const allTips = db.prepare('SELECT t.*, p.name AS player_name FROM tips t JOIN players p ON p.id = t.player_id').all();
  const tipsByMatch = {};
  for (const t of allTips) (tipsByMatch[t.match_id] ||= []).push(t);

  const out = matches.map((m) => {
    const locked = isLocked(m);
    const played = m.home_score !== null && m.away_score !== null;
    const result = played ? { home: m.home_score, away: m.away_score } : null;
    const tips = tipsByMatch[m.id] || [];

    const myTip = tips.find((t) => t.player_id === myId);
    // Other players' tips only revealed once the match has locked.
    const others = locked
      ? tips
          .filter((t) => t.player_id !== myId)
          .map((t) => ({
            player: t.player_name,
            home: t.home_tip,
            away: t.away_tip,
            points: result ? scoreTip({ home: t.home_tip, away: t.away_tip }, result, pts) : null,
          }))
      : [];

    return {
      id: m.id,
      round: m.round,
      roundLabel: ROUND_LABELS[m.round] || m.round,
      seq: m.seq,
      home: sideName(m, 'home', names),
      away: sideName(m, 'away', names),
      venue: m.venue,
      kickoffAt: m.kickoff_at,
      locked,
      played,
      result,
      myTip: myTip ? { home: myTip.home_tip, away: myTip.away_tip } : null,
      myPoints: myTip && result ? scoreTip({ home: myTip.home_tip, away: myTip.away_tip }, result, pts) : null,
      otherTips: others,
    };
  });

  res.json(out);
});

app.put('/api/matches/:id/tip', auth, (req, res) => {
  if (!req.session.player_id) return res.status(403).json({ error: 'Log in as a player to tip' });
  const match = db.prepare('SELECT * FROM matches WHERE id = ?').get(req.params.id);
  if (!match) return res.status(404).json({ error: 'Match not found' });
  if (isLocked(match)) return res.status(403).json({ error: 'This match is locked (kickoff passed)' });

  const home = Number(req.body?.home);
  const away = Number(req.body?.away);
  if (!Number.isInteger(home) || !Number.isInteger(away) || home < 0 || away < 0 || home > 99 || away > 99) {
    return res.status(400).json({ error: 'Enter two whole numbers (0–99)' });
  }

  db.prepare(`
    INSERT INTO tips (player_id, match_id, home_tip, away_tip, updated_at)
    VALUES (@pid, @mid, @home, @away, @now)
    ON CONFLICT(player_id, match_id)
    DO UPDATE SET home_tip = @home, away_tip = @away, updated_at = @now
  `).run({ pid: req.session.player_id, mid: match.id, home, away, now: now() });

  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Bonus questions
// ---------------------------------------------------------------------------
app.get('/api/bonus', auth, (req, res) => {
  const myId = req.session.player_id;
  const questions = db.prepare('SELECT * FROM bonus_questions ORDER BY seq').all();
  const answers = db.prepare('SELECT b.*, p.name AS player_name FROM bonus_answers b JOIN players p ON p.id = b.player_id').all();
  const byQ = {};
  for (const a of answers) (byQ[a.question_id] ||= []).push(a);

  const out = questions.map((q) => {
    const locked = now() >= q.lock_at;
    const correct = q.correct_answer ? JSON.parse(q.correct_answer) : null;
    const qa = byQ[q.id] || [];
    const mine = qa.find((a) => a.player_id === myId);
    const others = locked
      ? qa.filter((a) => a.player_id !== myId).map((a) => {
          const ans = JSON.parse(a.answer);
          return {
            player: a.player_name,
            answer: ans,
            points: correct ? scoreBonus(ans, correct, q.points) : null,
          };
        })
      : [];
    const myAns = mine ? JSON.parse(mine.answer) : null;
    return {
      id: q.id,
      prompt: q.prompt,
      points: q.points,
      answerCount: q.answer_count,
      lockAt: q.lock_at,
      locked,
      correct,
      myAnswer: myAns,
      myPoints: myAns && correct ? scoreBonus(myAns, correct, q.points) : null,
      otherAnswers: others,
    };
  });
  res.json(out);
});

app.put('/api/bonus/:id/answer', auth, (req, res) => {
  if (!req.session.player_id) return res.status(403).json({ error: 'Log in as a player to answer' });
  const q = db.prepare('SELECT * FROM bonus_questions WHERE id = ?').get(req.params.id);
  if (!q) return res.status(404).json({ error: 'Question not found' });
  if (now() >= q.lock_at) return res.status(403).json({ error: 'Bonus question is locked' });

  let answer = req.body?.answer;
  if (!Array.isArray(answer)) answer = answer != null ? [answer] : [];
  answer = answer.map((s) => String(s).trim()).filter(Boolean).slice(0, q.answer_count);
  if (answer.length === 0) return res.status(400).json({ error: 'Provide at least one answer' });

  db.prepare(`
    INSERT INTO bonus_answers (player_id, question_id, answer, updated_at)
    VALUES (@pid, @qid, @ans, @now)
    ON CONFLICT(player_id, question_id)
    DO UPDATE SET answer = @ans, updated_at = @now
  `).run({ pid: req.session.player_id, qid: q.id, ans: JSON.stringify(answer), now: now() });

  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Leaderboard
// ---------------------------------------------------------------------------
app.get('/api/leaderboard', auth, (req, res) => {
  const pts = scoringPoints();
  const players = db.prepare('SELECT id, name FROM players').all();
  const matches = db.prepare('SELECT * FROM matches WHERE home_score IS NOT NULL AND away_score IS NOT NULL').all();
  const tips = db.prepare('SELECT * FROM tips').all();
  const questions = db.prepare('SELECT * FROM bonus_questions WHERE correct_answer IS NOT NULL').all();
  const bonusAnswers = db.prepare('SELECT * FROM bonus_answers').all();

  const board = players.map((p) => {
    let matchPts = 0;
    let exact = 0, diff = 0, tendency = 0;
    // Knockout-only buckets (rounds other than 'Group').
    let koPts = 0, koExact = 0, koDiff = 0, koTendency = 0;
    for (const m of matches) {
      const tip = tips.find((t) => t.player_id === p.id && t.match_id === m.id);
      if (!tip) continue;
      const s = scoreTip({ home: tip.home_tip, away: tip.away_tip }, { home: m.home_score, away: m.away_score }, pts);
      matchPts += s;
      if (s === pts.exact) exact++;
      else if (s === pts.diff) diff++;
      else if (s === pts.tendency) tendency++;
      if (m.round !== 'Group') {
        koPts += s;
        if (s === pts.exact) koExact++;
        else if (s === pts.diff) koDiff++;
        else if (s === pts.tendency) koTendency++;
      }
    }
    let bonusPts = 0;
    for (const q of questions) {
      const a = bonusAnswers.find((x) => x.player_id === p.id && x.question_id === q.id);
      if (!a) continue;
      bonusPts += scoreBonus(JSON.parse(a.answer), JSON.parse(q.correct_answer), q.points);
    }
    return {
      player: p.name,
      total: matchPts + bonusPts,
      matchPoints: matchPts,
      bonusPoints: bonusPts,
      exact, diff, tendency,
      // Knockout-rounds-only ranking (match tips from R32 onward; no bonus).
      koPoints: koPts,
      koExact, koDiff, koTendency,
    };
  });

  board.sort((a, b) => b.total - a.total);
  res.json(board);
});

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------
app.get('/api/admin/matches', auth, adminOnly, (req, res) => {
  const names = teamNameMap();
  const matches = db.prepare('SELECT * FROM matches ORDER BY kickoff_at, seq').all();
  res.json(matches.map((m) => ({
    id: m.id, round: m.round, roundLabel: ROUND_LABELS[m.round] || m.round, seq: m.seq,
    homeCode: m.home_code, awayCode: m.away_code,
    home: sideName(m, 'home', names), away: sideName(m, 'away', names),
    venue: m.venue, kickoffAt: m.kickoff_at,
    homeScore: m.home_score, awayScore: m.away_score,
    // Knockout bracket: `derived` means the teams come from earlier winners and
    // are filled automatically, so the admin sets only the score (+ who
    // advanced if it went to penalties).
    slot: m.slot, derived: !!(m.home_src || m.away_src), advance: m.advance_side,
  })));
});

app.put('/api/admin/matches/:id', auth, adminOnly, (req, res) => {
  const m = db.prepare('SELECT * FROM matches WHERE id = ?').get(req.params.id);
  if (!m) return res.status(404).json({ error: 'Match not found' });
  const b = req.body || {};

  const homeScore = b.homeScore === '' || b.homeScore == null ? null : Number(b.homeScore);
  const awayScore = b.awayScore === '' || b.awayScore == null ? null : Number(b.awayScore);
  if (homeScore !== null && (!Number.isInteger(homeScore) || homeScore < 0)) {
    return res.status(400).json({ error: 'Invalid home score' });
  }
  if (awayScore !== null && (!Number.isInteger(awayScore) || awayScore < 0)) {
    return res.status(400).json({ error: 'Invalid away score' });
  }

  // Who advances on penalties (only meaningful for knockout ties). '' clears it.
  let advanceSide;
  if (b.advance === undefined) advanceSide = m.advance_side; // unchanged
  else if (b.advance === 'home' || b.advance === 'away') advanceSide = b.advance;
  else advanceSide = null;

  // For derived knockout slots the teams come from the bracket, so ignore any
  // submitted names; for everything else a submitted name overrides.
  const derived = !!(m.home_src || m.away_src);

  db.prepare(`
    UPDATE matches SET
      home_name  = COALESCE(@home_name, home_name),
      away_name  = COALESCE(@away_name, away_name),
      venue      = COALESCE(@venue, venue),
      kickoff_at = COALESCE(@kickoff_at, kickoff_at),
      home_score = @home_score,
      away_score = @away_score,
      advance_side = @advance_side
    WHERE id = @id
  `).run({
    id: m.id,
    home_name: derived ? null : (b.home ?? null),
    away_name: derived ? null : (b.away ?? null),
    venue: b.venue ?? null,
    kickoff_at: b.kickoffAt ?? null,
    home_score: homeScore,
    away_score: awayScore,
    advance_side: advanceSide,
  });
  // Propagate the (possibly new) winner/loser into the next knockout games.
  recomputeBracket(db);
  res.json({ ok: true });
});

app.get('/api/admin/teams', auth, adminOnly, (req, res) => {
  res.json(db.prepare('SELECT code, name, grp FROM teams ORDER BY grp, code').all());
});

app.put('/api/admin/teams/:code', auth, adminOnly, (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Name required' });
  const r = db.prepare('UPDATE teams SET name = ? WHERE code = ?').run(name, req.params.code);
  if (r.changes === 0) return res.status(404).json({ error: 'Team not found' });
  res.json({ ok: true });
});

app.get('/api/admin/bonus', auth, adminOnly, (req, res) => {
  const qs = db.prepare('SELECT * FROM bonus_questions ORDER BY seq').all();
  res.json(qs.map((q) => ({
    id: q.id, prompt: q.prompt, points: q.points, answerCount: q.answer_count,
    lockAt: q.lock_at, correct: q.correct_answer ? JSON.parse(q.correct_answer) : null,
  })));
});

app.put('/api/admin/bonus/:id', auth, adminOnly, (req, res) => {
  const q = db.prepare('SELECT * FROM bonus_questions WHERE id = ?').get(req.params.id);
  if (!q) return res.status(404).json({ error: 'Question not found' });
  const b = req.body || {};
  let correct = q.correct_answer;
  if (b.correct !== undefined) {
    if (b.correct === null || (Array.isArray(b.correct) && b.correct.length === 0)) {
      correct = null;
    } else {
      const arr = (Array.isArray(b.correct) ? b.correct : [b.correct]).map((s) => String(s).trim()).filter(Boolean);
      correct = JSON.stringify(arr);
    }
  }
  db.prepare(`
    UPDATE bonus_questions SET
      prompt  = COALESCE(@prompt, prompt),
      points  = COALESCE(@points, points),
      lock_at = COALESCE(@lock_at, lock_at),
      correct_answer = @correct
    WHERE id = @id
  `).run({
    id: q.id,
    prompt: b.prompt ?? null,
    points: b.points != null ? Number(b.points) : null,
    lock_at: b.lockAt ?? null,
    correct,
  });
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Tippspiel WC 2026 running at http://localhost:${PORT}`);
});
