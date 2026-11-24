// bench/charts.js
// Tiny hand-written charts, no libraries. Charts are first built as a "scene" (a list of lines,
// rects, markers and text items) and then drawn by one of two renderers:
//   renderCanvas(canvas, scene)  - used by bench.html (browser)
//   sceneToSvg(scene)            - used by bench/run.js to write static SVG files (Node)
// Because both renderers consume the same scene, the in-browser charts and the SVG files used in
// the documents look the same. Charts do not rely on color alone: every series has its own marker
// shape and line style, bars have hatch patterns, and every chart has axis titles and a legend.

const PALETTE = ['#0072B2', '#D55E00', '#009E73', '#CC79A7', '#E69F00', '#56B4E9', '#444444'];
const MARKERS = ['circle', 'square', 'triangle', 'diamond', 'cross', 'plus', 'circle'];
const DASHES = [null, [7, 3], [2, 3], [9, 3, 2, 3], [4, 4], null, [7, 3]];
const HATCHES = [0, 1, 2, 3, 1, 2, 3]; // 0 solid, 1 '/', 2 '\', 3 dots
const INK = '#222222';
const GRID = '#dddddd';

// ---------------------------------------------------------------------------------------------
// Scale and tick helpers
// ---------------------------------------------------------------------------------------------

function makeScale(type, lo, hi) {
  if (type === 'log') {
    const a = Math.log10(lo);
    const b = Math.log10(hi);
    return { type, lo, hi, map: (v) => (Math.log10(v) - a) / (b - a) };
  }
  return { type, lo, hi, map: (v) => (v - lo) / (hi - lo) };
}

function linearTicks(lo, hi, count = 6) {
  const raw = (hi - lo) / count || 1;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
  const ticks = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) ticks.push(+v.toPrecision(12));
  return ticks;
}

function logTicks(lo, hi) {
  const out = [];
  for (let e = Math.round(Math.log10(lo)); e <= Math.round(Math.log10(hi)); e++) out.push(Math.pow(10, e));
  return out;
}

function fmt(v) {
  if (v === 0) return '0';
  const a = Math.abs(v);
  if (a >= 1e5 || a < 1e-3) return v.toExponential(0).replace('e+', 'e');
  return String(+v.toPrecision(6));
}

/** Axis range and ticks for a set of values. */
function axisFor(values, type, forceZero) {
  const vals = values.filter((v) => Number.isFinite(v) && (type !== 'log' || v > 0));
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  if (!Number.isFinite(lo)) { lo = 1; hi = 10; }
  if (type === 'log') {
    lo = Math.pow(10, Math.floor(Math.log10(lo)));
    hi = Math.pow(10, Math.ceil(Math.log10(hi)));
    if (hi === lo) hi = lo * 10;
    return { scale: makeScale('log', lo, hi), ticks: logTicks(lo, hi) };
  }
  if (forceZero) lo = Math.min(0, lo);
  if (hi === lo) hi = lo + 1;
  const ticks = linearTicks(lo, hi);
  const nlo = Math.min(lo, ticks[0]);
  const nhi = Math.max(hi, ticks[ticks.length - 1]);
  return { scale: makeScale('lin', nlo, nhi), ticks };
}

// ---------------------------------------------------------------------------------------------
// Scene building
// ---------------------------------------------------------------------------------------------

function newScene(width, height) {
  return { width, height, items: [] };
}

