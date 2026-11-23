/**
 * @file effects.js
 * Procedural visual effects manager for Frostveil (Member B).
 *
 * Handles:
 * - Aurora borealis bands (teal, cyan, violet wave ribbons)
 * - Slow falling snow particles (pre-allocated fixed pool for zero per-frame GC)
 * - Frost creep animation along edges when frost advances (250-450 ms)
 * - Severed road dashed ghost line fade-out (320 ms)
 * - Beacon ignition radial ring & embers (400 ms)
 * - Respects `prefers-reduced-motion: reduce`
 */

const SNOW_COUNT = 68;

export class EffectsManager {
  constructor() {
    this.reducedMotion = false;
    this._initReducedMotionListener();

    this.width = 1280;
    this.height = 720;
    this.time = 0;

    // Pre-allocated snow pool
    this.snow = Array.from({ length: SNOW_COUNT }, (_, i) => ({
      x: ((i * 173) % 1000) / 1000,
      y: ((i * 317) % 1000) / 1000,
      r: 1.1 + (i % 4) * 0.65,
      speedY: 14 + (i % 5) * 6,
      driftPhase: (i * 1.3) % (Math.PI * 2),
      alpha: 0.22 + (i % 5) * 0.11
    }));

    /**
     * Severed road ghost lines:
     * { u: number, v: number, startTime: number, duration: number }
     */
    this.severedGhosts = [];

    /**
     * Frost creep animations along edges:
     * { fromId: number, toId: number, startTime: number, duration: number }
     */
    this.frostCreeps = [];

    /**
     * Beacon ignition pulses:
     * { nodeId: number, startTime: number, duration: number }
     */
    this.beaconPulses = [];
  }

