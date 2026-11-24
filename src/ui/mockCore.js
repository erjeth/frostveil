/**
 * @file mockCore.js
 * Temporary contract-compliant stand-in for `src/core/index.js` (Member B).
 *
 * Implements every export specified in Section 6 (THE CONTRACT) so the entire
 * Frostveil UI, all 8 campaign levels, Free Play, algorithmic overlays
 * (BFS Frost Forecast, iterative DFS Safe Zones, iterative Tarjan Critical
 * Articulation Points & Bridges), Hints, and Strategy Arena work before
 * Member A merges checkpoints CP1-CP3 into `main`.
 */

// ===== rng.js =====
/**
 * Deterministic 32-bit seeded PRNG returning floats in [0, 1).
 * @param {number} seed
 * @returns {() => number}
 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function nextRandom() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ===== graph.js =====
export class Graph {
  /**
   * @param {number} n Number of nodes (0 .. n-1)
   */
  constructor(n) {
    this._n = n;
    this._m = 0;
    /** @type {number[][]} */
    this._adj = Array.from({ length: n }, () => []);
  }

  get n() {
    return this._n;
  }

  get m() {
    return this._m;
  }

  addEdge(u, v) {
    if (u < 0 || v < 0 || u >= this._n || v >= this._n || u === v) {
      return false;
    }
    if (this._adj[u].includes(v)) {
      return false;
    }
    this._adj[u].push(v);
    this._adj[v].push(u);
    this._m += 1;
    return true;
  }

  removeEdge(u, v) {
    if (u < 0 || v < 0 || u >= this._n || v >= this._n || u === v) {
      return false;
    }
    const idxU = this._adj[u].indexOf(v);
    if (idxU === -1) {
      return false;
    }
    this._adj[u].splice(idxU, 1);
    const idxV = this._adj[v].indexOf(u);
    if (idxV !== -1) {
      this._adj[v].splice(idxV, 1);
    }
    this._m -= 1;
    return true;
  }

  hasEdge(u, v) {
    if (u < 0 || v < 0 || u >= this._n || v >= this._n) {
      return false;
    }
    return this._adj[u].includes(v);
  }

  neighbors(u) {
    return this._adj[u] || [];
  }

  degree(u) {
    return this._adj[u] ? this._adj[u].length : 0;
  }

  edges() {
    /** @type {[number, number][]} */
    const result = [];
    for (let u = 0; u < this._n; u++) {
      const nbrs = this._adj[u];
      for (let i = 0; i < nbrs.length; i++) {
        const v = nbrs[i];
        if (u < v) {
          result.push([u, v]);
        }
      }
    }
    return result;
  }

  clone() {
    const copy = new Graph(this._n);
    copy._m = this._m;
    for (let u = 0; u < this._n; u++) {
      copy._adj[u] = this._adj[u].slice();
    }
    return copy;
  }
}

// ===== bfs.js =====
/**
 * Multi-source BFS layer decomposition.
 * Sources are always visited at distance 0 even if marked in `blocked`.
 * @param {Graph} graph
 * @param {number[]} sources
 * @param {Uint8Array} [blocked]
 */
export function bfsLayers(graph, sources, blocked) {
  const n = graph.n;
  const dist = new Int32Array(n).fill(-1);
  const visitedOrder = [];
  /** @type {number[][]} */
  const layers = [];

  const dedupSources = [];
  for (let i = 0; i < sources.length; i++) {
    const s = sources[i];
    if (s >= 0 && s < n && dist[s] === -1) {
      dist[s] = 0;
      dedupSources.push(s);
      visitedOrder.push(s);
    }
  }

  if (dedupSources.length === 0) {
    return {
      dist,
      order: new Int32Array(0),
      layers
    };
  }

  layers.push(dedupSources);
  let currentLayer = dedupSources;

  while (currentLayer.length > 0) {
    const nextLayer = [];
    for (let i = 0; i < currentLayer.length; i++) {
      const u = currentLayer[i];
      const d = dist[u];
      const nbrs = graph.neighbors(u);
      for (let j = 0; j < nbrs.length; j++) {
        const v = nbrs[j];
        if (dist[v] !== -1) continue;
        if (blocked && blocked[v] === 1) continue;
        dist[v] = d + 1;
        nextLayer.push(v);
        visitedOrder.push(v);
      }
    }
    if (nextLayer.length > 0) {
      layers.push(nextLayer);
    }
    currentLayer = nextLayer;
  }

  return {
    dist,
    order: Int32Array.from(visitedOrder),
    layers
  };
}

