'use strict';

const assert = require('assert');
const { scoreTip, scoreBonus } = require('../scoring');

const P = { exact: 5, diff: 3, tendency: 1 };
let n = 0;
const t = (msg, fn) => { fn(); n++; console.log('  ok -', msg); };

console.log('scoreTip:');
t('exact result -> 5', () => assert.strictEqual(scoreTip({ home: 3, away: 2 }, { home: 3, away: 2 }, P), 5));
t('correct difference -> 3', () => assert.strictEqual(scoreTip({ home: 2, away: 1 }, { home: 3, away: 2 }, P), 3));
t('two different draws -> 3 (diff)', () => assert.strictEqual(scoreTip({ home: 1, away: 1 }, { home: 2, away: 2 }, P), 3));
t('exact draw -> 5', () => assert.strictEqual(scoreTip({ home: 0, away: 0 }, { home: 0, away: 0 }, P), 5));
t('right winner wrong diff -> 1', () => assert.strictEqual(scoreTip({ home: 1, away: 0 }, { home: 3, away: 1 }, P), 1));
t('wrong tendency -> 0', () => assert.strictEqual(scoreTip({ home: 2, away: 0 }, { home: 0, away: 1 }, P), 0));
t('predicted draw, was a win -> 0', () => assert.strictEqual(scoreTip({ home: 1, away: 1 }, { home: 2, away: 1 }, P), 0));
t('away win exact -> 5', () => assert.strictEqual(scoreTip({ home: 0, away: 2 }, { home: 0, away: 2 }, P), 5));
t('null tip -> 0', () => assert.strictEqual(scoreTip(null, { home: 1, away: 0 }, P), 0));
t('no result yet -> 0', () => assert.strictEqual(scoreTip({ home: 1, away: 0 }, null, P), 0));

console.log('scoreBonus:');
t('single correct -> points', () => assert.strictEqual(scoreBonus(['Brazil'], ['Brazil'], 15), 15));
t('case/space insensitive', () => assert.strictEqual(scoreBonus([' brazil '], ['Brazil'], 15), 15));
t('single wrong -> 0', () => assert.strictEqual(scoreBonus(['France'], ['Brazil'], 15), 0));
t('2 of 4 semis -> 2*5', () => assert.strictEqual(scoreBonus(['A', 'B', 'X', 'Y'], ['A', 'B', 'C', 'D'], 5), 10));
t('all 4 semis -> 20', () => assert.strictEqual(scoreBonus(['A', 'B', 'C', 'D'], ['A', 'B', 'C', 'D'], 5), 20));
t('duplicates do not double count', () => assert.strictEqual(scoreBonus(['A', 'A'], ['A', 'B'], 5), 5));
t('unresolved (empty correct) -> 0', () => assert.strictEqual(scoreBonus(['A'], [], 5), 0));

console.log(`\nAll ${n} assertions passed.`);
