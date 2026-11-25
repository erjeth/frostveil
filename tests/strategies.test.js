import test from 'node:test';
import assert from 'node:assert/strict';
import {
  NodeState, createGameState, applyAction, endWardenPhase, buildLevel, generateLevel, mulberry32,
  randomStrategy, maxDegreeStrategy, articulationGreedyStrategy, STRATEGIES, playOut, LEVEL_SPECS,
} from '../src/core/index.js';
import { makeLevel, pathLevel } from './helpers.js';

const { CLEAR } = NodeState;
const snapshot = (s) =>
  JSON.stringify({ ns: [...s.nodeState], e: s.graph.edges(), t: s.turn, a: s.actionsLeft, acts: s.actions, over: s.over, log: s.log });

/** A few mid-game states on a real level, to exercise strategies beyond the opening position. */
function sampleStates() {
  const out = [];
  for (const id of [1, 3, 5, 8]) {
    const level = buildLevel(id);
    const s = createGameState(level);
    out.push(s);
    for (let t = 0; t < 2 && !s.over; t++) {
      for (const a of articulationGreedyStrategy(s)) applyAction(s, a);
      endWardenPhase(s);
      if (!s.over) out.push(s);
    }
  }
  return out;
}

test('STRATEGIES lists the three strategies with the contract ids and labels', () => {
  assert.deepEqual(STRATEGIES.map((s) => s.id), ['random', 'maxDegree', 'articulationGreedy']);
  assert.deepEqual(STRATEGIES.map((s) => s.label), ['Random', 'Max-Degree', 'Articulation-Aware Greedy']);
  assert.equal(STRATEGIES[0].fn, randomStrategy);
  assert.equal(STRATEGIES[1].fn, maxDegreeStrategy);
  assert.equal(STRATEGIES[2].fn, articulationGreedyStrategy);
});

test('no strategy mutates the game state', () => {
  for (const s of sampleStates()) {
    const before = snapshot(s);
    for (const { fn } of STRATEGIES) {
      fn(s);
      fn(s, mulberry32(5));
      assert.equal(snapshot(s), before);
    }
  }
});

test('strategies return legal beacon actions: <= actionsLeft, distinct CLEAR nodes, all applicable', () => {
  for (const s of sampleStates()) {
    for (const { id, fn } of STRATEGIES) {
      const actions = fn(s, mulberry32(11));
      assert.ok(actions.length <= s.actionsLeft, `${id}: too many actions`);
      const seen = new Set();
      for (const a of actions) {
        assert.equal(a.type, 'beacon', id);
        assert.ok(Number.isInteger(a.node) && s.nodeState[a.node] === CLEAR, `${id}: beacon on a non-CLEAR node`);
        assert.ok(!seen.has(a.node), `${id}: duplicate node`);
        seen.add(a.node);
      }
      // really applicable, in order, to a fresh copy of the position
      const copy = createGameState(s.level);
      copy.nodeState.set(s.nodeState);
      copy.graph = s.graph.clone();
      copy.actionsLeft = s.actionsLeft;
      for (const a of actions) assert.equal(applyAction(copy, a).ok, true, `${id}: illegal action ${JSON.stringify(a)}`);
    }
  }
});

test('strategies return [] when there is nothing to protect or no actions left', () => {
  const s = createGameState(pathLevel(3, { k: 1 }));
  s.actionsLeft = 0;
  for (const { fn } of STRATEGIES) assert.deepEqual(fn(s), []);
});

test('randomStrategy: deterministic for a given rng seed, varies across seeds, respects k', () => {
  const s = createGameState(buildLevel(5));
  const a = randomStrategy(s, mulberry32(1));
  const b = randomStrategy(s, mulberry32(1));
  assert.deepEqual(a, b);
  assert.equal(a.length, 2);
  const picks = new Set();
  for (let seed = 1; seed <= 30; seed++) picks.add(JSON.stringify(randomStrategy(s, mulberry32(seed))));
  assert.ok(picks.size > 10, 'different rng seeds should give different picks');
  // default rng (fresh mulberry32 of the turn) is deterministic as well
  assert.deepEqual(randomStrategy(s), randomStrategy(s));
});