// ===== components.js =====
/**
 * Iterative DFS connected components ignoring blocked nodes.
 * @param {Graph} graph
 * @param {Uint8Array} [blocked]
 */
export function connectedComponents(graph, blocked) {
  const n = graph.n;
  const compId = new Int32Array(n).fill(-1);
  const sizes = [];
  let count = 0;
  const stack = [];

  for (let start = 0; start < n; start++) {
    if (blocked && blocked[start] === 1) continue;
    if (compId[start] !== -1) continue;

    const cid = count++;
    let size = 0;
    compId[start] = cid;
    stack.push(start);

    while (stack.length > 0) {
      const u = stack.pop();
      size += 1;
      const nbrs = graph.neighbors(u);
      for (let i = 0; i < nbrs.length; i++) {
        const v = nbrs[i];
        if (blocked && blocked[v] === 1) continue;
        if (compId[v] === -1) {
          compId[v] = cid;
          stack.push(v);
        }
      }
    }
    sizes.push(size);
  }

  return { compId, count, sizes };
}

// ===== tarjan.js =====
/**
 * Iterative Tarjan's algorithm for articulation points and bridges.
 * Blocked nodes are treated as removed.
 * @param {Graph} graph
 * @param {Uint8Array} [blocked]
 */
export function articulationPointsAndBridges(graph, blocked) {
  const n = graph.n;
  const disc = new Int32Array(n).fill(-1);
  const low = new Int32Array(n).fill(-1);
  const parent = new Int32Array(n).fill(-1);
  const points = new Set();
  /** @type {[number, number][]} */
  const bridges = [];
  let timer = 0;

  for (let start = 0; start < n; start++) {
    if (blocked && blocked[start] === 1) continue;
    if (disc[start] !== -1) continue;

    let rootChildren = 0;
    disc[start] = low[start] = timer++;

    // Explicit stack frames: { u, idx }
    const stack = [{ u: start, idx: 0 }];

    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      const u = frame.u;
      const nbrs = graph.neighbors(u);

      if (frame.idx < nbrs.length) {
        const v = nbrs[frame.idx++];
        if (blocked && blocked[v] === 1) continue;

        if (disc[v] === -1) {
          parent[v] = u;
          if (u === start) {
            rootChildren += 1;
          }
          disc[v] = low[v] = timer++;
          stack.push({ u: v, idx: 0 });
        } else if (v !== parent[u]) {
          if (disc[v] < low[u]) {
            low[u] = disc[v];
          }
        }
      } else {
        stack.pop();
        if (stack.length > 0) {
          const p = stack[stack.length - 1].u;
          if (low[u] < low[p]) {
            low[p] = low[u];
          }
          if (p !== start && low[u] >= disc[p]) {
            points.add(p);
          }
          if (low[u] > disc[p]) {
            bridges.push(p < u ? [p, u] : [u, p]);
          }
        }
      }
    }

    if (rootChildren > 1) {
      points.add(start);
    }
  }

  return { points, bridges };
}

// ===== simulation.js =====
export const NodeState = Object.freeze({
  CLEAR: 0,
  FROSTED: 1,
  WARDED: 2
});

/**
 * Creates a fresh mutable game state from a Level object.
 * @param {object} level
 */
export function createGameState(level) {
  const nodeState = new Uint8Array(level.n);
  for (let i = 0; i < level.sources.length; i++) {
    const src = level.sources[i];
    if (src >= 0 && src < level.n) {
      nodeState[src] = NodeState.FROSTED;
    }
  }

  const state = {
    level,
    graph: level.graph.clone(),
    nodeState,
    turn: 1,
    actionsLeft: level.k,
    actions: [],
    over: false,
    outcome: null,
    log: []
  };

  if (isContained(state)) {
    state.over = true;
    state.outcome = evaluateOutcome(state);
  }

  return state;
}

/**
 * Applies a Warden action ('beacon' or 'sever') to the current state.
 * @param {object} state
 * @param {{ type: 'beacon', node: number } | { type: 'sever', u: number, v: number }} action
 * @returns {{ ok: boolean, reason?: string }}
 */
