/**
 * Multi-source breadth-first search with layer extraction.
 *
 * Used for: one frost step (layer 1 from the FROSTED set), frost arrival
 * times (Frost Forecast), and strategy scoring.
 *
 * Time O(V + E), space O(V). The queue is a preallocated Int32Array with
 * head/tail indices (no Array.shift, which would be O(n) per pop).
 *
 * Semantics:
 *  - Sources are visited at distance 0 even if `blocked[source] === 1`
 *    (a FROSTED node is "blocked" for entry yet it is where frost starts).
 *  - A blocked node is never ENTERED from a neighbor.
 *  - Duplicate sources are collapsed; layers[0] lists each source once, in
 *    first-seen order. Invalid ids are ignored.
 *
 * @param {import('./graph.js').Graph} graph
 * @param {number[]} sources
 * @param {Uint8Array} [blocked] 1 = node can never be entered from a neighbor
 * @returns {{dist: Int32Array, order: Int32Array, layers: number[][]}}
 *   dist[v] = hop distance from the nearest source, -1 if unreachable;
 *   order   = reached nodes in visit order;
 *   layers  = nodes grouped by distance.
 */
export function bfsLayers(graph, sources, blocked) {
  const n = graph.n;
  const dist = new Int32Array(n).fill(-1);
  const queue = new Int32Array(n);
  let head = 0;
  let tail = 0;

  for (const s of sources) {
    if (s >= 0 && s < n && dist[s] === -1) {
      dist[s] = 0;
      queue[tail++] = s;
    }
  }

  const layers = [];
  const layer0 = Array.from(queue.subarray(0, tail));
  if (layer0.length > 0) layers.push(layer0);

  // Process one whole layer at a time so layer boundaries are exact.
  let layerEnd = tail;
  let d = 0;
  while (head < tail) {
    const next = [];
    d++;
    while (head < layerEnd) {
      const u = queue[head++];
      const nb = graph.neighbors(u);
      for (let i = 0; i < nb.length; i++) {
        const v = nb[i];
        if (dist[v] !== -1) continue;
        if (blocked !== undefined && blocked[v] !== 0) continue;
        dist[v] = d;
        queue[tail++] = v;
        next.push(v);
      }
    }
    if (next.length > 0) layers.push(next);
    layerEnd = tail;
  }

  return { dist, order: queue.slice(0, tail), layers };
}
