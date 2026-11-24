// bench/mockCore.js
// THROWAWAY stand-in for src/core until Member A's code lands. It follows the signatures of the
// contract (section 6) only so the benchmark harness can be built and debugged.
// Its results are MEANINGLESS for the report. Delete this file in the cleanup commit.

export const IS_MOCK = true; // the real core does not export this; run.js uses it to flag mock results

// ===== rng =====
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ===== graph =====
export class Graph {
  #n;
  #adj;
  #m = 0;
  constructor(n) {
    this.#n = n;
    this.#adj = Array.from({ length: n }, () => []);
  }
  get n() { return this.#n; }
  get m() { return this.#m; }
  addEdge(u, v) {
    if (u === v || this.hasEdge(u, v)) return false;
    this.#adj[u].push(v);
    this.#adj[v].push(u);
    this.#m++;
    return true;
  }
  removeEdge(u, v) {
    const i = this.#adj[u].indexOf(v);
    if (i < 0) return false;
    this.#adj[u].splice(i, 1);
    this.#adj[v].splice(this.#adj[v].indexOf(u), 1);
    this.#m--;
    return true;
  }
  hasEdge(u, v) {
    const a = this.#adj[u].length <= this.#adj[v].length ? this.#adj[u] : this.#adj[v];
    const x = a === this.#adj[u] ? v : u;
    return a.includes(x);
  }
  neighbors(u) { return this.#adj[u]; }
  degree(u) { return this.#adj[u].length; }
  edges() {
    const out = [];
    for (let u = 0; u < this.#n; u++) for (const v of this.#adj[u]) if (u < v) out.push([u, v]);
    return out;
  }
  clone() {
    const g = new Graph(this.#n);
    for (let u = 0; u < this.#n; u++) g.#adj[u] = this.#adj[u].slice();
    g.#m = this.#m;
    return g;
  }
}

// ===== bfs =====
export function bfsLayers(graph, sources, blocked) {
  const dist = new Int32Array(graph.n).fill(-1);
  const order = [];
  let frontier = [];
  for (const s of sources) {
    if (dist[s] === -1) { dist[s] = 0; frontier.push(s); order.push(s); }
  }
  const layers = [frontier];
  for (;;) {
    const next = [];
    for (const u of frontier) {
      for (const v of graph.neighbors(u)) {
        if (dist[v] !== -1 || (blocked && blocked[v])) continue;
        dist[v] = layers.length;
        next.push(v);
        order.push(v);
      }
    }
    if (next.length === 0) break;
    layers.push(next);
    frontier = next;
  }
  return { dist, order: Int32Array.from(order), layers };
}

// ===== components (iterative) =====
export function connectedComponents(graph, blocked) {
  const n = graph.n;
  const compId = new Int32Array(n).fill(-1);
  const sizes = [];
  const stack = new Int32Array(n);
  let count = 0;
  for (let r = 0; r < n; r++) {
    if (compId[r] !== -1 || (blocked && blocked[r])) continue;
    let sp = 0;
    stack[sp++] = r;
    compId[r] = count;
    let size = 0;
    while (sp > 0) {
      const u = stack[--sp];
      size++;
      for (const v of graph.neighbors(u)) {
        if (compId[v] !== -1 || (blocked && blocked[v])) continue;
        compId[v] = count;
        stack[sp++] = v;
      }
    }
    sizes.push(size);
    count++;
  }
  return { compId, count, sizes };
}

// ===== tarjan (iterative, even in the mock, so path graphs can be tested) =====
export function articulationPointsAndBridges(graph, blocked) {
  const n = graph.n;
  const disc = new Int32Array(n).fill(-1);
  const low = new Int32Array(n);
  const parent = new Int32Array(n).fill(-1);
  const it = new Int32Array(n);
  const stack = new Int32Array(n);
  const points = new Set();
  const bridges = [];
  let time = 0;
  for (let r = 0; r < n; r++) {
    if (disc[r] !== -1 || (blocked && blocked[r])) continue;
    let sp = 0;
    stack[sp++] = r;
    disc[r] = low[r] = time++;
    let rootChildren = 0;
    while (sp > 0) {
      const u = stack[sp - 1];
      const nb = graph.neighbors(u);
      if (it[u] < nb.length) {
        const v = nb[it[u]++];
        if (blocked && blocked[v]) continue;
        if (disc[v] === -1) {
          parent[v] = u;
          disc[v] = low[v] = time++;
          stack[sp++] = v;
          if (u === r) rootChildren++;
        } else if (v !== parent[u] && disc[v] < low[u]) {
          low[u] = disc[v];
        }
      } else {
        sp--;
        const p = parent[u];
        if (p !== -1) {
          if (low[u] < low[p]) low[p] = low[u];
          if (low[u] > disc[p]) bridges.push(p < u ? [p, u] : [u, p]);
          if (p !== r && low[u] >= disc[p]) points.add(p);
        }
      }
    }
    if (rootChildren > 1) points.add(r);
  }
  return { points, bridges };
}

// ===== level generation (simple) =====
export function generateLevel({ n, seed, k = 2, sources = 1, targetPercent = 60, avgDegree = 3.2 }) {
  const rng = mulberry32(seed);
  const nodes = [];
  for (let i = 0; i < n; i++) {
    nodes.push({ id: i, x: rng(), y: rng(), population: 1 + Math.floor(rng() * 9), isCitadel: false });
  }
  const citadel = Math.floor(rng() * n);
  nodes[citadel].isCitadel = true;
  const cand = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const dx = nodes[i].x - nodes[j].x;
      const dy = nodes[i].y - nodes[j].y;
      cand.push([dx * dx + dy * dy, i, j]);
    }
  }
  cand.sort((a, b) => a[0] - b[0]);
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const graph = new Graph(n);
  const rest = [];
  for (const c of cand) {
    const a = find(c[1]);
    const b = find(c[2]);
    if (a !== b) { parent[a] = b; graph.addEdge(c[1], c[2]); } else rest.push(c);
  }
  const target = Math.round((n * avgDegree) / 2);
  for (const c of rest) {
    if (graph.m >= target) break;
    graph.addEdge(c[1], c[2]);
  }
  const src = [];
  while (src.length < sources) {
    const s = Math.floor(rng() * n);
    if (s !== citadel && !src.includes(s)) src.push(s);
  }
  const totalPopulation = nodes.reduce((acc, v) => acc + v.population, 0);
  return { seed, n, k, targetPercent, sources: src, graph, nodes, totalPopulation };
}

// ===== levels =====
export const LEVEL_SPECS = [
  { id: 1, name: 'L1', n: 12, k: 1, sources: 1, targetPercent: 50, seed: 1001, avgDegree: 3.2 },
  { id: 2, name: 'L2', n: 16, k: 1, sources: 1, targetPercent: 55, seed: 1002, avgDegree: 3.2 },
  { id: 3, name: 'L3', n: 20, k: 2, sources: 1, targetPercent: 60, seed: 1003, avgDegree: 3.2 },
  { id: 4, name: 'L4', n: 25, k: 2, sources: 1, targetPercent: 60, seed: 1004, avgDegree: 3.2 },
  { id: 5, name: 'L5', n: 30, k: 2, sources: 2, targetPercent: 60, seed: 1005, avgDegree: 3.2 },
  { id: 6, name: 'L6', n: 40, k: 2, sources: 2, targetPercent: 65, seed: 1006, avgDegree: 3.2 },
  { id: 7, name: 'L7', n: 50, k: 2, sources: 2, targetPercent: 65, seed: 1007, avgDegree: 3.2 },
  { id: 8, name: 'L8', n: 60, k: 2, sources: 3, targetPercent: 65, seed: 1008, avgDegree: 3.2 },
];
export function buildLevel(id) {
  const s = LEVEL_SPECS.find((x) => x.id === id);
  return generateLevel(s);
}

// ===== simulation =====
export const NodeState = Object.freeze({ CLEAR: 0, FROSTED: 1, WARDED: 2 });

export function createGameState(level) {
  const nodeState = new Uint8Array(level.n);
  for (const s of level.sources) nodeState[s] = NodeState.FROSTED;
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

export function applyAction(state, action) {
  if (state.over) return { ok: false, reason: 'game over' };
  if (state.actionsLeft <= 0) return { ok: false, reason: 'no actions left' };
  if (action.type === 'beacon') {
    if (state.nodeState[action.node] !== NodeState.CLEAR) return { ok: false, reason: 'node not clear' };
    state.nodeState[action.node] = NodeState.WARDED;
  } else if (action.type === 'sever') {
    if (!state.graph.removeEdge(action.u, action.v)) return { ok: false, reason: 'no such edge' };
  } else {
    return { ok: false, reason: 'unknown action' };
  }
  state.actions.push(action);
  state.actionsLeft--;
  return { ok: true };
}

export function undoAction(state) {
  const a = state.actions.pop();
  if (!a) return false;
  if (a.type === 'beacon') state.nodeState[a.node] = NodeState.CLEAR;
  else state.graph.addEdge(a.u, a.v);
  state.actionsLeft++;
  return true;
}

export function blockedMask(state) {
  const m = new Uint8Array(state.nodeState.length);
  for (let i = 0; i < m.length; i++) m[i] = state.nodeState[i] !== NodeState.CLEAR ? 1 : 0;
  return m;
}

export function isContained(state) {
  const { nodeState, graph } = state;
  let anyClear = false;
  for (let u = 0; u < nodeState.length; u++) if (nodeState[u] === NodeState.CLEAR) { anyClear = true; break; }
  if (!anyClear) return true;
  for (let u = 0; u < nodeState.length; u++) {
    if (nodeState[u] !== NodeState.FROSTED) continue;
    for (const v of graph.neighbors(u)) if (nodeState[v] === NodeState.CLEAR) return false;
  }
  return true;
}

export function evaluateOutcome(state) {
  const { level, nodeState } = state;
  let saved = 0;
  for (let i = 0; i < level.n; i++) if (nodeState[i] !== NodeState.FROSTED) saved += level.nodes[i].population;
  const citadel = level.nodes.find((v) => v.isCitadel).id;
  const citadelSafe = nodeState[citadel] !== NodeState.FROSTED;
  const savedPercent = (saved / level.totalPopulation) * 100;
  const won = state.over && citadelSafe && savedPercent >= level.targetPercent;
  return {
    won,
    savedPopulation: saved,
    totalPopulation: level.totalPopulation,
    savedPercent,
    citadelSafe,
    stars: state.over ? (won ? 1 : 0) : 0,
    reference: state.over ? { greedySaved: saved, bestKnownSaved: saved } : null,
  };
}

export function endWardenPhase(state) {
  const { graph, nodeState } = state;
  const newly = [];
  for (let u = 0; u < nodeState.length; u++) {
    if (nodeState[u] !== NodeState.FROSTED) continue;
    for (const v of graph.neighbors(u)) {
      if (nodeState[v] === NodeState.CLEAR && !newly.includes(v)) newly.push(v);
    }
  }
  for (const v of newly) nodeState[v] = NodeState.FROSTED;
  state.log.push({ turn: state.turn, actions: state.actions.slice(), newlyFrosted: newly });
  state.actions = [];
  state.turn += 1;
  state.actionsLeft = state.level.k;
  const contained = isContained(state);
  if (contained) {
    state.over = true;
    state.outcome = evaluateOutcome(state);
  }
  return { newlyFrosted: newly, contained };
}

export function frostForecast(state) {
  const sources = [];
  for (let i = 0; i < state.nodeState.length; i++) if (state.nodeState[i] === NodeState.FROSTED) sources.push(i);
  const wardedMask = new Uint8Array(state.nodeState.length);
  for (let i = 0; i < wardedMask.length; i++) wardedMask[i] = state.nodeState[i] === NodeState.WARDED ? 1 : 0;
  return bfsLayers(state.graph, sources, wardedMask).dist;
}

export function safeZones(state) {
  const { compId, count } = connectedComponents(state.graph, blockedMask(state));
  const zones = Array.from({ length: count }, () => ({ nodes: [], population: 0, threatened: false }));
  for (let u = 0; u < compId.length; u++) {
    if (compId[u] < 0) continue;
    const z = zones[compId[u]];
    z.nodes.push(u);
    z.population += state.level.nodes[u].population;
    for (const v of state.graph.neighbors(u)) if (state.nodeState[v] === NodeState.FROSTED) z.threatened = true;
  }
  return zones;
}

// ===== strategies (mock heuristics; NOT the real ones) =====
const clearNodes = (state) => {
  const out = [];
  for (let i = 0; i < state.nodeState.length; i++) if (state.nodeState[i] === NodeState.CLEAR) out.push(i);
  return out;
};

export function randomStrategy(state, rng = Math.random) {
  const pool = clearNodes(state);
  const out = [];
  while (out.length < state.actionsLeft && pool.length > 0) {
    const i = Math.floor(rng() * pool.length);
    out.push({ type: 'beacon', node: pool.splice(i, 1)[0] });
  }
  return out;
}

export function maxDegreeStrategy(state) {
  const pool = clearNodes(state).sort((a, b) => state.graph.degree(b) - state.graph.degree(a) || a - b);
  return pool.slice(0, state.actionsLeft).map((node) => ({ type: 'beacon', node }));
}

export function articulationGreedyStrategy(state) {
  const n = state.nodeState.length;
  const frosted = [];
  const mask = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (state.nodeState[i] === NodeState.FROSTED) frosted.push(i);
    if (state.nodeState[i] === NodeState.WARDED) mask[i] = 1;
  }
  const pop = (i) => state.level.nodes[i].population;
  const out = [];
  for (let a = 0; a < state.actionsLeft; a++) {
    let best = -1;
    let bestScore = -Infinity;
    for (const c of clearNodes(state)) {
      if (mask[c]) continue;
      mask[c] = 1;
      const reached = bfsLayers(state.graph, frosted, mask).order;
      let lost = 0;
      for (const v of reached) lost += pop(v);
      mask[c] = 0;
      const score = -lost + state.graph.degree(c) * 1e-3;
      if (score > bestScore) { bestScore = score; best = c; }
    }
    if (best < 0) break;
    mask[best] = 1;
    out.push({ type: 'beacon', node: best });
  }
  return out;
}

export const STRATEGIES = [
  { id: 'random', label: 'Random', fn: randomStrategy },
  { id: 'maxDegree', label: 'Max-Degree', fn: maxDegreeStrategy },
  { id: 'articulationGreedy', label: 'Articulation-Aware Greedy', fn: articulationGreedyStrategy },
];

export function playOut(level, strategyFn, rng) {
  const r = rng ?? mulberry32(level.seed);
  const state = createGameState(level);
  const turns = [];
  let guard = level.n + 5;
  while (!state.over && guard-- > 0) {
    const acts = strategyFn(state, r);
    for (const a of acts) applyAction(state, a);
    const applied = state.actions.slice();
    const res = endWardenPhase(state);
    turns.push({ turn: state.turn - 1, actions: applied, newlyFrosted: res.newlyFrosted });
  }
  if (!state.over) { state.over = true; state.outcome = evaluateOutcome(state); }
  return { outcome: state.outcome, turns };
}

// ===== brute force (mock: beacons only, memoised DFS over beacon placements) =====
export function bruteForceOptimal(level, { maxNodes = 20, timeLimitMs = 10000 } = {}) {
  if (level.n > maxNodes) return null;
  const t0 = performance.now();
  const n = level.n;
  const g = level.graph;
  const k = level.k;
  const memo = new Map();
  let explored = 0;
  let truncated = false;

  const frostStep = (ns) => {
    const next = ns.slice();
    for (let u = 0; u < n; u++) {
      if (ns[u] !== 1) continue;
      for (const v of g.neighbors(u)) if (ns[v] === 0) next[v] = 1;
    }
    return next;
  };
  const contained = (ns) => {
    let anyClear = false;
    for (let u = 0; u < n; u++) if (ns[u] === 0) { anyClear = true; break; }
    if (!anyClear) return true;
    for (let u = 0; u < n; u++) if (ns[u] === 1) for (const v of g.neighbors(u)) if (ns[v] === 0) return false;
    return true;
  };
  const savedOf = (ns) => {
    let s = 0;
    for (let i = 0; i < n; i++) if (ns[i] !== 1) s += level.nodes[i].population;
    return s;
  };
  const combos = (pool, size) => {
    const res = [];
    const rec = (start, cur) => {
      if (cur.length === size) { res.push(cur.slice()); return; }
      for (let i = start; i < pool.length; i++) { cur.push(pool[i]); rec(i + 1, cur); cur.pop(); }
    };
    rec(0, []);
    return res;
  };

  const search = (ns) => {
    const key = ns.join('');
    const hit = memo.get(key);
    if (hit) return hit.value;
    explored++;
    if ((explored & 1023) === 0 && performance.now() - t0 > timeLimitMs) truncated = true;
    const pool = [];
    for (let i = 0; i < n; i++) if (ns[i] === 0) pool.push(i);
    if (truncated || pool.length === 0) return savedOf(ns);
    let bestValue = -1;
    let bestCombo = [];
    for (const c of combos(pool, Math.min(k, pool.length))) {
      const w = ns.slice();
      for (const v of c) w[v] = 2;
      const after = frostStep(w);
      const value = contained(after) ? savedOf(after) : search(after);
      if (value > bestValue) { bestValue = value; bestCombo = c; }
      if (truncated) break;
    }
    memo.set(key, { value: bestValue, combo: bestCombo });
    return bestValue;
  };

  const state = createGameState(level);
  search(state.nodeState.slice());
  const turns = [];
  let guard = n + 5;
  while (!state.over && guard-- > 0) {
    const hit = memo.get(state.nodeState.join(''));
    const acts = hit ? hit.combo.map((node) => ({ type: 'beacon', node })) : articulationGreedyStrategy(state);
    for (const a of acts) applyAction(state, a);
    const applied = state.actions.slice();
    const res = endWardenPhase(state);
    turns.push({ turn: state.turn - 1, actions: applied, newlyFrosted: res.newlyFrosted });
  }
  if (!state.over) { state.over = true; state.outcome = evaluateOutcome(state); }
  return { outcome: state.outcome, turns, truncated, elapsedMs: performance.now() - t0, explored };
}