export function applyAction(state, action) {
  if (state.over) {
    return { ok: false, reason: 'Game is already over.' };
  }
  if (state.actionsLeft <= 0) {
    return { ok: false, reason: 'No actions left this turn. Press End Turn (E) or Undo (U).' };
  }
  if (!action || typeof action !== 'object') {
    return { ok: false, reason: 'Invalid action.' };
  }

  if (action.type === 'beacon') {
    const u = action.node;
    if (typeof u !== 'number' || u < 0 || u >= state.level.n) {
      return { ok: false, reason: 'Invalid settlement selected.' };
    }
    if (state.nodeState[u] === NodeState.FROSTED) {
      return { ok: false, reason: 'Cannot light a beacon on a frosted settlement!' };
    }
    if (state.nodeState[u] === NodeState.WARDED) {
      return { ok: false, reason: 'This settlement already has an active beacon.' };
    }
    state.nodeState[u] = NodeState.WARDED;
    state.actions.push({ type: 'beacon', node: u });
    state.actionsLeft -= 1;
    return { ok: true };
  }

  if (action.type === 'sever') {
    const u = Math.min(action.u, action.v);
    const v = Math.max(action.u, action.v);
    if (!state.graph.hasEdge(u, v)) {
      return { ok: false, reason: 'That road is already severed or does not exist.' };
    }
    state.graph.removeEdge(u, v);
    state.actions.push({ type: 'sever', u, v });
    state.actionsLeft -= 1;
    return { ok: true };
  }

  return { ok: false, reason: 'Unknown action type.' };
}

/**
 * Undoes the most recent action in the current Warden phase.
 * @param {object} state
 * @returns {boolean}
 */
export function undoAction(state) {
  if (state.over || state.actions.length === 0) {
    return false;
  }
  const last = state.actions.pop();
  if (last.type === 'beacon') {
    state.nodeState[last.node] = NodeState.CLEAR;
  } else if (last.type === 'sever') {
    state.graph.addEdge(last.u, last.v);
  }
  state.actionsLeft += 1;
  return true;
}

/**
 * Checks whether frost spread is completely contained (or no CLEAR nodes remain).
 * @param {object} state
 * @returns {boolean}
 */
export function isContained(state) {
  const n = state.level.n;
  let clearCount = 0;
  let canSpread = false;

  for (let u = 0; u < n; u++) {
    const st = state.nodeState[u];
    if (st === NodeState.CLEAR) {
      clearCount += 1;
    } else if (st === NodeState.FROSTED) {
      const nbrs = state.graph.neighbors(u);
      for (let i = 0; i < nbrs.length; i++) {
        if (state.nodeState[nbrs[i]] === NodeState.CLEAR) {
          canSpread = true;
          break;
        }
      }
    }
  }

  return clearCount === 0 || !canSpread;
}

/**
 * Returns a Uint8Array mask where 1 = FROSTED or WARDED, 0 = CLEAR.
 * @param {object} state
 * @returns {Uint8Array}
 */
export function blockedMask(state) {
  const n = state.level.n;
  const mask = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (state.nodeState[i] !== NodeState.CLEAR) {
      mask[i] = 1;
    }
  }
  return mask;
}

/**
 * Ends the Warden phase and advances frost by exactly ONE BFS layer.
 * @param {object} state
 * @returns {{ newlyFrosted: number[], contained: boolean }}
 */
export function endWardenPhase(state) {
  if (state.over) {
    return { newlyFrosted: [], contained: true };
  }

  const n = state.level.n;
  const newlyFrostedSet = new Set();

  for (let u = 0; u < n; u++) {
    if (state.nodeState[u] === NodeState.FROSTED) {
      const nbrs = state.graph.neighbors(u);
      for (let i = 0; i < nbrs.length; i++) {
        const v = nbrs[i];
        if (state.nodeState[v] === NodeState.CLEAR) {
          newlyFrostedSet.add(v);
        }
      }
    }
  }

  const newlyFrosted = Array.from(newlyFrostedSet);
  for (let i = 0; i < newlyFrosted.length; i++) {
    state.nodeState[newlyFrosted[i]] = NodeState.FROSTED;
  }

  state.log.push({
    turn: state.turn,
    actions: state.actions.slice(),
    newlyFrosted
  });

  state.actions = [];
  state.turn += 1;
  state.actionsLeft = state.level.k;

  const contained = isContained(state);
  if (contained) {
    state.over = true;
    state.outcome = evaluateOutcome(state);
  }

  return { newlyFrosted, contained };
}

/**
 * Computes the number of frost phases until each node is frosted if nothing changes.
 * 0 = already FROSTED, t >= 1 = frosted in t turns, -1 = never reached (including WARDED).
 * @param {object} state
 * @returns {Int32Array}
 */
