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
    grad.addColorStop(0, '#2e7dc4');
    grad.addColorStop(0.42, '#68b7f0');
    grad.addColorStop(0.76, '#aee0fc');
    grad.addColorStop(1, '#e2f4ff');
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

    // 2. Stars, aurora borealis and parallax mountain ridges
    this.effects.drawSky(ctx, w, h);

    if (state && layout && layout.nodes && layout.nodes.length > 0 && layout.camera) {
      // 3. Floating ice-island ground slab under the whole map
      this._drawGround(ctx, layout);

      // 4. Safe Zones overlay (underneath roads and nodes)
      if (overlays && overlays.safeZones && analysis && analysis.safeZones) {
        this._drawSafeZones(ctx, state, layout, analysis.safeZones);
      }

      // 5. Roads (edges) + Tarjan critical bridges + hover highlight
      this._drawEdges(
        ctx,
        state,
        layout,
        overlays && overlays.critical && analysis ? analysis.critical : null,
        hoverEdge,
        activeTool
      );

      // 6. Transient edge animations (severed road ghosts & frost creep beams)
      this.effects.drawEdgeEffects(ctx, layout);

      // 7. 3D settlements & Citadel, depth-sorted back to front
      this._drawNodes3D(ctx, state, layout, overlays, analysis, hintNodes, hoverNodeId, activeTool);

      // 8. Transient node animations (beacon ignition rings)
      this.effects.drawNodeEffects(ctx, layout);
    }

    // 9. Snow falls in front of everything for depth
    this.effects.drawSnow(ctx, w, h);
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
      const sq = layout.squash || 1;
      ctx.strokeStyle = style.fill;
      ctx.lineWidth = layout.baseRadius * 2.1 * Math.max(0.45, sq) * (layout.camera ? layout.camera.zoom : 1);
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
      let haloR = layout.baseRadius * 1.65;

      for (let i = 0; i < zone.nodes.length; i++) {
        const u = zone.nodes[i];
        const nu = layout.nodes[u];
        sumX += nu.x;
        sumY += nu.y;
        haloR = nu.r * 1.65;
        if (nu.y - haloR < minY) minY = nu.y - haloR * sq;

        ctx.fillStyle = style.fill;
        ctx.strokeStyle = style.stroke;
        ctx.lineWidth = zone.threatened ? 1.5 : 2.2;
        if (!zone.threatened) {
          ctx.setLineDash([]);
        } else {
          ctx.setLineDash([4, 4]);
        }
        ctx.beginPath();
        ctx.ellipse(nu.x, nu.y, haloR, Math.max(1, haloR * sq), 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }

      // Zone summary label at centroid / top of zone
      const cx = sumX / zone.nodes.length;
      const cy = Math.max(85, minY - 28);
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
      const sc = ((nu.f || 1) + (nv.f || 1)) * 0.5;

      // Glowing cyan energy road aura on the white snow surface (matching Image 1)
      ctx.setLineDash([]);
      ctx.lineCap = 'round';
      ctx.strokeStyle = isHovered
        ? 'rgba(244, 63, 94, 0.35)'
        : isBridge
        ? 'rgba(236, 72, 153, 0.42)'
        : 'rgba(34, 211, 238, 0.38)';
      ctx.lineWidth = 9.5 * sc;
      ctx.beginPath();
      ctx.moveTo(nu.x, nu.y);
      ctx.lineTo(nv.x, nv.y);
      ctx.stroke();

      // Mid turquoise road track
      ctx.strokeStyle = isHovered
        ? '#f43f5e'
        : isBridge
        ? '#ec4899'
        : uFrosted || vFrosted
        ? '#0284c7'
        : '#06b6d4';
      ctx.lineWidth = 4.6 * sc;
      ctx.beginPath();
      ctx.moveTo(nu.x, nu.y);
      ctx.lineTo(nv.x, nv.y);
      ctx.stroke();

      // Inner bright ice-white energy core filament
      ctx.beginPath();
      ctx.moveTo(nu.x, nu.y);
      ctx.lineTo(nv.x, nv.y);
      if (isHovered) {
        ctx.strokeStyle = '#ffe4e6';
        ctx.lineWidth = 2.4 * sc;
        ctx.setLineDash([7, 5]);
      } else if (isBridge) {
        ctx.strokeStyle = '#fbcfe8';
        ctx.lineWidth = 2.2 * sc;
        ctx.setLineDash([]);
      } else {
        ctx.strokeStyle = '#ecfeff';
        ctx.lineWidth = 2.0 * sc;
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

  _drawPopulationBadge(ctx, node, isUrgent = false) {
    const bx = node.x + node.r * 0.58;
    const by = node.y + node.r * 0.42;
    const br = Math.max(8.5, Math.min(11.5, node.r * 0.52));

    ctx.save();
    ctx.fillStyle = '#0d2240';
    ctx.strokeStyle = isUrgent ? '#f43f5e' : node.isCitadel ? '#fbbf24' : '#38bdf8';
    ctx.lineWidth = 2.0;
    ctx.beginPath();
    ctx.arc(bx, by, br, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.font = `800 ${Math.round(br * 1.15)}px system-ui, -apple-system, sans-serif`;
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

  // ==================== 3D (2.5D) PROCEDURAL GEOMETRY ====================

  /** Projects a world point through the layout camera into a fresh point object. */
  _p(cam, x, y, h) {
    return cam.project(x, y, h, { x: 0, y: 0, z: 0, f: 1 });
  }

  /** Signed screen-space area; > 0 means the face points toward the viewer. */
  _area(pts) {
    let a = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const q = pts[(i + 1) % pts.length];
      a += p.x * q.y - q.x * p.y;
    }
    return a;
  }

  _poly(ctx, pts) {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
  }

  /**
   * Lambert-style brightness for a vertical face whose bottom edge runs p -> q.
   * The light is fixed relative to the camera (upper-left, toward viewer),
   * so faces re-shade naturally while the player orbits the map.
   */
  _light(cam, p, q, boost = 0) {
    const ex = q[0] - p[0];
    const ey = q[1] - p[1];
    const len = Math.hypot(ex, ey) || 1;
    const nx = ey / len;
    const ny = -ex / len;
    const rx = nx * cam._cosY - ny * cam._sinY;
    const ry = nx * cam._sinY + ny * cam._cosY;
    const dot = rx * -0.55 + ry * 0.83;
    return 0.58 + boost + 0.5 * Math.max(0, dot);
  }

  _shade(rgb, b, a = 1) {
    const r = Math.min(255, Math.round(rgb[0] * b));
    const g = Math.min(255, Math.round(rgb[1] * b));
    const bl = Math.min(255, Math.round(rgb[2] * b));
    return a >= 1 ? `rgb(${r},${g},${bl})` : `rgba(${r},${g},${bl},${a})`;
  }

  /**
   * Extruded prism: `ring` is a clockwise footprint (world offsets) around (wx, wy),
   * extruded from height h0 to h1. Back faces are culled by screen winding.
   * @returns {{x:number,y:number}[]} projected top ring
   */
  _prism(ctx, cam, wx, wy, ring, h0, h1, rgb, topFill, stroke, alpha = 1) {
    const n = ring.length;
    const B = new Array(n);
    const T = new Array(n);
    for (let i = 0; i < n; i++) {
      B[i] = this._p(cam, wx + ring[i][0], wy + ring[i][1], h0);
      T[i] = this._p(cam, wx + ring[i][0], wy + ring[i][1], h1);
    }
    ctx.lineJoin = 'round';
    ctx.lineWidth = 1;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const face = [B[i], B[j], T[j], T[i]];
      if (this._area(face) <= 0.5) continue;
      this._poly(ctx, face);
      ctx.fillStyle = this._shade(rgb, this._light(cam, ring[i], ring[j]), alpha);
      ctx.fill();
      if (stroke) {
        ctx.strokeStyle = stroke;
        ctx.stroke();
      }
    }
    if (topFill) {
      this._poly(ctx, T);
      ctx.fillStyle = topFill;
      ctx.fill();
      if (stroke) {
        ctx.strokeStyle = stroke;
        ctx.stroke();
      }
    }
    return T;
  }

  /** Pyramid roof / spire from footprint `ring` at h0 up to an apex at hApex. */
  _pyramid(ctx, cam, wx, wy, ring, h0, hApex, rgb, stroke, alpha = 1) {
    const n = ring.length;
    const R = new Array(n);
    for (let i = 0; i < n; i++) {
      R[i] = this._p(cam, wx + ring[i][0], wy + ring[i][1], h0);
    }
    const A = this._p(cam, wx, wy, hApex);
    ctx.lineJoin = 'round';
    ctx.lineWidth = 1;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const face = [R[i], R[j], A];
      if (this._area(face) <= 0.3) continue;
      this._poly(ctx, face);
      ctx.fillStyle = this._shade(rgb, this._light(cam, ring[i], ring[j], 0.1), alpha);
      ctx.fill();
      if (stroke) {
        ctx.strokeStyle = stroke;
        ctx.stroke();
      }
    }
    return A;
  }

  /** Ice crystal: hexagonal bipyramid with a ring at hMid, tips at hTop and hBot. */
  _crystal(ctx, cam, wx, wy, ring, hMid, hTop, hBot, rgb, stroke, alpha) {
    const n = ring.length;
    const R = new Array(n);
    for (let i = 0; i < n; i++) {
      R[i] = this._p(cam, wx + ring[i][0], wy + ring[i][1], hMid);
    }
    const top = this._p(cam, wx, wy, hTop);
    const bot = this._p(cam, wx, wy, hBot);
    ctx.lineJoin = 'round';
    ctx.lineWidth = 1;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const upper = [R[i], R[j], top];
      const lower = [bot, R[j], R[i]];
      if (this._area(lower) > 0.3) {
        this._poly(ctx, lower);
        ctx.fillStyle = this._shade(rgb, this._light(cam, ring[i], ring[j]) * 0.8, alpha);
        ctx.fill();
        ctx.strokeStyle = stroke;
        ctx.stroke();
      }
      if (this._area(upper) > 0.3) {
        this._poly(ctx, upper);
        ctx.fillStyle = this._shade(rgb, this._light(cam, ring[i], ring[j], 0.15), alpha);
        ctx.fill();
        ctx.strokeStyle = stroke;
        ctx.stroke();
      }
    }
    return top;
  }

  _box(a) {
    return [[-a, -a], [a, -a], [a, a], [-a, a]];
  }

  _ngon(r, n, rot = 0) {
    const pts = new Array(n);
    for (let i = 0; i < n; i++) {
      const ang = rot + (i * Math.PI * 2) / n;
      pts[i] = [Math.cos(ang) * r, Math.sin(ang) * r];
    }
    return pts;
  }

  /**
   * Builds a 20-vertex organic polygon contour around [-hw..hw, -hh..hh]
   * so the island looks like a carved floating snow continent rather than a rectangle.
   */
  _buildIslandRing(hw, hh) {
    const template = [
      [-0.92, -0.94], [-0.52, -1.03], [-0.12, -0.97], [0.32, -1.04], [0.76, -0.96],
      [1.02, -0.78], [1.06, -0.35], [0.98, 0.08], [1.05, 0.52], [0.90, 0.90],
      [0.54, 1.04], [0.14, 0.97], [-0.26, 1.05], [-0.68, 0.98], [-0.96, 0.82],
      [-1.06, 0.42], [-0.98, -0.04], [-1.05, -0.48]
    ];
    return template.map(([nx, ny]) => [nx * hw, ny * hh]);
  }

  /**
   * Draws a small floating satellite ice-rock chunk beside the main island.
   */
  _drawSatelliteIslet(ctx, cam, wx, wy, radX, radY, zOffset, depth) {
    const ring = [
      [-radX, -radY * 0.55],
      [-radX * 0.25, -radY],
      [radX * 0.82, -radY * 0.72],
      [radX, radY * 0.35],
      [radX * 0.35, radY],
      [-radX * 0.75, radY * 0.82]
    ];
    const n = ring.length;
    const topPts = ring.map(([x, y]) => this._p(cam, wx + x, wy + y, zOffset - 10));
    const midPts = ring.map(([x, y], i) =>
      this._p(cam, wx + x * 0.88, wy + y * 0.88, zOffset - 10 - depth * (0.55 + (i % 2) * 0.15))
    );
    const botApex = this._p(cam, wx, wy + radY * 0.15, zOffset - 10 - depth * 1.25);

    ctx.lineJoin = 'round';
    ctx.lineWidth = 1;
    const cliffCol = [38, 128, 224];
    const deepCol = [20, 86, 176];

    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const bVal = this._light(cam, ring[i], ring[j]);

      // Lower cone facet (bottom = botApex, top = midPts)
      const lowTri = [botApex, midPts[j], midPts[i]];
      if (this._area(lowTri) > 0.3) {
        this._poly(ctx, lowTri);
        ctx.fillStyle = this._shade(deepCol, bVal * 0.9);
        ctx.fill();
        ctx.strokeStyle = 'rgba(135, 212, 255, 0.35)';
        ctx.stroke();
      }

      // Upper cliff facets (bottom = midPts, top = topPts)
      const up1 = [midPts[i], midPts[j], topPts[i]];
      if (this._area(up1) > 0.3) {
        this._poly(ctx, up1);
        ctx.fillStyle = this._shade(cliffCol, bVal * 1.05);
        ctx.fill();
        ctx.strokeStyle = 'rgba(165, 228, 255, 0.45)';
        ctx.stroke();
      }
      const up2 = [midPts[j], topPts[j], topPts[i]];
      if (this._area(up2) > 0.3) {
        this._poly(ctx, up2);
        ctx.fillStyle = this._shade(cliffCol, bVal * 0.88);
        ctx.fill();
        ctx.strokeStyle = 'rgba(145, 218, 255, 0.38)';
        ctx.stroke();
      }
    }

    // Thick white snow cap on top
    this._prism(
      ctx,
      cam,
      wx,
      wy,
      ring,
      zOffset - 10,
      zOffset,
      [196, 226, 252],
      '#f6fbff',
      'rgba(175, 216, 248, 0.85)'
    );
  }

  /**
   * Draws the map as a low-poly floating snowy iceberg island with jagged blue glacier
   * cliffs below, turquoise frozen ponds, and floating satellite ice rocks (Reference Image 1).
   */
  _drawGround(ctx, layout) {
    const cam = layout.camera;
    const b = layout.bounds;
    const pad = layout.baseRadius * 2.55;
    const hw = b.width / 2 + pad;
    const hh = b.height / 2 + pad;
    const ring = this._buildIslandRing(hw, hh);
    const n = ring.length;

    ctx.save();

    // 1. Low-poly faceted glacier underbelly (2 tiers of jagged crystalline facets)
    // Note: in _prism winding, bottom points (lower h) come first so front-facing facets have positive screen area!
    const rimBot = new Array(n);
    const midRing = new Array(n);
    const deepTips = new Array(n);

    for (let i = 0; i < n; i++) {
      const [rx, ry] = ring[i];
      const shrinkMid = 0.98 - ((i * 7) % 3) * 0.02;
      const midH = -96 - ((i * 13) % 4) * 24;
      const tipShrink = 0.78 - ((i * 5) % 4) * 0.04;
      const tipH = -185 - ((i * 11) % 4) * 38;

      rimBot[i] = this._p(cam, rx, ry, -14);
      midRing[i] = this._p(cam, rx * shrinkMid, ry * shrinkMid, midH);
      deepTips[i] = this._p(cam, rx * tipShrink, ry * tipShrink, tipH);
    }

    const glacierBrightRgb = [74, 172, 248];
    const glacierUpperRgb = [42, 134, 228];
    const glacierMidRgb = [24, 98, 196];
    const glacierDeepRgb = [14, 64, 146];

    ctx.lineJoin = 'round';
    ctx.lineWidth = 1.2;

    // Draw lower stalactite peaks first (quad [deepTips[i], deepTips[j], midRing[j], midRing[i]])
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const bVal = this._light(cam, ring[i], ring[j]);

      // Spike triangle pointing down to deepTips[i]
      const low1 = [deepTips[i], midRing[j], midRing[i]];
      if (this._area(low1) > 0.5) {
        this._poly(ctx, low1);
        ctx.fillStyle = this._shade(glacierMidRgb, bVal * 1.02);
        ctx.fill();
        ctx.strokeStyle = 'rgba(155, 222, 255, 0.42)';
        ctx.stroke();
      }

      // Adjacent recessed facet
      const low2 = [deepTips[i], deepTips[j], midRing[j]];
      if (this._area(low2) > 0.5) {
        this._poly(ctx, low2);
        ctx.fillStyle = this._shade(glacierDeepRgb, bVal * 0.82);
        ctx.fill();
        ctx.strokeStyle = 'rgba(120, 198, 250, 0.32)';
        ctx.stroke();
      }
    }

    // Draw upper glacier cliff facets (quad [midRing[i], midRing[j], rimBot[j], rimBot[i]])
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const bVal = this._light(cam, ring[i], ring[j]);

      const up1 = [midRing[i], midRing[j], rimBot[i]];
      if (this._area(up1) > 0.5) {
        this._poly(ctx, up1);
        ctx.fillStyle = this._shade(i % 2 === 0 ? glacierBrightRgb : glacierUpperRgb, bVal * 1.08);
        ctx.fill();
        ctx.strokeStyle = 'rgba(195, 240, 255, 0.52)';
        ctx.stroke();
      }

      const up2 = [midRing[j], rimBot[j], rimBot[i]];
      if (this._area(up2) > 0.5) {
        this._poly(ctx, up2);
        ctx.fillStyle = this._shade(glacierUpperRgb, bVal * 0.92);
        ctx.fill();
        ctx.strokeStyle = 'rgba(165, 228, 255, 0.44)';
        ctx.stroke();
      }
    }

    // 2. Thick snow-crust overhang rim & bright snowy top surface
    const T = this._prism(
      ctx,
      cam,
      0,
      0,
      ring,
      -14,
      0,
      [205, 232, 255],
      null,
      'rgba(175, 218, 252, 0.85)'
    );

    const snowGrad = ctx.createLinearGradient(T[0].x, T[0].y, T[9].x, T[9].y);
    snowGrad.addColorStop(0, '#f8fcff');
    snowGrad.addColorStop(0.52, '#eaf4fe');
    snowGrad.addColorStop(1, '#d5e9fb');
    this._poly(ctx, T);
    ctx.fillStyle = snowGrad;
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2.2;
    ctx.stroke();

    // 3. Low-poly snow facet lines across the snow surface
    const centerPt = this._p(cam, 0, 0, 0);
    ctx.strokeStyle = 'rgba(175, 212, 245, 0.38)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < n; i += 2) {
      ctx.moveTo(centerPt.x, centerPt.y);
      ctx.lineTo(T[i].x, T[i].y);
    }
    ctx.stroke();

    // 4. Frozen turquoise ice ponds nestled on the snow surface (matching Image 1)
    const ponds = [
      { wx: -hw * 0.44, wy: -hh * 0.24, rx: hw * 0.16, ry: hh * 0.15, rot: 0.25 },
      { wx: hw * 0.46, wy: hh * 0.30, rx: hw * 0.19, ry: hh * 0.17, rot: -0.35 },
      { wx: hw * 0.38, wy: -hh * 0.32, rx: hw * 0.13, ry: hh * 0.11, rot: 0.15 }
    ];

    for (let p = 0; p < ponds.length; p++) {
      const pd = ponds[p];
      const pondRing = [
        [-pd.rx, -pd.ry * 0.5],
        [-pd.rx * 0.3, -pd.ry],
        [pd.rx * 0.75, -pd.ry * 0.8],
        [pd.rx, pd.ry * 0.2],
        [pd.rx * 0.45, pd.ry],
        [-pd.rx * 0.65, pd.ry * 0.85]
      ].map(([px, py]) => {
        const c = Math.cos(pd.rot);
        const s = Math.sin(pd.rot);
        return this._p(cam, pd.wx + px * c - py * s, pd.wy + px * s + py * c, 0.2);
      });

      this._poly(ctx, pondRing);
      const pGrad = ctx.createLinearGradient(pondRing[0].x, pondRing[0].y, pondRing[3].x, pondRing[3].y);
      pGrad.addColorStop(0, '#29b6f6');
      pGrad.addColorStop(0.55, '#4dd0e1');
      pGrad.addColorStop(1, '#80deea');
      ctx.fillStyle = pGrad;
      ctx.fill();
      ctx.strokeStyle = '#e6f4ff';
      ctx.lineWidth = 2.4;
      ctx.stroke();

      // Specular ice highlight streak across pond
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.48)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(
        (pondRing[0].x + pondRing[1].x) * 0.5,
        (pondRing[0].y + pondRing[1].y) * 0.5
      );
      ctx.lineTo(
        (pondRing[3].x + pondRing[4].x) * 0.5,
        (pondRing[3].y + pondRing[4].y) * 0.5
      );
      ctx.stroke();
    }

    // 5. Floating satellite snow-capped ice islets below the front cliffs
    this._drawSatelliteIslet(ctx, cam, -hw * 0.24, hh * 0.94, hw * 0.16, hh * 0.11, -38, 105);
    this._drawSatelliteIslet(ctx, cam, hw * 0.26, hh * 0.96, hw * 0.13, hh * 0.09, -46, 95);
    this._drawSatelliteIslet(ctx, cam, -hw * 0.82, hh * 0.72, hw * 0.09, hh * 0.07, -52, 75);

    ctx.restore();
  }

  _platformPalette(st, isCitadel) {
    if (st === NodeState.FROSTED) {
      return { side: [72, 165, 218], top: '#7dd3fc', rim: '#ffffff' };
    }
    if (st === NodeState.WARDED) {
      return { side: [180, 105, 24], top: '#f59e0b', rim: '#fef08a' };
    }
    if (isCitadel) {
      return { side: [184, 134, 28], top: '#eab308', rim: '#fef08a' };
    }
    return { side: [34, 112, 178], top: '#2998d6', rim: '#bae6fd' };
  }

  /**
   * Generates deterministic perimeter pine trees and rocks that never overlap settlements.
   */
  _getScenicProps(layout) {
    const b = layout.bounds;
    const pad = layout.baseRadius * 2.1;
    const hw = b.width / 2 + pad;
    const hh = b.height / 2 + pad;
    const key = `${Math.round(hw)}_${Math.round(hh)}_${layout.nodes.length}`;
    if (this._scenicKey === key && this._scenicProps) {
      return this._scenicProps;
    }

    const candidates = [
      // Top-left dense pine forest cluster
      { type: 'tree', nx: -0.95, ny: -0.85, scale: 1.85 },
      { type: 'tree', nx: -0.84, ny: -0.94, scale: 1.55 },
      { type: 'tree', nx: -1.00, ny: -0.68, scale: 1.60 },
      { type: 'tree', nx: -0.72, ny: -0.96, scale: 1.45 },
      { type: 'rock', nx: -0.88, ny: -0.74, scale: 1.35 },
      // Top-right dense pine forest cluster
      { type: 'tree', nx: 0.88, ny: -0.88, scale: 1.90 },
      { type: 'tree', nx: 0.76, ny: -0.96, scale: 1.60 },
      { type: 'tree', nx: 0.98, ny: -0.74, scale: 1.70 },
      { type: 'tree', nx: 0.64, ny: -0.95, scale: 1.40 },
      { type: 'rock', nx: 0.84, ny: -0.80, scale: 1.30 },
      // Bottom-left dense pine forest cluster
      { type: 'tree', nx: -0.78, ny: 0.88, scale: 1.95 },
      { type: 'tree', nx: -0.66, ny: 0.96, scale: 1.65 },
      { type: 'tree', nx: -0.90, ny: 0.80, scale: 1.75 },
      { type: 'tree', nx: -0.54, ny: 0.95, scale: 1.50 },
      { type: 'rock', nx: -0.95, ny: 0.38, scale: 1.45 },
      // Bottom-right rocky outcropping & pines
      { type: 'rock', nx: 0.94, ny: 0.66, scale: 1.75 },
      { type: 'rock', nx: 0.86, ny: 0.78, scale: 1.35 },
      { type: 'tree', nx: 0.92, ny: 0.46, scale: 1.55 },
      { type: 'tree', nx: -0.42, ny: -0.96, scale: 1.45 },
      { type: 'tree', nx: 0.36, ny: -0.97, scale: 1.50 }
    ];

    const minClearance = layout.baseRadius * 1.95;
    const valid = [];

    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      const wx = c.nx * hw;
      const wy = c.ny * hh;
      let clear = true;
      for (let j = 0; j < layout.nodes.length; j++) {
        const nd = layout.nodes[j];
        if (Math.hypot(wx - nd.wx, wy - nd.wy) < minClearance) {
          clear = false;
          break;
        }
      }
      if (clear) {
        valid.push({
          type: c.type,
          wx,
          wy,
          size: layout.baseRadius * 0.95 * c.scale
        });
      }
    }

    this._scenicKey = key;
    this._scenicProps = valid;
    return valid;
  }

  /**
   * Draws a 3D snow-covered evergreen pine tree at (wx, wy).
   */
  _drawPineTree3D(ctx, cam, wx, wy, size) {
    const edge = 'rgba(20, 50, 75, 0.22)';
    // Timber trunk
    this._prism(ctx, cam, wx, wy, this._box(size * 0.15), 0, size * 0.36, [102, 66, 38], null, null);
    // 3 stacked evergreen cones with white snow caps on each tier (matching Image 1)
    const tiers = [
      { r: size * 0.72, h0: size * 0.25, hMid: size * 0.75, h1: size * 1.15 },
      { r: size * 0.56, h0: size * 0.80, hMid: size * 1.22, h1: size * 1.64 },
      { r: size * 0.40, h0: size * 1.30, hMid: size * 1.62, h1: size * 2.08 }
    ];
    for (let i = 0; i < tiers.length; i++) {
      const tr = tiers[i];
      // Lower green pine foliage
      this._pyramid(ctx, cam, wx, wy, this._ngon(tr.r, 6, 0.3), tr.h0, tr.h1, [44, 118, 78], edge);
      // Upper white snow blanket cap on each branch tier
      this._pyramid(ctx, cam, wx, wy, this._ngon(tr.r * 0.78, 6, 0.3), tr.hMid, tr.h1 + 1, [242, 249, 255], 'rgba(180, 215, 245, 0.45)');
    }
  }

  /**
   * Draws a 3D low-poly snow-topped boulder at (wx, wy).
   */
  _drawRock3D(ctx, cam, wx, wy, size) {
    const ring = this._ngon(size * 0.62, 5, 0.4);
    this._prism(
      ctx,
      cam,
      wx,
      wy,
      ring,
      0,
      size * 0.55,
      [115, 136, 162],
      '#eef6ff',
      'rgba(60, 82, 110, 0.35)'
    );
  }

  /**
   * Draws every settlement, the multi-tower Citadel, and scenic 3D pine trees/rocks,
   * depth-sorted back to front.
   */
  _drawNodes3D(ctx, state, layout, overlays, analysis, hintNodes, hoverNodeId, activeTool) {
    const cam = layout.camera;
    const sq = layout.squash;
    const t = this.effects.reducedMotion ? 0 : this.effects.time;
    const hintSet = new Set(hintNodes || []);
    const artPoints =
      overlays && overlays.critical && analysis && analysis.critical ? analysis.critical.points : null;
    const forecastArr = overlays && overlays.forecast && analysis ? analysis.forecast : null;
    const canHoverBeacon = activeTool === 'auto' || activeTool === 'beacon';

    // Combine scenic props and settlement nodes into one depth-sorted list
    const props = this._getScenicProps(layout);
    const drawList = [];

    for (let i = 0; i < props.length; i++) {
      const pr = props[i];
      const pScreen = this._p(cam, pr.wx, pr.wy, 0);
      drawList.push({ kind: 'prop', z: pScreen.z, prop: pr });
    }
    for (let i = 0; i < layout.nodes.length; i++) {
      const nd = layout.nodes[i];
      drawList.push({ kind: 'node', z: nd.z, node: nd });
    }
    drawList.sort((a, b) => b.z - a.z);

    for (let k = 0; k < drawList.length; k++) {
      const item = drawList[k];
      if (item.kind === 'prop') {
        const pr = item.prop;
        if (pr.type === 'tree') {
          this._drawPineTree3D(ctx, cam, pr.wx, pr.wy, pr.size);
        } else {
          this._drawRock3D(ctx, cam, pr.wx, pr.wy, pr.size);
        }
        continue;
      }

      const node = item.node;
      const st = state.nodeState[node.id];
      const isHovered = canHoverBeacon && hoverNodeId === node.id;
      const isHinted = hintSet.has(node.id);
      const isArticulation = artPoints ? artPoints.has(node.id) : false;
      const ry = Math.max(1, sq);

      ctx.save();

      // 1. Soft contact shadow on the white snow surface
      ctx.fillStyle = 'rgba(28, 74, 128, 0.26)';
      ctx.beginPath();
      ctx.ellipse(
        node.x + node.r * 0.22,
        node.y + node.r * 0.16,
        node.r * 1.25,
        Math.max(1, node.r * 1.05 * sq),
        0,
        0,
        Math.PI * 2
      );
      ctx.fill();

      // 2. Hover glow
      if (isHovered && st === NodeState.CLEAR) {
        ctx.fillStyle = 'rgba(245, 158, 11, 0.34)';
        ctx.beginPath();
        ctx.ellipse(node.x, node.y, node.r + 10, Math.max(1, (node.r + 10) * sq), 0, 0, Math.PI * 2);
        ctx.fill();
      }

      // 3. Hint: pulsing ground rings + vertical golden beam
      if (isHinted) {
        const pulse = 0.5 + 0.5 * Math.sin(t * 5.2);
        const ringR = node.r + 8 + pulse * 6;
        ctx.strokeStyle = 'rgba(245, 158, 11, 0.95)';
        ctx.lineWidth = 2.8;
        ctx.beginPath();
        ctx.ellipse(node.x, node.y, ringR, Math.max(1, ringR * sq), 0, 0, Math.PI * 2);
        ctx.stroke();

        const beamH = 120 * node.f;
        const beam = ctx.createLinearGradient(0, node.y, 0, node.y - beamH);
        beam.addColorStop(0, `rgba(251, 191, 36, ${0.38 + pulse * 0.15})`);
        beam.addColorStop(1, 'rgba(251, 191, 36, 0)');
        ctx.fillStyle = beam;
        ctx.fillRect(node.x - node.r * 0.7, node.y - beamH, node.r * 1.4, beamH);
      }

      // 4. Tarjan articulation point: dashed magenta ground ring
      if (isArticulation) {
        ctx.strokeStyle = '#db2777';
        ctx.lineWidth = 2.6;
        ctx.setLineDash([5, 4]);
        ctx.beginPath();
        ctx.ellipse(node.x, node.y, node.r + 6, Math.max(1, (node.r + 6) * sq), 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // 5. Round snow-and-ice pedestal (12-sided extruded disc)
      const pal = this._platformPalette(st, node.isCitadel);
      this._prism(
        ctx,
        cam,
        node.wx,
        node.wy,
        this._ngon(node.rw * 0.96, 12),
        -4,
        3,
        pal.side,
        pal.top,
        isHovered ? '#fbbf24' : pal.rim
      );

      // 6. The 3D building itself (Multi-tower Citadel castle or cozy timber cabin)
      const topH = this._drawBuilding(ctx, cam, node, st, t);

      // 7. Population badge at front-right of pedestal (matching Reference Image 1)
      const etaVal = analysis && analysis.forecast ? analysis.forecast[node.id] : -1;
      const isUrgent = st === NodeState.CLEAR && (etaVal === 1 || etaVal === 2);
      this._drawPopulationBadge(
        ctx,
        {
          x: node.x,
          y: node.y,
          r: node.r,
          population: node.population,
          isCitadel: node.isCitadel
        },
        isUrgent
      );

      const gx = node.x - node.r * 0.95;
      const gy = node.y + node.r * 0.12 * ry;
      if (st === NodeState.FROSTED) {
        this._drawCornerGlyph(ctx, gx, gy, '❄', '#062038', '#7ceeff');
      } else if (st === NodeState.WARDED) {
        this._drawCornerGlyph(ctx, gx, gy, '🔥', '#3b1d04', '#ffc14d');
      } else if (isArticulation) {
        this._drawCornerGlyph(ctx, gx, gy, '◆', '#3a0b28', '#ff79c6');
      }

      if (node.isCitadel) {
        this._drawCitadelLabel(
          ctx,
          { x: node.x, y: node.y - node.r + node.r * sq + 6, r: node.r },
          st === NodeState.FROSTED
        );
      }

      if (forecastArr && st === NodeState.CLEAR) {
        if (cam.tilt < 0.15) {
          this._drawForecastBadge(ctx, node, forecastArr[node.id]);
        } else {
          const tp = this._p(cam, node.wx, node.wy, topH + node.rw * 0.55);
          this._drawForecastBadge(
            ctx,
            { x: tp.x - node.r * 0.35, y: tp.y + node.r * 0.55, r: node.r },
            forecastArr[node.id]
          );
        }
      }

      ctx.restore();
    }
  }

  /**
   * Draws the 3D building for one node and returns the height of its highest point.
   */
  _drawBuilding(ctx, cam, node, st, t) {
    const rw = node.rw;
    const wx = node.wx;
    const wy = node.wy;
    const frosted = st === NodeState.FROSTED;
    const warded = st === NodeState.WARDED;
    const edge = 'rgba(20, 42, 74, 0.42)';

    // ---- The Citadel: Grand Multi-Tower Golden Castle (matching Image 1) ----
    if (node.isCitadel) {
      const a = rw * 0.78;
      const H = rw * 1.95;
      const wall = frosted ? [150, 215, 245] : [238, 182, 54];
      const turretCol = frosted ? [170, 225, 250] : [248, 198, 72];
      const spireCol = frosted ? [205, 245, 255] : [255, 216, 84];

      // Stepped golden plinth
      this._prism(ctx, cam, wx, wy, this._box(a * 1.18), 3, rw * 0.25, wall, this._shade(wall, 1.08), edge);

      // Sort the 4 corner turrets + central keep by distance from camera
      const tOffset = a * 0.88;
      const turretR = a * 0.34;
      const turretH = H * 0.88;
      const parts = [
        { kind: 'keep', x: wx, y: wy, z: this._p(cam, wx, wy, H * 0.5).z },
        { kind: 'turret', x: wx - tOffset, y: wy - tOffset, z: this._p(cam, wx - tOffset, wy - tOffset, turretH * 0.5).z },
        { kind: 'turret', x: wx + tOffset, y: wy - tOffset, z: this._p(cam, wx + tOffset, wy - tOffset, turretH * 0.5).z },
        { kind: 'turret', x: wx + tOffset, y: wy + tOffset, z: this._p(cam, wx + tOffset, wy + tOffset, turretH * 0.5).z },
        { kind: 'turret', x: wx - tOffset, y: wy + tOffset, z: this._p(cam, wx - tOffset, wy + tOffset, turretH * 0.5).z }
      ];
      parts.sort((p1, p2) => p2.z - p1.z);

      let keepTip = null;
      for (let i = 0; i < parts.length; i++) {
        const pt = parts[i];
        if (pt.kind === 'turret') {
          this._prism(
            ctx,
            cam,
            pt.x,
            pt.y,
            this._ngon(turretR, 8),
            rw * 0.25,
            turretH,
            turretCol,
            this._shade(turretCol, 1.1),
            edge
          );
          this._pyramid(
            ctx,
            cam,
            pt.x,
            pt.y,
            this._ngon(turretR * 1.12, 8),
            turretH,
            turretH + rw * 0.48,
            spireCol,
            edge
          );
        } else {
          // Central tall castle keep
          this._prism(ctx, cam, wx, wy, this._box(a * 0.78), rw * 0.25, H, wall, this._shade(wall, 1.06), edge);
          keepTip = this._pyramid(
            ctx,
            cam,
            wx,
            wy,
            this._box(a * 0.86),
            H,
            H + rw * 0.92,
            spireCol,
            edge
          );

          // Arched fortress gate on the front-most keep wall
          const sides = [[0, a * 0.79], [a * 0.79, 0], [0, -a * 0.79], [-a * 0.79, 0]];
          let frontGate = null;
          for (let s = 0; s < sides.length; s++) {
            const p = this._p(cam, wx + sides[s][0], wy + sides[s][1], rw * 0.52);
            if (!frontGate || p.z < frontGate.z) frontGate = p;
          }
          if (frontGate) {
            const gw = Math.max(2.5, rw * 0.16 * node.f);
            const gh = Math.max(4, rw * 0.28 * node.f);
            ctx.fillStyle = '#5c3409';
            ctx.beginPath();
            ctx.arc(frontGate.x, frontGate.y - gh * 0.2, gw, Math.PI, 0);
            ctx.lineTo(frontGate.x + gw, frontGate.y + gh * 0.5);
            ctx.lineTo(frontGate.x - gw, frontGate.y + gh * 0.5);
            ctx.closePath();
            ctx.fill();
          }
        }
      }

      // Pennant flag & glowing crown jewel atop the central keep spire
      if (keepTip) {
        const poleH = rw * 0.36 * node.f;
        ctx.strokeStyle = '#fef08a';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(keepTip.x, keepTip.y);
        ctx.lineTo(keepTip.x, keepTip.y - poleH);
        ctx.stroke();

        ctx.fillStyle = frosted ? '#38bdf8' : '#f59e0b';
        ctx.beginPath();
        ctx.moveTo(keepTip.x, keepTip.y - poleH);
        ctx.lineTo(keepTip.x + rw * 0.32 * node.f, keepTip.y - poleH * 0.72);
        ctx.lineTo(keepTip.x, keepTip.y - poleH * 0.42);
        ctx.closePath();
        ctx.fill();
      }
      return H + rw * 1.1;
    }

    // ---- Frosted settlement: crystalline ice spikes around the frozen cabin ----
    if (frosted) {
      const mid = this._p(cam, wx, wy, rw * 0.8);
      const glowR = rw * 1.45 * node.f;
      const glow = ctx.createRadialGradient(mid.x, mid.y, 0, mid.x, mid.y, glowR);
      glow.addColorStop(0, 'rgba(56, 189, 248, 0.38)');
      glow.addColorStop(1, 'rgba(56, 189, 248, 0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(mid.x, mid.y, glowR, 0, Math.PI * 2);
      ctx.fill();

      const shimmer = 0.94 + 0.06 * Math.sin(t * 3 + node.id);
      this._crystal(
        ctx,
        cam,
        wx,
        wy,
        this._ngon(rw * 0.52, 6, node.id * 0.7),
        rw * 0.7,
        rw * 1.75,
        rw * 0.08,
        [120, 210, 250].map((c) => c * shimmer),
        'rgba(255, 255, 255, 0.9)',
        0.94
      );
      return rw * 1.75;
    }

    // ---- Clear or warded settlement: cozy 3D timber cabin with snow-draped red roof ----
    const a = rw * 0.38;
    const H = rw * (0.46 + node.population * 0.035);
    const wall = warded ? [235, 168, 72] : [188, 114, 54];
    const roof = warded ? [234, 136, 28] : [206, 62, 46];
    this._prism(ctx, cam, wx, wy, this._box(a), 3, H, wall, null, edge);

    // Warm glowing window on the wall closest to the camera
    const sides = [[0, a], [a, 0], [0, -a], [-a, 0]];
    let best = null;
    for (let i = 0; i < sides.length; i++) {
      const p = this._p(cam, wx + sides[i][0] * 1.02, wy + sides[i][1] * 1.02, H * 0.52);
      if (!best || p.z < best.z) best = p;
    }
    const winR = Math.max(1.8, rw * 0.14 * node.f);
    ctx.fillStyle = '#fef08a';
    ctx.shadowColor = '#f59e0b';
    ctx.shadowBlur = 8;
    ctx.fillRect(best.x - winR, best.y - winR, winR * 2, winR * 2);
    ctx.shadowBlur = 0;

    // Thick white snow overhang eaves under the pitched red roof
    this._prism(
      ctx,
      cam,
      wx,
      wy,
      this._box(a * 1.24),
      H - rw * 0.05,
      H + rw * 0.08,
      [230, 244, 255],
      '#ffffff',
      'rgba(170, 205, 238, 0.6)'
    );

    const apexH = H + rw * 0.62;
    const apex = this._pyramid(ctx, cam, wx, wy, this._box(a * 1.18), H + rw * 0.08, apexH, roof, edge);

    // Snow ridge cap on roof apex
    const capR = Math.max(1.8, rw * 0.15 * node.f);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(apex.x, apex.y + capR * 0.5, capR, 0, Math.PI * 2);
    ctx.fill();

    if (!warded) {
      return apexH;
    }

    // ---- Beacon flame floating above the warded cabin ----
    const flicker = 1 + Math.sin(t * 9 + node.id * 1.7) * 0.08;
    const fp = this._p(cam, wx, wy, apexH + rw * 0.5);
    const glowR = rw * 1.8 * node.f * flicker;
    const glow = ctx.createRadialGradient(fp.x, fp.y, 0, fp.x, fp.y, glowR);
    glow.addColorStop(0, 'rgba(255, 196, 82, 0.58)');
    glow.addColorStop(1, 'rgba(255, 140, 20, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(fp.x, fp.y, glowR, 0, Math.PI * 2);
    ctx.fill();

    const s = rw * 0.36 * node.f * flicker;
    const fl = ctx.createLinearGradient(fp.x, fp.y - s * 1.6, fp.x, fp.y + s * 0.6);
    fl.addColorStop(0, '#fff3b0');
    fl.addColorStop(0.5, '#ffb340');
    fl.addColorStop(1, '#ff5a1f');
    ctx.fillStyle = fl;
    ctx.beginPath();
    ctx.moveTo(fp.x, fp.y - s * 1.6);
    ctx.quadraticCurveTo(fp.x + s, fp.y - s * 0.2, fp.x, fp.y + s * 0.6);
    ctx.quadraticCurveTo(fp.x - s, fp.y - s * 0.2, fp.x, fp.y - s * 1.6);
    ctx.fill();
    return apexH + rw * 0.9;
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
