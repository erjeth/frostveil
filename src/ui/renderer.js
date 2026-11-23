/**
 * @file renderer.js
 * HTML5 Canvas 2D procedural renderer for Frostveil (Member B).
 *
 * Renders:
 * - Dark arctic night sky, aurora, and snow (via EffectsManager)
 * - Safe Zones overlay (DFS connected components with population & secured status)
 * - Roads, severed-road ghosts, frost creep animations, and Tarjan bridge highlights
 * - Settlements (procedural huts) and The Citadel (procedural tower & crown)
 * - Accessible state shapes & icons: CLEAR (hut), FROSTED (jagged ice crystal), WARDED (beacon flame)
 * - Frost Forecast overlay (BFS arrival turns or ✓ check mark)
 * - Tarjan Critical articulation point rings
 * - Pulsing Hint rings
 * - How-to-Play mini canvas diagrams
 */

import { NodeState } from './core.js';

const ZONE_PALETTE_THREATENED = [
  { fill: 'rgba(56, 189, 248, 0.13)', stroke: 'rgba(56, 189, 248, 0.45)', badge: '#38bdf8' },
  { fill: 'rgba(168, 85, 247, 0.13)', stroke: 'rgba(168, 85, 247, 0.45)', badge: '#c084fc' },
  { fill: 'rgba(251, 146, 60, 0.13)', stroke: 'rgba(251, 146, 60, 0.45)', badge: '#fb923c' },
  { fill: 'rgba(244, 114, 182, 0.13)', stroke: 'rgba(244, 114, 182, 0.45)', badge: '#f472b6' }
];

const ZONE_SECURED_STYLE = {
  fill: 'rgba(52, 211, 153, 0.17)',
  stroke: 'rgba(52, 211, 153, 0.68)',
  badge: '#34d399'
};

