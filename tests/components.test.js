import test from 'node:test';
import assert from 'node:assert/strict';
import { connectedComponents, Graph } from '../src/core/index.js';
import { path, cycle, fromEdges, randomGraph, refCountComponents, mulberry32 } from './helpers.js';

test('components: path is a single component', () => {
  const r = connectedComponents(path(6));
  assert.equal(r.count, 1);
  assert.deepEqual(r.sizes, [6]);
  assert.ok([...r.compId].every((c) => c === 0));
});

test('components: cycle is a single component', () => {
  const r = connectedComponents(cycle(5));
  assert.equal(r.count, 1);
  assert.deepEqual(r.sizes, [5]);
});

test('components: disconnected graph incl. isolated node', () => {
  const g = fromEdges(7, [[0, 1], [1, 2], [3, 4]]); // {0,1,2} {3,4} {5} {6}
  const r = connectedComponents(g);
  assert.equal(r.count, 4);
  assert.deepEqual(r.sizes, [3, 2, 1, 1]);
  assert.equal(r.compId[0], r.compId[2]);
  assert.notEqual(r.compId[0], r.compId[3]);
});

test('components: blocked nodes get -1 and split components', () => {
  const blocked = new Uint8Array(5); blocked[2] = 1;
  const r = connectedComponents(path(5), blocked);
  assert.equal(r.compId[2], -1);
  assert.equal(r.count, 2);
  assert.deepEqual(r.sizes, [2, 2]);
  assert.equal(r.compId[0], r.compId[1]);
  assert.equal(r.compId[3], r.compId[4]);
  assert.notEqual(r.compId[1], r.compId[3]);
});

test('components: all nodes blocked, and empty graph', () => {
  const r = connectedComponents(path(3), new Uint8Array([1, 1, 1]));
  assert.equal(r.count, 0);
  assert.deepEqual(r.sizes, []);
  assert.deepEqual([...r.compId], [-1, -1, -1]);
  assert.equal(connectedComponents(new Graph(0)).count, 0);
});

test('components: sizes sum to number of unblocked nodes; matches reference on random graphs', () => {
  const rng = mulberry32(7);
  for (let t = 0; t < 100; t++) {
    const n = 2 + Math.floor(rng() * 25);
    const g = randomGraph(n, Math.floor(rng() * n * 1.5), rng);
    const blocked = new Uint8Array(n);
    for (let i = 0; i < n; i++) blocked[i] = rng() < 0.2 ? 1 : 0;
    const r = connectedComponents(g, blocked);
    assert.equal(r.count, refCountComponents(g, { blocked }));
    assert.equal(r.sizes.reduce((a, b) => a + b, 0), blocked.filter((b) => !b).length);
  }
});

test('components: iterative, survives a 100,000-node path (no stack overflow)', () => {
  const r = connectedComponents(path(100000));
  assert.equal(r.count, 1);
  assert.equal(r.sizes[0], 100000);
});
