import test from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32 } from '../src/core/index.js';

test('mulberry32: same seed gives the same sequence', () => {
  const a = mulberry32(12345);
  const b = mulberry32(12345);
  for (let i = 0; i < 1000; i++) assert.equal(a(), b());
});

test('mulberry32: different seeds give different sequences', () => {
  const a = mulberry32(1);
  const b = mulberry32(2);
  const sa = Array.from({ length: 10 }, a);
  const sb = Array.from({ length: 10 }, b);
  assert.notDeepEqual(sa, sb);
});

test('mulberry32: values are floats in [0, 1) with a sane mean', () => {
  const r = mulberry32(99);
  let sum = 0;
  const N = 20000;
  for (let i = 0; i < N; i++) {
    const x = r();
    assert.ok(x >= 0 && x < 1);
    sum += x;
  }
  assert.ok(Math.abs(sum / N - 0.5) < 0.02, `mean was ${sum / N}`);
});

test('mulberry32: matches the standard reference implementation for seed 0', () => {
  // Independent re-implementation of the published algorithm.
  function ref(a) {
    return () => {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  for (const seed of [0, 1, 1001, 4294967295]) {
    const x = mulberry32(seed);
    const y = ref(seed);
    for (let i = 0; i < 50; i++) assert.equal(x(), y());
  }
});
