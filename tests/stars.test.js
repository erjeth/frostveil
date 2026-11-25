// Star tiers, tested with a FAKE reference provider. This file imports simulation.js and
// reference.js directly (not index.js) so the real strategies provider is never registered here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameState, applyAction, endWardenPhase } from '../src/core/simulation.js';
import { setReferenceProvider } from '../src/core/reference.js';
import { pathLevel } from './helpers.js';

// Level: path of 20 nodes, pop 1 each, source 0, k=1. Warding node w saves 20-w nodes... (w..19) => saved = 20 - w.
function playWard(level, w) {
  const s = createGameState(level);
  applyAction(s, { type: 'beacon', node: w });
  while (!s.over) endWardenPhase(s);
  return s.outcome;
}

test('stars: no reference available -> stars are 0 (lost) or 1 (won), reference null', () => {
  setReferenceProvider(null);
  const lvl = () => pathLevel(20, { targetPercent: 50 });
  const win = playWard(lvl(), 3); // saved 17/20
  assert.equal(win.won, true);
  assert.equal(win.stars, 1);
  assert.equal(win.reference, null);
  const lose = playWard(lvl(), 15); // saved 5/20
  assert.equal(lose.won, false);
  assert.equal(lose.stars, 0);
});

test('stars: 1 / 2 / 3 tiers from greedySaved and bestKnownSaved; lost stays 0', () => {
  // greedy saved 17, best known 19 (95% of 19 = 18.05 -> need >= 19)
  setReferenceProvider(() => ({ greedySaved: 17, bestKnownSaved: 19 }));
  const lvl = () => pathLevel(20, { targetPercent: 50 });
  assert.equal(playWard(lvl(), 5).stars, 1, 'saved 15 < greedy 17');
  assert.equal(playWard(lvl(), 3).stars, 2, 'saved 17 >= greedy 17');
  assert.equal(playWard(lvl(), 2).stars, 2, 'saved 18: 95% of 19 is 18.05, so not 3 stars yet');
  const best = playWard(lvl(), 1); // saved 19
  assert.equal(best.stars, 3);
  assert.deepEqual(best.reference, { greedySaved: 17, bestKnownSaved: 19 });
  assert.equal(playWard(lvl(), 15).stars, 0, 'lost game: 0 stars regardless of references');
});

test('stars: reference is computed once per level object (cached) and only when the game is over', () => {
  let calls = 0;
  setReferenceProvider(() => { calls++; return { greedySaved: 1, bestKnownSaved: 1 }; });
  const level = pathLevel(10, { targetPercent: 10 });
  const s1 = createGameState(level);
  assert.equal(calls, 0, 'not computed at creation');
  applyAction(s1, { type: 'beacon', node: 3 });
  while (!s1.over) endWardenPhase(s1);
  assert.equal(calls, 1);
  const s2 = createGameState(level);
  applyAction(s2, { type: 'beacon', node: 4 });
  while (!s2.over) endWardenPhase(s2);
  assert.equal(calls, 1, 'second game on the same level object reuses the cache');
  const other = pathLevel(10, { targetPercent: 10 });
  const s3 = createGameState(other);
  applyAction(s3, { type: 'beacon', node: 4 });
  while (!s3.over) endWardenPhase(s3);
  assert.equal(calls, 2, 'a different level object gets its own entry');
});

test('stars: 95% rule uses exact integer arithmetic', () => {
  setReferenceProvider(() => ({ greedySaved: 100, bestKnownSaved: 100 }));
  // path of 100 nodes, ward node w saves 100 - w. saved 95 -> exactly 95% -> 3 stars; 94 -> 2 stars? (94 < greedy 100 -> 1 star)
  const lvl = () => pathLevel(100, { targetPercent: 10 });
  assert.equal(playWard(lvl(), 5).stars, 3);
  assert.equal(playWard(lvl(), 6).stars, 1);
});
