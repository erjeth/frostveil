/**
 * The eight campaign levels. Numbers (n, k, sources, targetPercent, seed) follow the
 * project contract; only the names are free. If a level ever turns out to be unwinnable
 * ONLY its seed may change (and must be recorded in docs/CONTRACT.md).
 */
import { generateLevel } from './levelGen.js';

export const LEVEL_SPECS = [
  { id: 1, name: 'Hollow Brook', n: 12, k: 1, sources: 1, targetPercent: 50, seed: 1001, avgDegree: 3.2 },
  { id: 2, name: 'Pinewatch', n: 16, k: 1, sources: 1, targetPercent: 55, seed: 1002, avgDegree: 3.2 },
  { id: 3, name: 'Ashford Crossing', n: 20, k: 2, sources: 1, targetPercent: 60, seed: 1003, avgDegree: 3.2 },
  { id: 4, name: 'Greywater', n: 25, k: 2, sources: 1, targetPercent: 60, seed: 1004, avgDegree: 3.2 },
  { id: 5, name: 'Stonemarch', n: 30, k: 2, sources: 2, targetPercent: 60, seed: 1005, avgDegree: 3.2 },
  { id: 6, name: 'Highmoor', n: 40, k: 2, sources: 2, targetPercent: 65, seed: 1006, avgDegree: 3.2 },
  { id: 7, name: 'Ironvale', n: 50, k: 2, sources: 2, targetPercent: 65, seed: 1007, avgDegree: 3.2 },
  { id: 8, name: 'The Long Winter', n: 60, k: 2, sources: 3, targetPercent: 65, seed: 1008, avgDegree: 3.2 },
].map((spec) => Object.freeze(spec));

/**
 * Build level `id` (1..8) via generateLevel; deterministic.
 * @param {number} id
 */
export function buildLevel(id) {
  const spec = LEVEL_SPECS.find((s) => s.id === id);
  if (spec === undefined) throw new RangeError(`buildLevel: unknown level id ${id}`);
  const { n, k, sources, targetPercent, seed, avgDegree } = spec;
  return generateLevel({ n, seed, k, sources, targetPercent, avgDegree });
}
