import test from 'node:test';
import assert from 'node:assert/strict';
import { LEVEL_SPECS, buildLevel, connectedComponents } from '../src/core/index.js';

// The table from the project contract (section 7). Only the seed may ever be changed (and documented).
const CONTRACT_TABLE = [
  [1, 12, 1, 1, 50, 1001],
  [2, 16, 1, 1, 55, 1002],
  [3, 20, 2, 1, 60, 1003],
  [4, 25, 2, 1, 60, 1004],
  [5, 30, 2, 2, 60, 1005],
  [6, 40, 2, 2, 65, 1006],
  [7, 50, 2, 2, 65, 1007],
  [8, 60, 2, 3, 65, 1008],
];

test('LEVEL_SPECS: ids 1..8 with the contract numbers (n, k, sources, target, seed)', () => {
  assert.equal(LEVEL_SPECS.length, 8);
  CONTRACT_TABLE.forEach(([id, n, k, sources, targetPercent, seed], i) => {
    const s = LEVEL_SPECS[i];
    assert.equal(s.id, id);
    assert.equal(s.n, n);
    assert.equal(s.k, k);
    assert.equal(s.sources, sources);
    assert.equal(s.targetPercent, targetPercent);
    assert.equal(s.seed, seed, `seed of level ${id} differs from the contract: document the change in docs/CONTRACT.md`);
    assert.equal(typeof s.name, 'string');
    assert.ok(s.name.length > 0);
    assert.equal(typeof s.avgDegree, 'number');
  });
  assert.equal(new Set(LEVEL_SPECS.map((s) => s.name)).size, 8, 'names are unique');
});

test('buildLevel: builds all 8 levels matching their spec', () => {
  for (const spec of LEVEL_SPECS) {
    const L = buildLevel(spec.id);
    assert.equal(L.n, spec.n);
    assert.equal(L.k, spec.k);
    assert.equal(L.sources.length, spec.sources);
    assert.equal(L.targetPercent, spec.targetPercent);
    assert.equal(L.seed, spec.seed);
    assert.equal(connectedComponents(L.graph).count, 1);
    assert.equal(L.nodes.filter((x) => x.isCitadel).length, 1);
  }
});

test('buildLevel: deterministic, and returns independent objects', () => {
  const a = buildLevel(4);
  const b = buildLevel(4);
  assert.notEqual(a, b);
  assert.notEqual(a.graph, b.graph);
  assert.deepEqual(a.nodes, b.nodes);
  assert.deepEqual(a.graph.edges(), b.graph.edges());
  assert.deepEqual(a.sources, b.sources);
});

test('buildLevel: unknown ids throw', () => {
  for (const bad of [0, 9, -1, 1.5, 'x', undefined]) assert.throws(() => buildLevel(bad), RangeError);
});

test('LEVEL_SPECS entries are frozen (UI cannot corrupt the campaign table)', () => {
  assert.ok(LEVEL_SPECS.every((s) => Object.isFrozen(s)));
});