export function frostForecast(state) {
  const n = state.level.n;
  const sources = [];
  const wardedMask = new Uint8Array(n);

  for (let i = 0; i < n; i++) {
    if (state.nodeState[i] === NodeState.FROSTED) {
      sources.push(i);
    } else if (state.nodeState[i] === NodeState.WARDED) {
      wardedMask[i] = 1;
    }
  }

  const { dist } = bfsLayers(state.graph, sources, wardedMask);
  return dist;
}

/**
 * Connected components of CLEAR nodes (FROSTED and WARDED act as walls).
 * @param {object} state
 * @returns {{ nodes: number[], population: number, threatened: boolean }[]}
 */
export function safeZones(state) {
  const mask = blockedMask(state);
  const { compId, count } = connectedComponents(state.graph, mask);
  /** @type {{ nodes: number[], population: number, threatened: boolean }[]} */
  const zones = Array.from({ length: count }, () => ({
    nodes: [],
    population: 0,
    threatened: false
  }));

  for (let u = 0; u < state.level.n; u++) {
    const cid = compId[u];
    if (cid === -1) continue;
    const zone = zones[cid];
    zone.nodes.push(u);
    zone.population += state.level.nodes[u].population;

    if (!zone.threatened) {
      const nbrs = state.graph.neighbors(u);
      for (let i = 0; i < nbrs.length; i++) {
        if (state.nodeState[nbrs[i]] === NodeState.FROSTED) {
          zone.threatened = true;
          break;
        }
      }
    }
  }

  return zones;
}

// Internal guard so reference calculation during evaluateOutcome doesn't recurse infinitely
let _computingReference = false;
const _referenceCache = new Map();

/**
 * Evaluates current or final outcome of a game state.
 * @param {object} state
 */
export function evaluateOutcome(state) {
  const level = state.level;
  let savedPopulation = 0;
  let citadelSafe = true;

  for (let i = 0; i < level.n; i++) {
    const node = level.nodes[i];
    const isFrosted = state.nodeState[i] === NodeState.FROSTED;
    if (!isFrosted) {
      savedPopulation += node.population;
    } else if (node.isCitadel) {
      citadelSafe = false;
    }
  }

  const totalPopulation = level.totalPopulation;
  const savedPercent = totalPopulation > 0
    ? Math.round((savedPopulation / totalPopulation) * 100)
    : 0;
  const won = citadelSafe && savedPercent >= level.targetPercent;

  let stars = 0;
  let reference = null;

  if (state.over && !_computingReference) {
    const cacheKey = `${level.seed}_${level.n}_${level.k}_${level.sources.length}`;
    if (_referenceCache.has(cacheKey)) {
      reference = _referenceCache.get(cacheKey);
    } else {
      _computingReference = true;
      try {
        const greedyRes = playOut(level, articulationGreedyStrategy);
        const maxDegRes = playOut(level, maxDegreeStrategy);
        const randRes = playOut(level, randomStrategy);
        const greedySaved = greedyRes.outcome.savedPopulation;
        let bestKnownSaved = Math.max(
          greedySaved,
          maxDegRes.outcome.savedPopulation,
          randRes.outcome.savedPopulation
        );
        if (level.n <= 20) {
          const opt = bruteForceOptimal(level, { maxNodes: 20, timeLimitMs: 120 });
          if (opt && opt.outcome) {
            bestKnownSaved = Math.max(bestKnownSaved, opt.outcome.savedPopulation);
          }
        }
        reference = { greedySaved, bestKnownSaved };
        _referenceCache.set(cacheKey, reference);
      } finally {
        _computingReference = false;
      }
    }

    if (won) {
      stars = 1;
      if (savedPopulation >= reference.greedySaved) {
        stars = 2;
      }
      if (savedPopulation >= Math.floor(0.95 * reference.bestKnownSaved)) {
        stars = 3;
      }
    }
  }

  return {
    won,
    savedPopulation,
    totalPopulation,
    savedPercent,
    citadelSafe,
    stars,
    reference
  };
}

// ===== levelGen.js =====
/**
 * Orientation test for segment intersection check so roads look planar and clean.
 */
function segmentsIntersect(a, b, c, d) {
  function ccw(p1, p2, p3) {
    return (p3.y - p1.y) * (p2.x - p1.x) > (p2.y - p1.y) * (p3.x - p1.x);
  }
  return ccw(a, c, d) !== ccw(b, c, d) && ccw(a, b, c) !== ccw(a, b, d);
}

