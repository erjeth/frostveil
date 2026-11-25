/**
 * @file effects.js
 * Procedural visual effects manager for Frostveil (Member B).
 *
 * Implements the bright Alpine Arctic sky backdrop:
 * - Luminous arctic daylight/twilight sky gradient
 * - Soft volumetric cloud sea floating beneath the iceberg island
 * - Subtle distant snow peaks & twinkling ice dust
 * - Falling snow particles
 * - Glowing cyan frost creep beams, severed-road ghosts, and beacon pulses
 */

const SNOW_COUNT = 72;

export class EffectsManager {
  constructor() {
    this.reducedMotion = false;
    this._initReducedMotionListener();

    this.width = 1280;
    this.height = 720;
    this.time = 0;
    this.cameraYaw = 0;

    // Pre-allocated snow pool
    this.snow = Array.from({ length: SNOW_COUNT }, (_, i) => ({
      x: ((i * 173) % 1000) / 1000,
      y: ((i * 317) % 1000) / 1000,
      r: 1.3 + (i % 4) * 0.75,
      speedY: 14 + (i % 5) * 6,
      driftPhase: (i * 1.3) % (Math.PI * 2),
      alpha: 0.35 + (i % 5) * 0.12
    }));

    // Pre-allocated fluffy cloud clusters for the lower cloud sea
    this._clouds = [
      { x: 0.10, y: 0.78, rx: 170, ry: 54, speed: 0.004, alpha: 0.82 },
      { x: 0.26, y: 0.85, rx: 220, ry: 68, speed: 0.003, alpha: 0.88 },
      { x: 0.48, y: 0.88, rx: 260, ry: 74, speed: 0.0025, alpha: 0.90 },
      { x: 0.72, y: 0.84, rx: 215, ry: 64, speed: 0.0035, alpha: 0.86 },
      { x: 0.90, y: 0.77, rx: 180, ry: 56, speed: 0.0045, alpha: 0.80 },
      { x: 0.16, y: 0.66, rx: 135, ry: 40, speed: 0.002, alpha: 0.45 },
      { x: 0.84, y: 0.65, rx: 145, ry: 42, speed: 0.0022, alpha: 0.45 }
    ];

    this.severedGhosts = [];
    this.frostCreeps = [];
    this.beaconPulses = [];

    // Preload SVG cloud and snowflake sprites from src/ui/assets/
    this._sprites = {};
    this._preloadSvgSprites();
  }

