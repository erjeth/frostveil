import test from 'node:test';
import assert from 'node:assert/strict';
import { Graph } from '../src/core/index.js';

test('Graph: constructor, n and m', () => {
  const g = new Graph(5);
  assert.equal(g.n, 5);
  assert.equal(g.m, 0);
});

test('Graph.addEdge: rejects self-loops and duplicates, counts edges', () => {
  const g = new Graph(4);
  assert.equal(g.addEdge(0, 1), true);
  assert.equal(g.addEdge(1, 0), false, 'reverse duplicate');
  assert.equal(g.addEdge(0, 1), false, 'duplicate');
  assert.equal(g.addEdge(2, 2), false, 'self loop');
  assert.equal(g.addEdge(0, 9), false, 'out of range');
  assert.equal(g.m, 1);
});

test('Graph: hasEdge, degree and neighbors are symmetric', () => {
  const g = new Graph(4);
  g.addEdge(0, 1); g.addEdge(0, 2);
  assert.ok(g.hasEdge(0, 1) && g.hasEdge(1, 0));
  assert.ok(!g.hasEdge(1, 2));
  assert.equal(g.degree(0), 2);
  assert.deepEqual([...g.neighbors(0)].sort(), [1, 2]);
  assert.deepEqual(g.neighbors(1), [0]);
});

test('Graph.removeEdge: removes from both sides, false when missing', () => {
  const g = new Graph(4);
  g.addEdge(0, 1); g.addEdge(1, 2);
  assert.equal(g.removeEdge(2, 1), true);
  assert.equal(g.m, 1);
  assert.ok(!g.hasEdge(1, 2) && !g.hasEdge(2, 1));
  assert.equal(g.degree(2), 0);
  assert.equal(g.removeEdge(1, 2), false);
  assert.equal(g.removeEdge(0, 3), false);
});

test('Graph.edges: each edge once with u < v, canonical order', () => {
  const g = new Graph(5);
  g.addEdge(3, 1); g.addEdge(0, 4); g.addEdge(2, 1); g.addEdge(0, 1);
  assert.deepEqual(g.edges(), [[0, 1], [0, 4], [1, 2], [1, 3]]);
});

test('Graph.edges: order is independent of remove/re-add history', () => {
  const g = new Graph(5);
  g.addEdge(0, 1); g.addEdge(0, 2); g.addEdge(0, 3);
  const before = g.edges();
  g.removeEdge(0, 1);
  g.addEdge(0, 1);
  assert.deepEqual(g.edges(), before);
});

test('Graph.clone: independent deep copy', () => {
  const g = new Graph(4);
  g.addEdge(0, 1); g.addEdge(1, 2);
  const c = g.clone();
  assert.deepEqual(c.edges(), g.edges());
  c.removeEdge(0, 1);
  c.addEdge(2, 3);
  assert.equal(g.m, 2);
  assert.ok(g.hasEdge(0, 1) && !g.hasEdge(2, 3));
  assert.equal(c.m, 2);
});