/**
 * Generates a connected, deterministic level using mulberry32 and Kruskal MST.
 */
export function generateLevel({
  n,
  seed,
  k = 2,
  sources = 1,
  targetPercent = 60,
  avgDegree = 3.2
}) {
  const rng = mulberry32(seed);
  const nodes = [];
  const minDist = Math.max(0.055, Math.min(0.18, 0.72 / Math.sqrt(n)));

  for (let i = 0; i < n; i++) {
    let bestX = 0.5;
    let bestY = 0.5;
    let bestClearance = -1;

    for (let attempt = 0; attempt < 35; attempt++) {
      const cx = 0.06 + rng() * 0.88;
      const cy = 0.08 + rng() * 0.84;
      let nearest = Infinity;
      for (let j = 0; j < nodes.length; j++) {
        const dx = cx - nodes[j].x;
        const dy = cy - nodes[j].y;
        const d = Math.hypot(dx, dy);
        if (d < nearest) nearest = d;
      }
      if (nearest > bestClearance) {
        bestClearance = nearest;
        bestX = cx;
        bestY = cy;
      }
      if (nearest >= minDist) break;
    }

    const population = 2 + Math.floor(rng() * 7); // 2..8
    nodes.push({
      id: i,
      x: bestX,
      y: bestY,
      population,
      isCitadel: false
    });
  }

  // Pick node closest to center (0.5, 0.5) as the Citadel
  let citadelId = 0;
  let bestCenterDist = Infinity;
  for (let i = 0; i < n; i++) {
    const d = Math.hypot(nodes[i].x - 0.5, nodes[i].y - 0.5);
    if (d < bestCenterDist) {
      bestCenterDist = d;
      citadelId = i;
    }
  }
  nodes[citadelId].isCitadel = true;
  nodes[citadelId].population = 9;

  // Build all pairwise candidate edges sorted by Euclidean length
  const pairs = [];
  for (let u = 0; u < n; u++) {
    for (let v = u + 1; v < n; v++) {
      const dist = Math.hypot(nodes[u].x - nodes[v].x, nodes[u].y - nodes[v].y);
      pairs.push({ u, v, dist });
    }
  }
  pairs.sort((a, b) => a.dist - b.dist);

  // Kruskal's MST using Union-Find
  const parent = Int32Array.from({ length: n }, (_, i) => i);
  function find(x) {
    let root = x;
    while (parent[root] !== root) root = parent[root];
    let curr = x;
    while (curr !== root) {
      const nxt = parent[curr];
      parent[curr] = root;
      curr = nxt;
    }
    return root;
  }

  const graph = new Graph(n);
  const chosenSegments = [];

  for (let i = 0; i < pairs.length; i++) {
    const { u, v } = pairs[i];
    const ru = find(u);
    const rv = find(v);
    if (ru !== rv) {
      parent[ru] = rv;
      graph.addEdge(u, v);
      chosenSegments.push([u, v]);
      if (graph.m === n - 1) break;
    }
  }

  // Add extra short non-crossing edges to reach avgDegree
  const targetEdges = Math.min(
    Math.floor((n * (n - 1)) / 2),
    Math.max(n - 1, Math.round((n * avgDegree) / 2))
  );

  for (let i = 0; i < pairs.length && graph.m < targetEdges; i++) {
    const { u, v } = pairs[i];
    if (graph.hasEdge(u, v)) continue;
    if (graph.degree(u) >= 6 || graph.degree(v) >= 6) continue;

    // Avoid crossing existing roads for clean visual readability
    let crosses = false;
    const pU = nodes[u];
    const pV = nodes[v];
    for (let j = 0; j < chosenSegments.length; j++) {
      const [eu, ev] = chosenSegments[j];
      if (eu === u || eu === v || ev === u || ev === v) continue;
      if (segmentsIntersect(pU, pV, nodes[eu], nodes[ev])) {
        crosses = true;
        break;
      }
    }
    if (!crosses) {
      graph.addEdge(u, v);
      chosenSegments.push([u, v]);
    }
  }

  // Choose `sources` frost origins farthest from the Citadel and well spread apart
  const { dist: citadelDist } = bfsLayers(graph, [citadelId]);
  const candidates = [];
  for (let i = 0; i < n; i++) {
    if (i === citadelId) continue;
    candidates.push({
      id: i,
      hopDist: citadelDist[i],
      euclid: Math.hypot(nodes[i].x - nodes[citadelId].x, nodes[i].y - nodes[citadelId].y)
    });
  }
  candidates.sort((a, b) => (b.hopDist - a.hopDist) || (b.euclid - a.euclid));

  const chosenSources = [];
  for (let i = 0; i < candidates.length && chosenSources.length < sources; i++) {
    const cand = candidates[i].id;
    let farEnough = true;
    for (let j = 0; j < chosenSources.length; j++) {
      const prev = chosenSources[j];
      const d = Math.hypot(nodes[cand].x - nodes[prev].x, nodes[cand].y - nodes[prev].y);
      if (d < 0.28 && candidates.length - i > sources - chosenSources.length) {
        farEnough = false;
        break;
      }
    }
    if (farEnough) {
      chosenSources.push(cand);
    }
  }

  let totalPopulation = 0;
  for (let i = 0; i < n; i++) {
    totalPopulation += nodes[i].population;
  }

  return {
    seed,
    n,
    k,
    targetPercent,
    sources: chosenSources,
    graph,
    nodes,
    totalPopulation
  };
}

