/**
 * Deterministic procedural level generator.
 *
 * Pipeline (all randomness from one seeded mulberry32 stream, drawn in a fixed order):
 *  1. Points      Mitchell's best-candidate sampling in [0,1]^2 (well spread, "Poisson-disc-like"),
 *                 accelerated by a uniform grid.                       ~ O(n * C) expected
 *  2. Candidates  K-nearest-neighbour pairs per point (grid ring search). ~ O(n * K) expected
 *  3. MST         Kruskal + union-find over candidate edges sorted by length: O(E log E).
 *                 If the candidate graph is disconnected, K is doubled and the step repeated
 *                 (terminates: K = n-1 gives the complete graph).
 *  4. Extra roads Shortest remaining candidates that are GABRIEL edges (empty circle on the
 *                 segment as diameter). The Gabriel graph is planar and contains the Euclidean
 *                 MST, so these roads cannot cross the MST or each other. If the Gabriel
 *                 candidates run out before the target degree is reached, further short
 *                 candidates are added only if they cross no existing road (exact check, n <= 2000).
 *  5. Populations 1..9, then frost sources (spread out) and the Citadel (far, not always the farthest).
 */
import { Graph } from './graph.js';
import { mulberry32 } from './rng.js';
import { bfsLayers } from './bfs.js';

const BEST_CANDIDATES = 10; // candidate points tried per placed point
const KNN = 10; // initial neighbours per point for candidate roads
const CROSSING_CHECK_MAX_N = 2000; // exact crossing test is brute force: only for moderate n
const FAR_FRACTION = 0.35; // citadel / extra sources are drawn from the farthest 35 % of nodes

// ---------------------------------------------------------------------------
// Uniform grid for nearest-neighbour style queries on points in [0,1]^2
// ---------------------------------------------------------------------------
class SpatialGrid {
  /** @param {number} n expected number of points  @param {Float64Array} xs @param {Float64Array} ys */
  constructor(n, xs, ys) {
    this.size = Math.max(1, Math.ceil(Math.sqrt(n / 2))); // ~2 points per cell
    this.cell = 1 / this.size;
    this.xs = xs;
    this.ys = ys;
    this.cells = Array.from({ length: this.size * this.size }, () => []);
  }

  _c(t) {
    return Math.min(this.size - 1, Math.max(0, Math.floor(t * this.size)));
  }

  insert(i) {
    this.cells[this._c(this.ys[i]) * this.size + this._c(this.xs[i])].push(i);
  }

  /** Squared distance from (x, y) to the nearest inserted point (Infinity if none). */
  nearestDist2(x, y) {
    const { size, cell, cells, xs, ys } = this;
    const cx = this._c(x);
    const cy = this._c(y);
    let best = Infinity;
    for (let r = 0; r <= size; r++) {
      for (let dy = -r; dy <= r; dy++) {
        const gy = cy + dy;
        if (gy < 0 || gy >= size) continue;
        const step = dy === -r || dy === r ? 1 : 2 * r || 1; // full row on the ring edge, else only both ends
        for (let dx = -r; dx <= r; dx += step) {
          const gx = cx + dx;
          if (gx < 0 || gx >= size) continue;
          const list = cells[gy * size + gx];
          for (let k = 0; k < list.length; k++) {
            const j = list[k];
            const d = (xs[j] - x) ** 2 + (ys[j] - y) ** 2;
            if (d < best) best = d;
          }
        }
      }
      // Anything not yet examined lies in ring r+1 or beyond: at distance >= r * cell.
      if (best <= (r * cell) ** 2) break;
    }
    return best;
  }

  /** The K nearest inserted points to point i (excluding i), ascending by distance then id. */
  kNearest(i, K) {
    const { size, cell, cells, xs, ys } = this;
    const x = xs[i];
    const y = ys[i];
    const cx = this._c(x);
    const cy = this._c(y);
    const best = []; // sorted ascending [d2, j]
    for (let r = 0; r <= size; r++) {
      for (let dy = -r; dy <= r; dy++) {
        const gy = cy + dy;
        if (gy < 0 || gy >= size) continue;
        const step = dy === -r || dy === r ? 1 : 2 * r || 1;
        for (let dx = -r; dx <= r; dx += step) {
          const gx = cx + dx;
          if (gx < 0 || gx >= size) continue;
          const list = cells[gy * size + gx];
          for (let k = 0; k < list.length; k++) {
            const j = list[k];
            if (j === i) continue;
            const d = (xs[j] - x) ** 2 + (ys[j] - y) ** 2;
            if (best.length === K && (d > best[K - 1][0] || (d === best[K - 1][0] && j > best[K - 1][1]))) continue;
            let p = best.length;
            while (p > 0 && (best[p - 1][0] > d || (best[p - 1][0] === d && best[p - 1][1] > j))) p--;
            best.splice(p, 0, [d, j]);
            if (best.length > K) best.pop();
          }
        }
      }
      if (best.length === K && best[K - 1][0] <= (r * cell) ** 2) break;
    }
    return best.map((e) => e[1]);
  }

