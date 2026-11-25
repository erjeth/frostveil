import test from 'node:test';
import assert from 'node:assert/strict';
import { generateLevel, connectedComponents } from '../src/core/index.js';

const SIZES = [2, 3, 10, 20, 40, 80];

/** Count proper crossings among road segments (O(m^2), fine for small n). */
function crossings(level) {
  const E = level.graph.edges();
  const P = level.nodes;
  const orient = (a, b, c) => (P[b].x - P[a].x) * (P[c].y - P[a].y) - (P[b].y - P[a].y) * (P[c].x - P[a].x);
  let count = 0;
  for (let i = 0; i < E.length; i++)
    for (let j = i + 1; j < E.length; j++) {
      const [a, b] = E[i];
      const [c, d] = E[j];
      if (a === c || a === d || b === c || b === d) continue;
      if (orient(a, b, c) * orient(a, b, d) < 0 && orient(c, d, a) * orient(c, d, b) < 0) count++;
    }
  return count;
}

test('generateLevel invariants hold over 100+ seeds and several sizes', () => {
  let checked = 0;
  for (const n of SIZES) {
    for (let seed = 1; seed <= 120; seed++) {
      const nSources = Math.min(1 + (seed % 3), n - 1);
      const L = generateLevel({ n, seed, sources: nSources });
      const tag = `n=${n} seed=${seed}`;

      assert.equal(L.n, n, tag);
      assert.equal(L.graph.n, n, tag);
      assert.equal(L.nodes.length, n, tag);
      assert.equal(connectedComponents(L.graph).count, 1, `${tag}: graph must be connected`);
      assert.ok(L.graph.m >= n - 1, tag);

      // exactly one citadel, not a source
      const citadels = L.nodes.filter((x) => x.isCitadel);
      assert.equal(citadels.length, 1, tag);
      assert.ok(!L.sources.includes(citadels[0].id), `${tag}: citadel must not be a source`);

      // sources: right count, distinct, valid ids
      assert.equal(L.sources.length, nSources, tag);
      assert.equal(new Set(L.sources).size, nSources, `${tag}: sources distinct`);
      for (const s of L.sources) assert.ok(Number.isInteger(s) && s >= 0 && s < n, tag);

      // coordinates and populations
      let total = 0;
      L.nodes.forEach((node, i) => {
        assert.equal(node.id, i, tag);
        assert.ok(node.x >= 0 && node.x <= 1 && node.y >= 0 && node.y <= 1, `${tag}: coords in [0,1]`);
        assert.ok(Number.isInteger(node.population) && node.population >= 1 && node.population <= 9, tag);
        total += node.population;
      });
      assert.equal(L.totalPopulation, total, tag);
      checked++;
    }
  }
  assert.ok(checked >= 600);
});

test('generateLevel echoes its parameters and applies the documented defaults', () => {
  const d = generateLevel({ n: 20, seed: 7 });
  assert.equal(d.seed, 7);
  assert.equal(d.k, 2);
  assert.equal(d.targetPercent, 60);
  assert.equal(d.sources.length, 1);
  const c = generateLevel({ n: 20, seed: 7, k: 3, sources: 2, targetPercent: 40 });
  assert.equal(c.k, 3);
  assert.equal(c.targetPercent, 40);
  assert.equal(c.sources.length, 2);
});

test('generateLevel is deterministic: same seed gives identical output', () => {
  for (const n of [12, 30, 60]) {
    for (const seed of [1, 42, 1001, 99999]) {
      const a = generateLevel({ n, seed, sources: 2 });
      const b = generateLevel({ n, seed, sources: 2 });
      assert.deepEqual(a.nodes, b.nodes);
      assert.deepEqual(a.graph.edges(), b.graph.edges());
      assert.deepEqual(a.sources, b.sources);
      assert.equal(a.totalPopulation, b.totalPopulation);
    }
  }
});

test('generateLevel: different seeds give different levels', () => {
  const sigs = new Set();
  for (let seed = 1; seed <= 50; seed++) {
    const L = generateLevel({ n: 30, seed });
    sigs.add(JSON.stringify([L.nodes.map((x) => [x.x, x.y]), L.graph.edges()]));
  }
  assert.equal(sigs.size, 50);
});

test('generateLevel: average degree is close to the requested value', () => {
  for (const avgDegree of [2.4, 3.2, 3.8]) {
    const L = generateLevel({ n: 60, seed: 3, avgDegree });
    const got = (2 * L.graph.m) / L.n;
    assert.ok(Math.abs(got - avgDegree) < 0.1, `avgDegree ${avgDegree} -> ${got}`);
  }
});

test('generateLevel: roads do not cross (checked on 100 random levels)', () => {
  let total = 0;
  for (let seed = 1; seed <= 100; seed++) total += crossings(generateLevel({ n: 10 + (seed % 5) * 15, seed }));
  assert.equal(total, 0);
});

