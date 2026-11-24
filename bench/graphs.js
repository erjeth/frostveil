// bench/graphs.js
// Seeded generators for benchmark graphs. They only need the contract's `Graph` class,
// so the runtime benchmark does not depend on the level generator.

import { Graph } from './core.js';

/** Tiny local PRNG (mulberry32) so graph shapes never depend on the core's own RNG. */
export function localRng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Random connected sparse graph: a random spanning tree (node i attaches to a random earlier
 * node) plus random extra edges until E is about V * avgDegree / 2. With avgDegree = 6 this
 * gives E about 3V.
 */
export function randomConnectedGraph(V, seed, avgDegree = 6) {
  const rng = localRng(seed);
  const g = new Graph(V);
  for (let i = 1; i < V; i++) g.addEdge(i, Math.floor(rng() * i));
  const maxEdges = (V * (V - 1)) / 2;
  const target = Math.min(Math.round((V * avgDegree) / 2), maxEdges);
  let attempts = 0;
  const attemptCap = target * 50 + 1000;
  while (g.m < target && attempts < attemptCap) {
    attempts++;
    const u = Math.floor(rng() * V);
    const v = Math.floor(rng() * V);
    if (u !== v) g.addEdge(u, v);
  }
  return g;
}

/**
 * Path-like graph: the path 0-1-2-...-(V-1) plus a chord (i, i+2) with probability chordProb.
 * Its DFS depth is about V, which is the worst case for a recursive DFS / Tarjan.
 */
export function pathLikeGraph(V, seed, chordProb = 0.05) {
  const rng = localRng(seed);
  const g = new Graph(V);
  for (let i = 0; i + 1 < V; i++) g.addEdge(i, i + 1);
  for (let i = 0; i + 2 < V; i++) if (rng() < chordProb) g.addEdge(i, i + 2);
  return g;
}