  /** True if some inserted point other than a or b lies strictly inside the disk (cx, cy, rad). */
  anyInDisk(cx, cy, rad2, a, b) {
    const { size, cells, xs, ys } = this;
    const rad = Math.sqrt(rad2);
    const x0 = this._c(cx - rad);
    const x1 = this._c(cx + rad);
    const y0 = this._c(cy - rad);
    const y1 = this._c(cy + rad);
    for (let gy = y0; gy <= y1; gy++) {
      for (let gx = x0; gx <= x1; gx++) {
        const list = cells[gy * size + gx];
        for (let k = 0; k < list.length; k++) {
          const j = list[k];
          if (j === a || j === b) continue;
          if ((xs[j] - cx) ** 2 + (ys[j] - cy) ** 2 < rad2 - 1e-12) return true;
        }
      }
    }
    return false;
  }
}

// ---------------------------------------------------------------------------
// Union-find (disjoint sets): path halving + union by size, ~O(alpha(n)) per op
// ---------------------------------------------------------------------------
class UnionFind {
  constructor(n) {
    this.parent = Int32Array.from({ length: n }, (_, i) => i);
    this.size = new Int32Array(n).fill(1);
    this.sets = n;
  }

  find(a) {
    const p = this.parent;
    while (p[a] !== a) {
      p[a] = p[p[a]];
      a = p[a];
    }
    return a;
  }

  union(a, b) {
    let ra = this.find(a);
    let rb = this.find(b);
    if (ra === rb) return false;
    if (this.size[ra] < this.size[rb]) [ra, rb] = [rb, ra];
    this.parent[rb] = ra;
    this.size[ra] += this.size[rb];
    this.sets--;
    return true;
  }
}

// ---------------------------------------------------------------------------
// Geometry helper: do segments (a,b) and (c,d) properly cross? (shared endpoints do not count)
// ---------------------------------------------------------------------------
function segmentsCross(xs, ys, a, b, c, d) {
  if (a === c || a === d || b === c || b === d) return false;
  const orient = (p, q, r) => (xs[q] - xs[p]) * (ys[r] - ys[p]) - (ys[q] - ys[p]) * (xs[r] - xs[p]);
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  return o1 * o2 < 0 && o3 * o4 < 0;
}

// ---------------------------------------------------------------------------
// Generation steps
// ---------------------------------------------------------------------------

/** Step 1: best-candidate sampling. Returns {xs, ys, grid}. */
function samplePoints(n, rng) {
  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  const grid = new SpatialGrid(n, xs, ys);
  for (let i = 0; i < n; i++) {
    let bx = rng();
    let by = rng();
    if (i > 0) {
      let bestD = grid.nearestDist2(bx, by);
      for (let c = 1; c < BEST_CANDIDATES; c++) {
        const x = rng();
        const y = rng();
        const d = grid.nearestDist2(x, y);
        if (d > bestD) {
          bestD = d;
          bx = x;
          by = y;
        }
      }
    }
    xs[i] = bx;
    ys[i] = by;
    grid.insert(i);
  }
  return { xs, ys, grid };
}

/**
 * Steps 2-3: candidate edges + Kruskal MST.
 * @returns {{eu: Int32Array, ev: Int32Array, order: Int32Array, inMst: Uint8Array}}
 *   candidate edge arrays, indices sorted by (length, u, v), and the MST membership flags.
 */
function candidatesAndMst(n, xs, ys, grid) {
  let K = Math.min(n - 1, KNN);
  for (;;) {
    // --- candidate edges: kNN pairs, deduplicated ---
    const seen = new Set();
    const us = [];
    const vs = [];
    for (let i = 0; i < n; i++) {
      for (const j of grid.kNearest(i, K)) {
        const u = i < j ? i : j;
        const v = i < j ? j : i;
        const key = u * n + v;
        if (seen.has(key)) continue;
        seen.add(key);
        us.push(u);
        vs.push(v);
      }
    }
    const m = us.length;
    const eu = Int32Array.from(us);
    const ev = Int32Array.from(vs);
    const len2 = new Float64Array(m);
    for (let e = 0; e < m; e++) len2[e] = (xs[eu[e]] - xs[ev[e]]) ** 2 + (ys[eu[e]] - ys[ev[e]]) ** 2;
    const order = Int32Array.from({ length: m }, (_, e) => e).sort(
      (a, b) => len2[a] - len2[b] || eu[a] - eu[b] || ev[a] - ev[b],
    );

    // --- Kruskal: scan edges by increasing length, keep those joining two different trees ---
    const uf = new UnionFind(n);
    const inMst = new Uint8Array(m);
    for (let t = 0; t < m && uf.sets > 1; t++) {
      const e = order[t];
      if (uf.union(eu[e], ev[e])) inMst[e] = 1;
    }
    if (uf.sets === 1) return { eu, ev, order, inMst };
    K = Math.min(n - 1, K * 2); // disconnected candidate graph: widen the neighbourhood and retry
  }
}

