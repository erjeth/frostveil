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

The API above is implemented exactly as written. These are the points the contract left open.

**Changed level seeds** (only two numbers in the table were ever touched, and only seeds):

| Level | Contract seed | Final seed | Reason |
|---|---|---|---|
| 6 | 1006 | **1051** | No built-in strategy won it (greedy saved 53 % vs a 65 % target; no brute force for n > 20). |
| 8 | 1008 | **1027** | Same (greedy saved 36 % vs 65 %). |

Rule used: the first seed above the original where Articulation-Aware Greedy wins by >= 5 percentage points and Random wins < 20 % of 200 random playouts
(level 6 greedy 72 %, level 8 greedy 72 %). Every other level keeps its contract seed.

**Observation for Member B (Hint quality):** on level 2 (seed 1002) the greedy strategy, which powers the in-game Hint, *loses* (36 % saved, target 55 %),
while the exact optimum wins (54 of 81 = 67 %). The level meets the brief's winnability rule (brute force wins), so its seed was not changed, but a player
who blindly follows the Hint there will lose. Changing seed 1002 is possible if the team prefers.

**Stars:** the highest satisfied tier wins: lost = 0; won = 1; won and saved >= `greedySaved` = 2; won and saved >= 95 % of `bestKnownSaved` = 3 (integer
arithmetic: `saved * 100 >= 95 * best`). A win can therefore get 3 stars while saving slightly less than greedy, when greedy is far above 95 % of the best.
`bestKnownSaved` = max saved by the three strategies and, for n <= 20, by `bruteForceOptimal`.

**`evaluateOutcome` on a running game:** `won: false`, `stars: 0`, `reference: null`.

**Reference scores:** computed lazily when a game ends (inside `endWardenPhase`), cached per Level object in a `WeakMap` (`src/core/reference.js`). Because the
computation is registered by `strategies.js`, always import the core through `src/core/index.js`. The brute-force part has a 3000 ms budget; measured cost on
n <= 24 levels is a few milliseconds, so the first game-over on a *new* level object costs roughly the time of three playouts.
If a reference computation is ever unavailable, stars degrade to 0/1 and `reference` stays `null`.

**`playOut`:** runs on an internal "silent" state, so its `outcome.reference` is `null` and its stars are only 0 or 1. This avoids recursion
(reference computation uses `playOut`) and keeps benchmarks cheap. Use `evaluateOutcome` on a live state for full stars.

**Strategy details:** `articulationGreedyStrategy` only considers candidates the frost can still reach (a beacon elsewhere cannot change the outcome);
when nothing is reachable it returns `[]`. `maxDegreeStrategy` uses the current degree (severed roads no longer count). `randomStrategy` defaults to
`mulberry32(state.turn)`.

**`bruteForceOptimal`:** beacons only; supports at most 30 nodes (31-bit masks), so it returns `null` above 30 even if `maxNodes` is larger; the incumbent is seeded
by the heuristics so it is never worse than them, even when `truncated`.

**Misc behaviour:** `newlyFrosted` is sorted ascending; `edges()` is in canonical (u, v) order; `endWardenPhase` on a finished game changes nothing; `safeZones` are ordered by
smallest node id; `blocked` masks treat any non-zero byte as blocked; `generateLevel` throws `RangeError` for `n < 2`, `sources` outside `1..n-1`, or `k < 1`.
For n > 2000 the average degree is capped by the Gabriel graph (about 4), so dense benchmark graphs (degree about 6) must be built by the benchmark code itself.