// ===== levels.js =====
export const LEVEL_SPECS = [
  { id: 1, name: 'Outpost of Dawn', n: 12, k: 1, sources: 1, targetPercent: 50, seed: 1001, avgDegree: 3.2 },
  { id: 2, name: 'Whispering Pines', n: 16, k: 1, sources: 1, targetPercent: 55, seed: 1002, avgDegree: 3.2 },
  { id: 3, name: 'Twin Passes', n: 20, k: 2, sources: 1, targetPercent: 60, seed: 1003, avgDegree: 3.2 },
  { id: 4, name: 'Shivering Vale', n: 25, k: 2, sources: 1, targetPercent: 60, seed: 1004, avgDegree: 3.2 },
  { id: 5, name: 'Crossroads of Rime', n: 30, k: 2, sources: 2, targetPercent: 60, seed: 1005, avgDegree: 3.2 },
  { id: 6, name: 'Glacier Reach', n: 40, k: 2, sources: 2, targetPercent: 65, seed: 1006, avgDegree: 3.2 },
  { id: 7, name: 'Stormwatch Expanse', n: 50, k: 2, sources: 2, targetPercent: 65, seed: 1007, avgDegree: 3.2 },
  { id: 8, name: 'The Eternal Frostveil', n: 60, k: 2, sources: 3, targetPercent: 65, seed: 1008, avgDegree: 3.2 }
];

/**
 * Builds one of the 8 campaign levels by id (1..8).
 * @param {number} id
 */
export function buildLevel(id) {
  const spec = LEVEL_SPECS.find((s) => s.id === Number(id)) || LEVEL_SPECS[0];
  const level = generateLevel(spec);
  level.id = spec.id;
  level.name = spec.name;
  return level;
}

// ===== strategies.js =====
/**
 * Random Baseline Strategy: picks up to `state.actionsLeft` random CLEAR nodes for beacons.
 */
export function randomStrategy(state, rng = mulberry32(state.level.seed + state.turn * 97)) {
  if (state.over || state.actionsLeft <= 0) return [];
  const clearNodes = [];
  for (let i = 0; i < state.level.n; i++) {
    if (state.nodeState[i] === NodeState.CLEAR) {
      clearNodes.push(i);
    }
  }
  // Fisher-Yates partial shuffle
  const count = Math.min(state.actionsLeft, clearNodes.length);
  const actions = [];
  for (let i = 0; i < count; i++) {
    const pickIdx = i + Math.floor(rng() * (clearNodes.length - i));
    const tmp = clearNodes[i];
    clearNodes[i] = clearNodes[pickIdx];
    clearNodes[pickIdx] = tmp;
    actions.push({ type: 'beacon', node: clearNodes[i] });
  }
  return actions;
}

/**
 * Max-Degree Greedy Strategy: wards reachable CLEAR nodes with highest active degree
 * weighted by proximity to advancing frost.
 */
