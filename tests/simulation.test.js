import test from 'node:test';
import assert from 'node:assert/strict';
import {
  NodeState, createGameState, applyAction, undoAction, endWardenPhase, isContained,
  blockedMask, frostForecast, safeZones, evaluateOutcome,
} from '../src/core/index.js';
import { makeLevel, pathLevel } from './helpers.js';

const { CLEAR, FROSTED, WARDED } = NodeState;
const beacon = (node) => ({ type: 'beacon', node });
const sever = (u, v) => ({ type: 'sever', u, v });

test('NodeState values and immutability', () => {
  assert.deepEqual({ ...NodeState }, { CLEAR: 0, FROSTED: 1, WARDED: 2 });
  assert.ok(Object.isFrozen(NodeState));
});

test('createGameState: initial state matches the contract', () => {
  const level = pathLevel(5, { sources: [2], k: 2 });
  const s = createGameState(level);
  assert.equal(s.level, level);
  assert.notEqual(s.graph, level.graph, 'graph must be a clone');
  assert.deepEqual([...s.nodeState], [CLEAR, CLEAR, FROSTED, CLEAR, CLEAR]);
  assert.equal(s.turn, 1);
  assert.equal(s.actionsLeft, 2);
  assert.deepEqual(s.actions, []);
  assert.equal(s.over, false);
  assert.equal(s.outcome, null);
  assert.deepEqual(s.log, []);
});

test('level is never mutated by play (graph clone)', () => {
  const level = pathLevel(5);
  const edgesBefore = JSON.stringify(level.graph.edges());
  const s = createGameState(level);
  applyAction(s, sever(0, 1));
  endWardenPhase(s);
  assert.equal(JSON.stringify(level.graph.edges()), edgesBefore);
  assert.deepEqual(level.sources, [0]);
});

test('beacon protects a node and blocks the spread behind it', () => {
  const s = createGameState(pathLevel(4)); // 0(F)-1-2-3
  assert.deepEqual(applyAction(s, beacon(1)), { ok: true });
  assert.equal(s.nodeState[1], WARDED);
  const r = endWardenPhase(s);
  assert.deepEqual(r.newlyFrosted, []);
  assert.equal(r.contained, true);
  assert.equal(s.over, true);
  assert.deepEqual([...s.nodeState], [FROSTED, WARDED, CLEAR, CLEAR]);
});

test('beacon on a non-CLEAR node fails with a reason', () => {
  const s = createGameState(pathLevel(4, { k: 2 }));
  const onFrosted = applyAction(s, beacon(0));
  assert.equal(onFrosted.ok, false);
  assert.equal(typeof onFrosted.reason, 'string');
  assert.ok(onFrosted.reason.length > 0);
  assert.equal(applyAction(s, beacon(2)).ok, true);
  const onWarded = applyAction(s, beacon(2));
  assert.equal(onWarded.ok, false);
  assert.ok(onWarded.reason);
  assert.equal(s.actionsLeft, 1, 'failed actions must not consume actions');
  assert.equal(s.actions.length, 1);
});

test('invalid actions fail cleanly', () => {
  const s = createGameState(pathLevel(4, { k: 3 }));
  assert.equal(applyAction(s, beacon(99)).ok, false);
  assert.equal(applyAction(s, beacon(-1)).ok, false);
  assert.equal(applyAction(s, { type: 'nuke' }).ok, false);
  assert.equal(applyAction(s, null).ok, false);
  assert.equal(s.actionsLeft, 3);
});

test('sever on a missing edge fails; on an existing edge it stops the spread', () => {
  const s = createGameState(pathLevel(4)); // 0(F)-1-2-3
  const miss = applyAction(s, sever(0, 3));
  assert.equal(miss.ok, false);
  assert.ok(miss.reason);
  assert.deepEqual(applyAction(s, sever(0, 1)), { ok: true });
  assert.ok(!s.graph.hasEdge(0, 1));
  const r = endWardenPhase(s);
  assert.deepEqual(r.newlyFrosted, []);
  assert.equal(s.over, true);
});

