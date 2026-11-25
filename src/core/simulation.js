/**
 * Frostveil game simulation (the Firefighter-Problem variant).
 *
 * A turn = Warden phase (up to `k` actions: light a beacon / sever a road)
 * followed by exactly ONE BFS layer of frost spread (`endWardenPhase`).
 *
 * Functions mutate `state` only where documented
 * (applyAction, undoAction, endWardenPhase); everything else is pure.
 */
import { bfsLayers } from './bfs.js';
import { connectedComponents } from './components.js';
import { getReference } from './reference.js';

export const NodeState = Object.freeze({ CLEAR: 0, FROSTED: 1, WARDED: 2 });

const { CLEAR, FROSTED, WARDED } = NodeState;

/**
 * States created by `createPlayoutState` never compute reference scores.
 * strategies.js uses them for playOut / brute force, which prevents the
 * recursion "game over -> reference -> playOut -> game over -> reference ...".
 * @type {WeakSet<object>}
 */
const silentStates = new WeakSet();

/**
 * @typedef {{type: 'beacon', node: number} | {type: 'sever', u: number, v: number}} Action
 */

/** Create a fresh game state for `level` (the level itself is never mutated). */
export function createGameState(level) {
  const nodeState = new Uint8Array(level.n);
  for (const s of level.sources) nodeState[s] = FROSTED;
  return {
    level,
    graph: level.graph.clone(),
    nodeState,
    turn: 1,
    actionsLeft: level.k,
    actions: [],
    over: false,
    outcome: null,
    log: [],
  };
}

/**
 * INTERNAL (not part of the public contract, not re-exported by index.js).
 * Same as createGameState, but the state never triggers the (expensive)
 * reference computation when the game ends. Its outcome has `reference: null`
 * and stars limited to 0 (lost) / 1 (won).
 */
export function createPlayoutState(level) {
  const state = createGameState(level);
  silentStates.add(state);
  return state;
}

/**
 * Apply one Warden action. Mutates `state`.
 * @param {object} state
 * @param {Action} action
 * @returns {{ok: boolean, reason?: string}}
 */
export function applyAction(state, action) {
  if (state.over) return { ok: false, reason: 'The game is over.' };
  if (state.actionsLeft <= 0) return { ok: false, reason: 'No actions left this turn.' };
  if (action === null || typeof action !== 'object') return { ok: false, reason: 'Invalid action.' };

  const n = state.level.n;
  if (action.type === 'beacon') {
    const v = action.node;
    if (!Number.isInteger(v) || v < 0 || v >= n) return { ok: false, reason: 'No such settlement.' };
    const st = state.nodeState[v];
    if (st === FROSTED) return { ok: false, reason: 'That settlement is already frosted.' };
    if (st === WARDED) return { ok: false, reason: 'That settlement already has a beacon.' };
    state.nodeState[v] = WARDED;
    state.actions.push({ type: 'beacon', node: v });
  } else if (action.type === 'sever') {
    const { u, v } = action;
    if (!state.graph.removeEdge(u, v)) return { ok: false, reason: 'There is no road between those settlements.' };
    state.actions.push({ type: 'sever', u, v });
  } else {
    return { ok: false, reason: 'Unknown action type.' };
  }
  state.actionsLeft--;
  return { ok: true };
}

/**
 * Undo the most recent action of the CURRENT Warden phase (restores the beacon
 * or the severed edge, and `actionsLeft`). Mutates `state`.
 * Actions of completed turns cannot be undone.
 * @returns {boolean} false if there was nothing to undo
 */
export function undoAction(state) {
  if (state.over || state.actions.length === 0) return false;
  const a = state.actions.pop();
  if (a.type === 'beacon') state.nodeState[a.node] = CLEAR;
  else state.graph.addEdge(a.u, a.v);
  state.actionsLeft++;
  return true;
}

/** Indices of all nodes currently in `status`. */
function nodesWith(nodeState, status) {
  const out = [];
  for (let i = 0; i < nodeState.length; i++) if (nodeState[i] === status) out.push(i);
  return out;
}

/**
 * 1 where the node is FROSTED or WARDED (cannot be entered by frost).
 * @returns {Uint8Array}
 */
export function blockedMask(state) {
  const ns = state.nodeState;
  const mask = new Uint8Array(ns.length);
  for (let i = 0; i < ns.length; i++) mask[i] = ns[i] !== CLEAR ? 1 : 0;
  return mask;
}

/**
 * Containment test: true iff no FROSTED node has a CLEAR neighbor along a
 * remaining edge. (This also covers "no CLEAR node is left": with no CLEAR
 * node there is no CLEAR neighbor either.)
 * Time O(V + E), early exit on the first threatened edge.
 */
export function isContained(state) {
  const ns = state.nodeState;
  const g = state.graph;
  for (let u = 0; u < ns.length; u++) {
    if (ns[u] !== FROSTED) continue;
    const nb = g.neighbors(u);
    for (let i = 0; i < nb.length; i++) if (ns[nb[i]] === CLEAR) return false;
  }
  return true;
}

