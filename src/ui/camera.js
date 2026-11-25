/**
 * @file camera.js
 * Lightweight orbit camera that gives the Canvas 2D map a 2.5D / 3D look (Member B).
 *
 * World space: the flat 2D layout (CSS pixels) is treated as the ground plane,
 * centred on the play-area centre, with `h` as height above the ground.
 * The camera can yaw (rotate around the vertical axis), tilt (0 = top-down,
 * ~1.2 rad = low angle) and zoom. A mild perspective divide makes near objects
 * larger. No libraries or WebGL: everything is projected by hand.
 */

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const TAU = Math.PI * 2;
const DEFAULT_YAW = -0.18;
const DEFAULT_TILT = 0.96;
const DEFAULT_ZOOM = 0.88;

export class Camera {
  constructor() {
    this.mode3D = true;
    this.yaw = DEFAULT_YAW;
    this.tilt = DEFAULT_TILT;
    this.zoom = DEFAULT_ZOOM;
    // Targets: the camera eases smoothly toward these values every frame
    this.tYaw = DEFAULT_YAW;
    this.tTilt = DEFAULT_TILT;
    this.tZoom = DEFAULT_ZOOM;
    this.autoRotate = false;
    this.persp = 1500;

    this.cx = 0;
    this.cy = 0;
    this._cosY = 1;
    this._sinY = 0;
    this._cosT = 1;
    this._sinT = 0;

    /** Re-used projected layout object (avoids per-frame allocation). */
    this._out = { nodes: [], baseRadius: 16, bounds: null, squash: 1, camera: this };
    this._tmp = { x: 0, y: 0, z: 0, f: 1 };
    this._cacheTrig();
  }

  _cacheTrig() {
    this._cosY = Math.cos(this.yaw);
    this._sinY = Math.sin(this.yaw);
    this._cosT = Math.cos(this.tilt);
    this._sinT = Math.sin(this.tilt);
  }

  /** Toggles between the 3D orbit view and a flat top-down 2D view. */
  toggle3D() {
    this.mode3D = !this.mode3D;
    this.reset();
    return this.mode3D;
  }

  /** Eases back to the default viewpoint (nearest full turn, so it never spins wildly). */
  reset() {
    const base = Math.round(this.yaw / TAU) * TAU;
    this.tYaw = this.mode3D ? base + DEFAULT_YAW : base;
    this.tTilt = this.mode3D ? DEFAULT_TILT : 0;
    this.tZoom = this.mode3D ? DEFAULT_ZOOM : 0.96;
  }

  /** Drag-to-orbit: horizontal drag yaws, vertical drag tilts (3D mode only). */
  orbit(dx, dy) {
    this.tYaw += dx * 0.0065;
    if (this.mode3D) {
      this.tTilt = clamp(this.tTilt - dy * 0.004, 0.2, 1.2);
    }
  }

  zoomBy(factor) {
    this.tZoom = clamp(this.tZoom * factor, 0.55, 2.4);
  }

  /**
   * @param {number} dt seconds since last frame
   * @param {boolean} instant skip easing (reduced motion)
   */
  update(dt, instant = false) {
    if (this.autoRotate && !instant) {
      this.tYaw += dt * 0.07;
    }
    const k = instant ? 1 : 1 - Math.exp(-dt * 8);
    this.yaw += (this.tYaw - this.yaw) * k;
    this.tilt += (this.tTilt - this.tilt) * k;
    this.zoom += (this.tZoom - this.zoom) * k;
    this._cacheTrig();
  }

  /**
   * Projects a world point (dx, dy relative to the map centre, height h) to the screen.
   * @param {number} dx
   * @param {number} dy
   * @param {number} h
   * @param {{x:number,y:number,z:number,f:number}} out
   */
  project(dx, dy, h, out) {
    const rx = dx * this._cosY - dy * this._sinY;
    const ry = dx * this._sinY + dy * this._cosY;
    // z grows away from the viewer (top of the screen is far away)
    const z = -ry * this._sinT - h * this._cosT;
    const f = (this.persp / Math.max(200, this.persp + z)) * this.zoom;
    out.x = this.cx + rx * f;
    out.y = this.cy + (ry * this._cosT - h * this._sinT) * f;
    out.z = z;
    out.f = f;
    return out;
  }

  /**
   * Projects every node of a flat layout (from layout.js) into screen space.
   * The returned object keeps the same shape as the flat layout, so hit-testing,
   * effects and tooltips keep working, plus 3D extras (wx, wy, rw, z, f, hitY, hitR).
   */
  projectLayout(base) {
    const out = this._out;
    out.baseRadius = base.baseRadius;
    out.bounds = base.bounds;
    out.squash = Math.max(0.04, this._cosT);

    const b = base.bounds;
    const mcx = b.left + b.width / 2;
    const mcy = b.top + b.height / 2;
    this.cx = mcx;
    this.cy = mcy + this._sinT * 26;

    const src = base.nodes;
    out.nodes.length = src.length;
    const tmp = this._tmp;

    for (let i = 0; i < src.length; i++) {
      const s = src[i];
      let n = out.nodes[i];
      if (!n) {
        n = out.nodes[i] = {};
      }
      const dx = s.x - mcx;
      const dy = s.y - mcy;
      this.project(dx, dy, 0, tmp);
      n.id = s.id;
      n.x = tmp.x;
      n.y = tmp.y;
      n.z = tmp.z;
      n.f = tmp.f;
      n.r = s.r * tmp.f;
      n.rw = s.r;
      n.wx = dx;
      n.wy = dy;
      n.population = s.population;
      n.isCitadel = s.isCitadel;

      // Hit area covers both the base disc and the building standing on it
      this.project(dx, dy, s.r * 1.4, tmp);
      n.hitY = (n.y + tmp.y) / 2;
      n.hitR = Math.max(n.r, (n.y - tmp.y) / 2 + n.r * 0.5);
    }

    return out;
  }
}