test('generateLevel: the road network contains a spanning tree of SHORT roads (MST property)', () => {
  // The MST is the lightest spanning tree: its total length can never exceed that of any other
  // spanning tree. Compare with the BFS tree of the final graph.
  const L = generateLevel({ n: 40, seed: 11 });
  const len = ([u, v]) => Math.hypot(L.nodes[u].x - L.nodes[v].x, L.nodes[u].y - L.nodes[v].y);
  // Prim's algorithm as an independent MST oracle on the same complete geometric graph.
  const n = L.n;
  const inTree = new Uint8Array(n);
  const best = new Float64Array(n).fill(Infinity);
  best[0] = 0;
  let primTotal = 0;
  for (let it = 0; it < n; it++) {
    let u = -1;
    for (let v = 0; v < n; v++) if (!inTree[v] && (u === -1 || best[v] < best[u])) u = v;
    inTree[u] = 1;
    primTotal += best[u];
    for (let v = 0; v < n; v++) if (!inTree[v]) best[v] = Math.min(best[v], len([u, v]));
  }
  // Every Euclidean-MST edge must be a road: removing all roads not in the MST must keep it connected.
  // Equivalent check: Kruskal over the ROADS only yields a tree whose weight equals the geometric MST weight.
  const roads = L.graph.edges().sort((a, b) => len(a) - len(b));
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  let roadTotal = 0;
  for (const e of roads) {
    const a = find(e[0]), b = find(e[1]);
    if (a !== b) { parent[a] = b; roadTotal += len(e); }
  }
  assert.ok(Math.abs(roadTotal - primTotal) < 1e-9, `MST weight of roads ${roadTotal} vs geometric MST ${primTotal}`);
});

test('generateLevel: points are well spread (no two settlements nearly coincide)', () => {
  const L = generateLevel({ n: 60, seed: 5 });
  let minD = Infinity;
  for (let i = 0; i < L.n; i++)
    for (let j = i + 1; j < L.n; j++) minD = Math.min(minD, Math.hypot(L.nodes[i].x - L.nodes[j].x, L.nodes[i].y - L.nodes[j].y));
  // purely uniform random points would typically give minD ~ 0.003 at n=60; best-candidate sampling keeps them apart
  assert.ok(minD > 0.02, `closest pair distance ${minD}`);
});

test('generateLevel: citadel is far from the sources but not always the single farthest node', () => {
  let notFarthest = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const L = generateLevel({ n: 30, seed, sources: 1 });
    const g = L.graph;
    const src = L.sources[0];
    // hop distances via a simple BFS (independent of the module under test)
    const dist = new Array(L.n).fill(-1);
    dist[src] = 0;
    const q = [src];
    for (let h = 0; h < q.length; h++) for (const v of g.neighbors(q[h])) if (dist[v] === -1) { dist[v] = dist[q[h]] + 1; q.push(v); }
    const citadel = L.nodes.find((x) => x.isCitadel).id;
    const ds = dist.filter((_, i) => i !== src).sort((a, b) => b - a);
    const threshold = ds[Math.ceil(0.35 * ds.length) - 1];
    assert.ok(dist[citadel] >= threshold, `seed ${seed}: citadel at distance ${dist[citadel]} < far-quantile ${threshold}`);
    if (dist[citadel] < ds[0]) notFarthest++;
  }
  assert.ok(notFarthest > 0, 'citadel should not ALWAYS be the farthest node');
});

test('generateLevel: multiple sources are spread out (not adjacent)', () => {
  for (let seed = 1; seed <= 50; seed++) {
    const L = generateLevel({ n: 40, seed, sources: 3 });
    for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) assert.ok(!L.graph.hasEdge(L.sources[i], L.sources[j]), `seed ${seed}`);
  }
});

test('generateLevel: rejects invalid arguments', () => {
  assert.throws(() => generateLevel({ n: 1, seed: 1 }), RangeError);
  assert.throws(() => generateLevel({ n: 10, seed: 1, sources: 0 }), RangeError);
  assert.throws(() => generateLevel({ n: 10, seed: 1, sources: 10 }), RangeError);
  assert.throws(() => generateLevel({ n: 10, seed: 1, k: 0 }), RangeError);
  assert.throws(() => generateLevel({ n: 10.5, seed: 1 }), RangeError);
});

test('generateLevel: smallest legal levels work (n=2, n=3 with 2 sources)', () => {
  const a = generateLevel({ n: 2, seed: 1 });
  assert.equal(a.graph.m, 1);
  const b = generateLevel({ n: 3, seed: 1, sources: 2 });
  assert.equal(b.sources.length, 2);
  assert.equal(b.nodes.filter((x) => x.isCitadel).length, 1);
});

test('generateLevel scales: 20,000 nodes stay connected and are generated quickly', () => {
  const t0 = performance.now();
  const L = generateLevel({ n: 20000, seed: 9, sources: 3 });
  const ms = performance.now() - t0;
  assert.equal(connectedComponents(L.graph).count, 1);
  assert.ok(L.graph.m >= 19999);
  assert.ok(ms < 5000, `took ${ms.toFixed(0)} ms`);
});
