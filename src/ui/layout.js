/**
 * @file layout.js
 * Maps normalized level coordinates (x, y in [0, 1]) to responsive canvas
 * CSS pixel coordinates and provides fast node and edge hit-testing.
 */

/**
 * Computes responsive screen-space coordinates and radii for all nodes in a level.
 * Leaves comfortable padding for the top HUD bar and bottom control toolbar.
 *
 * @param {object | null} level
 * @param {number} width Viewport width in CSS pixels
 * @param {number} height Viewport height in CSS pixels
 * @returns {{
 *   nodes: { id: number, x: number, y: number, r: number, population: number, isCitadel: boolean }[],
 *   baseRadius: number,
 *   bounds: { left: number, top: number, right: number, bottom: number, width: number, height: number }
 * }}
 */
export function computeLayout(level, width, height) {
  if (!level || !level.nodes || level.nodes.length === 0) {
    return {
      nodes: [],
      baseRadius: 16,
      bounds: { left: 0, top: 0, right: width, bottom: height, width, height }
    };
  }

  const isCompact = width < 760;
  const padTop = isCompact ? 118 : 96;
  const padBottom = isCompact ? 115 : 94;
  const padLeft = width > 960 ? 158 : Math.max(36, width * 0.055);
  const padRight = Math.max(38, width * 0.055);

  const availW = Math.max(160, width - padLeft - padRight);
  const availH = Math.max(160, height - padTop - padBottom);

  // Normalize actual node bounding box so the graph fills the play area nicely
  let minX = 1;
  let maxX = 0;
  let minY = 1;
  let maxY = 0;

  for (let i = 0; i < level.nodes.length; i++) {
    const n = level.nodes[i];
    if (n.x < minX) minX = n.x;
    if (n.x > maxX) maxX = n.x;
    if (n.y < minY) minY = n.y;
    if (n.y > maxY) maxY = n.y;
  }

  const spanX = Math.max(0.25, maxX - minX);
  const spanY = Math.max(0.25, maxY - minY);

  // Scale node radius inversely with square root of node count (smooth from n=10 to n=80)
  const minDim = Math.min(availW, availH);
  const densityScale = Math.sqrt(22 / Math.max(10, level.n));
  const baseRadius = Math.max(11, Math.min(22, Math.round(minDim * 0.032 * densityScale)));

  const layoutNodes = new Array(level.nodes.length);
  for (let i = 0; i < level.nodes.length; i++) {
    const src = level.nodes[i];
    const nx = (src.x - minX) / spanX;
    const ny = (src.y - minY) / spanY;
    const x = padLeft + nx * availW;
    const y = padTop + ny * availH;
    const r = src.isCitadel ? Math.round(baseRadius * 1.38) : baseRadius;

    layoutNodes[i] = {
      id: src.id,
      x,
      y,
      r,
      population: src.population,
      isCitadel: Boolean(src.isCitadel)
    };
  }

  return {
    nodes: layoutNodes,
    baseRadius,
    bounds: {
      left: padLeft,
      top: padTop,
      right: padLeft + availW,
      bottom: padTop + availH,
      width: availW,
      height: availH
    }
  };
}

/**
 * Picks the closest settlement node under pointer coordinates (px, py).
 *
 * @param {number} px Pointer X in CSS pixels
 * @param {number} py Pointer Y in CSS pixels
 * @param {{ nodes: { id: number, x: number, y: number, r: number }[] }} layout
 * @param {number} [slop=7] Extra hit-testing radius in pixels for touch friendliness
 * @returns {number} Node ID or -1 if none hit
 */
export function pickNode(px, py, layout, slop = 7) {
  if (!layout || !layout.nodes) return -1;
  let bestId = -1;
  let bestDistSq = Infinity;

  for (let i = 0; i < layout.nodes.length; i++) {
    const node = layout.nodes[i];
    const dx = px - node.x;
    const dy = py - node.y;
    const distSq = dx * dx + dy * dy;
    const hitR = node.r + slop;
    if (distSq <= hitR * hitR && distSq < bestDistSq) {
      bestDistSq = distSq;
      bestId = node.id;
    }
  }

  return bestId;
}

/**
 * Computes distance from point (px, py) to segment (x1, y1)-(x2, y2) and projection factor t in [0, 1].
 */
function pointToSegment(px, py, x1, y1, x2, y2) {
  const vx = x2 - x1;
  const vy = y2 - y1;
  const lenSq = vx * vx + vy * vy;
  if (lenSq <= 1e-6) {
    return { dist: Math.hypot(px - x1, py - y1), t: 0 };
  }
  let t = ((px - x1) * vx + (py - y1) * vy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const projX = x1 + t * vx;
  const projY = y1 + t * vy;
  return {
    dist: Math.hypot(px - projX, py - projY),
    t
  };
}

/**
 * Picks the closest road edge under pointer coordinates (px, py).
 * Ignores clicks right on top of endpoint nodes so node picking and edge picking don't conflict.
 *
 * @param {number} px Pointer X in CSS pixels
 * @param {number} py Pointer Y in CSS pixels
 * @param {object} graph Graph instance with `.edges()`
 * @param {{ nodes: { id: number, x: number, y: number, r: number }[] }} layout
 * @param {number} [threshold=13] Max distance in CSS pixels from road centerline
 * @returns {[number, number] | null} Edge tuple [u, v] with u < v, or null
 */
export function pickEdge(px, py, graph, layout, threshold = 13) {
  if (!graph || !layout || !layout.nodes || layout.nodes.length === 0) {
    return null;
  }

  const edges = graph.edges();
  let bestEdge = null;
  let bestDist = threshold;

  for (let i = 0; i < edges.length; i++) {
    const [u, v] = edges[i];
    const nu = layout.nodes[u];
    const nv = layout.nodes[v];
    if (!nu || !nv) continue;

    // Exclude regions inside endpoint node circles
    const dU = Math.hypot(px - nu.x, py - nu.y);
    const dV = Math.hypot(px - nv.x, py - nv.y);
    if (dU < nu.r + 3 || dV < nv.r + 3) continue;

    const { dist } = pointToSegment(px, py, nu.x, nu.y, nv.x, nv.y);
    if (dist <= bestDist) {
      bestDist = dist;
      bestEdge = [u, v];
    }
  }

  return bestEdge;
}
