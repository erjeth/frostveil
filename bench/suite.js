// bench/suite.js
// The three benchmarks (10.1 runtime, 10.2 strategy comparison, 10.3 brute-force scaling).
// No Node-only imports, so the same code runs from bench/run.js (Node) and bench/bench.html
// (browser). That keeps the in-browser numbers and the Node numbers produced by one code path.

import {
  bfsLayers,
  connectedComponents,
  articulationPointsAndBridges,
  generateLevel,
  STRATEGIES,
  playOut,
  bruteForceOptimal,
  mulberry32,
} from './core.js';
import { randomConnectedGraph, pathLikeGraph } from './graphs.js';
import { summarize, mean, std, logLogFit, expFit } from './stats.js';

const now = () => performance.now();
const tick = () => new Promise((resolve) => setTimeout(resolve, 0)); // let a browser repaint between configs

// Keeps the JIT from discarding the benchmarked calls as dead code.
let sink = null;
export const getSink = () => sink;

/** Time fn: `warmup` untimed calls, then `runs` timed calls with performance.now(). Returns ms[]. */
function timeRuns(fn, warmup, runs) {
  for (let i = 0; i < warmup; i++) sink = fn();
  const t = [];
  for (let i = 0; i < runs; i++) {
    const a = now();
    sink = fn();
    t.push(now() - a);
  }
  return t;
}

const strategyById = (id) => STRATEGIES.find((s) => s.id === id);

// ---------------------------------------------------------------------------------------------
// 10.1 Runtime benchmark
// ---------------------------------------------------------------------------------------------

export const RUNTIME_DEFAULTS = {
  sizes: [50, 500, 5000, 50000],
  extraSizes: [200000], // only used for the three linear algorithms
  warmup: 3,
  runs: 10,
  avgDegree: 6, // E is about 3V
  graphSeed: 1,
  pathGraphSeed: 2,
  levelSeed: 7000,
  playOutMaxV: 500, // cap for the full-game benchmark (see EVALUATION.md)
};

export async function runtimeBench(options = {}, log = () => {}) {
  const o = { ...RUNTIME_DEFAULTS, ...options };
  const rows = [];

  const algorithms = [
    { id: 'bfsLayers', linear: true, build: (V) => randomConnectedGraph(V, o.graphSeed, o.avgDegree), run: (g) => bfsLayers(g, [0]) },
    { id: 'connectedComponents', linear: true, build: (V) => randomConnectedGraph(V, o.graphSeed, o.avgDegree), run: (g) => connectedComponents(g) },
    { id: 'articulationPointsAndBridges', linear: true, build: (V) => randomConnectedGraph(V, o.graphSeed, o.avgDegree), run: (g) => articulationPointsAndBridges(g) },
    { id: 'articulationPointsAndBridges_pathGraph', linear: true, build: (V) => pathLikeGraph(V, o.pathGraphSeed), run: (g) => articulationPointsAndBridges(g) },
  ];

  for (const alg of algorithms) {
    const sizes = [...o.sizes, ...(alg.linear ? o.extraSizes : [])];
    for (const V of sizes) {
      const g = alg.build(V);
      const E = g.m;
      let ok = true;
      let error = null;
      let t = [];
      try {
        t = timeRuns(() => alg.run(g), o.warmup, o.runs);
      } catch (e) {
        ok = false;
        error = String(e && e.message ? e.message : e);
      }
      rows.push(makeRuntimeRow(alg.id, V, E, o, ok, error, t));
      log(`  [runtime] ${alg.id.padEnd(40)} V=${String(V).padStart(7)} E=${String(E).padStart(8)} ${ok ? `median ${rows[rows.length - 1].median_ms.toFixed(4)} ms` : `FAILED: ${error}`}`);
      await tick();
    }
  }

  // Full simulated game on a level-like graph (capped).
  const aag = strategyById('articulationGreedy').fn;
  for (const V of o.sizes.filter((v) => v <= o.playOutMaxV)) {
    const level = generateLevel({ n: V, seed: o.levelSeed + V, k: 2, sources: 2, targetPercent: 60 });
    const E = level.graph.m;
    let ok = true;
    let error = null;
    let t = [];
    try {
      t = timeRuns(() => playOut(level, aag), o.warmup, o.runs);
    } catch (e) {
      ok = false;
      error = String(e && e.message ? e.message : e);
    }
    rows.push(makeRuntimeRow('playOut_articulationGreedy', V, E, o, ok, error, t));
    log(`  [runtime] ${'playOut_articulationGreedy'.padEnd(40)} V=${String(V).padStart(7)} E=${String(E).padStart(8)} ${ok ? `median ${rows[rows.length - 1].median_ms.toFixed(4)} ms` : `FAILED: ${error}`}`);
    await tick();
  }

  // Log-log fits per algorithm: log10(median_ms) against log10(V + E).
  const fits = [];
  for (const id of [...new Set(rows.map((r) => r.algorithm))]) {
    const rs = rows.filter((r) => r.algorithm === id && r.ok);
    if (rs.length < 3) continue;
    const all = logLogFit(rs.map((r) => r.V + r.E), rs.map((r) => r.median_ms));
    const rs2 = rs.filter((r) => r.V >= 500);
    const big = rs2.length >= 3 ? logLogFit(rs2.map((r) => r.V + r.E), rs2.map((r) => r.median_ms)) : null;
    fits.push({
      algorithm: id,
      points: rs.length,
      slope_all_sizes: all.slope,
      r2_all_sizes: all.r2,
      slope_V_ge_500: big ? big.slope : null,
      r2_V_ge_500: big ? big.r2 : null,
    });
  }

  return { options: o, rows, fits };
}