function drawFrame(sc, plot, o) {
  const { l, t, r, b } = plot;
  const X = (v) => l + o.xs.map(v) * (r - l);
  const Y = (v) => b - o.ys.map(v) * (b - t);
  for (const tv of o.yTicks) {
    const y = Y(tv);
    sc.items.push({ t: 'line', x1: l, y1: y, x2: r, y2: y, stroke: GRID, width: 1 });
    sc.items.push({ t: 'text', x: l - 8, y: y + 4, s: o.yFmt ? o.yFmt(tv) : fmt(tv), size: 12, anchor: 'end', fill: INK });
  }
  for (const tv of o.xTicks) {
    const x = X(tv);
    if (!o.noXGrid) sc.items.push({ t: 'line', x1: x, y1: t, x2: x, y2: b, stroke: GRID, width: 1 });
    sc.items.push({ t: 'line', x1: x, y1: b, x2: x, y2: b + 5, stroke: INK, width: 1 });
    sc.items.push({ t: 'text', x, y: b + 20, s: o.xFmt ? o.xFmt(tv) : fmt(tv), size: 12, anchor: 'middle', fill: INK });
  }
  sc.items.push({ t: 'line', x1: l, y1: t, x2: l, y2: b, stroke: INK, width: 1.5 });
  sc.items.push({ t: 'line', x1: l, y1: b, x2: r, y2: b, stroke: INK, width: 1.5 });
  sc.items.push({ t: 'text', x: (l + r) / 2, y: sc.height - 14, s: o.xTitle, size: 13, anchor: 'middle', weight: 'bold', fill: INK });
  sc.items.push({ t: 'text', x: 18, y: (t + b) / 2, s: o.yTitle, size: 13, anchor: 'middle', weight: 'bold', fill: INK, rotate: -90 });
  sc.items.push({ t: 'text', x: sc.width / 2, y: 24, s: o.title, size: 15, anchor: 'middle', weight: 'bold', fill: INK });
  return { X, Y };
}

function legendItems(sc, x, y, entries) {
  entries.forEach((e, i) => {
    const yy = y + i * 24;
    if (e.kind === 'bar') {
      sc.items.push({ t: 'rect', x, y: yy - 9, w: 22, h: 14, fill: e.color, hatch: e.hatch, stroke: INK });
    } else {
      if (!e.noLine) sc.items.push({ t: 'line', x1: x, y1: yy - 2, x2: x + 26, y2: yy - 2, stroke: e.color, width: 2, dash: e.dash });
      if (!e.noMarker) sc.items.push({ t: 'marker', shape: e.marker, x: x + 13, y: yy - 2, r: 5, fill: e.hollow ? '#ffffff' : e.color, stroke: e.color });
    }
    sc.items.push({ t: 'text', x: x + 34, y: yy + 2, s: e.label, size: 12, anchor: 'start', fill: INK });
  });
}

/**
 * Generic line chart.
 * series: [{ label, points: [{ x, y, lo?, hi?, hollow? }], noLine?, noMarker?, dashOverride?, color? }]
 * hLines: [{ y, label }] horizontal reference lines.
 */
export function lineChartScene({ title, xTitle, yTitle, series, xLog = false, yLog = false, xIntegerTicks = false, hLines = [], width = 960, height = 540 }) {
  const sc = newScene(width, height);
  const plot = { l: 84, t: 46, r: width - 270, b: height - 62 };
  const xs = [];
  const ys = [];
  for (const s of series) for (const p of s.points) {
    xs.push(p.x); ys.push(p.y);
    if (p.lo !== undefined) ys.push(p.lo);
    if (p.hi !== undefined) ys.push(p.hi);
  }
  for (const h of hLines) ys.push(h.y);
  const ax = axisFor(xs, xLog ? 'log' : 'lin', !xLog && !xIntegerTicks);
  const ay = axisFor(ys, yLog ? 'log' : 'lin', !yLog);
  let xTicks = ax.ticks;
  if (xIntegerTicks) xTicks = Array.from(new Set(xs)).sort((a, b) => a - b);
  const xScale = xIntegerTicks ? makeScale('lin', Math.min(...xs) - 0.5, Math.max(...xs) + 0.5) : ax.scale;
  const { X, Y } = drawFrame(sc, plot, { xs: xScale, ys: ay.scale, xTicks, yTicks: ay.ticks, xTitle, yTitle, title });

  for (const h of hLines) {
    if (!(h.y >= ay.scale.lo && h.y <= ay.scale.hi)) continue;
    sc.items.push({ t: 'line', x1: plot.l, y1: Y(h.y), x2: plot.r, y2: Y(h.y), stroke: '#990000', width: 1.5, dash: [3, 3] });
    sc.items.push({ t: 'text', x: plot.r - 4, y: Y(h.y) - 5, s: h.label, size: 11, anchor: 'end', fill: '#990000' });
  }

  const legend = [];
  series.forEach((s, i) => {
    const color = s.color ?? PALETTE[i % PALETTE.length];
    const marker = MARKERS[i % MARKERS.length];
    const dash = s.dashOverride !== undefined ? s.dashOverride : DASHES[i % DASHES.length];
    const pts = s.points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y) && (!xLog || p.x > 0) && (!yLog || p.y > 0));
    if (!s.noLine && pts.length > 1) sc.items.push({ t: 'poly', pts: pts.map((p) => [X(p.x), Y(p.y)]), stroke: color, width: 2, dash });
    for (const p of pts) {
      if (p.lo !== undefined && p.hi !== undefined && p.lo > 0 && p.hi >= p.lo) {
        const x = X(p.x);
        sc.items.push({ t: 'line', x1: x, y1: Y(p.lo), x2: x, y2: Y(p.hi), stroke: color, width: 1.2 });
        sc.items.push({ t: 'line', x1: x - 4, y1: Y(p.lo), x2: x + 4, y2: Y(p.lo), stroke: color, width: 1.2 });
        sc.items.push({ t: 'line', x1: x - 4, y1: Y(p.hi), x2: x + 4, y2: Y(p.hi), stroke: color, width: 1.2 });
      }
      if (!s.noMarker) sc.items.push({ t: 'marker', shape: marker, x: X(p.x), y: Y(p.y), r: 5, fill: p.hollow ? '#ffffff' : color, stroke: color });
    }
    legend.push({ label: s.label, color, marker, dash, noLine: s.noLine, noMarker: s.noMarker });
  });
  legendItems(sc, plot.r + 22, plot.t + 12, legend);
  return sc;
}

