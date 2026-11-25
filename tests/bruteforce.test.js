import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bruteForceOptimal, buildLevel, generateLevel, STRATEGIES, playOut, createGameState, applyAction, endWardenPhase,
} from '../src/core/index.js';
import { pathLevel } from './helpers.js';

/**
 * INDEPENDENT oracle: naive exhaustive search written directly against the rules (own mini frost
 * simulator, no code shared with the module under test). Any subset of CLEAR nodes of size <= k
 * may be warded each turn, including useless ones and the empty set.
 */
function naiveOptimum(level) {
  const n = level.n;
  const pop = level.nodes.map((x) => x.population);
  const adj = Array.from({ length: n }, () => []);
  for (const [u, v] of level.graph.edges()) { adj[u].push(v); adj[v].push(u); }
  const memo = new Map();
  const saved = (st) => st.reduce((s, x, i) => s + (x !== 1 ? pop[i] : 0), 0);
  const subsets = (clear, k) => {
    const out = [[]];
    const rec = (start, cur) => {
      if (cur.length === k) return;
      for (let i = start; i < clear.length; i++) { const nxt = [...cur, clear[i]]; out.push(nxt); rec(i + 1, nxt); }
    };
    rec(0, []);
    return out;
  };
  function solve(st) {
    const key = st.join('');
    if (memo.has(key)) return memo.get(key);
    const clear = [];
    st.forEach((x, i) => { if (x === 0) clear.push(i); });
    let best = -1;
    for (const wards of subsets(clear, level.k)) {
      const t = st.slice();
      for (const w of wards) t[w] = 2;
      const newly = [];
      for (let v = 0; v < n; v++) if (t[v] === 0 && adj[v].some((u) => t[u] === 1)) newly.push(v);
      for (const v of newly) t[v] = 1;
      const value = newly.length === 0 ? saved(t) : solve(t);
      if (value > best) best = value;
    }
    memo.set(key, best);
    return best;
  }
  const start = new Array(n).fill(0);
  for (const s of level.sources) start[s] = 1;
  return solve(start);
}

test('bruteForceOptimal returns null when level.n > maxNodes', () => {
  assert.equal(bruteForceOptimal(buildLevel(4)), null); // n = 25 > 20
  assert.equal(bruteForceOptimal(buildLevel(1), { maxNodes: 10 }), null); // n = 12 > 10
  assert.notEqual(bruteForceOptimal(buildLevel(1)), null);
});

test('bruteForceOptimal matches the naive exhaustive oracle on 60 tiny random levels (k = 1..3)', () => {
  let compared = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const n = 5 + (seed % 5); // 5..9
    const level = generateLevel({ n, seed, k: 1 + (seed % 3), sources: 1 + (seed % 2), targetPercent: 50 });
    const bf = bruteForceOptimal(level);
    assert.equal(bf.truncated, false);
    assert.equal(bf.outcome.savedPopulation, naiveOptimum(level), `mismatch n=${n} seed=${seed} k=${level.k}`);
    compared++;
  }
  assert.equal(compared, 60);
});

test('bruteForceOptimal matches the naive oracle on campaign levels 1 and 2', () => {
  for (const id of [1, 2]) {
    const level = buildLevel(id);
    assert.equal(bruteForceOptimal(level).outcome.savedPopulation, naiveOptimum(level), `level ${id}`);
  }
});

test('bruteForceOptimal is at least as good as every strategy on campaign levels with n <= 20 and on small random levels', () => {
  const levels = [1, 2, 3].map((id) => buildLevel(id));
  for (let seed = 1; seed <= 25; seed++) levels.push(generateLevel({ n: 8 + (seed % 12), seed, k: 1 + (seed % 2), sources: 1 + (seed % 3) }));
  for (const level of levels) {
    const bf = bruteForceOptimal(level);
    assert.equal(bf.truncated, false);
    for (const { id, fn } of STRATEGIES) {
      assert.ok(
        bf.outcome.savedPopulation >= playOut(level, fn).outcome.savedPopulation,
        `brute force worse than ${id} on n=${level.n} seed=${level.seed}`,
      );
    }
  }
});

test('bruteForceOptimal: result shape, and the returned turns replay to the same outcome', () => {
  const level = buildLevel(3);
  const bf = bruteForceOptimal(level);
  assert.equal(typeof bf.elapsedMs, 'number');
  assert.ok(bf.elapsedMs >= 0);
  assert.equal(bf.truncated, false);
  assert.ok(Array.isArray(bf.turns) && bf.turns.length >= 1);
  const s = createGameState(level);
  for (const t of bf.turns) {
    for (const a of t.actions) assert.equal(applyAction(s, a).ok, true);
    const r = endWardenPhase(s);
    assert.deepEqual(r.newlyFrosted, t.newlyFrosted);
  }
  assert.equal(s.over, true);
  assert.equal(s.outcome.savedPopulation, bf.outcome.savedPopulation);
});

test('bruteForceOptimal: deterministic', () => {
  const a = bruteForceOptimal(buildLevel(2));
  const b = bruteForceOptimal(buildLevel(2));
  assert.deepEqual(a.outcome, b.outcome);
  assert.deepEqual(a.turns, b.turns);
});

test('bruteForceOptimal: a zero time limit aborts but never returns anything worse than a heuristic', () => {
  const level = generateLevel({ n: 20, seed: 4, k: 2, sources: 1 });
  const bf = bruteForceOptimal(level, { timeLimitMs: 0 });
  assert.equal(typeof bf.truncated, 'boolean');
  for (const { fn } of STRATEGIES) assert.ok(bf.outcome.savedPopulation >= playOut(level, fn).outcome.savedPopulation);
});

test('bruteForceOptimal: trivial levels (everything protectable) save everything not already frosted', () => {
  const level = pathLevel(4, { k: 1, sources: [0] }); // ward node 1 -> only node 0 lost
  const bf = bruteForceOptimal(level);
  assert.equal(bf.outcome.savedPopulation, 3);
});

test('bruteForceOptimal handles multiple frost sources and finishes quickly on n = 20', () => {
  const level = generateLevel({ n: 20, seed: 77, k: 2, sources: 3 });
  const t0 = performance.now();
  const bf = bruteForceOptimal(level);
  assert.equal(bf.truncated, false);
  assert.ok(performance.now() - t0 < 5000);
});
