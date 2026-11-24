// bench/tables.js
// Prints (and saves as bench/results/tables.md) the Markdown tables used in docs/EVALUATION.md
// and docs/REPORT.md, generated straight from the JSON files in bench/results/. Copying these
// tables instead of retyping numbers guarantees that the documents match the real run.
//
//   node bench/tables.js            reads bench/results/*.json
//   node bench/tables.js --quick    reads bench/results/quick/*.json

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const quick = process.argv.includes('--quick');
const dir = path.join(here, 'results', quick ? 'quick' : '');

const read = (name) => {
  const p = path.join(dir, name);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
};

const ms = (v) => (!Number.isFinite(v) ? '-' : v >= 100 ? v.toFixed(1) : v >= 1 ? v.toFixed(2) : v.toFixed(4));
const f = (d) => (v) => (v === null || v === undefined || !Number.isFinite(v) ? '-' : v.toFixed(d));
const pct = (v) => (v === null || v === undefined ? '-' : `${(v * 100).toFixed(1)}%`);
const dash = (v) => (v === null || v === undefined ? '-' : String(v));

function table(headers, rows) {
  const line = (cells) => `| ${cells.join(' | ')} |`;
  return [line(headers), line(headers.map(() => '---')), ...rows.map(line)].join('\n');
}

const out = [];
const section = (title, body) => out.push(`### ${title}\n\n${body}\n`);

const env = read('environment.json');
if (env) {
  section('Environment', table(['Item', 'Value'], [
    ['Core used', env.meta.core],
    ['Node.js', env.node_version],
    ['OS', `${env.os_platform} ${env.os_release} (${env.os_arch})`],
    ['CPU', `${env.cpu_model}, ${env.cpu_cores} cores`],
    ['Total memory', `${env.total_memory_gb} GB`],
    ['Timestamp', env.timestamp],
    ...Object.entries(env.durations_s ?? {}).map(([k, v]) => [`Duration ${k.replace('_s', '')}`, `${v.toFixed(1)} s`]),
  ]));
}

const rt = read('runtime.json');
if (rt) {
  section('Runtime (10.1)', table(
    ['Algorithm', 'V', 'E', 'median ms', 'Q1 ms', 'Q3 ms', 'min ms', 'max ms', 'ns per (V+E)'],
    rt.rows.map((r) => [r.algorithm, r.V, r.E, ms(r.median_ms), ms(r.q1_ms), ms(r.q3_ms), ms(r.min_ms), ms(r.max_ms), r.ok ? f(1)(r.ns_per_element) : `FAILED: ${r.error}`]),
  ));
  section('Log-log slope of runtime vs V + E', table(
    ['Algorithm', 'points', 'slope (all sizes)', 'R^2 (all sizes)', 'slope (V >= 500)', 'R^2 (V >= 500)'],
    rt.fits.map((x) => [x.algorithm, x.points, f(3)(x.slope_all_sizes), f(3)(x.r2_all_sizes), f(3)(x.slope_V_ge_500), f(3)(x.r2_V_ge_500)]),
  ));
}

const st = read('strategies.json');
if (st) {
  section('Strategy comparison (10.2)', table(
    ['n', 'k', 'sources', 'levels', 'strategy', 'games', 'mean saved %', 'std %', 'win rate', 'Citadel survival', 'mean ms per game'],
    st.rows.map((r) => [r.n, r.k, r.sources, r.levels, r.strategy, r.games, f(1)(r.mean_saved_pct), f(1)(r.std_saved_pct), pct(r.win_rate), pct(r.citadel_survival_rate), f(3)(r.mean_ms_per_game)]),
  ));
  section('Optimality gap against brute force (n <= 20)', table(
    ['n', 'k', 'strategy', 'approx ratio (mean)', 'approx ratio (min)', 'equals optimum', 'levels above optimum', 'brute-force truncated levels'],
    st.rows.filter((r) => r.approx_ratio_mean !== null).map((r) => [r.n, r.k, r.strategy, f(3)(r.approx_ratio_mean), f(3)(r.approx_ratio_min), pct(r.equals_optimum_fraction), dash(r.levels_exceeding_optimum), dash(r.truncated_levels)]),
  ));
  section('How often Articulation-Aware Greedy strictly beats the baselines', table(
    ['n', 'k', 'levels', 'vs Max-Degree: wins / ties / losses', 'vs Random (mean of playouts): wins / ties / losses'],
    st.comparisons.map((c) => [c.n, c.k, c.levels, `${c.aag_vs_maxDegree.wins} / ${c.aag_vs_maxDegree.ties} / ${c.aag_vs_maxDegree.losses}`, `${c.aag_vs_random_mean.wins} / ${c.aag_vs_random_mean.ties} / ${c.aag_vs_random_mean.losses}`]),
  ));
}

const bf = read('bruteforce.json');
if (bf) {
  section('Brute-force scaling (10.3)', table(
    ['n', 'seeds', 'median ms', 'min ms', 'max ms', 'median explored states', 'truncated runs', 'median time ratio to previous n'],
    bf.summary.map((s) => [s.n, s.seeds, ms(s.median_ms), ms(s.min_ms), ms(s.max_ms), dash(s.median_explored), s.truncated_runs, f(2)(s.ratio_to_previous_n)]),
  ));
  if (bf.growth) out.push(`Fitted growth: x${bf.growth.growth_factor_per_extra_node.toFixed(2)} per extra node (R^2 = ${bf.growth.r2_log_fit.toFixed(3)}, ${bf.growth.points} points without truncation).\n`);
}

const text = out.join('\n');
fs.writeFileSync(path.join(dir, 'tables.md'), text);
console.log(text);
