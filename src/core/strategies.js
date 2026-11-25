/**
 * Warden strategies, full-game playouts and the exact brute-force optimum.
 *
 * Every strategy has the signature (state, rng?) -> Action[], NEVER mutates `state`,
 * and returns at most `state.actionsLeft` BEACON actions.
 *
 * This module also registers the reference-score computation used by
 * `evaluateOutcome` (see reference.js for why it is registered, not imported).
 */
import { bfsLayers } from './bfs.js';
import { articulationPointsAndBridges } from './tarjan.js';
import { mulberry32 } from './rng.js';
import {
  NodeState,
  applyAction,
  blockedMask,
  createPlayoutState,
  endWardenPhase,
  evaluateOutcome,
} from './simulation.js';
import { setReferenceProvider } from './reference.js';

const { CLEAR, FROSTED } = NodeState;

/** Indices i with nodeState[i] === status. */
function nodesWith(nodeState, status) {
  const out = [];
  for (let i = 0; i < nodeState.length; i++) if (nodeState[i] === status) out.push(i);
  return out;
}

const beaconAt = (node) => ({ type: 'beacon', node });

// ===========================================================================
// Random
// ===========================================================================

/**
 * Baseline: beacons on uniformly random CLEAR nodes.
 * rng defaults to a fresh mulberry32(state.turn), so the strategy stays deterministic.
 * Time O(V + k) (partial Fisher-Yates).
 */
export function randomStrategy(state, rng) {
  const next = rng ?? mulberry32(state.turn);
  const pool = nodesWith(state.nodeState, CLEAR);
  const count = Math.min(state.actionsLeft, pool.length);
  const actions = [];
  for (let i = 0; i < count; i++) {
    const j = i + Math.floor(next() * (pool.length - i));
    [pool[i], pool[j]] = [pool[j], pool[i]];
    actions.push(beaconAt(pool[i]));
  }
  return actions;
}

// ===========================================================================
// Max-Degree
// ===========================================================================

/**
 * Baseline: beacons on the CLEAR nodes with the highest CURRENT degree
 * (edges that are already severed no longer count); ties go to the smaller id.
 * Time O(k * V): k linear scans, k is tiny.
 */
export function maxDegreeStrategy(state) {
  const { nodeState, graph } = state;
  const taken = new Uint8Array(nodeState.length);
  const actions = [];
  for (let a = 0; a < state.actionsLeft; a++) {
    let best = -1;
    let bestDeg = -1;
    for (let v = 0; v < nodeState.length; v++) {
      if (nodeState[v] !== CLEAR || taken[v]) continue;
      const d = graph.degree(v);
      if (d > bestDeg) {
        bestDeg = d;
        best = v;
      }
    }
    if (best === -1) break;
    taken[best] = 1;
    actions.push(beaconAt(best));
  }
  return actions;
}

// ===========================================================================
// Articulation-Aware Greedy (main strategy, also the in-game Hint)
// ===========================================================================

/**
 * Articulation-Aware Greedy. For every action of the turn:
 *  1. Candidates = articulation points of the graph restricted to CLEAR nodes
 *     (Tarjan) + all CLEAR nodes adjacent to FROSTED ones.
 *  2. Score each candidate v by the population SAVED if v were warded now:
 *     total - (frosted + still-reachable-by-frost), with reachability from a BFS
 *     started at the FROSTED nodes that may not enter FROSTED/WARDED nodes.
 *  3. Pick the best score; ties: nearer to the frost (smaller BFS distance, more
 *     urgent), then larger population, then smaller id.
 *  4. Add v to a tentative blocked mask and repeat for the next action.
 *
 * Only candidates that frost can still reach are considered: a beacon on a node the
 * frost can never reach changes nothing, and any reachable candidate scores strictly
 * higher (it saves at least its own population). If nothing is reachable the game is
 * effectively contained and no action is returned.
 *
 * Time per turn: O(k * |C| * (V + E)) with |C| the number of candidates
 * (one BFS per candidate; Tarjan adds O(V + E) per action). Never mutates `state`.
 */