/**
 * Grouped bar chart with error bars.
 * groups: [{ labelLines: string[], bars: [{ series: number, value, err? }] }], seriesLabels: string[]
 */
export function barChartScene({ title, xTitle, yTitle, groups, seriesLabels, yMax = 100, width = 1060, height = 560 }) {
  const sc = newScene(width, height);
  const plot = { l: 84, t: 46, r: width - 250, b: height - 100 };
  const ys = makeScale('lin', 0, yMax);
  const xs = makeScale('lin', 0, groups.length);
  const { Y } = drawFrame(sc, plot, { xs, ys, xTicks: [], yTicks: linearTicks(0, yMax, 5), xTitle, yTitle, title, noXGrid: true });
  const gw = (plot.r - plot.l) / groups.length;
  groups.forEach((g, gi) => {
    const x0 = plot.l + gi * gw;
    const inner = gw * 0.8;
    const bw = inner / seriesLabels.length;
    const start = x0 + (gw - inner) / 2;
    g.bars.forEach((b) => {
      const bx = start + b.series * bw;
      const top = Y(Math.min(b.value, yMax));
      sc.items.push({ t: 'rect', x: bx + 1, y: top, w: bw - 2, h: plot.b - top, fill: PALETTE[b.series % PALETTE.length], hatch: HATCHES[b.series % HATCHES.length], stroke: INK });
      if (b.err > 0) {
        const cx = bx + bw / 2;
        const y1 = Y(Math.max(0, b.value - b.err));
        const y2 = Y(Math.min(yMax, b.value + b.err));
        sc.items.push({ t: 'line', x1: cx, y1, x2: cx, y2, stroke: INK, width: 1.4 });
        sc.items.push({ t: 'line', x1: cx - 3, y1, x2: cx + 3, y2: y1, stroke: INK, width: 1.4 });
        sc.items.push({ t: 'line', x1: cx - 3, y1: y2, x2: cx + 3, y2, stroke: INK, width: 1.4 });
      }
    });
    g.labelLines.forEach((line, li) => {
      sc.items.push({ t: 'text', x: x0 + gw / 2, y: plot.b + 18 + li * 15, s: line, size: 12, anchor: 'middle', fill: INK });
    });
  });
  legendItems(sc, plot.r + 22, plot.t + 12, seriesLabels.map((label, i) => ({ kind: 'bar', label, color: PALETTE[i % PALETTE.length], hatch: HATCHES[i % HATCHES.length] })));
  sc.items.push({ t: 'text', x: plot.r + 22, y: plot.t + 12 + seriesLabels.length * 24 + 14, s: 'Bars: mean; error bars: +/- 1 std', size: 11, anchor: 'start', fill: INK });
  return sc;
}

// ---------------------------------------------------------------------------------------------
// Results -> scenes
// ---------------------------------------------------------------------------------------------