/** Steps 3b-4: assemble the Graph = MST + extra short, non-crossing roads up to the target degree. */
function buildRoads(n, avgDegree, xs, ys, grid, cand) {
  const { eu, ev, order, inMst } = cand;
  const graph = new Graph(n);
  const acceptedU = [];
  const acceptedV = [];
  const accept = (u, v) => {
    graph.addEdge(u, v);
    acceptedU.push(u);
    acceptedV.push(v);
  };

  for (let t = 0; t < order.length; t++) {
    const e = order[t];
    if (inMst[e]) accept(eu[e], ev[e]);
  }

  const maxEdges = (n * (n - 1)) / 2;
  const target = Math.min(maxEdges, Math.max(n - 1, Math.round((avgDegree * n) / 2)));
  const exactCheck = n <= CROSSING_CHECK_MAX_N;

  // Pass 1: Gabriel edges, shortest first (planar => no crossing check needed).
  for (let t = 0; t < order.length && graph.m < target; t++) {
    const e = order[t];
    if (inMst[e]) continue;
    const u = eu[e];
    const v = ev[e];
    const mx = (xs[u] + xs[v]) / 2;
    const my = (ys[u] + ys[v]) / 2;
    const rad2 = ((xs[u] - xs[v]) ** 2 + (ys[u] - ys[v]) ** 2) / 4;
    if (!grid.anyInDisk(mx, my, rad2, u, v)) accept(u, v);
  }

  // Pass 2 (only for high target degrees): other short candidates that cross no existing road.
  if (graph.m < target && exactCheck) {
    for (let t = 0; t < order.length && graph.m < target; t++) {
      const e = order[t];
      const u = eu[e];
      const v = ev[e];
      if (graph.hasEdge(u, v)) continue;
      let crosses = false;
      for (let q = 0; q < acceptedU.length && !crosses; q++) crosses = segmentsCross(xs, ys, u, v, acceptedU[q], acceptedV[q]);
      if (!crosses) accept(u, v);
    }
  }
  return graph;
}

/** Pick an index from `sortedFarFirst` among the farthest FAR_FRACTION share, uniformly. */
function pickFar(sortedFarFirst, rng) {
  const pool = Math.max(1, Math.ceil(sortedFarFirst.length * FAR_FRACTION));
  return sortedFarFirst[Math.floor(rng() * pool)];
}

/** Non-source nodes sorted by decreasing hop distance from `sources` (ties: smaller id first). */
function farthestFirst(graph, sources) {
  const { dist } = bfsLayers(graph, sources);
  const isSource = new Uint8Array(graph.n);
  for (const s of sources) isSource[s] = 1;
  const nodes = [];
  for (let v = 0; v < graph.n; v++) if (!isSource[v]) nodes.push(v);
  nodes.sort((a, b) => dist[b] - dist[a] || a - b);
  return nodes;
}

/**
 * Generate a connected level, deterministically from `seed`.
 *
 * @param {{n: number, seed: number, k?: number, sources?: number, targetPercent?: number, avgDegree?: number}} opts
 * @returns {{seed: number, n: number, k: number, targetPercent: number, sources: number[],
 *   graph: Graph, nodes: {id: number, x: number, y: number, population: number, isCitadel: boolean}[],
 *   totalPopulation: number}}
 */
export function generateLevel({ n, seed, k = 2, sources = 1, targetPercent = 60, avgDegree = 3.2 } = {}) {
  if (!Number.isInteger(n) || n < 2) throw new RangeError(`generateLevel: n must be an integer >= 2 (got ${n})`);
  if (!Number.isInteger(sources) || sources < 1 || sources > n - 1) {
    throw new RangeError(`generateLevel: sources must be an integer in 1..n-1 (got ${sources})`);
  }
  if (!Number.isInteger(k) || k < 1) throw new RangeError(`generateLevel: k must be an integer >= 1 (got ${k})`);

  const rng = mulberry32(seed);

  // 1-4: geometry and roads
  const { xs, ys, grid } = samplePoints(n, rng);
  const cand = candidatesAndMst(n, xs, ys, grid);
  const graph = buildRoads(n, avgDegree, xs, ys, grid, cand);

  // 5a: populations (integers 1..9)
  const population = new Int32Array(n);
  let totalPopulation = 0;
  for (let i = 0; i < n; i++) {
    population[i] = 1 + Math.floor(rng() * 9);
    totalPopulation += population[i];
  }

  // 5b: frost sources, spread out: the first is uniform, each further one is drawn
  //     from the farthest 35 % of nodes (by hop distance) from the sources chosen so far.
  const sourceIds = [Math.floor(rng() * n)];
  while (sourceIds.length < sources) sourceIds.push(pickFar(farthestFirst(graph, sourceIds), rng));

  // 5c: Citadel: far from every source, but drawn from the farthest 35 % rather than always the farthest.
  const citadel = pickFar(farthestFirst(graph, sourceIds), rng);

  const nodes = Array.from({ length: n }, (_, id) => ({
    id,
    x: xs[id],
    y: ys[id],
    population: population[id],
    isCitadel: id === citadel,
  }));

  return { seed, n, k, targetPercent, sources: sourceIds, graph, nodes, totalPopulation };
}