export function maxDegreeStrategy(state) {
  if (state.over || state.actionsLeft <= 0) return [];
  const eta = frostForecast(state);
  const candidates = [];

  for (let u = 0; u < state.level.n; u++) {
    if (state.nodeState[u] !== NodeState.CLEAR) continue;
    if (eta[u] <= 0) continue; // unreachable or already frosted
    let clearNbrs = 0;
    const nbrs = state.graph.neighbors(u);
    for (let i = 0; i < nbrs.length; i++) {
      if (state.nodeState[nbrs[i]] === NodeState.CLEAR) clearNbrs += 1;
    }
    candidates.push({
      node: u,
      eta: eta[u],
      deg: clearNbrs,
      pop: state.level.nodes[u].population,
      isCitadel: state.level.nodes[u].isCitadel ? 1 : 0
    });
  }

  candidates.sort((a, b) => {
    // Prioritize immediate front (eta 1..2), then degree, then population
    const frontA = a.eta <= 2 ? 1 : 0;
    const frontB = b.eta <= 2 ? 1 : 0;
    if (frontA !== frontB) return frontB - frontA;
    if (b.deg !== a.deg) return b.deg - a.deg;
    return b.pop - a.pop;
  });

  const actions = [];
  const limit = Math.min(state.actionsLeft, candidates.length);
  for (let i = 0; i < limit; i++) {
    actions.push({ type: 'beacon', node: candidates[i].node });
  }
  return actions;
}

/**
 * Articulation-Aware Greedy Strategy (also powers the in-game Hint system).
 * Uses BFS frost forecast, Tarjan articulation points, and downstream population threat
 * to pick up to `state.actionsLeft` high-impact beacon placements without mutating `state`.
 */
export function articulationGreedyStrategy(state) {
  if (state.over || state.actionsLeft <= 0) return [];

  const n = state.level.n;
  const simNodeState = state.nodeState.slice();
  const actions = [];

  for (let step = 0; step < state.actionsLeft; step++) {
    // Build temporary view for current step
    const tempState = {
      level: state.level,
      graph: state.graph,
      nodeState: simNodeState
    };
    const eta = frostForecast(tempState);
    const mask = blockedMask(tempState);
    const { points: artPoints } = articulationPointsAndBridges(state.graph, mask);

    let bestNode = -1;
    let bestScore = -Infinity;

    for (let u = 0; u < n; u++) {
      if (simNodeState[u] !== NodeState.CLEAR) continue;
      const d = eta[u];
      if (d <= 0) continue; // unreachable by frost

      const nodeObj = state.level.nodes[u];
      // Simulate warding node u and measure how many nodes become unreachable (-1) or delayed
      simNodeState[u] = NodeState.WARDED;
      const afterEta = frostForecast(tempState);
      simNodeState[u] = NodeState.CLEAR;

      let savedPopGain = nodeObj.population;
      let delayedPopGain = 0;
      let citadelProtectedBonus = 0;

      for (let v = 0; v < n; v++) {
        if (v === u || simNodeState[v] !== NodeState.CLEAR) continue;
        if (eta[v] > 0) {
          const vp = state.level.nodes[v].population;
          if (afterEta[v] === -1) {
            savedPopGain += vp;
            if (state.level.nodes[v].isCitadel) {
              citadelProtectedBonus += 180;
            }
          } else if (afterEta[v] > eta[v]) {
            delayedPopGain += vp * Math.min(3, afterEta[v] - eta[v]);
            if (state.level.nodes[v].isCitadel) {
              citadelProtectedBonus += 65;
            }
          }
        }
      }

      if (nodeObj.isCitadel && d === 1) {
        citadelProtectedBonus += 250;
      }

      const urgencyWeight = d === 1 ? 1.55 : d === 2 ? 1.2 : 1.0 / Math.sqrt(d);
      const artBonus = artPoints.has(u) ? 14 : 0;

      const score =
        savedPopGain * 10 * urgencyWeight +
        delayedPopGain * 2.5 +
        artBonus +
        citadelProtectedBonus;

      if (score > bestScore) {
        bestScore = score;
        bestNode = u;
      }
    }

    if (bestNode === -1) break;
    simNodeState[bestNode] = NodeState.WARDED;
    actions.push({ type: 'beacon', node: bestNode });
  }

  return actions;
}

export const STRATEGIES = [
  { id: 'random', label: 'Random Baseline', fn: randomStrategy },
  { id: 'maxDegree', label: 'Max-Degree Greedy', fn: maxDegreeStrategy },
  { id: 'articulationGreedy', label: 'Articulation-Aware Greedy', fn: articulationGreedyStrategy }
];

/**
 * Plays a full game on a fresh state using `strategyFn`.
 * @param {object} level
 * @param {Function} strategyFn
 * @param {() => number} [rng]
 */