test('randomStrategy: only CLEAR nodes, never more beacons than CLEAR nodes exist', () => {
  const s = createGameState(pathLevel(3, { k: 5 })); // 2 CLEAR nodes, k = 5
  const acts = randomStrategy(s, mulberry32(3));
  assert.equal(acts.length, 2);
  assert.deepEqual(acts.map((x) => x.node).sort(), [1, 2]);
});

test('maxDegreeStrategy: highest current degree among CLEAR nodes, ties to the smaller id', () => {
  // hub 3 has degree 4; nodes 1 and 2 tie on degree 2
  const level = makeLevel({ n: 7, edges: [[0, 1], [1, 3], [3, 4], [3, 5], [3, 6], [0, 2], [2, 6]], sources: [0], k: 2 });
  const s = createGameState(level);
  assert.deepEqual(maxDegreeStrategy(s), [{ type: 'beacon', node: 3 }, { type: 'beacon', node: 1 }]);
});

test('maxDegreeStrategy: uses the CURRENT degree (severed roads no longer count) and skips non-CLEAR nodes', () => {
  // node 1: neighbors 0,2,3,4 (degree 4); node 4: neighbors 1,5,6 (degree 3)
  const level = makeLevel({ n: 7, edges: [[0, 1], [1, 2], [1, 3], [1, 4], [4, 5], [4, 6]], sources: [0], k: 1 });
  const s = createGameState(level);
  assert.deepEqual(maxDegreeStrategy(s), [{ type: 'beacon', node: 1 }]);
  // after severing 1-2 and 1-3, node 1 has degree 2 (0 and 4) and node 4 (degree 3) takes over
  s.graph.removeEdge(1, 2);
  s.graph.removeEdge(1, 3);
  assert.deepEqual(maxDegreeStrategy(s), [{ type: 'beacon', node: 4 }]);
  // a WARDED node is never chosen again: with node 4 warded, node 1 is next
  s.nodeState[4] = NodeState.WARDED;
  assert.deepEqual(maxDegreeStrategy(s), [{ type: 'beacon', node: 1 }]);
});

test('articulationGreedy: picks the far cut vertex that shields a big region (needs the articulation candidates)', () => {
  // frost 0 touches a=1 and b=2; both lead to hub 3, which guards three heavy leaves 4,5,6.
  // Warding 1 or 2 alone does nothing (frost walks around); warding hub 3 saves the leaves.
  const level = makeLevel({
    n: 7, edges: [[0, 1], [0, 2], [1, 3], [2, 3], [3, 4], [3, 5], [3, 6]],
    pops: [1, 1, 1, 1, 9, 9, 9], sources: [0], k: 1, citadel: 4,
  });
  const s = createGameState(level);
  assert.deepEqual(articulationGreedyStrategy(s), [{ type: 'beacon', node: 3 }]);
});

test('articulationGreedy beats maxDegree where degree is misleading', () => {
  // 0(F)-1 and 0(F)-6; 1-2; 2 is a hub with heavy leaves 3,4,5; 6-7 is a light side branch
  const level = makeLevel({
    n: 8, edges: [[0, 1], [1, 2], [2, 3], [2, 4], [2, 5], [0, 6], [6, 7]],
    pops: [1, 1, 1, 9, 9, 9, 1, 1], sources: [0], k: 1, citadel: 3, targetPercent: 10,
  });
  const s = createGameState(level);
  const greedy = articulationGreedyStrategy(s)[0].node;
  assert.equal(maxDegreeStrategy(s)[0].node, 2, 'max-degree grabs the hub');
  assert.equal(greedy, 1, 'greedy stops the frost at the frontier, saving the hub AND its leaves');
  assert.ok(playOut(level, articulationGreedyStrategy).outcome.savedPopulation >= playOut(level, maxDegreeStrategy).outcome.savedPopulation);
});