function makeRuntimeRow(algorithm, V, E, o, ok, error, times) {
  if (!ok) {
    return { algorithm, V, E, warmup: o.warmup, runs: o.runs, ok, error, median_ms: NaN, q1_ms: NaN, q3_ms: NaN, min_ms: NaN, max_ms: NaN, mean_ms: NaN, std_ms: NaN, ns_per_element: NaN };
  }
  const s = summarize(times);
  return {
    algorithm,
    V,
    E,
    warmup: o.warmup,
    runs: o.runs,
    ok,
    error,
    median_ms: s.median,
    q1_ms: s.q1,
    q3_ms: s.q3,
    min_ms: s.min,
    max_ms: s.max,
    mean_ms: s.mean,
    std_ms: s.std,
    ns_per_element: (s.median * 1e6) / (V + E), // median_ms / (V + E), converted from ms to ns
  };
}

// ---------------------------------------------------------------------------------------------
// 10.2 Strategy comparison
// ---------------------------------------------------------------------------------------------

export const STRATEGY_DEFAULTS = {
  configs: [
    { n: 15, k: 1 }, { n: 15, k: 2 },
    { n: 30, k: 1 }, { n: 30, k: 2 },
    { n: 60, k: 1 }, { n: 60, k: 2 },
    { n: 20, k: 1, seedCount: 20 }, { n: 20, k: 2, seedCount: 20 }, // extra: smaller sample, brute force still feasible
  ],
  seedStart: 5000,
  seedCount: 100,
  randomPlayouts: 20,
  targetPercent: 60,
  bruteMaxNodes: 20,
  bruteTimeLimitMs: 10000,
};

/** 1 frost source for n <= 20, 2 for n = 30 and 60 (see section 10.2 of the brief). */
export const sourcesFor = (n) => (n <= 20 ? 1 : 2);

const EPS = 1e-9;