test('frost spreads exactly ONE BFS layer per phase', () => {
  const s = createGameState(pathLevel(6)); // 0(F)-1-2-3-4-5
  assert.deepEqual(endWardenPhase(s).newlyFrosted, [1]);
  assert.deepEqual([...s.nodeState], [1, 1, 0, 0, 0, 0]);
  assert.deepEqual(endWardenPhase(s).newlyFrosted, [2]);
  assert.deepEqual(endWardenPhase(s).newlyFrosted, [3]);
  assert.equal(s.turn, 4);
  assert.equal(s.over, false);
});

test('newly frosted nodes do not spread within the same phase; star graph spreads to all leaves at once', () => {
  const edges = [[0, 1], [0, 2], [0, 3], [3, 4]];
  const s = createGameState(makeLevel({ n: 5, edges, sources: [0] }));
  assert.deepEqual(endWardenPhase(s).newlyFrosted, [1, 2, 3]);
  assert.equal(s.nodeState[4], CLEAR, '4 is two hops away: not frosted yet');
});

test('frost never crosses a WARDED node, but goes around it through another path', () => {
  // square 0-1-2-3-0 plus tail 3-4; source 0; ward 1 -> frost reaches 3 then 2 via 3
  const edges = [[0, 1], [1, 2], [2, 3], [3, 0], [3, 4]];
  const s = createGameState(makeLevel({ n: 5, edges, sources: [0] }));
  applyAction(s, beacon(1));
  assert.deepEqual(endWardenPhase(s).newlyFrosted, [3]);
  assert.deepEqual(endWardenPhase(s).newlyFrosted, [2, 4]);
  assert.equal(s.nodeState[1], WARDED, 'ward never frosts');
  assert.equal(s.over, true);
});

test('multiple frost sources spread simultaneously', () => {
  const s = createGameState(pathLevel(7, { sources: [0, 6] }));
  assert.deepEqual(endWardenPhase(s).newlyFrosted, [1, 5]);
});

test('actionsLeft decreases per action, blocks at 0 and resets after the frost phase', () => {
  const s = createGameState(pathLevel(8, { k: 2 }));
  assert.equal(s.actionsLeft, 2);
  assert.equal(applyAction(s, beacon(5)).ok, true);
  assert.equal(applyAction(s, beacon(6)).ok, true);
  assert.equal(s.actionsLeft, 0);
  const third = applyAction(s, beacon(4));
  assert.equal(third.ok, false);
  assert.ok(third.reason);
  endWardenPhase(s);
  assert.equal(s.actionsLeft, 2);
  assert.deepEqual(s.actions, []);
});

test('undoAction restores beacons, severed edges and actionsLeft, in reverse order', () => {
  const s = createGameState(pathLevel(6, { k: 3 }));
  const edgesBefore = JSON.stringify(s.graph.edges());
  applyAction(s, beacon(4));
  applyAction(s, sever(2, 3));
  applyAction(s, beacon(5));
  assert.equal(s.actionsLeft, 0);

  assert.equal(undoAction(s), true); // beacon 5
  assert.equal(s.nodeState[5], CLEAR);
  assert.equal(s.actionsLeft, 1);
  assert.equal(undoAction(s), true); // sever 2-3
  assert.ok(s.graph.hasEdge(2, 3));
  assert.equal(s.actionsLeft, 2);
  assert.equal(undoAction(s), true); // beacon 4
  assert.equal(s.nodeState[4], CLEAR);
  assert.equal(s.actionsLeft, 3);
  assert.deepEqual(s.actions, []);
  assert.equal(JSON.stringify(s.graph.edges()), edgesBefore);
  assert.equal(undoAction(s), false, 'nothing left to undo');
});

test('undo cannot reach into a completed turn or a finished game', () => {
  const s = createGameState(pathLevel(6, { k: 1 }));
  applyAction(s, beacon(3));
  endWardenPhase(s);
  assert.equal(undoAction(s), false);
  assert.equal(s.nodeState[3], WARDED);
});

