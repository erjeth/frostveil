/**
 * Lazy, per-level cache of the reference scores used for star ratings.
 *
 * Why this module exists: `evaluateOutcome` (simulation.js) needs the scores
 * of the built-in strategies, but strategies.js itself imports simulation.js.
 * Importing each other directly would create a circular dependency, so
 * simulation.js only depends on this tiny module, and strategies.js REGISTERS
 * the real computation here when it is loaded (src/core/index.js loads both).
 *
 * Cache: a WeakMap keyed by the Level object, so references are computed at
 * most once per level object and are garbage-collected with it.
 *
 * @typedef {{greedySaved: number, bestKnownSaved: number}} Reference
 */

/** @type {WeakMap<object, Reference>} */
const cache = new WeakMap();

/** @type {((level: object) => Reference) | null} */
let provider = null;

/** Re-entrancy guard: a reference computation must never trigger another one. */
let computing = false;

/** Called once by strategies.js at load time. */
export function setReferenceProvider(fn) {
  provider = fn;
}

/**
 * Reference scores for `level`, or null when no provider is registered
 * (strategies not loaded) or when called re-entrantly.
 * @returns {Reference | null}
 */
export function getReference(level) {
  const hit = cache.get(level);
  if (hit !== undefined) return hit;
  if (provider === null || computing) return null;
  computing = true;
  try {
    const ref = provider(level);
    cache.set(level, ref);
    return ref;
  } finally {
    computing = false;
  }
}
