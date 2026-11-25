// Single entry point of the Frostveil core. UI and benchmarks import ONLY from here.
// Modules are re-exported as they land (see docs/CONTRACT.md for the full contract).
export { mulberry32 } from './rng.js';
export { Graph } from './graph.js';
export { bfsLayers } from './bfs.js';
export { connectedComponents } from './components.js';
export { articulationPointsAndBridges } from './tarjan.js';
export {
  NodeState,
  createGameState,
  applyAction,
  undoAction,
  endWardenPhase,
  isContained,
  blockedMask,
  frostForecast,
  safeZones,
  evaluateOutcome,
} from './simulation.js';
export { generateLevel } from './levelGen.js';
export { LEVEL_SPECS, buildLevel } from './levels.js';
export {
  randomStrategy,
  maxDegreeStrategy,
  articulationGreedyStrategy,
  STRATEGIES,
  playOut,
  bruteForceOptimal,
} from './strategies.js';