/**
 * End the Warden phase and run ONE frost layer (one BFS layer).
 * Mutates `state`: marks nodes FROSTED, appends to `log`, `turn += 1`,
 * resets `actionsLeft`, clears `actions`, then checks for game over.
 *
 * Frost layer = layer 1 of a BFS started at all FROSTED nodes that may only
 * enter CLEAR nodes over remaining edges (FROSTED + WARDED are blocked).
 *
 * @returns {{newlyFrosted: number[], contained: boolean}}
 *   newlyFrosted is sorted ascending (independent of undo/removal history).
 */
export function endWardenPhase(state) {
  if (state.over) return { newlyFrosted: [], contained: isContained(state) };

  const { layers } = bfsLayers(state.graph, nodesWith(state.nodeState, FROSTED), blockedMask(state));
  const newlyFrosted = layers.length > 1 ? layers[1].slice().sort((a, b) => a - b) : [];
  for (const v of newlyFrosted) state.nodeState[v] = FROSTED;

  state.log.push({ turn: state.turn, actions: state.actions, newlyFrosted });
  state.turn += 1;
  state.actionsLeft = state.level.k;
  state.actions = [];

  const contained = isContained(state);
  if (contained) {
    state.over = true;
    state.outcome = evaluateOutcome(state);
  }
  return { newlyFrosted, contained };
}

/**
 * Frost arrival times if nothing changes: BFS from all FROSTED nodes with
 * WARDED nodes blocked.
 * @returns {Int32Array} eta[v]: 0 = already frosted; t >= 1 = frosted during the
 *   t-th frost phase from now (1 = end of the current turn); -1 = never (incl. WARDED).
 */
export function frostForecast(state) {
  const ns = state.nodeState;
  const walls = new Uint8Array(ns.length);
  for (let i = 0; i < ns.length; i++) walls[i] = ns[i] === WARDED ? 1 : 0;
  return bfsLayers(state.graph, nodesWith(ns, FROSTED), walls).dist;
}

/**
 * Safe zones: connected components of CLEAR nodes (FROSTED and WARDED nodes
 * and severed edges act as walls). Zones are ordered by their smallest node
 * id; `nodes` is ascending.
 * `threatened` = some node of the zone is adjacent to a FROSTED node.
 * @returns {{nodes: number[], population: number, threatened: boolean}[]}
 */
export function safeZones(state) {
  const { level, graph, nodeState } = state;
  const { compId, count } = connectedComponents(graph, blockedMask(state));
  const zones = Array.from({ length: count }, () => ({ nodes: [], population: 0, threatened: false }));
  for (let v = 0; v < nodeState.length; v++) {
    const c = compId[v];
    if (c === -1) continue;
    const zone = zones[c];
    zone.nodes.push(v);
    zone.population += level.nodes[v].population;
    if (!zone.threatened) {
      const nb = graph.neighbors(v);
      for (let i = 0; i < nb.length; i++) {
        if (nodeState[nb[i]] === FROSTED) {
          zone.threatened = true;
          break;
        }
      }
    }
  }
  return zones;
}

/**
 * @typedef {{won: boolean, savedPopulation: number, totalPopulation: number,
 *   savedPercent: number, citadelSafe: boolean, stars: number,
 *   reference: {greedySaved: number, bestKnownSaved: number} | null}} Outcome
 */

/**
 * Score the game. Callable at any time.
 *  - Running game: current saved population; won=false, stars=0, reference=null.
 *  - Finished game: won = citadel not frosted AND savedPercent >= targetPercent.
 *    Stars: 0 lost; 1 won; 2 won and saved >= greedySaved;
 *    3 won and saved >= 95% of bestKnownSaved (highest satisfied tier wins).
 *    Reference scores come from reference.js (lazy, cached per level).
 *    If no reference is available (strategies not loaded, or a playout state),
 *    stars are 0 or 1 and `reference` is null.
 * @returns {Outcome}
 */
export function evaluateOutcome(state) {
  const { level, nodeState } = state;
  let savedPopulation = 0;
  for (let i = 0; i < nodeState.length; i++) {
    if (nodeState[i] !== FROSTED) savedPopulation += level.nodes[i].population;
  }
  const totalPopulation = level.totalPopulation;
  const savedPercent = totalPopulation > 0 ? (100 * savedPopulation) / totalPopulation : 100;

  let citadelSafe = true;
  for (let i = 0; i < level.n; i++) {
    if (level.nodes[i].isCitadel) {
      citadelSafe = nodeState[i] !== FROSTED;
      break;
    }
  }

  if (!state.over) {
    return { won: false, savedPopulation, totalPopulation, savedPercent, citadelSafe, stars: 0, reference: null };
  }

  // Integer cross-multiplication avoids floating-point rounding at the threshold.
  const won = citadelSafe && savedPopulation * 100 >= level.targetPercent * totalPopulation;
  const reference = silentStates.has(state) ? null : getReference(level);

  let stars = 0;
  if (won) {
    stars = 1;
    if (reference !== null) {
      if (savedPopulation >= reference.greedySaved) stars = 2;
      if (savedPopulation * 100 >= 95 * reference.bestKnownSaved) stars = 3;
    }
  }
  return { won, savedPopulation, totalPopulation, savedPercent, citadelSafe, stars, reference };
}
