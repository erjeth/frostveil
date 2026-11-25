import test from 'node:test';
import assert from 'node:assert/strict';
import { articulationPointsAndBridges as ap, Graph } from '../src/core/index.js';
import { path, cycle, star, fromEdges, randomGraph, refArticulationPoints, refBridges, mulberry32 } from './helpers.js';

const pts = (r) => [...r.points].sort((a, b) => a - b);

test('tarjan: path - inner nodes are articulation points, all edges are bridges', () => {
  const r = ap(path(5));
  assert.deepEqual(pts(r), [1, 2, 3]);
  assert.deepEqual(r.bridges, [[0, 1], [1, 2], [2, 3], [3, 4]]);
});

test('tarjan: cycle has neither', () => {
  const r = ap(cycle(6));
  assert.equal(r.points.size, 0);
  assert.deepEqual(r.bridges, []);
});

test('tarjan: star - only the center; every edge is a bridge', () => {
  const r = ap(star(6));
  assert.deepEqual(pts(r), [0]);
  assert.equal(r.bridges.length, 5);
});

test('tarjan: two triangles joined by one edge', () => {
  const g = fromEdges(6, [[0, 1], [1, 2], [2, 0], [3, 4], [4, 5], [5, 3], [2, 3]]);
  const r = ap(g);
  assert.deepEqual(r.bridges, [[2, 3]]);
  assert.deepEqual(pts(r), [2, 3]);
});

test('tarjan: root with several children is an articulation point (root = node 0)', () => {
  // 0 is the DFS root with 3 independent branches
  const g = fromEdges(7, [[0, 1], [1, 2], [0, 3], [3, 4], [0, 5], [5, 6]]);
  assert.ok(ap(g).points.has(0));
});

test('tarjan: root with a single child is NOT an articulation point', () => {
  const r = ap(path(3)); // root 0 has exactly one child
  assert.ok(!r.points.has(0));
  assert.ok(!r.points.has(2));
});

test('tarjan: multiple components are all processed', () => {
  const g = fromEdges(8, [[0, 1], [1, 2], [4, 5], [5, 6], [6, 4], [6, 7]]);
  const r = ap(g);
  assert.deepEqual(pts(r), [1, 6]);
  assert.deepEqual(r.bridges, [[0, 1], [1, 2], [6, 7]]);
});

test('tarjan: blocked nodes are treated as removed', () => {
  // cycle 0-1-2-3-4-0 with node 0 blocked becomes the path 1-2-3-4
  const blocked = new Uint8Array(5); blocked[0] = 1;
  const r = ap(cycle(5), blocked);
  assert.deepEqual(pts(r), [2, 3]);
  assert.deepEqual(r.bridges, [[1, 2], [2, 3], [3, 4]]);
});

test('tarjan: blocked root and empty/edgeless graphs', () => {
  const blocked = new Uint8Array(3); blocked[0] = 1;
  assert.deepEqual(pts(ap(path(3), blocked)), []);
  assert.deepEqual(ap(new Graph(0)).bridges, []);
  assert.equal(ap(new Graph(4)).points.size, 0);
});

test('tarjan: cross-check vs brute force on 200 random small graphs', () => {
  const rng = mulberry32(2024);
  for (let t = 0; t < 200; t++) {
    const n = 1 + Math.floor(rng() * 14);
    const g = randomGraph(n, Math.floor(rng() * n * 2), rng);
    const r = ap(g);
    assert.deepEqual(pts(r), [...refArticulationPoints(g)].sort((a, b) => a - b), `AP mismatch on graph #${t}: ${JSON.stringify(g.edges())}`);
    assert.deepEqual(r.bridges, refBridges(g), `bridge mismatch on graph #${t}: ${JSON.stringify(g.edges())}`);
  }
});

test('tarjan: cross-check vs brute force WITH blocked masks on 200 random graphs', () => {
  const rng = mulberry32(555);
  for (let t = 0; t < 200; t++) {
    const n = 1 + Math.floor(rng() * 14);
    const g = randomGraph(n, Math.floor(rng() * n * 2), rng);
    const blocked = new Uint8Array(n);
    for (let i = 0; i < n; i++) blocked[i] = rng() < 0.25 ? 1 : 0;
    const r = ap(g, blocked);
    assert.deepEqual(pts(r), [...refArticulationPoints(g, blocked)].sort((a, b) => a - b), `AP(blocked) mismatch #${t}`);
    assert.deepEqual(r.bridges, refBridges(g, blocked), `bridge(blocked) mismatch #${t}`);
  }
});

test('tarjan: iterative, survives a 100,000-node path (no stack overflow)', () => {
  const n = 100000;
  const r = ap(path(n));
  assert.equal(r.points.size, n - 2);
  assert.equal(r.bridges.length, n - 1);
});

test('tarjan: survives a 200,000-node path', () => {
  const r = ap(path(200000));
  assert.equal(r.bridges.length, 199999);
});

test('tarjan: does not mutate graph or blocked mask', () => {
  const g = cycle(6); g.addEdge(0, 3);
  const edges = g.edges();
  const blocked = new Uint8Array(6); blocked[5] = 1;
  const copy = blocked.slice();
  ap(g, blocked);
  assert.deepEqual(g.edges(), edges);
  assert.deepEqual(blocked, copy);
});
