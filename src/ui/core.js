/**
 * @file core.js
 * Single core import bridge for the Frostveil UI layer (Member B).
 *
 * Every UI module imports exclusively from `./core.js`.
 * While Member A's checkpoints (CP1-CP3) are not yet merged on `main`,
 * this file re-exports `./mockCore.js`. Once `src/core/index.js` lands,
 * swap the single line below to `export * from '../core/index.js';`.
 */

export * from './mockCore.js';
// export * from '../core/index.js';
