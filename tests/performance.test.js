// Performance sanity check (brief section 13, CP4): BFS, components and Tarjan on a
// 50,000-node, ~150,000-edge graph must each finish "well under a second".
import test from 'node:test';
import assert from 'node:assert/strict';
import { bfsLayers, connectedComponents, articulationPointsAndBridges, Graph, mulberry32 } from '../src/core/index.js';

const N = 50000;
const M = 150000;

function bigGraph() {
  const rng = mulberry32(2026);
  const g = new Graph(N);
  for (let i = 1; i < N; i++) g.addEdge(i, Math.floor(rng() * i)); // random tree: connected
  while (g.m < M) g.addEdge(Math.floor(rng() * N), Math.floor(rng() * N));
  return g;
}

function timed(label, fn) {
  fn(); // warm-up (JIT)
  const t0 = performance.now();
  const result = fn();
  const ms = performance.now() - t0;
  console.log(`  [perf] ${label}: ${ms.toFixed(1)} ms`);
  return { ms, result };
}

test(`performance: BFS, components and Tarjan on ${N} nodes / ${M} edges are well under a second`, () => {
  const g = bigGraph();
  assert.equal(g.n, N);
  assert.equal(g.m, M);

  const bfs = timed('bfsLayers', () => bfsLayers(g, [0]));
  assert.equal(bfs.result.order.length, N);
  assert.ok(bfs.ms < 1000, `bfs took ${bfs.ms} ms`);

  const cc = timed('connectedComponents', () => connectedComponents(g));
  assert.equal(cc.result.count, 1);
  assert.ok(cc.ms < 1000, `components took ${cc.ms} ms`);

  const tj = timed('articulationPointsAndBridges', () => articulationPointsAndBridges(g));
  assert.ok(tj.result.points instanceof Set);
  assert.ok(tj.ms < 1000, `tarjan took ${tj.ms} ms`);
});

test('performance: blocked-mask variants are equally fast', () => {
  const g = bigGraph();
  const blocked = new Uint8Array(N);
  const rng = mulberry32(5);
  for (let i = 0; i < N; i++) blocked[i] = rng() < 0.1 ? 1 : 0;
  assert.ok(timed('bfs+blocked', () => bfsLayers(g, [0], blocked)).ms < 1000);
  assert.ok(timed('components+blocked', () => connectedComponents(g, blocked)).ms < 1000);
  assert.ok(timed('tarjan+blocked', () => articulationPointsAndBridges(g, blocked)).ms < 1000);
});