test('articulationGreedy: sequential beacons within one turn see each other (k = 2)', () => {
  // two separate corridors from the frost, each guarding a heavy node: both must be warded in one turn
  const level = makeLevel({
    n: 5, edges: [[0, 1], [0, 2], [1, 3], [2, 4]], pops: [1, 1, 1, 9, 9], sources: [0], k: 2, citadel: 3,
  });
  const s = createGameState(level);
  const nodes = articulationGreedyStrategy(s).map((a) => a.node).sort();
  assert.deepEqual(nodes, [1, 2], 'the two frontier cut nodes');
});

test('articulationGreedy: tie-break by lower id when everything is equal', () => {
  const level = makeLevel({ n: 3, edges: [[0, 1], [0, 2]], pops: [1, 5, 5], sources: [0], k: 1, citadel: 1 });
  const s = createGameState(level);
  assert.deepEqual(articulationGreedyStrategy(s), [{ type: 'beacon', node: 1 }]);
});

test('articulationGreedy: deterministic, ignores rng', () => {
  const s = createGameState(buildLevel(7));
  const a = articulationGreedyStrategy(s);
  assert.deepEqual(articulationGreedyStrategy(s), a);
  assert.deepEqual(articulationGreedyStrategy(s, mulberry32(999)), a);
});

test('playOut terminates for every strategy on every campaign level and on random free-play levels', () => {
  for (const spec of LEVEL_SPECS) {
    const level = buildLevel(spec.id);
    for (const { id, fn } of STRATEGIES) {
      const r = playOut(level, fn);
      assert.ok(r.turns.length >= 1 && r.turns.length <= level.n, `${id} on level ${spec.id}`);
      assert.equal(typeof r.outcome.won, 'boolean');
    }
  }
  for (let seed = 1; seed <= 25; seed++) {
    const level = generateLevel({ n: 10 + (seed % 7) * 10, seed, k: 1 + (seed % 3), sources: 1 + (seed % 3) });
    for (const { fn } of STRATEGIES) assert.ok(playOut(level, fn).turns.length <= level.n);
  }
});

test('playOut is deterministic: same level, same strategy, same result (incl. Random)', () => {
  for (const { fn } of STRATEGIES) {
    const level = buildLevel(4);
    assert.deepEqual(playOut(level, fn), playOut(level, fn));
  }
  const level = buildLevel(4);
  assert.deepEqual(playOut(level, randomStrategy, mulberry32(77)), playOut(level, randomStrategy, mulberry32(77)));
});

test('playOut: result shape, turn log and outcome agree with a manual game on a real state', () => {
  const level = buildLevel(5);
  const r = playOut(level, articulationGreedyStrategy);
  const s = createGameState(level);
  const rng = mulberry32(level.seed);
  while (!s.over) {
    for (const a of articulationGreedyStrategy(s, rng)) applyAction(s, a);
    endWardenPhase(s);
  }
  assert.deepEqual(r.turns, s.log);
  assert.equal(r.outcome.savedPopulation, s.outcome.savedPopulation);
  assert.equal(r.outcome.won, s.outcome.won);
  for (const t of r.turns) {
    assert.ok(Number.isInteger(t.turn) && Array.isArray(t.actions) && Array.isArray(t.newlyFrosted));
  }
});

test('playOut leaves reference null (documented choice) and never recurses into reference computation', () => {
  const r = playOut(buildLevel(3), articulationGreedyStrategy);
  assert.equal(r.outcome.reference, null);
  assert.ok(r.outcome.stars === 0 || r.outcome.stars === 1);
});

test('playOut does not touch the level it is given', () => {
  const level = buildLevel(6);
  const edges = JSON.stringify(level.graph.edges());
  playOut(level, articulationGreedyStrategy);
  playOut(level, maxDegreeStrategy);
  assert.equal(JSON.stringify(level.graph.edges()), edges);
});