export function articulationGreedyStrategy(state) {
  const { graph, level, nodeState } = state;
  const n = nodeState.length;
  const pop = level.nodes.map((x) => x.population);
  const total = level.totalPopulation;
  const frosted = nodesWith(nodeState, FROSTED);
  const blocked = blockedMask(state); // private copy: tentative wards are added here
  const actions = [];

  for (let a = 0; a < state.actionsLeft; a++) {
    // Distances from the frost under the current tentative walls (for reachability + urgency).
    const base = bfsLayers(graph, frosted, blocked).dist;

    // --- step 1: candidate set ---
    const candidates = new Set();
    const { points } = articulationPointsAndBridges(graph, blocked);
    for (const v of points) candidates.add(v);
    for (const u of frosted) for (const v of graph.neighbors(u)) if (blocked[v] === 0) candidates.add(v);
    if (candidates.size === 0) for (let v = 0; v < n; v++) if (blocked[v] === 0) candidates.add(v);

    // --- step 2-3: evaluate and pick ---
    let bestV = -1;
    let bestScore = -1;
    for (const v of candidates) {
      if (base[v] < 1) continue; // frost can never reach v: a beacon there is useless
      blocked[v] = 1; // tentatively ward v (restored right after the BFS)
      const { order } = bfsLayers(graph, frosted, blocked);
      blocked[v] = 0;
      // `order` = every FROSTED node (the BFS sources, dist 0) + every node the frost can still reach.
      let lost = 0;
      for (let i = 0; i < order.length; i++) lost += pop[order[i]];
      const score = total - lost; // population saved if v is warded now

      if (
        bestV === -1 ||
        score > bestScore ||
        (score === bestScore &&
          (base[v] < base[bestV] || (base[v] === base[bestV] && (pop[v] > pop[bestV] || (pop[v] === pop[bestV] && v < bestV)))))
      ) {
        bestV = v;
        bestScore = score;
      }
    }

    if (bestV === -1) break; // nothing left that the frost can reach
    blocked[bestV] = 1;
    actions.push(beaconAt(bestV));
  }
  return actions;
}

export const STRATEGIES = [
  { id: 'random', label: 'Random', fn: randomStrategy },
  { id: 'maxDegree', label: 'Max-Degree', fn: maxDegreeStrategy },
  { id: 'articulationGreedy', label: 'Articulation-Aware Greedy', fn: articulationGreedyStrategy },
];

// ===========================================================================
// playOut
// ===========================================================================

/**
 * Play a whole game on a FRESH state with `strategyFn`.
 *
 * Loop: strategy -> apply its actions -> endWardenPhase, until the game is over.
 * Termination: every frost phase that does not end the game frosts at least one node,
 * so at most n phases are needed; the turn cap n + 5 is a belt-and-braces guard.
 *
 * Reference scores: playOut runs on a "silent" state, so the returned outcome has
 * `reference: null` and stars of only 0 (lost) / 1 (won). This avoids infinite recursion
 * (reference computation itself uses playOut) and keeps benchmarks cheap. Use
 * `evaluateOutcome` on a live game state to get the full star rating.
 *
 * @param {object} level
 * @param {(state: object, rng?: () => number) => object[]} strategyFn
 * @param {() => number} [rng] defaults to mulberry32(level.seed)
 * @returns {{outcome: object, turns: {turn: number, actions: object[], newlyFrosted: number[]}[]}}
 */
export function playOut(level, strategyFn, rng) {
  const random = rng ?? mulberry32(level.seed);
  const state = createPlayoutState(level);
  const cap = level.n + 5;
  while (!state.over && state.turn <= cap) {
    for (const action of strategyFn(state, random)) {
      if (!applyAction(state, action).ok) break; // an illegal action ends this phase's actions
    }
    endWardenPhase(state);
  }
  return { outcome: state.outcome ?? evaluateOutcome(state), turns: state.log.slice() };
}

// ===========================================================================
// bruteForceOptimal
// ===========================================================================

const BF_MAX_SUPPORTED_NODES = 30; // node sets are 31-bit integers

