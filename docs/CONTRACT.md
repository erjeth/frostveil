# Frostveil Core Contract

This file is the contract between Member A (core), Member B (UI) and Member C (bench/docs).
The API section below is copied **verbatim** from the project brief (section 6) and is read-only.
Implementation decisions are listed in the *Decisions* section at the end.


All exports below are re-exported from `src/core/index.js`.

```js
// ===== rng.js =====
mulberry32(seed: number): () => number              // float in [0, 1)

// ===== graph.js =====
class Graph {
  constructor(n)                  // nodes are 0..n-1
  get n(): number                 // node count (never changes)
  get m(): number                 // current edge count
  addEdge(u, v): boolean          // false for self-loop or duplicate
  removeEdge(u, v): boolean       // false if the edge did not exist
  hasEdge(u, v): boolean
  neighbors(u): number[]          // read-only array of neighbor ids
  degree(u): number
  edges(): [number, number][]     // each edge once, with u < v
  clone(): Graph
}

// ===== bfs.js =====
// sources: node ids, always visited at dist 0 even if blocked.
// blocked (optional): Uint8Array, 1 = node can never be entered from a neighbor.
bfsLayers(graph, sources: number[], blocked?: Uint8Array)
  -> { dist: Int32Array,        // -1 if unreachable
       order: Int32Array,       // reached nodes in visit order
       layers: number[][] }     // layers[0] = sources (deduplicated)

// ===== components.js =====
connectedComponents(graph, blocked?: Uint8Array)
  -> { compId: Int32Array,      // -1 for blocked nodes
       count: number,
       sizes: number[] }

// ===== tarjan.js =====  (blocked nodes are treated as removed)
articulationPointsAndBridges(graph, blocked?: Uint8Array)
  -> { points: Set<number>,
       bridges: [number, number][] }   // each bridge with u < v

// ===== simulation.js =====
NodeState = Object.freeze({ CLEAR: 0, FROSTED: 1, WARDED: 2 })

// Action = { type: 'beacon', node: number } | { type: 'sever', u: number, v: number }

createGameState(level) -> state
// state = {
//   level,                     // the Level object (never mutated)
//   graph,                     // working copy of level.graph; severed edges are removed from it
//   nodeState: Uint8Array,     // NodeState per node
//   turn: number,              // starts at 1
//   actionsLeft: number,       // starts at level.k, reset to level.k after every frost phase
//   actions: Action[],         // actions applied in the CURRENT Warden phase, in order
//   over: boolean,
//   outcome: Outcome | null,   // set when over becomes true
//   log: { turn, actions: Action[], newlyFrosted: number[] }[]   // completed turns
// }

applyAction(state, action) -> { ok: boolean, reason?: string }
// Mutates state. Fails (ok:false, reason) if: game over, no actionsLeft, beacon on a non-CLEAR
// node, or sever on a missing edge.

undoAction(state) -> boolean                 // undoes the last action of the current phase

endWardenPhase(state) -> { newlyFrosted: number[], contained: boolean }
// Runs ONE frost layer, pushes to state.log, turn += 1, actionsLeft = level.k.
// If the game is over afterwards: state.over = true and state.outcome is set.

isContained(state) -> boolean
blockedMask(state) -> Uint8Array             // 1 where nodeState is FROSTED or WARDED

frostForecast(state) -> Int32Array
// eta[v]: 0 = already frosted; t >= 1 = frosted during the t-th frost phase from now if nothing
// changes (1 = at the end of the current turn); -1 = never reached (includes WARDED nodes).

safeZones(state) -> { nodes: number[], population: number, threatened: boolean }[]
// Connected components of CLEAR nodes (FROSTED and WARDED nodes act as walls).
// threatened = some node of the zone is adjacent to a FROSTED node.

evaluateOutcome(state) -> Outcome
// Outcome = { won: boolean, savedPopulation: number, totalPopulation: number,
//             savedPercent: number,            // 0..100
//             citadelSafe: boolean,
//             stars: number,                   // 0..3, only computed when state.over, else 0
//             reference: { greedySaved: number, bestKnownSaved: number } | null }  // null until over
// Can be called at any time; for a running game it reports the current saved population.

// ===== levelGen.js =====
generateLevel({ n, seed, k = 2, sources = 1, targetPercent = 60, avgDegree = 3.2 }) -> Level
// Level = { seed, n, k, targetPercent,
//           sources: number[],            // node ids that start FROSTED (length = `sources` argument)
//           graph: Graph,                 // connected
//           nodes: { id, x, y, population, isCitadel }[],   // x, y in [0, 1]
//           totalPopulation: number }

// ===== levels.js =====
LEVEL_SPECS: { id: number, name: string, n: number, k: number, sources: number,
               targetPercent: number, seed: number, avgDegree: number }[]   // ids 1..8
buildLevel(id: number) -> Level               // generateLevel(spec of that id)

// ===== strategies.js =====
// Every strategy has the same signature, never mutates `state`, and returns up to
// state.actionsLeft actions (beacons only). rng is optional for deterministic strategies.
randomStrategy(state, rng?)            -> Action[]
maxDegreeStrategy(state, rng?)         -> Action[]
articulationGreedyStrategy(state, rng?) -> Action[]       // also powers the in-game Hint
STRATEGIES: { id: string, label: string, fn: Function }[] // ids: 'random', 'maxDegree', 'articulationGreedy'

playOut(level, strategyFn, rng?) -> { outcome: Outcome, turns: { turn, actions: Action[], newlyFrosted: number[] }[] }
// Plays a whole game on a fresh state. rng defaults to mulberry32(level.seed).

bruteForceOptimal(level, { maxNodes = 20, timeLimitMs = 10000 } = {})
  -> null                                   // when level.n > maxNodes
   | { outcome: Outcome, turns: [...], truncated: boolean, elapsedMs: number }
```

**Semantics worth restating:**
- `blocked` masks mean "cannot be entered". Frost sources passed to `bfsLayers` are always visited.
- Frost never crosses a `WARDED` node and never crosses a severed edge.
- Level coordinates `x`, `y` are normalized to [0, 1]; the UI scales and pads them.
- Functions must be pure with respect to their inputs unless documented as mutating (`applyAction`, `undoAction`, `endWardenPhase`).

## Decisions

_(filled in as checkpoints land)_