test('undo then re-apply gives the same frost result as never having acted wrongly', () => {
  const a = createGameState(pathLevel(6));
  applyAction(a, beacon(3));
  undoAction(a);
  applyAction(a, sever(0, 1));
  endWardenPhase(a);
  const b = createGameState(pathLevel(6));
  applyAction(b, sever(0, 1));
  endWardenPhase(b);
  assert.deepEqual([...a.nodeState], [...b.nodeState]);
  assert.deepEqual(a.log, b.log);
});

test('log records completed turns', () => {
  const s = createGameState(pathLevel(5, { k: 2 }));
  applyAction(s, beacon(4));
  endWardenPhase(s);
  endWardenPhase(s);
  assert.equal(s.log.length, 2);
  assert.deepEqual(s.log[0], { turn: 1, actions: [beacon(4)], newlyFrosted: [1] });
  assert.deepEqual(s.log[1], { turn: 2, actions: [], newlyFrosted: [2] });
});

test('containment: detected when frost has no CLEAR neighbor; further actions are rejected', () => {
  const s = createGameState(pathLevel(5, { k: 1 }));
  assert.equal(isContained(s), false);
  applyAction(s, beacon(1));
  // isContained is a pure predicate on the current board: the only threatened edge is now warded...
  assert.equal(isContained(s), true);
  // ...but the game is only declared over when the frost phase has been run.
  assert.equal(s.over, false);
  const r = endWardenPhase(s);
  assert.equal(r.contained, true);
  assert.equal(s.over, true);
  assert.ok(s.outcome);
  assert.equal(applyAction(s, beacon(3)).ok, false);
  assert.equal(applyAction(s, beacon(3)).reason, 'The game is over.');
  assert.equal(undoAction(s), false);
  const turnBefore = s.turn;
  const again = endWardenPhase(s);
  assert.deepEqual(again.newlyFrosted, []);
  assert.equal(s.turn, turnBefore, 'ending a finished game changes nothing');
});

test('game over when no CLEAR node is left (everything frosted)', () => {
  const s = createGameState(pathLevel(3));
  endWardenPhase(s);
  endWardenPhase(s);
  assert.equal(s.over, true);
  assert.deepEqual([...s.nodeState], [1, 1, 1]);
});

test('evaluateOutcome: lose when the Citadel is frosted', () => {
  const s = createGameState(pathLevel(3, { pops: [1, 1, 8], citadel: 1, targetPercent: 10 }));
  endWardenPhase(s);
  endWardenPhase(s);
  const o = s.outcome;
  assert.equal(o.citadelSafe, false);
  assert.equal(o.won, false);
  assert.equal(o.stars, 0);
});

test('evaluateOutcome: lose when the saved percent is below the target even if the Citadel lives', () => {
  // path 0(F)-1-2-3, pops [1,5,1,1]: ward node 2, frost takes the big node 1 -> only nodes 2 and 3 are saved.
  const level = makeLevel({ n: 4, edges: [[0, 1], [1, 2], [2, 3]], pops: [1, 5, 1, 1], citadel: 3, targetPercent: 50 });
  const s = createGameState(level);
  applyAction(s, beacon(2));
  endWardenPhase(s);
  assert.equal(s.over, true);
  const o = s.outcome;
  assert.equal(o.savedPopulation, 2); // nodes 2 (warded) and 3, pop 1 each; nodes 0 and 1 are frosted
  assert.equal(o.totalPopulation, 8);
  assert.equal(o.savedPercent, 25);
  assert.equal(o.citadelSafe, true);
  assert.equal(o.won, false);
  assert.equal(o.stars, 0);
});

test('evaluateOutcome: win exactly at the threshold; warded nodes count as saved', () => {
  // 0(F)-1-2-3, all pop 1, ward node 1 -> saved = 3 of 4 = 75 %
  const level = pathLevel(4, { targetPercent: 75 });
  const s = createGameState(level);
  applyAction(s, beacon(1));
  endWardenPhase(s);
  const o = s.outcome;
  assert.equal(o.savedPopulation, 3);
  assert.equal(o.savedPercent, 75);
  assert.equal(o.won, true);
  assert.ok(o.stars >= 1);
  assert.ok(o.savedPercent >= 0 && o.savedPercent <= 100);
});

