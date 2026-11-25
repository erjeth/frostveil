/**
 * Connected components via ITERATIVE depth-first search (explicit stack).
 *
 * Recursion is deliberately avoided: benchmark graphs have 50,000+ nodes
 * (a path graph would be a 50,000-deep call chain) and would overflow the
 * JS call stack.
 *
 * Time O(V + E), space O(V).
 *
 * @param {import('./graph.js').Graph} graph
 * @param {Uint8Array} [blocked] nonzero = node is removed (compId -1)
 * @returns {{compId: Int32Array, count: number, sizes: number[]}}
 *   compId[v] in 0..count-1 (components numbered by smallest node id), -1 if blocked.
 */
export function connectedComponents(graph, blocked) {
  const n = graph.n;
  const compId = new Int32Array(n).fill(-1);
  const sizes = [];
  const stack = new Int32Array(n); // each node is pushed at most once
  let count = 0;

  for (let root = 0; root < n; root++) {
    if (compId[root] !== -1) continue;
    if (blocked !== undefined && blocked[root] !== 0) continue;

    // Mark on push (not on pop) so a node can never be on the stack twice;
    // this keeps the stack bounded by n.
    let size = 0;
    let sp = 0;
    compId[root] = count;
    stack[sp++] = root;
    while (sp > 0) {
      const u = stack[--sp];
      size++;
      const nb = graph.neighbors(u);
      for (let i = 0; i < nb.length; i++) {
        const v = nb[i];
        if (compId[v] !== -1) continue;
        if (blocked !== undefined && blocked[v] !== 0) continue;
        compId[v] = count;
        stack[sp++] = v;
      }
    }
    sizes.push(size);
    count++;
  }
  return { compId, count, sizes };
}