export class Renderer {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {import('./effects.js').EffectsManager} effects
   */
  constructor(canvas, effects) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.effects = effects;
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this._bgGradient = null;
    this.resize();
  }

  /**
   * Resizes the canvas cleanly for high-DPI displays and caches the background gradient.
   */
  resize() {
    this.width = Math.max(320, window.innerWidth);
    this.height = Math.max(320, window.innerHeight);
    this.dpr = Math.min(2, window.devicePixelRatio || 1);

    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);

    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    const grad = ctx.createLinearGradient(0, 0, 0, this.height);
    grad.addColorStop(0, '#040915');
    grad.addColorStop(0.48, '#091632');
    grad.addColorStop(1, '#050c1d');
    this._bgGradient = grad;

    this.effects.resize(this.width, this.height);
  }

  /**
   * Main frame render entrypoint.
   *
   * @param {object} params
   * @param {object | null} params.state Active core game state
   * @param {object | null} params.layout Screen layout from layout.js
   * @param {{ forecast: boolean, safeZones: boolean, critical: boolean }} params.overlays
   * @param {{ forecast: Int32Array | null, safeZones: any[] | null, critical: { points: Set<number>, bridges: [number, number][] } | null }} params.analysis
   * @param {number[]} params.hintNodes Node IDs currently suggested by Hint
   * @param {number} params.hoverNodeId Currently hovered node ID or -1
   * @param {[number, number] | null} params.hoverEdge Currently hovered edge [u, v] or null
   * @param {string} params.activeTool 'auto' | 'beacon' | 'sever'
   */
  render({
    state,
    layout,
    overlays,
    analysis,
    hintNodes = [],
    hoverNodeId = -1,
    hoverEdge = null,
    activeTool = 'auto'
  }) {
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;

    // 1. Arctic night sky backdrop
    ctx.fillStyle = this._bgGradient || '#071228';
    ctx.fillRect(0, 0, w, h);

    // 2. Aurora borealis & falling snow
    this.effects.drawBackgroundEffects(ctx, w, h);

    if (!state || !layout || !layout.nodes || layout.nodes.length === 0) {
      return;
    }

    // 3. Safe Zones overlay (underneath roads and nodes)
    if (overlays && overlays.safeZones && analysis && analysis.safeZones) {
      this._drawSafeZones(ctx, state, layout, analysis.safeZones);
    }

    // 4. Roads (edges) + Tarjan critical bridges + hover highlight
    this._drawEdges(
      ctx,
      state,
      layout,
      overlays && overlays.critical && analysis ? analysis.critical : null,
      hoverEdge,
      activeTool
    );

    // 5. Transient edge animations (severed road ghosts & frost creep beams)
    this.effects.drawEdgeEffects(ctx, layout);

    // 6. Transient node animations (beacon ignition rings)
    this.effects.drawNodeEffects(ctx, layout);

    // 7. Settlements & Citadel nodes + badges + overlays
    this._drawNodes(
      ctx,
      state,
      layout,
      overlays,
      analysis,
      hintNodes,
      hoverNodeId,
      activeTool
    );
  }

  /**
   * Draws DFS connected Safe Zones overlay with distinct styling for secured (`threatened: false`) zones.
   */
  _drawSafeZones(ctx, state, layout, zones) {
    ctx.save();
    for (let z = 0; z < zones.length; z++) {
      const zone = zones[z];
      if (!zone.nodes || zone.nodes.length === 0) continue;

      const style = zone.threatened
        ? ZONE_PALETTE_THREATENED[z % ZONE_PALETTE_THREATENED.length]
        : ZONE_SECURED_STYLE;

      // Draw soft connecting corridors between same-zone neighbors
      ctx.strokeStyle = style.fill;
      ctx.lineWidth = layout.baseRadius * 2.3;
      ctx.lineCap = 'round';
      for (let i = 0; i < zone.nodes.length; i++) {
        const u = zone.nodes[i];
        const nu = layout.nodes[u];
        const nbrs = state.graph.neighbors(u);
        for (let j = 0; j < nbrs.length; j++) {
          const v = nbrs[j];
          if (u < v && state.nodeState[v] === NodeState.CLEAR) {
            const nv = layout.nodes[v];
            ctx.beginPath();
            ctx.moveTo(nu.x, nu.y);
            ctx.lineTo(nv.x, nv.y);
            ctx.stroke();
          }
        }
      }

      // Draw circular zone pads around each node in the zone and compute centroid
      let sumX = 0;
      let sumY = 0;
      let minY = Infinity;
      const haloR = layout.baseRadius * 1.65;

      for (let i = 0; i < zone.nodes.length; i++) {
        const u = zone.nodes[i];
        const nu = layout.nodes[u];
        sumX += nu.x;
        sumY += nu.y;
        if (nu.y < minY) minY = nu.y;

        ctx.fillStyle = style.fill;
        ctx.strokeStyle = style.stroke;
        ctx.lineWidth = zone.threatened ? 1.5 : 2.2;
        if (!zone.threatened) {
          ctx.setLineDash([]);
        } else {
          ctx.setLineDash([4, 4]);
        }
        ctx.beginPath();
        ctx.arc(nu.x, nu.y, haloR, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }

      // Zone summary label at centroid / top of zone
      const cx = sumX / zone.nodes.length;
      const cy = Math.max(85, minY - haloR - 10);
      const label = zone.threatened
        ? `Zone Pop: ${zone.population}`
        : `✓ SECURED · Pop: ${zone.population}`;

      ctx.setLineDash([]);
      ctx.font = 'bold 11px system-ui, -apple-system, sans-serif';
      const padX = 7;
      const textW = ctx.measureText(label).width;
      const boxW = textW + padX * 2;
      const boxH = 19;

      ctx.fillStyle = 'rgba(5, 13, 30, 0.88)';
      ctx.strokeStyle = style.badge;
      ctx.lineWidth = 1.4;
      this._roundRect(ctx, cx - boxW * 0.5, cy - boxH * 0.5, boxW, boxH, 9);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = style.badge;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, cx, cy);
    }
    ctx.restore();
  }

  /**
   * Draws all remaining roads in `state.graph`, highlighting Tarjan bridges and hovered roads.
   */
  _drawEdges(ctx, state, layout, criticalData, hoverEdge, activeTool) {
    const edges = state.graph.edges();
    const bridgeSet = new Set();

    if (criticalData && criticalData.bridges) {
      for (let i = 0; i < criticalData.bridges.length; i++) {
        const [bu, bv] = criticalData.bridges[i];
        const a = Math.min(bu, bv);
        const b = Math.max(bu, bv);
        bridgeSet.add(`${a}_${b}`);
      }
    }

    const canHoverEdge = activeTool === 'auto' || activeTool === 'sever';

    ctx.save();
    for (let i = 0; i < edges.length; i++) {
      const [u, v] = edges[i];
      const nu = layout.nodes[u];
      const nv = layout.nodes[v];
      if (!nu || !nv) continue;

      const isHovered =
        canHoverEdge &&
        hoverEdge &&
        ((hoverEdge[0] === u && hoverEdge[1] === v) || (hoverEdge[0] === v && hoverEdge[1] === u));

      const isBridge = bridgeSet.has(`${u}_${v}`);
      const uFrosted = state.nodeState[u] === NodeState.FROSTED;
      const vFrosted = state.nodeState[v] === NodeState.FROSTED;

      // Critical Bridge outer glow
      if (isBridge) {
        ctx.strokeStyle = 'rgba(255, 105, 180, 0.55)';
        ctx.lineWidth = 7.5;
        ctx.beginPath();
        ctx.moveTo(nu.x, nu.y);
        ctx.lineTo(nv.x, nv.y);
        ctx.stroke();
      }

      // Main road line
      ctx.beginPath();
      ctx.moveTo(nu.x, nu.y);
      ctx.lineTo(nv.x, nv.y);

      if (isHovered) {
        ctx.strokeStyle = '#ff6b6b';
        ctx.lineWidth = 4.2;
        ctx.setLineDash([7, 5]);
      } else if (isBridge) {
        ctx.strokeStyle = '#ff85c0';
        ctx.lineWidth = 3.4;
        ctx.setLineDash([]);
      } else if (uFrosted && vFrosted) {
        ctx.strokeStyle = 'rgba(110, 224, 255, 0.55)';
        ctx.lineWidth = 2.4;
        ctx.setLineDash([]);
      } else if (uFrosted || vFrosted) {
        ctx.strokeStyle = 'rgba(130, 215, 255, 0.45)';
        ctx.lineWidth = 2.2;
        ctx.setLineDash([]);
      } else {
        ctx.strokeStyle = 'rgba(164, 196, 235, 0.34)';
        ctx.lineWidth = 2.0;
        ctx.setLineDash([]);
      }
      ctx.stroke();

      // Draw cut marker at midpoint if hovered for severing
      if (isHovered) {
        const mx = (nu.x + nv.x) * 0.5;
        const my = (nu.y + nv.y) * 0.5;
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(36, 10, 20, 0.92)';
        ctx.strokeStyle = '#ff6b6b';
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.arc(mx, my, 10, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = '#ffd8d8';
        ctx.font = '11px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('✂', mx, my + 0.5);
      }
    }
    ctx.restore();
  }

  /**
   * Draws all settlements, the Citadel, state icons, and active overlays.
   */
  _drawNodes(ctx, state, layout, overlays, analysis, hintNodes, hoverNodeId, activeTool) {
    const t = this.effects.reducedMotion ? 0 : this.effects.time;
    const hintSet = new Set(hintNodes || []);
    const artPoints =
      overlays && overlays.critical && analysis && analysis.critical
        ? analysis.critical.points
        : null;
    const forecastArr =
      overlays && overlays.forecast && analysis ? analysis.forecast : null;

    const canHoverBeacon = activeTool === 'auto' || activeTool === 'beacon';

    for (let i = 0; i < layout.nodes.length; i++) {
      const node = layout.nodes[i];
      const st = state.nodeState[node.id];
      const isHovered = canHoverBeacon && hoverNodeId === node.id;
      const isHinted = hintSet.has(node.id);
      const isArticulation = artPoints ? artPoints.has(node.id) : false;

      ctx.save();

      // 1. Hint pulsing double ring
      if (isHinted) {
        const pulse = 0.5 + 0.5 * Math.sin(t * 5.2);
        const ringR = node.r + 8 + pulse * 6;
        ctx.strokeStyle = 'rgba(255, 212, 96, 0.92)';
        ctx.lineWidth = 2.6;
        ctx.beginPath();
        ctx.arc(node.x, node.y, ringR, 0, Math.PI * 2);
        ctx.stroke();

        ctx.strokeStyle = 'rgba(52, 211, 153, 0.65)';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.arc(node.x, node.y, ringR + 5, 0, Math.PI * 2);
        ctx.stroke();
      }

      // 2. Tarjan Critical Articulation Point ring (dashed magenta-gold)
      if (isArticulation) {
        ctx.save();
        ctx.strokeStyle = '#ff69b4';
        ctx.lineWidth = 2.4;
        ctx.setLineDash([5, 4]);
        ctx.beginPath();
        ctx.arc(node.x, node.y, node.r + 6, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      // 3. Base state aura & shape (never relying on color alone)
      if (st === NodeState.FROSTED) {
        this._drawFrostedNode(ctx, node, t);
      } else if (st === NodeState.WARDED) {
        this._drawWardedNode(ctx, node, t);
      } else {
        this._drawClearNode(ctx, node, isHovered);
      }

      // 4. Procedural settlement hut or Citadel tower inside the node
      if (node.isCitadel) {
        this._drawCitadelIcon(ctx, node.x, node.y, node.r * 0.62, st);
      } else {
        this._drawHutIcon(ctx, node.x, node.y, node.r * 0.55, st);
      }

      // 5. State overlay icon at top-left (❄️ crystal for FROSTED, 🔥 flame for WARDED, ◆ for Critical)
      if (st === NodeState.FROSTED) {
        this._drawCornerGlyph(ctx, node.x - node.r * 0.72, node.y - node.r * 0.72, '❄', '#062038', '#7ceeff');
      } else if (st === NodeState.WARDED) {
        this._drawCornerGlyph(ctx, node.x - node.r * 0.72, node.y - node.r * 0.72, '🔥', '#3b1d04', '#ffc14d');
      } else if (isArticulation) {
        this._drawCornerGlyph(ctx, node.x - node.r * 0.72, node.y - node.r * 0.72, '◆', '#3a0b28', '#ff79c6');
      }

      // 6. Population badge at bottom-right
      this._drawPopulationBadge(ctx, node);

      // 7. Citadel title ribbon beneath the Citadel
      if (node.isCitadel) {
        this._drawCitadelLabel(ctx, node, st === NodeState.FROSTED);
      }

      // 8. Frost Forecast badge at top-right (on CLEAR nodes when Forecast overlay is active)
      if (forecastArr && st === NodeState.CLEAR) {
        const eta = forecastArr[node.id];
        this._drawForecastBadge(ctx, node, eta);
      }

      ctx.restore();
    }
  }

  _drawClearNode(ctx, node, isHovered) {
    if (isHovered) {
      ctx.fillStyle = 'rgba(255, 190, 75, 0.24)';
      ctx.beginPath();
      ctx.arc(node.x, node.y, node.r + 7, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = node.isCitadel ? '#162955' : '#0f2042';
    ctx.strokeStyle = isHovered
      ? '#ffd460'
      : node.isCitadel
      ? '#ffd460'
      : '#66b5e8';
    ctx.lineWidth = node.isCitadel ? 2.8 : isHovered ? 2.5 : 1.9;

    ctx.beginPath();
    ctx.arc(node.x, node.y, node.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  /**
   * Frosted node has a distinct jagged crystalline 8-point ice polygon outline.
   */
  _drawFrostedNode(ctx, node) {
    // Icy outer glow
    const grad = ctx.createRadialGradient(node.x, node.y, node.r * 0.3, node.x, node.y, node.r * 1.55);
    grad.addColorStop(0, 'rgba(130, 240, 255, 0.42)');
    grad.addColorStop(1, 'rgba(77, 228, 255, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(node.x, node.y, node.r * 1.55, 0, Math.PI * 2);
    ctx.fill();

    // Jagged 12-vertex crystal star-polygon
    const spikes = 12;
    ctx.beginPath();
    for (let i = 0; i < spikes; i++) {
      const angle = (i * Math.PI * 2) / spikes - Math.PI * 0.5;
      const rad = i % 2 === 0 ? node.r * 1.14 : node.r * 0.88;
      const px = node.x + Math.cos(angle) * rad;
      const py = node.y + Math.sin(angle) * rad;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle = '#123e63';
    ctx.strokeStyle = '#b4f6ff';
    ctx.lineWidth = 2.2;
    ctx.fill();
    ctx.stroke();
  }

  /**
   * Warded node has a warm amber radial beacon glow and an octagonal ward shield.
   */
  _drawWardedNode(ctx, node, t) {
    const flicker = 1 + Math.sin(t * 7 + node.id) * 0.06;
    const glowR = node.r * 1.65 * flicker;
    const grad = ctx.createRadialGradient(node.x, node.y, node.r * 0.25, node.x, node.y, glowR);
    grad.addColorStop(0, 'rgba(255, 186, 66, 0.48)');
    grad.addColorStop(1, 'rgba(255, 140, 20, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(node.x, node.y, glowR, 0, Math.PI * 2);
    ctx.fill();

    // Octagonal ward border
    const sides = 8;
    ctx.beginPath();
    for (let i = 0; i < sides; i++) {
      const angle = (i * Math.PI * 2) / sides + Math.PI / 8;
      const px = node.x + Math.cos(angle) * (node.r * 1.06);
      const py = node.y + Math.sin(angle) * (node.r * 1.06);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle = '#3d2408';
    ctx.strokeStyle = '#ffbe45';
    ctx.lineWidth = 2.5;
    ctx.fill();
    ctx.stroke();
  }

  /**
   * Procedurally draws a small village hut (body + peaked roof + warm doorway).
   */
  _drawHutIcon(ctx, cx, cy, size, nodeState) {
    const roofH = size * 0.65;
    const bodyW = size * 1.1;
    const bodyH = size * 0.75;

    ctx.save();
    ctx.fillStyle =
      nodeState === NodeState.FROSTED
        ? '#8be9fd'
        : nodeState === NodeState.WARDED
        ? '#ffd984'
        : '#d5e9ff';

    // Peaked roof triangle
    ctx.beginPath();
    ctx.moveTo(cx, cy - size * 0.78);
    ctx.lineTo(cx + bodyW * 0.68, cy - size * 0.08);
    ctx.lineTo(cx - bodyW * 0.68, cy - size * 0.08);
    ctx.closePath();
    ctx.fill();

    // Hut walls
    ctx.fillRect(cx - bodyW * 0.46, cy - size * 0.08, bodyW * 0.92, bodyH);

    // Warm window / hearth inside hut
    ctx.fillStyle =
      nodeState === NodeState.FROSTED
        ? '#0c304a'
        : nodeState === NodeState.WARDED
        ? '#ff7b00'
        : '#ffb74d';
    ctx.fillRect(cx - size * 0.18, cy + size * 0.12, size * 0.36, size * 0.36);
    ctx.restore();
  }

  /**
   * Procedurally draws the Citadel tower & crown silhouette.
   */
  _drawCitadelIcon(ctx, cx, cy, size, nodeState) {
    ctx.save();
    ctx.fillStyle =
      nodeState === NodeState.FROSTED
        ? '#9beeff'
        : '#ffd460';

    // Crown / crenellated spire
    ctx.beginPath();
    ctx.moveTo(cx - size * 0.75, cy + size * 0.62);
    ctx.lineTo(cx - size * 0.65, cy - size * 0.45);
    ctx.lineTo(cx - size * 0.28, cy - size * 0.12);
    ctx.lineTo(cx, cy - size * 0.75);
    ctx.lineTo(cx + size * 0.28, cy - size * 0.12);
    ctx.lineTo(cx + size * 0.65, cy - size * 0.45);
    ctx.lineTo(cx + size * 0.75, cy + size * 0.62);
    ctx.closePath();
    ctx.fill();

    // Inner jewel
    ctx.fillStyle = nodeState === NodeState.FROSTED ? '#113a5c' : '#162955';
    ctx.beginPath();
    ctx.arc(cx, cy + size * 0.18, size * 0.22, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  _drawCornerGlyph(ctx, x, y, glyph, bg, border) {
    ctx.save();
    ctx.fillStyle = bg;
    ctx.strokeStyle = border;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(x, y, 8.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.font = '10px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(glyph, x, y + 0.5);
    ctx.restore();
  }

  _drawPopulationBadge(ctx, node) {
    const bx = node.x + node.r * 0.68;
    const by = node.y + node.r * 0.68;
    const br = Math.max(8, Math.min(10.5, node.r * 0.48));

    ctx.save();
    ctx.fillStyle = '#07132c';
    ctx.strokeStyle = node.isCitadel ? '#ffd460' : '#7ac7f8';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(bx, by, br, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${Math.round(br * 1.15)}px system-ui, -apple-system, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(node.population), bx, by + 0.5);
    ctx.restore();
  }

  _drawCitadelLabel(ctx, node, isFrosted) {
    const lx = node.x;
    const ly = node.y + node.r + 13;

    ctx.save();
    ctx.font = 'bold 10px system-ui, -apple-system, sans-serif';
    const label = isFrosted ? 'CITADEL LOST' : '♛ CITADEL';
    const w = ctx.measureText(label).width + 10;
    const h = 15;

    ctx.fillStyle = isFrosted ? 'rgba(85, 16, 32, 0.92)' : 'rgba(26, 20, 6, 0.9)';
    ctx.strokeStyle = isFrosted ? '#ff5b6e' : '#ffd460';
    ctx.lineWidth = 1.2;
    this._roundRect(ctx, lx - w * 0.5, ly - h * 0.5, w, h, 4);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = isFrosted ? '#ffa8b4' : '#ffd460';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, lx, ly + 0.5);
    ctx.restore();
  }

  /**
   * Draws Frost Forecast badge on CLEAR nodes:
   * - eta >= 1: number of turns until frost arrives
   * - eta === -1: check mark '✓' (safe / unreachable by frost)
   */
  _drawForecastBadge(ctx, node, eta) {
    const bx = node.x + node.r * 0.76;
    const by = node.y - node.r * 0.76;

    let text = '✓';
    let bg = '#063b2b';
    let border = '#34d399';
    let textColor = '#a7f3d0';

    if (eta >= 1) {
      text = `${eta}t`;
      if (eta === 1) {
        bg = '#4c0d19';
        border = '#ff5b6e';
        textColor = '#ffe4e8';
      } else if (eta === 2) {
        bg = '#452205';
        border = '#ffb340';
        textColor = '#ffedd5';
      } else {
        bg = '#0a274e';
        border = '#4de4ff';
        textColor = '#e0f7ff';
      }
    }

    ctx.save();
    ctx.font = 'bold 10px system-ui, -apple-system, sans-serif';
    const w = Math.max(19, ctx.measureText(text).width + 8);
    const h = 16;

    ctx.fillStyle = bg;
    ctx.strokeStyle = border;
    ctx.lineWidth = 1.4;
    this._roundRect(ctx, bx - w * 0.5, by - h * 0.5, w, h, 8);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = textColor;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, bx, by + 0.5);
    ctx.restore();
  }

  _roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /**
   * Renders procedural mini-diagrams onto the 4 canvases on the How to Play screen.
   */
  drawHowToIllustrations() {
    // 1. Nodes & Citadel illustration
    const c1 = document.getElementById('howto-canvas-nodes');
    if (c1 instanceof HTMLCanvasElement) {
      const ctx = c1.getContext('2d');
      ctx.clearRect(0, 0, c1.width, c1.height);
      ctx.strokeStyle = 'rgba(164, 196, 235, 0.45)';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(65, 62);
      ctx.lineTo(185, 62);
      ctx.stroke();

      const village = { id: 0, x: 65, y: 62, r: 18, population: 4, isCitadel: false };
      const citadel = { id: 1, x: 185, y: 58, r: 23, population: 9, isCitadel: true };
      this._drawClearNode(ctx, village, false);
      this._drawHutIcon(ctx, village.x, village.y, 10, NodeState.CLEAR);
      this._drawPopulationBadge(ctx, village);

      this._drawClearNode(ctx, citadel, false);
      this._drawCitadelIcon(ctx, citadel.x, citadel.y, 14, NodeState.CLEAR);
      this._drawPopulationBadge(ctx, citadel);
      this._drawCitadelLabel(ctx, citadel, false);
    }

    // 2. Warden Actions (Beacon & Sever Road)
    const c2 = document.getElementById('howto-canvas-actions');
    if (c2 instanceof HTMLCanvasElement) {
      const ctx = c2.getContext('2d');
      ctx.clearRect(0, 0, c2.width, c2.height);

      // Severed dashed road on right
      ctx.strokeStyle = '#ff6b6b';
      ctx.lineWidth = 3;
      ctx.setLineDash([6, 5]);
      ctx.beginPath();
      ctx.moveTo(140, 62);
      ctx.lineTo(225, 62);
      ctx.stroke();
      ctx.setLineDash([]);

      const warded = { id: 0, x: 68, y: 62, r: 19, population: 6, isCitadel: false };
      this._drawWardedNode(ctx, warded, 0);
      this._drawHutIcon(ctx, warded.x, warded.y, 10, NodeState.WARDED);
      this._drawCornerGlyph(ctx, warded.x - 13, warded.y - 13, '🔥', '#3b1d04', '#ffc14d');

      ctx.fillStyle = '#ffd8d8';
      ctx.font = 'bold 13px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('✂ Sever Road', 182, 42);
    }

    // 3. Frost Spread (1 BFS layer per turn)
    const c3 = document.getElementById('howto-canvas-frost');
    if (c3 instanceof HTMLCanvasElement) {
      const ctx = c3.getContext('2d');
      ctx.clearRect(0, 0, c3.width, c3.height);

      ctx.strokeStyle = 'rgba(130, 240, 255, 0.9)';
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.moveTo(65, 62);
      ctx.lineTo(190, 62);
      ctx.stroke();

      const frosted = { id: 0, x: 65, y: 62, r: 19, population: 5, isCitadel: false };
      const target = { id: 1, x: 190, y: 62, r: 18, population: 4, isCitadel: false };
      this._drawFrostedNode(ctx, frosted);
      this._drawHutIcon(ctx, frosted.x, frosted.y, 10, NodeState.FROSTED);
      this._drawCornerGlyph(ctx, frosted.x - 13, frosted.y - 13, '❄', '#062038', '#7ceeff');

      this._drawClearNode(ctx, target, false);
      this._drawHutIcon(ctx, target.x, target.y, 10, NodeState.CLEAR);
      this._drawForecastBadge(ctx, target, 1);
    }

    // 4. Overlays & Stars
    const c4 = document.getElementById('howto-canvas-overlays');
    if (c4 instanceof HTMLCanvasElement) {
      const ctx = c4.getContext('2d');
      ctx.clearRect(0, 0, c4.width, c4.height);

      const critNode = { id: 0, x: 75, y: 62, r: 19, population: 7, isCitadel: false };
      ctx.strokeStyle = '#ff69b4';
      ctx.lineWidth = 2.4;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.arc(critNode.x, critNode.y, critNode.r + 6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);

      this._drawClearNode(ctx, critNode, false);
      this._drawHutIcon(ctx, critNode.x, critNode.y, 10, NodeState.CLEAR);
      this._drawCornerGlyph(ctx, critNode.x - 13, critNode.y - 13, '◆', '#3a0b28', '#ff79c6');
      this._drawForecastBadge(ctx, critNode, -1);

      ctx.fillStyle = '#ffd460';
      ctx.font = 'bold 22px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('★ ★ ★', 185, 68);
    }
  }
}
