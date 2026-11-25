// Shared test helpers: graph builders and slow-but-obviously-correct reference oracles.
// (Not a *.test.js file, so `node --test` does not run it directly.)
import { Graph } from '../src/core/index.js';
import { mulberry32 } from '../src/core/index.js';

export function fromEdges(n, edges) {
  const g = new Graph(n);
  for (const [u, v] of edges) g.addEdge(u, v);
  return g;
}
export const path = (n) => fromEdges(n, Array.from({ length: n - 1 }, (_, i) => [i, i + 1]));
export const cycle = (n) => fromEdges(n, Array.from({ length: n }, (_, i) => [i, (i + 1) % n]));
export const star = (n) => fromEdges(n, Array.from({ length: n - 1 }, (_, i) => [0, i + 1]));
export function grid(w, h) {
  const g = new Graph(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (x + 1 < w) g.addEdge(y * w + x, y * w + x + 1);
      if (y + 1 < h) g.addEdge(y * w + x, (y + 1) * w + x);
    }
  return g;
}

/** Random simple graph with n nodes and ~m edges (may be disconnected). */
export function randomGraph(n, m, rng) {
  const g = new Graph(n);
  let tries = 0;
  while (g.m < m && tries++ < m * 20) g.addEdge(Math.floor(rng() * n), Math.floor(rng() * n));
  return g;
}

/** Reference: number of components among unblocked nodes, optionally ignoring one node / one edge. */
export function refCountComponents(g, { blocked, skipNode = -1, skipEdge = null } = {}) {
  const seen = new Uint8Array(g.n);
  let count = 0;
  for (let s = 0; s < g.n; s++) {
    if (seen[s] || s === skipNode || (blocked && blocked[s])) continue;
    count++;
    const st = [s];
    seen[s] = 1;
    while (st.length) {
      const u = st.pop();
      for (const v of g.neighbors(u)) {
        if (seen[v] || v === skipNode || (blocked && blocked[v])) continue;
        if (skipEdge && ((u === skipEdge[0] && v === skipEdge[1]) || (u === skipEdge[1] && v === skipEdge[0]))) continue;
        seen[v] = 1;
        st.push(v);
      }
    }
  }
  return count;
}

/** Reference articulation points: v is one iff removing it increases the component count. */
export function refArticulationPoints(g, blocked) {
  const base = refCountComponents(g, { blocked });
  const pts = new Set();
  for (let v = 0; v < g.n; v++) {
    if (blocked && blocked[v]) continue;
    // removing v also removes its own (possibly singleton) component, so compare against
    // base minus 1 when v is isolated; an AP strictly increases components among the REST.
    const isolated = g.neighbors(v).every((w) => blocked && blocked[w]);
    const after = refCountComponents(g, { blocked, skipNode: v });
    const expected = isolated ? base - 1 : base;
    if (after > expected) pts.add(v);
  }
  return pts;
}

/** Reference bridges: edge is a bridge iff removing it increases the component count. */
export function refBridges(g, blocked) {
  const base = refCountComponents(g, { blocked });
  const out = [];
  for (const [u, v] of g.edges()) {
    if (blocked && (blocked[u] || blocked[v])) continue; // edges touching removed nodes do not exist
    if (refCountComponents(g, { blocked, skipEdge: [u, v] }) > base) out.push([u, v]);
  }
  return out;
}

export { mulberry32 };