  _preloadSvgSprites() {
    if (typeof Image === 'undefined') return;
    const files = {
      cloud: './src/ui/assets/world/cloud.svg',
      flake1: './src/ui/assets/snow/snowflake-1.svg',
      flake2: './src/ui/assets/snow/snowflake-2.svg',
      flake3: './src/ui/assets/snow/snowflake-3.svg',
      particle: './src/ui/assets/snow/snow-particle.svg'
    };
    for (const [key, src] of Object.entries(files)) {
      const img = new Image();
      img.src = src;
      this._sprites[key] = img;
    }
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

  spawnSeveredRoad(u, v) {
    if (this.reducedMotion) return;
    this.severedGhosts.push({
      u,
      v,
      startTime: this.time,
      duration: 0.38
    });
  }

  spawnBeaconPulse(nodeId) {
    if (this.reducedMotion) return;
    this.beaconPulses.push({
      nodeId,
      startTime: this.time,
      duration: 0.45
    });
  }

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
            duration: 0.38
          });
        }
      }
    }
  }

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

  drawBackgroundEffects(ctx, width, height) {
    this.drawSky(ctx, width, height);
    this.drawSnow(ctx, width, height);
  }

  /**
   * Draws the luminous Alpine Arctic sky, sparkling ice motes, soft aurora glow,
   * and the sea of fluffy clouds below the floating island (matching Reference Image 1).
   */
  drawSky(ctx, width, height) {
    const t = this.reducedMotion ? 0 : this.time;
    const yaw = this.cameraYaw || 0;

    // 1. Central radial atmospheric glow behind the floating island
    ctx.save();
    const sunGlow = ctx.createRadialGradient(
      width * 0.5,
      height * 0.44,
      20,
      width * 0.5,
      height * 0.44,
      Math.max(width, height) * 0.62
    );
    sunGlow.addColorStop(0, 'rgba(235, 250, 255, 0.52)');
    sunGlow.addColorStop(0.5, 'rgba(145, 218, 255, 0.22)');
    sunGlow.addColorStop(1, 'rgba(56, 142, 214, 0)');
    ctx.fillStyle = sunGlow;
    ctx.fillRect(0, 0, width, height);

    // 2. Soft upper-sky aurora sheen
    const bands = [
      { yBase: height * 0.14, amp: 16, freq: 0.0032, speed: 0.45, color: 'rgba(186, 242, 255, 0.18)', thickness: 48 },
      { yBase: height * 0.22, amp: 20, freq: 0.0024, speed: -0.35, color: 'rgba(125, 228, 255, 0.14)', thickness: 58 }
    ];
    for (let b = 0; b < bands.length; b++) {
      const band = bands[b];
      ctx.beginPath();
      const step = Math.max(48, Math.floor(width / 16));
      for (let x = 0; x <= width + step; x += step) {
        const y =
          band.yBase +
          Math.sin(x * band.freq + t * band.speed) * band.amp +
          Math.cos(x * band.freq * 0.6 - t * band.speed * 0.8) * (band.amp * 0.45);
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = band.color;
      ctx.lineWidth = band.thickness;
      ctx.lineCap = 'round';
      ctx.stroke();
    }

    // 3. Soft volumetric cloud sea around the lower horizon (using world/cloud.svg when loaded)
    const parallax = yaw * width * 0.05;
    const cloudImg = this._sprites && this._sprites.cloud;
    const hasCloudSvg = cloudImg && cloudImg.complete && cloudImg.naturalWidth > 0;

    for (let i = 0; i < this._clouds.length; i++) {
      const c = this._clouds[i];
      let cx = ((c.x * width + t * c.speed * width + parallax) % (width + 320)) - 160;
      if (cx < -160) cx += width + 320;
      const cy = c.y * height;

      if (hasCloudSvg) {
        ctx.save();
        ctx.globalAlpha = c.alpha * 0.78;
        ctx.drawImage(cloudImg, cx - c.rx, cy - c.ry, c.rx * 2, c.ry * 1.85);
        ctx.restore();
      } else {
        const grad = ctx.createRadialGradient(cx, cy - c.ry * 0.2, c.ry * 0.15, cx, cy, c.rx);
        grad.addColorStop(0, `rgba(248, 253, 255, ${c.alpha})`);
        grad.addColorStop(0.55, `rgba(214, 240, 255, ${c.alpha * 0.65})`);
        grad.addColorStop(1, 'rgba(165, 218, 250, 0)');

        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.ellipse(cx, cy, c.rx, c.ry, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Bottom cloud mist veil
    const mist = ctx.createLinearGradient(0, height * 0.72, 0, height);
    mist.addColorStop(0, 'rgba(210, 238, 255, 0)');
    mist.addColorStop(0.65, 'rgba(225, 245, 255, 0.55)');
    mist.addColorStop(1, 'rgba(240, 250, 255, 0.85)');
    ctx.fillStyle = mist;
    ctx.fillRect(0, height * 0.72, width, height * 0.28);

    ctx.restore();
  }

  drawSnow(ctx, width, height) {
    ctx.save();
    ctx.fillStyle = '#ffffff';
    const f1 = this._sprites && this._sprites.flake1;
    const f2 = this._sprites && this._sprites.flake2;
    const hasFlakes = f1 && f1.complete && f1.naturalWidth > 0 && f2 && f2.complete && f2.naturalWidth > 0;

    for (let i = 0; i < this.snow.length; i++) {
      const p = this.snow[i];
      ctx.globalAlpha = p.alpha;
      const sx = p.x * width;
      const sy = p.y * height;
      if (hasFlakes && i % 5 === 0) {
        const img = i % 10 === 0 ? f1 : f2;
        const sz = p.r * 4.2;
        ctx.drawImage(img, sx - sz * 0.5, sy - sz * 0.5, sz, sz);
      } else {
        ctx.beginPath();
        ctx.arc(sx, sy, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

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
      ctx.strokeStyle = `rgba(239, 68, 68, ${alpha.toFixed(3)})`;
      ctx.lineWidth = 3 * (1 - prog * 0.4);
      ctx.setLineDash([7, 7]);
      ctx.lineDashOffset = prog * 18;
      ctx.beginPath();
      ctx.moveTo(nu.x, nu.y);
      ctx.lineTo(nv.x, nv.y);
      ctx.stroke();

      const mx = (nu.x + nv.x) * 0.5;
      const my = (nu.y + nv.y) * 0.5;
      ctx.fillStyle = `rgba(251, 146, 60, ${alpha.toFixed(3)})`;
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
      ctx.strokeStyle = 'rgba(56, 235, 255, 0.96)';
      ctx.lineWidth = 5;
      ctx.shadowColor = '#06b6d4';
      ctx.shadowBlur = 14;
      ctx.beginPath();
      ctx.moveTo(nFrom.x, nFrom.y);
      ctx.lineTo(curX, curY);
      ctx.stroke();

      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(curX, curY, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  drawNodeEffects(ctx, layout) {
    if (!layout || !layout.nodes || layout.nodes.length === 0) return;

    for (let i = 0; i < this.beaconPulses.length; i++) {
      const bp = this.beaconPulses[i];
      const node = layout.nodes[bp.nodeId];
      if (!node) continue;

      const prog = Math.min(1, (this.time - bp.startTime) / bp.duration);
      const radius = node.r + prog * 30;
      const alpha = (1 - prog) * 0.9;

      ctx.save();
      ctx.strokeStyle = `rgba(245, 158, 11, ${alpha.toFixed(3)})`;
      ctx.lineWidth = 3.5 * (1 - prog * 0.5);
      ctx.beginPath();
      ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }
}