/** Iterate the set bits of `mask` (ascending) as node ids. */
function bitsOf(mask) {
  const out = [];
  while (mask !== 0) {
    const low = mask & -mask;
    out.push(31 - Math.clz32(low));
    mask ^= low;
  }
  return out;
}

/** All size-r subsets of `items`, each returned as a bitmask. */
function combinationsAsMasks(items, r) {
  const out = [];
  const rec = (start, left, acc) => {
    if (left === 0) {
      out.push(acc);
      return;
    }
    for (let i = start; i <= items.length - left; i++) rec(i + 1, left - 1, acc | (1 << items[i]));
  };
  rec(0, r, 0);
  return out;
}

/**
 * Exact optimum over beacon placements (node protection only; no severs) for small levels.
 *
 * Model. A position is (F, R): F = set of FROSTED nodes, R = set of CLEAR nodes the frost can
 * still reach through CLEAR nodes. The future depends on nothing else (wards that no longer
 * border R are irrelevant), so (F, R) is the memoization key: many different beacon histories
 * collapse into one state. minLoss(F, R) = smallest population that will additionally be
 * frosted. Each turn exactly min(k, |R|) beacons are placed inside R (placing fewer is never
 * better: more walls can only shrink the frosted set), then one frost layer runs.
 *
 * Branch and bound. Children of a position are sorted by a valid lower bound and the scan stops
 * as soon as a bound cannot beat the best exact value found so far. Lower bound for a position:
 * at most k nodes of the next frost layer can be protected per turn, so at least the
 * (|layer| - k) lightest ones are lost.
 *
 * Time limit. The search aborts after `timeLimitMs`; the result is then the best of the
 * heuristic playouts (which seed the incumbent) with truncated = true. The result therefore
 * is never worse than any built-in strategy, even when truncated.
 *
 * Worst case exponential: roughly C(|R|, k)^turns, softened by memoization and pruning.
 *
 * @returns {null | {outcome: object, turns: object[], truncated: boolean, elapsedMs: number}}
 *   null when level.n > maxNodes (or > 30, the bitmask limit).
 */
