import test from 'node:test';
import assert from 'node:assert/strict';
import { bfsLayers, Graph } from '../src/core/index.js';
import { path, star, grid, fromEdges } from './helpers.js';

test('bfs: path graph distances and layers', () => {
  const r = bfsLayers(path(5), [0]);
  assert.deepEqual([...r.dist], [0, 1, 2, 3, 4]);
  assert.deepEqual([...r.order], [0, 1, 2, 3, 4]);
  assert.deepEqual(r.layers, [[0], [1], [2], [3], [4]]);
});

test('bfs: star from the center and from a leaf', () => {
  const g = star(6);
  assert.deepEqual(bfsLayers(g, [0]).layers.map((l) => l.length), [1, 5]);
  const r = bfsLayers(g, [3]);
  assert.deepEqual([...r.dist], [1, 2, 2, 0, 2, 2]);
  assert.deepEqual(r.layers[0], [3]);
  assert.deepEqual(r.layers[1], [0]);
  assert.deepEqual(r.layers[2].sort(), [1, 2, 4, 5]);
});

test('bfs: grid distances equal Manhattan distance', () => {
  const w = 5, h = 4;
  const r = bfsLayers(grid(w, h), [0]);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) assert.equal(r.dist[y * w + x], x + y);
});

test('bfs: multi-source takes the nearest source', () => {
  const r = bfsLayers(path(7), [0, 6]);
  assert.deepEqual([...r.dist], [0, 1, 2, 3, 2, 1, 0]);
  assert.deepEqual(r.layers[0], [0, 6]);
});

test('bfs: duplicate sources are deduplicated', () => {
  const r = bfsLayers(path(3), [1, 1, 1]);
  assert.deepEqual(r.layers[0], [1]);
  assert.equal(r.order.length, 3);
});

test('bfs: blocked nodes are never entered', () => {
  const blocked = new Uint8Array(5); blocked[2] = 1;
  const r = bfsLayers(path(5), [0], blocked);
  assert.deepEqual([...r.dist], [0, 1, -1, -1, -1]);
  assert.deepEqual([...r.order], [0, 1]);
});

test('bfs: unreachable nodes have dist -1 (disconnected graph)', () => {
  const g = fromEdges(5, [[0, 1], [3, 4]]);
  const r = bfsLayers(g, [0]);
  assert.deepEqual([...r.dist], [0, 1, -1, -1, -1]);
});

test('bfs: a source inside the blocked set is still visited and expands', () => {
  const blocked = new Uint8Array(4); blocked[0] = 1; blocked[3] = 1;
  const r = bfsLayers(path(4), [0], blocked);
  assert.equal(r.dist[0], 0);
  assert.equal(r.dist[1], 1);
  assert.equal(r.dist[2], 2);
  assert.equal(r.dist[3], -1, 'blocked non-source node is not entered');
});

test('bfs: a blocked node cannot be re-entered even if it is a different source target', () => {
  // frost at 0, ward at 1: frost cannot get to 2 through 1
  const blocked = new Uint8Array(3); blocked[0] = 1; blocked[1] = 1;
  const r = bfsLayers(path(3), [0], blocked);
  assert.deepEqual([...r.dist], [0, -1, -1]);
});

test('bfs: empty source list and empty graph', () => {
  const r = bfsLayers(path(3), []);
  assert.deepEqual(r.layers, []);
  assert.equal(r.order.length, 0);
  assert.deepEqual([...r.dist], [-1, -1, -1]);
  const e = bfsLayers(new Graph(0), []);
  assert.equal(e.dist.length, 0);
});

test('bfs: does not mutate its inputs', () => {
  const g = grid(3, 3);
  const edges = g.edges();
  const blocked = new Uint8Array(9); blocked[4] = 1;
  const copy = blocked.slice();
  bfsLayers(g, [0], blocked);
  assert.deepEqual(g.edges(), edges);
  assert.deepEqual(blocked, copy);
});

test('bfs: layers partition the visited nodes consistently with dist', () => {
  const r = bfsLayers(grid(6, 6), [0, 35]);
  let total = 0;
  r.layers.forEach((layer, d) => { total += layer.length; for (const v of layer) assert.equal(r.dist[v], d); });
  assert.equal(total, r.order.length);
});
