import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LEVEL_SPECS, buildLevel, STRATEGIES, playOut, randomStrategy, articulationGreedyStrategy, bruteForceOptimal,
  createGameState, applyAction, endWardenPhase, evaluateOutcome,
} from '../src/core/index.js';

/** Level 2 is the documented exception: greedy loses it, only the exact optimum wins (n <= 20). */
const GREEDY_LOSES = new Set([2]);

test('every campaign level (1-8) is winnable by at least one strategy (brute force counts for n <= 20)', () => {
  for (const spec of LEVEL_SPECS) {
    const level = buildLevel(spec.id);
    const winners = STRATEGIES.filter(({ fn }) => playOut(level, fn).outcome.won).map((s) => s.id);
    if (level.n <= 20 && bruteForceOptimal(level).outcome.won) winners.push('bruteForce');
    assert.ok(winners.length > 0, `level ${spec.id} (${spec.name}) cannot be won by any strategy`);
  }
});

test('Articulation-Aware Greedy wins every level except the documented exception (level 2)', () => {
  for (const spec of LEVEL_SPECS) {
    const won = playOut(buildLevel(spec.id), articulationGreedyStrategy).outcome.won;
    assert.equal(won, !GREEDY_LOSES.has(spec.id), `level ${spec.id}: greedy won = ${won}`);
  }
});

test('levels are not trivially winnable: the default Random playout loses every level', () => {
  for (const spec of LEVEL_SPECS) {
    const level = buildLevel(spec.id);
    assert.equal(playOut(level, randomStrategy).outcome.won, false, `level ${spec.id}`);
  }
});

test('for n <= 20, brute force is at least as good as every strategy on every campaign level', () => {
  for (const spec of LEVEL_SPECS.filter((s) => s.n <= 20)) {
    const level = buildLevel(spec.id);
    const bf = bruteForceOptimal(level);
    for (const { id, fn } of STRATEGIES) assert.ok(bf.outcome.savedPopulation >= playOut(level, fn).outcome.savedPopulation, `${id} on level ${spec.id}`);
  }
});

// ---------------------------------------------------------------------------
// End-to-end star ratings on live states, with the REAL reference scores
// ---------------------------------------------------------------------------

/** Play a full game on a live (non-silent) state, using a list of per-turn action lists. */
function playScript(level, turns) {
  const s = createGameState(level);
  for (let t = 0; !s.over; t++) {
    for (const a of turns[t] ?? []) assert.equal(applyAction(s, a).ok, true);
    endWardenPhase(s);
  }
  return s;
}
const scriptOf = (turns) => turns.map((t) => t.actions);

function playLive(level, strategyFn) {
  const s = createGameState(level);
  while (!s.over) {
    for (const a of strategyFn(s)) applyAction(s, a);
    endWardenPhase(s);
  }
  return s;
}

test('real stars, level 3: greedy matches the optimum -> 3 stars; reference is filled and cached per level', () => {
  const level = buildLevel(3);
  const s = playLive(level, articulationGreedyStrategy);
  const o = s.outcome;
  assert.equal(o.won, true);
  assert.ok(o.reference);
  assert.equal(o.reference.greedySaved, playOut(level, articulationGreedyStrategy).outcome.savedPopulation);
  assert.equal(o.reference.bestKnownSaved, bruteForceOptimal(level).outcome.savedPopulation);
  assert.equal(o.stars, 3);
  // cached: a second finished game on the SAME level object gets the identical reference object
  const again = playLive(level, articulationGreedyStrategy).outcome;
  assert.equal(again.reference, o.reference);
  assert.equal(evaluateOutcome(s).reference, o.reference);
});

test('real stars, level 1: greedy -> 2 stars (equals greedy, < 95% of optimum); replaying the optimum -> 3 stars', () => {
  const level = buildLevel(1);
  const greedy = playLive(level, articulationGreedyStrategy).outcome;
  const best = bruteForceOptimal(level);
  assert.ok(best.outcome.savedPopulation * 0.95 > greedy.savedPopulation, 'precondition: greedy is clearly below the optimum here');
  assert.equal(greedy.won, true);
  assert.equal(greedy.stars, 2);
  const optimal = playScript(level, scriptOf(best.turns)).outcome;
  assert.equal(optimal.savedPopulation, best.outcome.savedPopulation);
  assert.equal(optimal.stars, 3);
});

test('real stars, level 2: greedy loses (0 stars); replaying the optimum wins with 3 stars', () => {
  const level = buildLevel(2);
  assert.equal(playLive(level, articulationGreedyStrategy).outcome.stars, 0);
  const best = bruteForceOptimal(level);
  const o = playScript(level, scriptOf(best.turns)).outcome;
  assert.equal(o.won, true);
  assert.equal(o.stars, 3);
});

test('real stars: a win that saves less than greedy gets exactly 1 star', () => {
  const level = buildLevel(3);
  const ref = playLive(level, articulationGreedyStrategy).outcome.reference;
  // Max-Degree wins level 3 with 59 < greedy 83
  const md = playLive(level, STRATEGIES[1].fn).outcome;
  assert.equal(md.won, true);
  assert.ok(md.savedPopulation < ref.greedySaved);
  assert.equal(md.stars, 1);
});

test('reference scores are consistent on all levels: bestKnown >= greedy and >= every strategy', () => {
  for (const spec of LEVEL_SPECS) {
    const level = buildLevel(spec.id);
    const ref = playLive(level, articulationGreedyStrategy).outcome.reference;
    assert.ok(ref.bestKnownSaved >= ref.greedySaved, `level ${spec.id}`);
    for (const { fn } of STRATEGIES) assert.ok(ref.bestKnownSaved >= playOut(level, fn).outcome.savedPopulation, `level ${spec.id}`);
    assert.equal(ref.greedySaved, playOut(level, articulationGreedyStrategy).outcome.savedPopulation);
  }
});

test('running games never trigger the reference computation (reference is null until the game is over)', () => {
  const level = buildLevel(8);
  const s = createGameState(level);
  assert.equal(evaluateOutcome(s).reference, null);
  applyAction(s, articulationGreedyStrategy(s)[0]);
  assert.equal(evaluateOutcome(s).reference, null);
  assert.equal(s.outcome, null);
});