  _initReducedMotionListener() {
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
      this.reducedMotion = Boolean(mq.matches);
      if (typeof mq.addEventListener === 'function') {
        mq.addEventListener('change', (e) => {
          this.reducedMotion = Boolean(e.matches);
        });
      }
    }
  }

  resize(width, height) {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
  }

  clearTransient() {
    this.severedGhosts.length = 0;
    this.frostCreeps.length = 0;
    this.beaconPulses.length = 0;
  }

  /**
   * Triggers a severed-road ghost animation between nodes u and v.
   */
  spawnSeveredRoad(u, v) {
    if (this.reducedMotion) return;
    this.severedGhosts.push({
      u,
      v,
      startTime: this.time,
      duration: 0.38
    });
  }

  /**
   * Triggers a warm beacon ignition ring around nodeId.
   */
  spawnBeaconPulse(nodeId) {
    if (this.reducedMotion) return;
    this.beaconPulses.push({
      nodeId,
      startTime: this.time,
      duration: 0.42
    });
  }

  /**
   * Triggers frost creep animations along edges leading into `newlyFrosted` nodes
   * from previously frosted neighbor nodes.
   *
   * @param {number[]} newlyFrosted
   * @param {object} graph
   * @param {Uint8Array} prevNodeState
   * @param {number} frostedConst
   */
  spawnFrostSpread(newlyFrosted, graph, prevNodeState, frostedConst) {
    if (this.reducedMotion || !newlyFrosted || newlyFrosted.length === 0) return;
    for (let i = 0; i < newlyFrosted.length; i++) {
      const target = newlyFrosted[i];
      const nbrs = graph.neighbors(target);
      for (let j = 0; j < nbrs.length; j++) {
        const src = nbrs[j];
        if (prevNodeState[src] === frostedConst) {
          this.frostCreeps.push({
            fromId: src,
            toId: target,
            startTime: this.time,
            duration: 0.36
          });
        }
      }
    }
  }

  /**
   * Advances snow particles and prunes finished animations.
   * @param {number} dt Delta time in seconds
   */
  update(dt) {
    const clampedDt = Math.min(0.1, Math.max(0, dt));
    this.time += clampedDt;

    if (!this.reducedMotion) {
      const h = this.height;
      const w = this.width;
      for (let i = 0; i < this.snow.length; i++) {
        const p = this.snow[i];
        p.y += (p.speedY * clampedDt) / h;
        p.x += (Math.sin(this.time * 0.9 + p.driftPhase) * 8 * clampedDt) / w;
        if (p.y > 1.03) {
          p.y = -0.02;
          p.x = (p.x + 0.37) % 1.0;
        }
        if (p.x < 0) p.x += 1;
        if (p.x > 1) p.x -= 1;
      }
    }

    // Prune completed transient effects in place
    this._pruneList(this.severedGhosts);
    this._pruneList(this.frostCreeps);
    this._pruneList(this.beaconPulses);
  }

  _pruneList(list) {
    let writeIdx = 0;
    for (let i = 0; i < list.length; i++) {
      const item = list[i];
      if (this.time - item.startTime < item.duration) {
        list[writeIdx++] = item;
      }
    }
    list.length = writeIdx;
  }

  /**
   * Draws the arctic night aurora ribbons and snow backdrop.
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} width
   * @param {number} height
   */
  drawBackgroundEffects(ctx, width, height) {
    // 1. Aurora borealis ribbons across the upper sky
    const bands = [
      { yBase: height * 0.20, amp: 24, freq: 0.0032, speed: 0.55, color: 'rgba(45, 212, 191, 0.09)', thickness: 64 },
      { yBase: height * 0.28, amp: 30, freq: 0.0026, speed: -0.42, color: 'rgba(77, 228, 255, 0.08)', thickness: 76 },
      { yBase: height * 0.15, amp: 18, freq: 0.0040, speed: 0.35, color: 'rgba(139, 92, 246, 0.07)', thickness: 56 }
    ];

    const t = this.reducedMotion ? 0 : this.time;

    ctx.save();
    for (let b = 0; b < bands.length; b++) {
      const band = bands[b];
      ctx.beginPath();
      const step = Math.max(48, Math.floor(width / 16));
      for (let x = 0; x <= width + step; x += step) {
        const y =
          band.yBase +
          Math.sin(x * band.freq + t * band.speed) * band.amp +
          Math.cos(x * band.freq * 0.6 - t * band.speed * 0.8) * (band.amp * 0.45);
        if (x === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.strokeStyle = band.color;
      ctx.lineWidth = band.thickness;
      ctx.lineCap = 'round';
      ctx.stroke();
    }

    // 2. Slow falling snow particles
    ctx.fillStyle = '#d9f4ff';
    for (let i = 0; i < this.snow.length; i++) {
      const p = this.snow[i];
      ctx.globalAlpha = p.alpha;
      ctx.beginPath();
      ctx.arc(p.x * width, p.y * height, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  /**
   * Draws severed road ghost animations and advancing frost creep animations.
   * @param {CanvasRenderingContext2D} ctx
   * @param {{ nodes: { x: number, y: number, r: number }[] }} layout
   */
  drawEdgeEffects(ctx, layout) {
    if (!layout || !layout.nodes || layout.nodes.length === 0) return;

    // 1. Severed road dashed ghost lines
    for (let i = 0; i < this.severedGhosts.length; i++) {
      const g = this.severedGhosts[i];
      const nu = layout.nodes[g.u];
      const nv = layout.nodes[g.v];
      if (!nu || !nv) continue;

      const prog = Math.min(1, (this.time - g.startTime) / g.duration);
      const alpha = 1 - prog;

      ctx.save();
      ctx.strokeStyle = `rgba(255, 110, 128, ${alpha.toFixed(3)})`;
      ctx.lineWidth = 2.5 * (1 - prog * 0.4);
      ctx.setLineDash([7, 7]);
      ctx.lineDashOffset = prog * 18;
      ctx.beginPath();
      ctx.moveTo(nu.x, nu.y);
      ctx.lineTo(nv.x, nv.y);
      ctx.stroke();

      // Small scissor spark at midpoint
      const mx = (nu.x + nv.x) * 0.5;
      const my = (nu.y + nv.y) * 0.5;
      ctx.fillStyle = `rgba(255, 185, 120, ${alpha.toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(mx, my, 4 + prog * 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // 2. Frost creep beam along newly infected roads
    for (let i = 0; i < this.frostCreeps.length; i++) {
      const fc = this.frostCreeps[i];
      const nFrom = layout.nodes[fc.fromId];
      const nTo = layout.nodes[fc.toId];
      if (!nFrom || !nTo) continue;

      const prog = Math.min(1, (this.time - fc.startTime) / fc.duration);
      const curX = nFrom.x + (nTo.x - nFrom.x) * prog;
      const curY = nFrom.y + (nTo.y - nFrom.y) * prog;

      ctx.save();
      ctx.strokeStyle = 'rgba(130, 240, 255, 0.92)';
      ctx.lineWidth = 4;
      ctx.shadowColor = '#4de4ff';
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.moveTo(nFrom.x, nFrom.y);
      ctx.lineTo(curX, curY);
      ctx.stroke();

      // Leading ice crystal spark
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(curX, curY, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  /**
   * Draws expanding warm amber rings when a beacon is lit.
   * @param {CanvasRenderingContext2D} ctx
   * @param {{ nodes: { x: number, y: number, r: number }[] }} layout
   */
  drawNodeEffects(ctx, layout) {
    if (!layout || !layout.nodes || layout.nodes.length === 0) return;

    for (let i = 0; i < this.beaconPulses.length; i++) {
      const bp = this.beaconPulses[i];
      const node = layout.nodes[bp.nodeId];
      if (!node) continue;

      const prog = Math.min(1, (this.time - bp.startTime) / bp.duration);
      const radius = node.r + prog * 28;
      const alpha = (1 - prog) * 0.85;

      ctx.save();
      ctx.strokeStyle = `rgba(255, 196, 82, ${alpha.toFixed(3)})`;
      ctx.lineWidth = 3 * (1 - prog * 0.5);
      ctx.beginPath();
      ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }
}
