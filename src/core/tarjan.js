/**
 * Articulation points and bridges (Tarjan / Hopcroft-Tarjan low-link),
 * implemented ITERATIVELY with an explicit stack.
 *
 * Definitions, with disc[v] = DFS discovery time and
 * low[v] = smallest disc reachable from the subtree of v using tree edges
 * downwards and at most one back edge:
 *  - tree edge (p, c) is a BRIDGE            iff low[c] >  disc[p]
 *  - non-root p is an ARTICULATION POINT     iff some child c has low[c] >= disc[p]
 *  - a DFS root is an ARTICULATION POINT     iff it has >= 2 DFS children
 *
 * The graph is simple (no parallel edges), so "skip the parent edge" is
 * implemented as "skip the parent node": there is exactly one edge to it.
 *
 * Disconnected graphs: a DFS is started from every unvisited, unblocked node.
 * Blocked nodes are treated as REMOVED (never visited, never traversed).
 *
 * Time O(V + E), space O(V). Handles 200,000-node graphs (no recursion).
 *
 * @param {import('./graph.js').Graph} graph
 * @param {Uint8Array} [blocked] nonzero = node removed from the graph
 * @returns {{points: Set<number>, bridges: [number, number][]}}
 *   bridges are [u, v] with u < v, sorted ascending (deterministic output).
 */
export function articulationPointsAndBridges(graph, blocked) {
  const n = graph.n;
  const disc = new Int32Array(n).fill(-1); // -1 = unvisited
  const low = new Int32Array(n);
  const parent = new Int32Array(n).fill(-1);
  const nextIdx = new Int32Array(n); // per-node cursor into its neighbor list
  const stack = new Int32Array(n); // DFS path; depth <= n
  const points = new Set();
  const bridges = [];
  let timer = 0;

  for (let root = 0; root < n; root++) {
    if (disc[root] !== -1) continue;
    if (blocked !== undefined && blocked[root] !== 0) continue;

    let rootChildren = 0;
    let sp = 0;
    disc[root] = low[root] = timer++;
    stack[sp++] = root;

    while (sp > 0) {
      const u = stack[sp - 1];
      const nb = graph.neighbors(u);

      if (nextIdx[u] < nb.length) {
        // ---- "recursive call" step: examine the next edge of u ----
        const v = nb[nextIdx[u]++];
        if (blocked !== undefined && blocked[v] !== 0) continue; // removed node
        if (v === parent[u]) continue; // the (unique) edge back to the parent
        if (disc[v] === -1) {
          // tree edge u -> v: "descend"
          parent[v] = u;
          disc[v] = low[v] = timer++;
          stack[sp++] = v;
          if (u === root) rootChildren++;
        } else if (disc[v] < low[u]) {
          // back edge to an already-discovered ancestor: improve low[u]
          low[u] = disc[v];
        }
      } else {
        // ---- "return" step: u is finished, propagate to its parent ----
        sp--;
        const p = parent[u];
        if (p !== -1) {
          if (low[u] < low[p]) low[p] = low[u];
          if (low[u] > disc[p]) bridges.push(p < u ? [p, u] : [u, p]);
          if (p !== root && low[u] >= disc[p]) points.add(p);
        }
      }
    }
    if (rootChildren >= 2) points.add(root);
  }

  bridges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return { points, bridges };
}
