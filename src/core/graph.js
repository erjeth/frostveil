/**
 * Undirected simple graph on nodes 0..n-1, stored as adjacency lists.
 *
 * Space: O(V + E). `neighbors(u)` returns the INTERNAL array for speed;
 * callers must treat it as read-only (never push/splice/sort it).
 *
 * Edge removal uses swap-with-last, so the order of a neighbor list is not
 * insertion order after removals. Nothing in the core depends on that order
 * (results are sets, or tie-broken by node id), and `edges()` is canonical.
 */
export class Graph {
  /** @param {number} n number of nodes (fixed for the lifetime of the graph) */
  constructor(n) {
    if (!Number.isInteger(n) || n < 0) throw new RangeError(`Graph: invalid node count ${n}`);
    this._n = n;
    this._m = 0;
    /** @type {number[][]} */
    this._adj = Array.from({ length: n }, () => []);
  }

  /** Node count (never changes). */
  get n() {
    return this._n;
  }

  /** Current edge count. */
  get m() {
    return this._m;
  }

  _valid(u) {
    return Number.isInteger(u) && u >= 0 && u < this._n;
  }

  /**
   * Add undirected edge {u, v}.
   * @returns {boolean} false for a self-loop, a duplicate, or an invalid node id
   * Time: O(min(deg u, deg v)) for the duplicate check.
   */
  addEdge(u, v) {
    if (u === v || !this._valid(u) || !this._valid(v)) return false;
    if (this.hasEdge(u, v)) return false;
    this._adj[u].push(v);
    this._adj[v].push(u);
    this._m++;
    return true;
  }

  /**
   * Remove undirected edge {u, v} from both adjacency lists.
   * @returns {boolean} false if the edge did not exist
   * Time: O(deg u + deg v).
   */
  removeEdge(u, v) {
    if (!this._valid(u) || !this._valid(v)) return false;
    const a = this._adj[u];
    const i = a.indexOf(v);
    if (i === -1) return false;
    const b = this._adj[v];
    const j = b.indexOf(u);
    // swap-with-last removal: O(1) once the index is known
    a[i] = a[a.length - 1];
    a.pop();
    b[j] = b[b.length - 1];
    b.pop();
    this._m--;
    return true;
  }

  /** Time: O(min(deg u, deg v)) by scanning the shorter list. */
  hasEdge(u, v) {
    if (!this._valid(u) || !this._valid(v)) return false;
    const a = this._adj[u];
    const b = this._adj[v];
    return a.length <= b.length ? a.includes(v) : b.includes(u);
  }

  /** Neighbor ids of u. Returns the internal array: DO NOT MUTATE. */
  neighbors(u) {
    return this._adj[u];
  }

  degree(u) {
    return this._adj[u].length;
  }

  /**
   * Every edge exactly once as [u, v] with u < v, in canonical order
   * (sorted by u, then v), independent of insertion/removal history.
   */
  edges() {
    const out = [];
    for (let u = 0; u < this._n; u++) {
      const higher = this._adj[u].filter((v) => v > u);
      higher.sort((a, b) => a - b);
      for (const v of higher) out.push([u, v]);
    }
    return out;
  }

  /** Deep copy; mutating the clone never affects the original. */
  clone() {
    const g = new Graph(this._n);
    for (let u = 0; u < this._n; u++) g._adj[u] = this._adj[u].slice();
    g._m = this._m;
    return g;
  }
}
