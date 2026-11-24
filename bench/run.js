// bench/run.js
// Entry point for `npm run bench`.
//
//   node bench/run.js                    full run (runtime + strategies + bruteforce), writes bench/results/
//   node bench/run.js --quick            small sizes and few seeds (smoke test), writes bench/results/quick/
//   node bench/run.js --only=runtime     one of: runtime | strategies | bruteforce
//   node bench/run.js --charts           only re-draw the SVG charts from the JSON files already in results/
//   node bench/run.js --no-200k          skip V = 200,000 for the three linear algorithms
//   node bench/run.js --playout-max=5000 raise the size cap of the full-game benchmark (default 500)

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

import * as core from './core.js';
import { runtimeBench, strategyBench, bruteScalingBench, RUNTIME_DEFAULTS, STRATEGY_DEFAULTS, BRUTE_DEFAULTS } from './suite.js';
import { runtimeScene, strategyScene, bruteScene, sceneToSvg } from './charts.js';

globalThis.performance ??= performance;

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};

const quick = flag('quick');
const chartsOnly = flag('charts');
const only = value('only');
if (only && !['runtime', 'strategies', 'bruteforce'].includes(only)) {
  console.error(`Unknown --only=${only}. Use runtime, strategies or bruteforce.`);
  process.exit(1);
}
const want = (part) => !only || only === part;

const isMock = core.IS_MOCK === true;
const outDir = path.join(here, 'results', quick ? 'quick' : '');
fs.mkdirSync(outDir, { recursive: true });

const log = (msg) => console.log(msg);

function banner() {
  if (isMock) {
    log('!'.repeat(78));
    log('! bench/core.js points at bench/mockCore.js. These numbers are MEANINGLESS.');
    log('! Switch bench/core.js to ../src/core/index.js before using any result in a report.');
    log('!'.repeat(78));
  }
  log(`Core: ${isMock ? 'MOCK' : 'real (src/core)'} | Mode: ${quick ? 'quick' : 'full'} | Output: ${path.relative(process.cwd(), outDir) || '.'}`);
}

// ----- CSV helpers -------------------------------------------------------------------------
function csvCell(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function toCsv(rows, columns) {
  const cols = columns ?? Object.keys(rows[0] ?? {});
  return [cols.join(','), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(','))].join('\n') + '\n';
}
function writeJson(name, obj) {
  fs.writeFileSync(path.join(outDir, name), JSON.stringify(obj, null, 2) + '\n');
}
function writeText(name, text) {
  fs.writeFileSync(path.join(outDir, name), text);
}
function readJsonIfExists(name) {
  const p = path.join(outDir, name);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
}

const meta = () => ({
  generated_at: new Date().toISOString(),
  core: isMock ? 'mock' : 'real',
  mode: quick ? 'quick' : 'full',
  ...(isMock ? { WARNING: 'Produced with bench/mockCore.js. Numbers are meaningless; never cite them.' } : {}),
});

// ----- Charts ------------------------------------------------------------------------------
function writeCharts() {
  const runtime = readJsonIfExists('runtime.json');
  if (runtime) {
    writeText('runtime.svg', sceneToSvg(runtimeScene(runtime, { logLog: true })));
    writeText('runtime_linear.svg', sceneToSvg(runtimeScene(runtime, { logLog: false })));
    log('  wrote runtime.svg, runtime_linear.svg');
  }
  const strategies = readJsonIfExists('strategies.json');
  if (strategies) {
    writeText('strategies.svg', sceneToSvg(strategyScene(strategies)));
    log('  wrote strategies.svg');
  }
  const brute = readJsonIfExists('bruteforce.json');
  if (brute) {
    writeText('bruteforce.svg', sceneToSvg(bruteScene(brute)));
    log('  wrote bruteforce.svg');
  }
}

