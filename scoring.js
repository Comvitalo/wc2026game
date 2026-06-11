'use strict';

/**
 * Scoring for a single match tip.
 *
 * Rules (points configurable):
 *   - Exact result            -> points.exact      (e.g. tip 3:2, actual 3:2)
 *   - Correct goal difference -> points.diff       (e.g. tip 2:1, actual 3:2)
 *   - Correct tendency only   -> points.tendency   (right winner or draw, wrong difference)
 *   - Wrong tendency          -> 0
 *
 * A "tendency" is the sign of (home - away): home win / draw / away win.
 * A correct goal difference always implies a correct tendency, so it is
 * checked first and outranks a plain tendency hit.
 *
 * @param {{home:number, away:number}|null} tip
 * @param {{home:number, away:number}|null} result
 * @param {{exact:number, diff:number, tendency:number}} points
 * @returns {number}
 */
function scoreTip(tip, result, points = { exact: 5, diff: 3, tendency: 1 }) {
  if (!tip || !result) return 0;
  const { home: th, away: ta } = tip;
  const { home: ah, away: aa } = result;
  if ([th, ta, ah, aa].some((v) => v === null || v === undefined || Number.isNaN(v))) {
    return 0;
  }

  // Exact result
  if (th === ah && ta === aa) return points.exact;

  const tipDiff = th - ta;
  const resDiff = ah - aa;

  // Same goal difference (this also covers two different draws, e.g. 1:1 vs 2:2)
  if (tipDiff === resDiff) return points.diff;

  // Same tendency (winner side or both non-equal in the same direction)
  if (Math.sign(tipDiff) === Math.sign(resDiff)) return points.tendency;

  return 0;
}

/**
 * Score a bonus question.
 * Both the player's answer and the correct answer are arrays of strings.
 * Awards `points` for every correct pick (case/whitespace insensitive),
 * so a 4-team "semi-finalists" question with points=5 can yield up to 20.
 *
 * @param {string[]} answer
 * @param {string[]} correct
 * @param {number} points  points per correct pick
 * @returns {number}
 */
function scoreBonus(answer, correct, points) {
  if (!Array.isArray(answer) || !Array.isArray(correct) || correct.length === 0) {
    return 0;
  }
  const norm = (s) => String(s).trim().toLowerCase();
  const correctSet = new Set(correct.map(norm));
  const seen = new Set();
  let hits = 0;
  for (const a of answer) {
    const key = norm(a);
    if (correctSet.has(key) && !seen.has(key)) {
      hits += 1;
      seen.add(key);
    }
  }
  return hits * points;
}

module.exports = { scoreTip, scoreBonus };