const RUNTIME_LABELS = {
  bfsLayers: 'bfsLayers',
  connectedComponents: 'connectedComponents',
  articulationPointsAndBridges: 'Tarjan (random graph)',
  articulationPointsAndBridges_pathGraph: 'Tarjan (path graph)',
  playOut_articulationGreedy: 'Full game (greedy playOut)',
};

export function runtimeScene(runtime, { logLog = true } = {}) {
  const ids = [...new Set(runtime.rows.map((r) => r.algorithm))];
  const series = ids.map((id) => ({
    label: RUNTIME_LABELS[id] ?? id,
    points: runtime.rows.filter((r) => r.algorithm === id && r.ok).map((r) => ({ x: r.V + r.E, y: r.median_ms, lo: r.q1_ms, hi: r.q3_ms })),
  }));
  // Reference line with slope 1: time = c * (V + E), with c taken from the median ns/element of the linear algorithms.
  const nsList = runtime.rows.filter((r) => r.ok && r.algorithm !== 'playOut_articulationGreedy').map((r) => r.ns_per_element).sort((a, b) => a - b);
  const xsAll = runtime.rows.filter((r) => r.ok).map((r) => r.V + r.E);
  if (nsList.length > 0 && xsAll.length > 0) {
    const c = (nsList[Math.floor(nsList.length / 2)]) / 1e6;
    const xMin = Math.min(...xsAll);
    const xMax = Math.max(...xsAll);
    series.push({ label: 'Linear reference (slope 1)', points: [{ x: xMin, y: c * xMin }, { x: xMax, y: c * xMax }], noMarker: true, color: '#990000', dashOverride: [3, 3] });
  }
  return lineChartScene({
    title: `Runtime vs input size (${logLog ? 'log-log' : 'linear'}); bars show Q1 to Q3`,
    xTitle: 'Input size V + E (number of elements)',
    yTitle: 'Median runtime per call (ms)',
    series,
    xLog: logLog,
    yLog: logLog,
  });
}

const STRATEGY_LABELS = { random: 'Random (20 playouts/level)', maxDegree: 'Max-Degree', articulationGreedy: 'Articulation-Aware Greedy', bruteForce: 'Brute force (optimum)' };
const STRATEGY_ORDER = ['random', 'maxDegree', 'articulationGreedy', 'bruteForce'];

export function strategyScene(strategies) {
  const configs = [];
  for (const r of strategies.rows) {
    if (!configs.some((c) => c.n === r.n && c.k === r.k)) configs.push({ n: r.n, k: r.k, levels: r.levels });
  }
  const groups = configs.map((c) => ({
    labelLines: [`n=${c.n}`, `k=${c.k}`, `${c.levels} levels`],
    bars: strategies.rows
      .filter((r) => r.n === c.n && r.k === c.k)
      .map((r) => ({ series: STRATEGY_ORDER.indexOf(r.strategy), value: r.mean_saved_pct, err: r.std_saved_pct })),
  }));
  return barChartScene({
    title: 'Mean saved population by strategy and configuration',
    xTitle: 'Configuration (n = nodes, k = actions per turn)',
    yTitle: 'Saved population (%)',
    groups,
    seriesLabels: STRATEGY_ORDER.map((id) => STRATEGY_LABELS[id]),
  });
}

export function bruteScene(brute) {
  const med = brute.summary.map((s) => ({ x: s.n, y: s.median_ms, lo: s.min_ms, hi: s.max_ms, hollow: s.truncated_runs > 0 }));
  const trunc = brute.summary.filter((s) => s.truncated_runs > 0).map((s) => ({ x: s.n, y: s.max_ms }));
  const series = [{ label: 'Median time (bars: min to max)', points: med }];
  if (trunc.length > 0) series.push({ label: 'Some runs hit the time limit', points: trunc, noLine: true, dashOverride: null });
  return lineChartScene({
    title: 'Brute-force time vs number of nodes (log scale)',
    xTitle: 'Number of nodes n',
    yTitle: 'Time per level (ms)',
    series,
    yLog: true,
    xIntegerTicks: true,
    hLines: [{ y: brute.options.timeLimitMs, label: `time limit ${brute.options.timeLimitMs} ms` }],
  });
}