// ----- Main --------------------------------------------------------------------------------
async function main() {
  banner();
  if (chartsOnly) {
    log('Drawing charts from existing JSON files...');
    writeCharts();
    return;
  }

  const durations = {};
  const seeds = {};
  const t0 = performance.now();

  if (want('runtime')) {
    log('\n[1/3] Runtime benchmark (10.1)');
    const opts = quick
      ? { sizes: [50, 500, 5000], extraSizes: [], warmup: 1, runs: 3 }
      : { ...(flag('no-200k') ? { extraSizes: [] } : {}) };
    const pm = value('playout-max');
    if (pm) opts.playOutMaxV = Number(pm);
    const t = performance.now();
    const res = await runtimeBench(opts, log);
    durations.runtime_s = (performance.now() - t) / 1000;
    const o = res.options;
    seeds.runtime = { graphSeed: o.graphSeed, pathGraphSeed: o.pathGraphSeed, levelSeedBase: o.levelSeed, sizes: o.sizes, extraSizes: o.extraSizes, warmup: o.warmup, runs: o.runs, playOutMaxV: o.playOutMaxV };
    writeJson('runtime.json', { meta: meta(), ...res });
    writeText('runtime.csv', toCsv(res.rows, ['algorithm', 'V', 'E', 'warmup', 'runs', 'median_ms', 'q1_ms', 'q3_ms', 'min_ms', 'max_ms', 'mean_ms', 'std_ms', 'ns_per_element', 'ok', 'error']));
    log('  log-log slopes (about 1 means linear):');
    for (const f of res.fits) log(`    ${f.algorithm.padEnd(40)} slope(all sizes)=${f.slope_all_sizes.toFixed(3)}  slope(V>=500)=${f.slope_V_ge_500 === null ? 'n/a' : f.slope_V_ge_500.toFixed(3)}`);
  }

  if (want('strategies')) {
    log('\n[2/3] Strategy comparison (10.2)');
    const opts = quick
      ? { configs: [{ n: 15, k: 1 }, { n: 15, k: 2 }, { n: 30, k: 1 }, { n: 30, k: 2 }], seedCount: 10, randomPlayouts: 5, bruteTimeLimitMs: 2000 }
      : {};
    const t = performance.now();
    const res = await strategyBench(opts, log);
    durations.strategies_s = (performance.now() - t) / 1000;
    const o = res.options;
    seeds.strategies = { seedStart: o.seedStart, seedCount: o.seedCount, randomPlayoutsPerLevel: o.randomPlayouts, targetPercent: o.targetPercent, bruteTimeLimitMs: o.bruteTimeLimitMs, configs: o.configs.map((c) => ({ ...c, seedRange: [o.seedStart, o.seedStart + (c.seedCount ?? o.seedCount) - 1] })) };
    writeJson('strategies.json', { meta: meta(), ...res });
    writeText('strategies.csv', toCsv(res.rows));
  }

  if (want('bruteforce')) {
    log('\n[3/3] Brute-force scaling (10.3)');
    const opts = quick ? { nMin: 8, nMax: 12, seeds: 2, timeLimitMs: 2000 } : {};
    const t = performance.now();
    const res = await bruteScalingBench(opts, log);
    durations.bruteforce_s = (performance.now() - t) / 1000;
    const o = res.options;
    seeds.bruteforce = { seedStart: o.seedStart, seedsPerN: o.seeds, nRange: [o.nMin, o.nMax], k: o.k, sources: o.sources, timeLimitMs: o.timeLimitMs };
    writeJson('bruteforce.json', { meta: meta(), ...res });
    writeText('bruteforce.csv', toCsv(res.summary));
    if (res.growth) log(`  fitted growth factor per extra node: x${res.growth.growth_factor_per_extra_node.toFixed(2)} (R^2 ${res.growth.r2_log_fit.toFixed(3)})`);
  }

  durations.total_s = (performance.now() - t0) / 1000;

  // environment.json: merge with an earlier partial run so seeds of other parts are kept.
  const prev = readJsonIfExists('environment.json');
  const cpus = os.cpus();
  writeJson('environment.json', {
    meta: meta(),
    node_version: process.version,
    v8_version: process.versions.v8,
    os_platform: os.platform(),
    os_release: os.release(),
    os_arch: os.arch(),
    cpu_model: cpus.length ? cpus[0].model : 'unknown',
    cpu_cores: cpus.length,
    total_memory_gb: Math.round((os.totalmem() / 1024 ** 3) * 100) / 100,
    timestamp: new Date().toISOString(),
    seeds: { ...(prev?.seeds ?? {}), ...seeds },
    durations_s: { ...(prev?.durations_s ?? {}), ...durations },
    run_flags: args,
  });

  log('\nDrawing charts...');
  writeCharts();
  log(`\nDone in ${durations.total_s.toFixed(1)} s. Results are in ${path.relative(process.cwd(), outDir) || '.'}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