export function playOut(level, strategyFn, rng = mulberry32(level.seed)) {
  const state = createGameState(level);
  let safetyCounter = 0;

  while (!state.over && safetyCounter < level.n + 10) {
    safetyCounter += 1;
    const suggested = strategyFn(state, rng) || [];
    for (let i = 0; i < suggested.length && state.actionsLeft > 0; i++) {
      applyAction(state, suggested[i]);
    }
    endWardenPhase(state);
  }

  const outcome = evaluateOutcome(state);
  return {
    outcome,
    turns: state.log
  };
}

/**
 * Branch-and-bound / bounded depth search for small levels (n <= maxNodes).
 * Returns null when level.n > maxNodes.
 */
export function bruteForceOptimal(level, { maxNodes = 20, timeLimitMs = 10000 } = {}) {
  if (level.n > maxNodes) {
    return null;
  }

  const startTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
  let truncated = false;

  // Baseline from Articulation-Aware Greedy
  const greedyRun = playOut(level, articulationGreedyStrategy);
  let bestSaved = greedyRun.outcome.savedPopulation;
  let bestTurns = greedyRun.turns;
  let bestOutcome = greedyRun.outcome;

  function search(state) {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (now - startTime >= timeLimitMs) {
      truncated = true;
      return;
    }

    if (state.over) {
      const out = evaluateOutcome(state);
      if (
        (out.citadelSafe && !bestOutcome.citadelSafe) ||
        (out.citadelSafe === bestOutcome.citadelSafe && out.savedPopulation > bestSaved)
      ) {
        bestSaved = out.savedPopulation;
        bestOutcome = out;
        bestTurns = state.log.map((entry) => ({
          turn: entry.turn,
          actions: entry.actions.slice(),
          newlyFrosted: entry.newlyFrosted.slice()
        }));
      }
      return;
    }

    // Upper bound pruning: currently non-frosted population cannot increase
    let currentUnfrostedPop = 0;
    for (let i = 0; i < level.n; i++) {
      if (state.nodeState[i] !== NodeState.FROSTED) {
        currentUnfrostedPop += level.nodes[i].population;
      } else if (level.nodes[i].isCitadel && bestOutcome.citadelSafe) {
        return;
      }
    }
    if (bestOutcome.citadelSafe && currentUnfrostedPop <= bestSaved) {
      return;
    }

    // Candidate nodes on or near the frost frontier (eta 1 or 2)
    const eta = frostForecast(state);
    const frontier = [];
    for (let u = 0; u < level.n; u++) {
      if (state.nodeState[u] === NodeState.CLEAR && (eta[u] === 1 || eta[u] === 2)) {
        frontier.push(u);
      }
    }
    frontier.sort((a, b) => (eta[a] - eta[b]) || (level.nodes[b].population - level.nodes[a].population));
    const topCandidates = frontier.slice(0, Math.min(6, frontier.length));

    if (topCandidates.length === 0 || state.actionsLeft === 0) {
      const next = cloneStateForSearch(state);
      endWardenPhase(next);
      search(next);
      return;
    }

    if (state.actionsLeft === 1 || topCandidates.length === 1) {
      for (let i = 0; i < topCandidates.length; i++) {
        const next = cloneStateForSearch(state);
        applyAction(next, { type: 'beacon', node: topCandidates[i] });
        endWardenPhase(next);
        search(next);
        if (truncated) return;
      }
    } else {
      // Pick pairs for k=2
      for (let i = 0; i < topCandidates.length; i++) {
        for (let j = i + 1; j < topCandidates.length; j++) {
          const next = cloneStateForSearch(state);
          applyAction(next, { type: 'beacon', node: topCandidates[i] });
          applyAction(next, { type: 'beacon', node: topCandidates[j] });
          endWardenPhase(next);
          search(next);
          if (truncated) return;
        }
      }
    }
  }

  function cloneStateForSearch(st) {
    return {
      level: st.level,
      graph: st.graph.clone(),
      nodeState: st.nodeState.slice(),
      turn: st.turn,
      actionsLeft: st.actionsLeft,
      actions: st.actions.slice(),
      over: st.over,
      outcome: st.outcome,
      log: st.log.slice()
    };
  }

  const rootState = createGameState(level);
  search(rootState);

  const elapsedMs = Math.max(
    1,
    Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - startTime)
  );

  return {
    outcome: bestOutcome,
    turns: bestTurns,
    truncated,
    elapsedMs
  };
}