// ---------------------------------------------------------------------------------------------
// Renderers
// ---------------------------------------------------------------------------------------------

function markerGeometry(shape, x, y, r) {
  switch (shape) {
    case 'square': return { kind: 'poly', pts: [[x - r, y - r], [x + r, y - r], [x + r, y + r], [x - r, y + r]] };
    case 'triangle': return { kind: 'poly', pts: [[x, y - r * 1.2], [x + r * 1.15, y + r * 0.9], [x - r * 1.15, y + r * 0.9]] };
    case 'diamond': return { kind: 'poly', pts: [[x, y - r * 1.3], [x + r * 1.3, y], [x, y + r * 1.3], [x - r * 1.3, y]] };
    case 'cross': return { kind: 'lines', segs: [[x - r, y - r, x + r, y + r], [x - r, y + r, x + r, y - r]] };
    case 'plus': return { kind: 'lines', segs: [[x - r * 1.2, y, x + r * 1.2, y], [x, y - r * 1.2, x, y + r * 1.2]] };
    default: return { kind: 'circle', x, y, r };
  }
}

/** Draw a scene on a 2D canvas. Sets the canvas size to the scene size. */
export function renderCanvas(canvas, scene) {
  canvas.width = scene.width;
  canvas.height = scene.height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, scene.width, scene.height);
  for (const it of scene.items) {
    switch (it.t) {
      case 'line':
        ctx.beginPath(); ctx.moveTo(it.x1, it.y1); ctx.lineTo(it.x2, it.y2);
        ctx.strokeStyle = it.stroke; ctx.lineWidth = it.width; ctx.setLineDash(it.dash || []); ctx.stroke(); ctx.setLineDash([]);
        break;
      case 'poly':
        ctx.beginPath(); it.pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
        ctx.strokeStyle = it.stroke; ctx.lineWidth = it.width; ctx.setLineDash(it.dash || []); ctx.stroke(); ctx.setLineDash([]);
        break;
      case 'rect':
        ctx.fillStyle = it.fill; ctx.fillRect(it.x, it.y, it.w, it.h);
        if (it.hatch) hatchCanvas(ctx, it);
        ctx.strokeStyle = it.stroke; ctx.lineWidth = 1; ctx.strokeRect(it.x, it.y, it.w, it.h);
        break;
      case 'marker': {
        const g = markerGeometry(it.shape, it.x, it.y, it.r);
        ctx.fillStyle = it.fill; ctx.strokeStyle = it.stroke; ctx.lineWidth = 1.8;
        if (g.kind === 'circle') { ctx.beginPath(); ctx.arc(g.x, g.y, g.r, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
        else if (g.kind === 'poly') { ctx.beginPath(); g.pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.closePath(); ctx.fill(); ctx.stroke(); }
        else { ctx.beginPath(); for (const s of g.segs) { ctx.moveTo(s[0], s[1]); ctx.lineTo(s[2], s[3]); } ctx.stroke(); }
        break;
      }
      case 'text':
        ctx.save();
        ctx.translate(it.x, it.y);
        if (it.rotate) ctx.rotate((it.rotate * Math.PI) / 180);
        ctx.fillStyle = it.fill;
        ctx.font = `${it.weight === 'bold' ? 'bold ' : ''}${it.size}px sans-serif`;
        ctx.textAlign = it.anchor === 'end' ? 'right' : it.anchor === 'middle' ? 'center' : 'left';
        ctx.fillText(it.s, 0, 0);
        ctx.restore();
        break;
      default:
        break;
    }
  }
}

function hatchCanvas(ctx, it) {
  ctx.save();
  ctx.beginPath(); ctx.rect(it.x, it.y, it.w, it.h); ctx.clip();
  ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = 1;
  const step = 6;
  if (it.hatch === 1 || it.hatch === 2) {
    for (let d = -it.h; d < it.w + it.h; d += step) {
      ctx.beginPath();
      if (it.hatch === 1) { ctx.moveTo(it.x + d, it.y + it.h); ctx.lineTo(it.x + d + it.h, it.y); }
      else { ctx.moveTo(it.x + d, it.y); ctx.lineTo(it.x + d + it.h, it.y + it.h); }
      ctx.stroke();
    }
  } else if (it.hatch === 3) {
    for (let px = it.x + 3; px < it.x + it.w; px += step) for (let py = it.y + 3; py < it.y + it.h; py += step) { ctx.beginPath(); ctx.arc(px, py, 1.1, 0, Math.PI * 2); ctx.fill(); }
  }
  ctx.restore();
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const n2 = (v) => (Math.round(v * 100) / 100).toString();

/** Serialize a scene to a standalone SVG string (hand-written, no library). */
export function sceneToSvg(scene) {
  const out = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${scene.width}" height="${scene.height}" viewBox="0 0 ${scene.width} ${scene.height}" font-family="sans-serif">`);
  out.push('<defs>');
  out.push('<pattern id="h1" width="6" height="6" patternUnits="userSpaceOnUse"><path d="M0,6 L6,0" stroke="rgba(0,0,0,0.55)" stroke-width="1"/></pattern>');
  out.push('<pattern id="h2" width="6" height="6" patternUnits="userSpaceOnUse"><path d="M0,0 L6,6" stroke="rgba(0,0,0,0.55)" stroke-width="1"/></pattern>');
  out.push('<pattern id="h3" width="6" height="6" patternUnits="userSpaceOnUse"><circle cx="3" cy="3" r="1.1" fill="rgba(0,0,0,0.55)"/></pattern>');
  out.push('</defs>');
  out.push(`<rect width="${scene.width}" height="${scene.height}" fill="#ffffff"/>`);
  for (const it of scene.items) {
    switch (it.t) {
      case 'line':
        out.push(`<line x1="${n2(it.x1)}" y1="${n2(it.y1)}" x2="${n2(it.x2)}" y2="${n2(it.y2)}" stroke="${it.stroke}" stroke-width="${it.width}"${it.dash ? ` stroke-dasharray="${it.dash.join(' ')}"` : ''}/>`);
        break;
      case 'poly':
        out.push(`<polyline points="${it.pts.map((p) => `${n2(p[0])},${n2(p[1])}`).join(' ')}" fill="none" stroke="${it.stroke}" stroke-width="${it.width}"${it.dash ? ` stroke-dasharray="${it.dash.join(' ')}"` : ''}/>`);
        break;
      case 'rect':
        out.push(`<rect x="${n2(it.x)}" y="${n2(it.y)}" width="${n2(it.w)}" height="${n2(it.h)}" fill="${it.fill}" stroke="${it.stroke}" stroke-width="1"/>`);
        if (it.hatch) out.push(`<rect x="${n2(it.x)}" y="${n2(it.y)}" width="${n2(it.w)}" height="${n2(it.h)}" fill="url(#h${it.hatch})"/>`);
        break;
      case 'marker': {
        const g = markerGeometry(it.shape, it.x, it.y, it.r);
        const style = `fill="${it.fill}" stroke="${it.stroke}" stroke-width="1.8"`;
        if (g.kind === 'circle') out.push(`<circle cx="${n2(g.x)}" cy="${n2(g.y)}" r="${g.r}" ${style}/>`);
        else if (g.kind === 'poly') out.push(`<polygon points="${g.pts.map((p) => `${n2(p[0])},${n2(p[1])}`).join(' ')}" ${style}/>`);
        else out.push(`<path d="${g.segs.map((s) => `M${n2(s[0])},${n2(s[1])} L${n2(s[2])},${n2(s[3])}`).join(' ')}" fill="none" stroke="${it.stroke}" stroke-width="1.8"/>`);
        break;
      }
      case 'text': {
        const anchor = it.anchor || 'start';
        const tr = it.rotate ? ` transform="rotate(${it.rotate} ${n2(it.x)} ${n2(it.y)})"` : '';
        out.push(`<text x="${n2(it.x)}" y="${n2(it.y)}" font-size="${it.size}" text-anchor="${anchor}" fill="${it.fill}"${it.weight === 'bold' ? ' font-weight="bold"' : ''}${tr}>${esc(it.s)}</text>`);
        break;
      }
      default:
        break;
    }
  }
  out.push('</svg>');
  return out.join('\n');
}

/** Browser only: download the canvas as a PNG file. */
export function downloadPng(canvas, filename) {
  canvas.toBlob((blob) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, 'image/png');
}