test('evaluateOutcome on a running game reports the current saved population only', () => {
  const s = createGameState(pathLevel(5, { pops: [2, 3, 1, 1, 1] }));
  const o = evaluateOutcome(s);
  assert.equal(o.savedPopulation, 8 - 2);
  assert.equal(o.totalPopulation, 8);
  assert.equal(o.won, false);
  assert.equal(o.stars, 0);
  assert.equal(o.reference, null);
  applyAction(s, beacon(1));
  assert.equal(evaluateOutcome(s).savedPopulation, 6, 'warded stays saved');
});

test('blockedMask: 1 for FROSTED and WARDED, 0 for CLEAR', () => {
  const s = createGameState(pathLevel(4));
  applyAction(s, beacon(2));
  assert.deepEqual([...blockedMask(s)], [1, 0, 1, 0]);
  assert.ok(blockedMask(s) instanceof Uint8Array);
});

test('frostForecast: 0 frosted, t>=1 arrival phase, -1 never (incl. WARDED)', () => {
  const s = createGameState(pathLevel(6)); // 0(F)-1-2-3-4-5
  applyAction(s, beacon(3));
  assert.deepEqual([...frostForecast(s)], [0, 1, 2, -1, -1, -1]);
  assert.ok(frostForecast(s) instanceof Int32Array);
});

test('frostForecast: respects severed edges, several sources, and the current turn', () => {
  const s = createGameState(pathLevel(7, { sources: [0, 6], k: 2 }));
  assert.deepEqual([...frostForecast(s)], [0, 1, 2, 3, 2, 1, 0]);
  applyAction(s, sever(1, 2));
  // road 1-2 severed: node 2 is only reachable from the right source, 6->5->4->3->2 = 4 hops
  assert.deepEqual([...frostForecast(s)], [0, 1, 4, 3, 2, 1, 0]);
  endWardenPhase(s); // frosts 1 and 5
  // now node 5 is frosted: 5->4->3->2 = 3 hops
  assert.deepEqual([...frostForecast(s)], [0, 0, 3, 2, 1, 0, 0]);
});

test('safeZones: components of CLEAR nodes, population and threatened flag', () => {
  // path 0(F)-1-2-3-4-5 ; ward 3 -> zones {1,2} (threatened) and {4,5} (cut off)
  const s = createGameState(pathLevel(6, { pops: [1, 2, 3, 4, 5, 6] }));
  applyAction(s, beacon(3));
  const zones = safeZones(s);
  assert.equal(zones.length, 2);
  assert.deepEqual(zones[0], { nodes: [1, 2], population: 5, threatened: true });
  assert.deepEqual(zones[1], { nodes: [4, 5], population: 11, threatened: false });
});

test('safeZones: a severed road creates a separate zone; no CLEAR nodes -> no zones', () => {
  const s = createGameState(pathLevel(5, { k: 2 }));
  applyAction(s, sever(2, 3));
  const zones = safeZones(s);
  assert.equal(zones.length, 2);
  assert.equal(zones[0].threatened, true);
  assert.equal(zones[1].threatened, false);
  const t = createGameState(pathLevel(2));
  endWardenPhase(t);
  assert.deepEqual(safeZones(t), []);
});

test('pure helpers do not mutate state', () => {
  const s = createGameState(pathLevel(6, { k: 2 }));
  applyAction(s, beacon(3));
  const snap = JSON.stringify({ ns: [...s.nodeState], e: s.graph.edges(), t: s.turn, a: s.actionsLeft });
  isContained(s); blockedMask(s); frostForecast(s); safeZones(s); evaluateOutcome(s);
  assert.equal(JSON.stringify({ ns: [...s.nodeState], e: s.graph.edges(), t: s.turn, a: s.actionsLeft }), snap);
});

test('determinism: same level and same actions give an identical log', () => {
  const run = () => {
    const s = createGameState(pathLevel(9, { k: 2 }));
    applyAction(s, beacon(5)); applyAction(s, sever(7, 8));
    while (!s.over) endWardenPhase(s);
    return JSON.stringify({ log: s.log, ns: [...s.nodeState] });
  };
  assert.equal(run(), run());
});