export async function strategyBench(options = {}, log = () => {}) {
  const o = { ...STRATEGY_DEFAULTS, ...options };
  const rows = [];
  const comparisons = [];
  const levelsOut = [];

  for (const cfg of o.configs) {
    const { n, k } = cfg;
    const seedCount = cfg.seedCount ?? o.seedCount;
    const sources = sourcesFor(n);
    const useBrute = n <= o.bruteMaxNodes;
    const acc = {}; // strategy id -> accumulators
    const ids = [...STRATEGIES.map((s) => s.id), ...(useBrute ? ['bruteForce'] : [])];
    for (const id of ids) acc[id] = { savedPct: [], levelMeanPct: [], won: 0, citadel: 0, games: 0, ms: [], ratios: [], equalFrac: [], truncated: 0, exceeds: 0 };
    const cmp = {
      vsMaxDegree: { wins: 0, ties: 0, losses: 0 },
      vsRandomMean: { wins: 0, ties: 0, losses: 0 },
    };
    let truncatedLevels = 0;

    for (let i = 0; i < seedCount; i++) {
      const seed = o.seedStart + i;
      const level = generateLevel({ n, seed, k, sources, targetPercent: o.targetPercent });
      const levelRec = { n, k, seed, saved: {} };

      let opt = null;
      if (useBrute) {
        const b = bruteForceOptimal(level, { maxNodes: o.bruteMaxNodes, timeLimitMs: o.bruteTimeLimitMs });
        if (b) {
          opt = b.outcome.savedPopulation;
          const a = acc.bruteForce;
          a.savedPct.push(b.outcome.savedPercent);
          a.levelMeanPct.push(b.outcome.savedPercent);
          a.games++;
          if (b.outcome.won) a.won++;
          if (b.outcome.citadelSafe) a.citadel++;
          a.ms.push(b.elapsedMs);
          if (b.truncated) { a.truncated++; truncatedLevels++; }
          levelRec.saved.bruteForce = opt;
        }
      }

      const levelSaved = {};
      for (const strat of STRATEGIES) {
        const a = acc[strat.id];
        const reps = strat.id === 'random' ? o.randomPlayouts : 1;
        const pops = [];
        const pcts = [];
        let optHits = 0;
        for (let r = 0; r < reps; r++) {
          const rng = strat.id === 'random' ? mulberry32(seed * 100003 + r + 1) : undefined;
          const t0 = now();
          const res = playOut(level, strat.fn, rng);
          const dt = now() - t0;
          const out = res.outcome;
          pops.push(out.savedPopulation);
          pcts.push(out.savedPercent);
          a.savedPct.push(out.savedPercent);
          a.games++;
          if (out.won) a.won++;
          if (out.citadelSafe) a.citadel++;
          a.ms.push(dt);
          if (opt !== null && out.savedPopulation >= opt - EPS) optHits++;
        }
        const meanPop = mean(pops);
        a.levelMeanPct.push(mean(pcts));
        levelSaved[strat.id] = meanPop;
        levelRec.saved[strat.id] = meanPop;
        if (opt !== null && opt > 0) {
          const ratio = meanPop / opt;
          a.ratios.push(ratio);
          if (ratio > 1 + EPS) a.exceeds++;
          a.equalFrac.push(optHits / reps);
        }
      }
      if (opt !== null && opt > 0) {
        acc.bruteForce.ratios.push(1);
        acc.bruteForce.equalFrac.push(1);
      }

      // Does Articulation-Aware Greedy strictly beat the baselines on this level?
      const tally = (bucket, diff) => {
        if (diff > EPS) bucket.wins++;
        else if (diff < -EPS) bucket.losses++;
        else bucket.ties++;
      };
      tally(cmp.vsMaxDegree, levelSaved.articulationGreedy - levelSaved.maxDegree);
      tally(cmp.vsRandomMean, levelSaved.articulationGreedy - levelSaved.random);
      levelsOut.push(levelRec);

      if ((i + 1) % 25 === 0 || i + 1 === seedCount) await tick();
    }

    for (const id of ids) {
      const a = acc[id];
      const hasOpt = useBrute && a.ratios.length > 0;
      rows.push({
        n,
        k,
        sources,
        levels: seedCount,
        strategy: id,
        games: a.games,
        mean_saved_pct: mean(a.savedPct),
        std_saved_pct: std(a.savedPct),
        std_saved_pct_level_means: std(a.levelMeanPct),
        win_rate: a.won / a.games,
        citadel_survival_rate: a.citadel / a.games,
        mean_ms_per_game: mean(a.ms),
        approx_ratio_mean: hasOpt ? mean(a.ratios) : null,
        approx_ratio_min: hasOpt ? Math.min(...a.ratios) : null,
        equals_optimum_fraction: hasOpt ? mean(a.equalFrac) : null,
        levels_exceeding_optimum: hasOpt ? a.exceeds : null,
        truncated_levels: id === 'bruteForce' ? a.truncated : null,
      });
    }
    comparisons.push({ n, k, levels: seedCount, aag_vs_maxDegree: cmp.vsMaxDegree, aag_vs_random_mean: cmp.vsRandomMean, truncatedLevels });
    log(`  [strategies] n=${n} k=${k} sources=${sources} levels=${seedCount}: ` + ids.map((id) => `${id}=${mean(acc[id].savedPct).toFixed(1)}%`).join('  '));
    await tick();
  }

  return { options: o, rows, comparisons, levels: levelsOut };
}

