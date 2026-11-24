// bench/stats.js
// Small statistics helpers used by the benchmarks. Pure functions, no dependencies,
// safe to import both from Node and from the browser (bench.html).

/** Returns a sorted Float64Array copy of `a`. */
function sortedCopy(a) {
  return Float64Array.from(a).sort();
}

/** Quantile with linear interpolation (the same rule as numpy's default). p in [0, 1]. */
export function quantile(a, p) {
  const s = sortedCopy(a);
  if (s.length === 0) return NaN;
  const pos = (s.length - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

export const median = (a) => quantile(a, 0.5);

export function mean(a) {
  if (a.length === 0) return NaN;
  let sum = 0;
  for (const x of a) sum += x;
  return sum / a.length;
}

/** Sample standard deviation (n - 1 in the denominator). Returns 0 for fewer than 2 values. */
export function std(a) {
  if (a.length < 2) return 0;
  const m = mean(a);
  let ss = 0;
  for (const x of a) ss += (x - m) * (x - m);
  return Math.sqrt(ss / (a.length - 1));
}

export function min(a) {
  let r = Infinity;
  for (const x of a) if (x < r) r = x;
  return r;
}

export function max(a) {
  let r = -Infinity;
  for (const x of a) if (x > r) r = x;
  return r;
}

/** Summary used for every timing row: median, IQR (q1 to q3), min, max, mean, std. */
export function summarize(a) {
  return {
    n: a.length,
    mean: mean(a),
    std: std(a),
    median: median(a),
    q1: quantile(a, 0.25),
    q3: quantile(a, 0.75),
    min: min(a),
    max: max(a),
  };
}

/** Ordinary least squares y = intercept + slope * x. Needs at least 2 points. */
export function linearRegression(x, y) {
  const n = x.length;
  if (n < 2) return { slope: NaN, intercept: NaN, r2: NaN };
  const mx = mean(x);
  const my = mean(y);
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (x[i] - mx) * (x[i] - mx);
    sxy += (x[i] - mx) * (y[i] - my);
    syy += (y[i] - my) * (y[i] - my);
  }
  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  const r2 = syy === 0 ? 1 : (sxy * sxy) / (sxx * syy);
  return { slope, intercept, r2 };
}

/** Fits log10(y) = a + slope * log10(x). A slope near 1 means linear growth. Ignores non-positive values. */
export function logLogFit(x, y) {
  const lx = [];
  const ly = [];
  for (let i = 0; i < x.length; i++) {
    if (x[i] > 0 && y[i] > 0) {
      lx.push(Math.log10(x[i]));
      ly.push(Math.log10(y[i]));
    }
  }
  return linearRegression(lx, ly);
}

/** Fits ln(y) = a + slope * x. exp(slope) is the multiplicative growth per unit step of x. */
export function expFit(x, y) {
  const xs = [];
  const ly = [];
  for (let i = 0; i < x.length; i++) {
    if (y[i] > 0) {
      xs.push(x[i]);
      ly.push(Math.log(y[i]));
    }
  }
  const fit = linearRegression(xs, ly);
  return { ...fit, factorPerStep: Math.exp(fit.slope) };
}
