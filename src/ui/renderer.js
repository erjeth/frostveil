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

      // 3D road bed: a dark wide underlay so roads read as paths carved into the ice
      ctx.setLineDash([]);
      ctx.strokeStyle = 'rgba(3, 9, 22, 0.55)';
      ctx.lineWidth = 6.5 * sc;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(nu.x, nu.y);
      ctx.lineTo(nv.x, nv.y);
      ctx.stroke();

      if (uFrosted && vFrosted) {
        // Frozen road glow
        ctx.strokeStyle = 'rgba(77, 228, 255, 0.18)';
        ctx.lineWidth = 9 * sc;
        ctx.stroke();
      }

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
   * Draws the map as a floating slab of glacier ice with a faint survey grid.
   */
  _drawGround(ctx, layout) {
    const cam = layout.camera;
    const b = layout.bounds;
    const pad = layout.baseRadius * 2.4;
    const hw = b.width / 2 + pad;
    const hh = b.height / 2 + pad;
    const ring = this._box(1).map((p) => [p[0] * hw, p[1] * hh]);

    ctx.save();
    // Slab sides (thickness) and top
    const T = this._prism(ctx, cam, 0, 0, ring, -34, -2, [24, 50, 92], null, 'rgba(130, 210, 255, 0.16)');
    const grad = ctx.createLinearGradient(T[0].x, T[0].y, T[2].x, T[2].y);
    grad.addColorStop(0, 'rgba(22, 52, 96, 0.92)');
    grad.addColorStop(0.5, 'rgba(12, 32, 66, 0.92)');
    grad.addColorStop(1, 'rgba(8, 22, 48, 0.94)');
    this._poly(ctx, T);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.strokeStyle = 'rgba(150, 225, 255, 0.38)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Survey grid lines on the ice
    ctx.strokeStyle = 'rgba(120, 200, 255, 0.07)';
    ctx.lineWidth = 1;
    const step = 64;
    ctx.beginPath();
    for (let gx = -hw + step; gx < hw; gx += step) {
      const p = this._p(cam, gx, -hh, -2);
      const q = this._p(cam, gx, hh, -2);
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(q.x, q.y);
    }
    for (let gy = -hh + step; gy < hh; gy += step) {
      const p = this._p(cam, -hw, gy, -2);
      const q = this._p(cam, hw, gy, -2);
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(q.x, q.y);
    }
    ctx.stroke();
    ctx.restore();
  }

  _platformPalette(st, isCitadel) {
    if (st === NodeState.FROSTED) {
      return { side: [96, 176, 214], top: '#8fd3ee', rim: '#e6fbff' };
    }
    if (st === NodeState.WARDED) {
      return { side: [150, 88, 28], top: '#4a2c0c', rim: '#ffbe45' };
    }
    if (isCitadel) {
      return { side: [120, 96, 40], top: '#2b2611', rim: '#ffd460' };
    }
    return { side: [38, 70, 122], top: '#17305c', rim: '#66b5e8' };
  }

  /**
   * Draws every settlement as a small 3D building, depth-sorted back to front.
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

    // Painter's algorithm: far nodes (large z) first
    if (!this._order || this._order.length !== layout.nodes.length) {
      this._order = layout.nodes.map((_, i) => i);
    }
    const order = this._order;
    order.sort((a, b) => layout.nodes[b].z - layout.nodes[a].z);

    for (let k = 0; k < order.length; k++) {
      const node = layout.nodes[order[k]];
      const st = state.nodeState[node.id];
      const isHovered = canHoverBeacon && hoverNodeId === node.id;
      const isHinted = hintSet.has(node.id);
      const isArticulation = artPoints ? artPoints.has(node.id) : false;
      const ry = Math.max(1, sq);

      ctx.save();

      // 1. Soft contact shadow on the ice
      ctx.fillStyle = 'rgba(0, 5, 16, 0.5)';
      ctx.beginPath();
      ctx.ellipse(node.x + node.r * 0.35, node.y + node.r * 0.18, node.r * 1.25, Math.max(1, node.r * 1.1 * sq), 0, 0, Math.PI * 2);
      ctx.fill();

      // 2. Hover glow
      if (isHovered && st === NodeState.CLEAR) {
        ctx.fillStyle = 'rgba(255, 190, 75, 0.28)';
        ctx.beginPath();
        ctx.ellipse(node.x, node.y, node.r + 9, Math.max(1, (node.r + 9) * sq), 0, 0, Math.PI * 2);
        ctx.fill();
      }

      // 3. Hint: pulsing ground rings + a vertical beam of light
      if (isHinted) {
        const pulse = 0.5 + 0.5 * Math.sin(t * 5.2);
        const ringR = node.r + 8 + pulse * 6;
        ctx.strokeStyle = 'rgba(255, 212, 96, 0.95)';
        ctx.lineWidth = 2.6;
        ctx.beginPath();
        ctx.ellipse(node.x, node.y, ringR, Math.max(1, ringR * sq), 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(52, 211, 153, 0.65)';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.ellipse(node.x, node.y, ringR + 5, Math.max(1, (ringR + 5) * sq), 0, 0, Math.PI * 2);
        ctx.stroke();

        const beamH = 120 * node.f;
        const beam = ctx.createLinearGradient(0, node.y, 0, node.y - beamH);
        beam.addColorStop(0, `rgba(255, 212, 96, ${0.32 + pulse * 0.15})`);
        beam.addColorStop(1, 'rgba(255, 212, 96, 0)');
        ctx.fillStyle = beam;
        ctx.fillRect(node.x - node.r * 0.7, node.y - beamH, node.r * 1.4, beamH);
      }

      // 4. Tarjan articulation point: dashed magenta ground ring
      if (isArticulation) {
        ctx.strokeStyle = '#ff69b4';
        ctx.lineWidth = 2.4;
        ctx.setLineDash([5, 4]);
        ctx.beginPath();
        ctx.ellipse(node.x, node.y, node.r + 6, Math.max(1, (node.r + 6) * sq), 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // 5. Round stone platform (12-sided extruded disc)
      const pal = this._platformPalette(st, node.isCitadel);
      this._prism(
        ctx, cam, node.wx, node.wy, this._ngon(node.rw * 0.98, 12), -5, 3,
        pal.side, pal.top, isHovered ? '#ffd460' : pal.rim
      );

      // 6. The building itself
      const topH = this._drawBuilding(ctx, cam, node, st, t);

      // 7. Badges & labels (always screen-aligned for legibility)
      this._drawPopulationBadge(ctx, { x: node.x + node.r * 0.25, y: node.y + node.r * 0.15 * ry, r: node.r, population: node.population, isCitadel: node.isCitadel });

      const gx = node.x - node.r * 1.0;
      const gy = node.y + node.r * 0.1;
      if (st === NodeState.FROSTED) {
        this._drawCornerGlyph(ctx, gx, gy, '❄', '#062038', '#7ceeff');
      } else if (st === NodeState.WARDED) {
        this._drawCornerGlyph(ctx, gx, gy, '🔥', '#3b1d04', '#ffc14d');
      } else if (isArticulation) {
        this._drawCornerGlyph(ctx, gx, gy, '◆', '#3a0b28', '#ff79c6');
      }

      if (node.isCitadel) {
        this._drawCitadelLabel(ctx, { x: node.x, y: node.y - node.r + node.r * sq + 4, r: node.r }, st === NodeState.FROSTED);
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
    const edge = 'rgba(5, 12, 28, 0.5)';

    // ---- The Citadel: gold keep with corner merlons and a central spire ----
    if (node.isCitadel) {
      const a = rw * 0.42;
      const H = rw * 1.35;
      const wall = frosted ? [165, 220, 240] : [232, 196, 104];
      this._prism(ctx, cam, wx, wy, this._box(a), 3, H, wall, this._shade(wall, 1.05), edge);

      const m = a * 0.32;
      const centreZ = this._p(cam, wx, wy, H).z;
      const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
      const front = [];
      for (let i = 0; i < corners.length; i++) {
        const mx = wx + corners[i][0] * (a - m);
        const my = wy + corners[i][1] * (a - m);
        if (this._p(cam, mx, my, H).z > centreZ) {
          this._prism(ctx, cam, mx, my, this._box(m), H, H + rw * 0.25, wall, this._shade(wall, 1.12), edge);
        } else {
          front.push([mx, my]);
        }
      }
      const spireCol = frosted ? [205, 245, 255] : [255, 214, 90];
      const tip = this._pyramid(ctx, cam, wx, wy, this._box(a * 0.48), H, H + rw * 1.0, spireCol, edge);
      for (let i = 0; i < front.length; i++) {
        this._prism(ctx, cam, front[i][0], front[i][1], this._box(m), H, H + rw * 0.25, wall, this._shade(wall, 1.12), edge);
      }

      // Glowing gem on the spire tip
      const glow = ctx.createRadialGradient(tip.x, tip.y, 0, tip.x, tip.y, rw * 0.6 * node.f);
      glow.addColorStop(0, frosted ? 'rgba(180, 245, 255, 0.9)' : 'rgba(255, 236, 150, 0.95)');
      glow.addColorStop(1, 'rgba(255, 220, 120, 0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(tip.x, tip.y, rw * 0.6 * node.f, 0, Math.PI * 2);
      ctx.fill();
      return H + rw * 1.0;
    }

    // ---- Frosted settlement: a jagged ice crystal has swallowed the hut ----
    if (frosted) {
      const mid = this._p(cam, wx, wy, rw * 0.8);
      const glowR = rw * 1.5 * node.f;
      const glow = ctx.createRadialGradient(mid.x, mid.y, 0, mid.x, mid.y, glowR);
      glow.addColorStop(0, 'rgba(130, 240, 255, 0.35)');
      glow.addColorStop(1, 'rgba(77, 228, 255, 0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(mid.x, mid.y, glowR, 0, Math.PI * 2);
      ctx.fill();

      const shimmer = 0.92 + 0.08 * Math.sin(t * 3 + node.id);
      this._crystal(
        ctx, cam, wx, wy, this._ngon(rw * 0.5, 6, node.id * 0.7), rw * 0.7, rw * 1.8, rw * 0.08,
        [150, 225, 255].map((c) => c * shimmer), 'rgba(230, 252, 255, 0.85)', 0.92
      );
      return rw * 1.8;
    }

    // ---- Clear or warded settlement: a cabin whose height grows with population ----
    const a = rw * 0.36;
    const H = rw * (0.42 + node.population * 0.04);
    const wall = warded ? [246, 214, 160] : [210, 226, 244];
    const roof = warded ? [200, 120, 40] : [158, 64, 58];
    this._prism(ctx, cam, wx, wy, this._box(a), 3, H, wall, null, edge);

    // Warm window on the wall closest to the camera
    const sides = [[0, a], [a, 0], [0, -a], [-a, 0]];
    let best = null;
    for (let i = 0; i < sides.length; i++) {
      const p = this._p(cam, wx + sides[i][0] * 1.01, wy + sides[i][1] * 1.01, H * 0.5);
      if (!best || p.z < best.z) best = p;
    }
    const winR = Math.max(1.5, rw * 0.13 * node.f);
    ctx.fillStyle = warded ? '#ff8a1c' : '#ffc861';
    ctx.shadowColor = '#ffb347';
    ctx.shadowBlur = 8;
    ctx.fillRect(best.x - winR, best.y - winR, winR * 2, winR * 2);
    ctx.shadowBlur = 0;

    // Snow-dusted pyramid roof
    const apexH = H + rw * 0.52;
    const apex = this._pyramid(ctx, cam, wx, wy, this._box(a * 1.22), H, apexH, roof, edge);
    const capR = Math.max(1.2, rw * 0.12 * node.f);
    ctx.fillStyle = 'rgba(240, 250, 255, 0.9)';
    ctx.beginPath();
    ctx.arc(apex.x, apex.y + capR * 0.6, capR, 0, Math.PI * 2);
    ctx.fill();

    if (!warded) {
      return apexH;
    }

    // ---- Beacon flame floating above the warded cabin ----
    const flicker = 1 + Math.sin(t * 9 + node.id * 1.7) * 0.08;
    const fp = this._p(cam, wx, wy, apexH + rw * 0.5);
    const glowR = rw * 1.8 * node.f * flicker;
    const glow = ctx.createRadialGradient(fp.x, fp.y, 0, fp.x, fp.y, glowR);
    glow.addColorStop(0, 'rgba(255, 196, 82, 0.55)');
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
