'use strict';

/**
 * Knockout-bracket advancement.
 *
 * Every knockout match (R16 onward, plus the third-place game and final) stores
 * where its two teams come from, in `home_src` / `away_src`, using the form
 * "<W|L>:<slot>":
 *
 *   W:R32-1   winner of the match in bracket slot R32-1
 *   L:SF-1    loser  of the match in bracket slot SF-1   (third-place game)
 *
 * Round-of-32 matches carry a `slot` but no source — their teams are the real
 * group qualifiers, set by the seed/migration.
 *
 * `recomputeBracket(db)` walks the rounds in order and fills each downstream
 * match's home_name / away_name:
 *   - the advancing (or eliminated) team's real name once the source is decided
 *   - otherwise a readable placeholder ("Winner of South Africa/Canada", "Winner
 *     of QF-2", …) so the bracket still reads sensibly before kickoff.
 *
 * A knockout tie that goes to penalties leaves the score level, so the winner
 * can't be read from home_score/away_score. For those, the admin sets
 * `advance_side` ('home' | 'away') and it decides who progresses.
 */

const ROUND_RANK = { Group: 0, R32: 1, R16: 2, QF: 3, SF: 4, '3RD': 5, FINAL: 6 };

// Which side won — 'home', 'away', or null if undecided.
// A decisive score wins; a level (or absent) score falls back to advance_side.
function decideWinner(m) {
  if (m.home_score != null && m.away_score != null) {
    if (m.home_score > m.away_score) return 'home';
    if (m.away_score > m.home_score) return 'away';
  }
  return m.advance_side === 'home' || m.advance_side === 'away' ? m.advance_side : null;
}

// A name is "concrete" once it's a real team rather than a TBD/placeholder.
function isConcrete(name) {
  if (!name) return false;
  return !/^(Winner|Loser) of /.test(name) && name !== 'TBD';
}

// Short label for a source match, used inside placeholders.
function matchupLabel(m) {
  if (isConcrete(m.home_name) && isConcrete(m.away_name)) return `${m.home_name}/${m.away_name}`;
  return m.slot;
}

// Resolve one "<W|L>:<slot>" source to a display name given the slot lookup.
function resolveSource(src, bySlot) {
  const i = src.indexOf(':');
  const take = src.slice(0, i); // 'W' or 'L'
  const ref = src.slice(i + 1);
  const sm = bySlot[ref];
  if (!sm) return src; // unknown slot — show raw token rather than crash
  const winner = decideWinner(sm);
  if (!winner) return `${take === 'W' ? 'Winner' : 'Loser'} of ${matchupLabel(sm)}`;
  const loser = winner === 'home' ? 'away' : 'home';
  const side = take === 'W' ? winner : loser;
  return sm[`${side}_name`];
}

// Recompute every sourced knockout match in place. Returns the number of rows
// whose names changed (handy for logging / tests).
function recomputeBracket(db) {
  const rows = db.prepare('SELECT * FROM matches').all();
  const bySlot = {};
  for (const m of rows) if (m.slot) bySlot[m.slot] = m;

  const upd = db.prepare('UPDATE matches SET home_name = ?, away_name = ? WHERE id = ?');
  let changed = 0;

  // Ascending round order guarantees a source is resolved before its dependents
  // (R16 before QF before SF before the third-place game / final).
  const sourced = rows
    .filter((m) => m.home_src || m.away_src)
    .sort((a, b) => (ROUND_RANK[a.round] ?? 9) - (ROUND_RANK[b.round] ?? 9));

  for (const m of sourced) {
    const home = m.home_src ? resolveSource(m.home_src, bySlot) : m.home_name;
    const away = m.away_src ? resolveSource(m.away_src, bySlot) : m.away_name;
    if (home !== m.home_name || away !== m.away_name) {
      upd.run(home, away, m.id);
      m.home_name = home; // keep in-memory copy current so dependents see it
      m.away_name = away;
      changed++;
    }
  }
  return changed;
}

module.exports = { recomputeBracket, decideWinner, ROUND_RANK };