// ---------------------------------------------------------------------------------------------
// 10.3 Brute-force scaling
// ---------------------------------------------------------------------------------------------

export const BRUTE_DEFAULTS = {
  nMin: 8,
  nMax: 20,
  seeds: 5,
  seedStart: 6000,
  k: 2,
  sources: 1,
  targetPercent: 60,
  timeLimitMs: 10000,
};

export async function bruteScalingBench(options = {}, log = () => {}) {
  const o = { ...BRUTE_DEFAULTS, ...options };
  const runs = [];
  const summary = [];

  for (let n = o.nMin; n <= o.nMax; n++) {
    const times = [];
    const explored = [];
    let truncated = 0;
    let exploredExposed = false;
    for (let i = 0; i < o.seeds; i++) {
      const seed = o.seedStart + i;
      const level = generateLevel({ n, seed, k: o.k, sources: o.sources, targetPercent: o.targetPercent });
      const t0 = now();
      const res = bruteForceOptimal(level, { maxNodes: Math.max(20, n), timeLimitMs: o.timeLimitMs });
      const wall = now() - t0;
      const ms = res && typeof res.elapsedMs === 'number' ? res.elapsedMs : wall;
      const ex = res && typeof res.explored === 'number' ? res.explored : null;
      if (ex !== null) { exploredExposed = true; explored.push(ex); }
      if (res && res.truncated) truncated++;
      times.push(ms);
      runs.push({ n, seed, k: o.k, elapsed_ms: ms, explored_states: ex, truncated: !!(res && res.truncated), saved_population: res ? res.outcome.savedPopulation : null });
    }
    const s = summarize(times);
    summary.push({
      n,
      seeds: o.seeds,
      median_ms: s.median,
      mean_ms: s.mean,
      min_ms: s.min,
      max_ms: s.max,
      median_explored: exploredExposed ? summarize(explored).median : null,
      truncated_runs: truncated,
      ratio_to_previous_n: null,
      ratio_explored_to_previous_n: null,
    });
    log(`  [bruteforce] n=${n} median ${s.median.toFixed(2)} ms, max ${s.max.toFixed(2)} ms, truncated ${truncated}/${o.seeds}`);
    await tick();
  }

  for (let i = 1; i < summary.length; i++) {
    const prev = summary[i - 1];
    const cur = summary[i];
    if (prev.median_ms > 0) cur.ratio_to_previous_n = cur.median_ms / prev.median_ms;
    if (prev.median_explored > 0 && cur.median_explored !== null) cur.ratio_explored_to_previous_n = cur.median_explored / prev.median_explored;
  }
  const clean = summary.filter((s) => s.truncated_runs === 0);
  const fit = clean.length >= 3 ? expFit(clean.map((s) => s.n), clean.map((s) => s.median_ms)) : null;
  const growth = fit ? { points: clean.length, growth_factor_per_extra_node: fit.factorPerStep, r2_log_fit: fit.r2 } : null;

  return { options: o, runs, summary, growth };
}