export function bruteForceOptimal(level, { maxNodes = 20, timeLimitMs = 10000 } = {}) {
  const n = level.n;
  if (n > maxNodes || n > BF_MAX_SUPPORTED_NODES) return null;
  const t0 = performance.now();

  // ---- incumbent: best heuristic playout (guarantees "never worse than a heuristic") ----
  let incumbent = null;
  for (const { fn } of STRATEGIES) {
    const run = playOut(level, fn);
    if (incumbent === null || run.outcome.savedPopulation > incumbent.outcome.savedPopulation) incumbent = run;
  }

  // ---- bitmask model of the level ----
  const k = level.k;
  const pop = level.nodes.map((x) => x.population);
  const adj = new Array(n).fill(0);
  for (const [u, v] of level.graph.edges()) {
    adj[u] |= 1 << v;
    adj[v] |= 1 << u;
  }
  const popOf = (mask) => {
    let s = 0;
    for (const v of bitsOf(mask)) s += pop[v];
    return s;
  };
  const neighborsOf = (mask) => {
    let out = 0;
    for (const v of bitsOf(mask)) out |= adj[v];
    return out;
  };
  /** Nodes of `region` reachable from `seeds` (seeds included if in region) inside `region`. */
  const closure = (seeds, region) => {
    let seen = seeds & region;
    let frontier = seen;
    while (frontier !== 0) {
      const next = neighborsOf(frontier) & region & ~seen;
      seen |= next;
      frontier = next;
    }
    return seen;
  };
  /** Lower bound on the additional loss from a position with next frost layer `layer`. */
  const lowerBound = (layer) => {
    const pops = bitsOf(layer).map((v) => pop[v]).sort((a, b) => a - b);
    let s = 0;
    for (let i = 0; i < pops.length - k; i++) s += pops[i];
    return s;
  };
  const keyOf = (F, R) => (n <= 26 ? F * 67108864 + R : `${F},${R}`); // 2^26 = 67108864

  const memo = new Map(); // key -> { loss, combo }
  let aborted = false;
  let ticks = 0;

  /** Smallest additional frosted population from position (F, R). Exact unless aborted. */
  function minLoss(F, R) {
    if (R === 0) return 0;
    const size = bitsOf(R).length;
    if (size <= k) return 0; // ward everything the frost can reach
    const key = keyOf(F, R);
    const hit = memo.get(key);
    if (hit !== undefined) return hit.loss;
    if ((++ticks & 255) === 0 && performance.now() - t0 > timeLimitMs) aborted = true;
    if (aborted) return Infinity;

    const clearAfter = (C) => R & ~C;
    const children = [];
    for (const C of combinationsAsMasks(bitsOf(R), k)) {
      const open = clearAfter(C);
      const newly = neighborsOf(F) & open;
      const F2 = F | newly;
      const R2 = closure(neighborsOf(newly) & ~F2, open & ~newly);
      const layer = neighborsOf(F2) & R2;
      children.push({ C, newly, F2, R2, lb: popOf(newly) + lowerBound(layer) });
    }
    children.sort((a, b) => a.lb - b.lb);

    let best = Infinity;
    let bestCombo = 0;
    for (const ch of children) {
      if (ch.lb >= best) break; // sorted: no remaining child can improve
      const loss = popOf(ch.newly) + minLoss(ch.F2, ch.R2);
      if (aborted) return Infinity;
      if (loss < best) {
        best = loss;
        bestCombo = ch.C;
      }
    }
    memo.set(key, { loss: best, combo: bestCombo });
    return best;
  }

  // ---- run the search from the initial position ----
  let F0 = 0;
  for (const s of level.sources) F0 |= 1 << s;
  const all = (n === 31 ? 0x7fffffff : (1 << n) - 1);
  const R0 = closure(neighborsOf(F0) & ~F0, all & ~F0);
  const rootLoss = minLoss(F0, R0);
  const elapsedSearch = performance.now() - t0;

  if (aborted || !Number.isFinite(rootLoss)) {
    return { ...incumbent, truncated: true, elapsedMs: elapsedSearch };
  }

  // ---- reconstruct the optimal line by replaying it on a real (silent) game state ----
  const replay = createPlayoutState(level);
  let F = F0;
  let R = R0;
  while (!replay.over) {
    let combo = 0;
    if (R !== 0) {
      const size = bitsOf(R).length;
      combo = size <= k ? R : memo.get(keyOf(F, R)).combo;
    }
    for (const v of bitsOf(combo)) applyAction(replay, beaconAt(v));
    endWardenPhase(replay);
    // advance the abstract position the same way minLoss did
    const open = R & ~combo;
    const newly = neighborsOf(F) & open;
    F |= newly;
    R = closure(neighborsOf(newly) & ~F, open & ~newly);
  }
  const optimal = { outcome: replay.outcome, turns: replay.log.slice() };

  const best = optimal.outcome.savedPopulation >= incumbent.outcome.savedPopulation ? optimal : incumbent;
  return { ...best, truncated: false, elapsedMs: performance.now() - t0 };
}

// ===========================================================================
// Reference scores for star ratings (registered for evaluateOutcome)
// ===========================================================================

/** Time budget for the brute-force part of a reference computation (UI-friendly). */
const REFERENCE_BRUTE_FORCE_MS = 3000;

setReferenceProvider((level) => {
  let greedySaved = 0;
  let bestKnownSaved = 0;
  for (const { id, fn } of STRATEGIES) {
    const saved = playOut(level, fn).outcome.savedPopulation;
    if (id === 'articulationGreedy') greedySaved = saved;
    bestKnownSaved = Math.max(bestKnownSaved, saved);
  }
  if (level.n <= 20) {
    const optimum = bruteForceOptimal(level, { timeLimitMs: REFERENCE_BRUTE_FORCE_MS });
    if (optimum !== null) bestKnownSaved = Math.max(bestKnownSaved, optimum.outcome.savedPopulation);
  }
  return { greedySaved, bestKnownSaved };
});
