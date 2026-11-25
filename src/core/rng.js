/**
 * Seeded pseudo-random number generator (mulberry32).
 *
 * All randomness in Frostveil (level generation, random strategy) comes from
 * this generator, which makes every level and every playout reproducible:
 * the same seed always yields the same sequence.
 *
 * @param {number} seed any number; it is coerced to an unsigned 32-bit integer
 * @returns {() => number} function returning a float in [0, 1)
 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
