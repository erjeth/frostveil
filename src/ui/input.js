/**
 * @file input.js
 * Mouse, touch, and keyboard handler for Frostveil (Member B).
 *
 * - Click / tap: act on a node (beacon) or road (sever)
 * - Drag (mouse or one finger): orbit the 3D camera (a drag never counts as a click)
 * - Mouse wheel / two-finger pinch: zoom
 * - Long-press on touch: inspection tooltip
 * - Keyboard shortcuts (see README / How to Play)
 */

import { pickNode, pickEdge } from './layout.js';

const DRAG_THRESHOLD = 6;

export class InputController {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {object} callbacks
   * @param {() => { state: any, layout: any, activeScreen: string, activeTool: string }} callbacks.getContext
   * @param {(nodeId: number) => void} callbacks.onNodeClick
   * @param {(edge: [number, number]) => void} callbacks.onEdgeClick
   * @param {(nodeId: number, edge: [number, number] | null, clientX: number, clientY: number) => void} callbacks.onHoverChange
   * @param {(keyAction: string) => void} callbacks.onShortcut
   * @param {(dx: number, dy: number) => void} callbacks.onOrbit
   * @param {(factor: number) => void} callbacks.onZoom
   */
  constructor(canvas, callbacks) {
    this.canvas = canvas;
    this.cb = callbacks;

    this.hoverNodeId = -1;
    this.hoverEdge = null;

    this._longPressTimer = null;
    this._longPressTriggered = false;

    /** Active pointers (for pinch zoom): id -> { x, y } */
    this._pointers = new Map();
    this._drag = null;
    this._pinchDist = 0;
    this._suppressClick = false;

    this._bindEvents();
  }

  _isMapScreen() {
    const { activeScreen } = this.cb.getContext();
    return activeScreen === 'game' || activeScreen === 'arena';
  }

  _bindEvents() {
    this.canvas.addEventListener('pointermove', (e) => this._onPointerMove(e));
    this.canvas.addEventListener('pointerdown', (e) => this._onPointerDown(e));
    this.canvas.addEventListener('pointerup', (e) => this._onPointerUp(e));
    this.canvas.addEventListener('pointercancel', (e) => {
      this._pointers.delete(e.pointerId);
      this._drag = null;
      this._pinchDist = 0;
      this._clearLongPress();
    });
    this.canvas.addEventListener('pointerleave', () => {
      if (this._drag) return;
      this._clearLongPress();
      this.hoverNodeId = -1;
      this.hoverEdge = null;
      this.canvas.style.cursor = 'default';
      this.cb.onHoverChange(-1, null, 0, 0);
    });
    this.canvas.addEventListener(
      'wheel',
      (e) => {
        if (!this._isMapScreen()) return;
        e.preventDefault();
        this.cb.onZoom(Math.exp(-e.deltaY * 0.0012));
      },
      { passive: false }
    );

    window.addEventListener('keydown', (e) => this._onKeyDown(e));
  }

  _getCanvasCoords(e) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    };
  }

  _hitTest(px, py, isTouch = false) {
    const { state, layout } = this.cb.getContext();
    if (!state || !layout) {
      return { nodeId: -1, edge: null };
    }

    const nodeSlop = isTouch ? 12 : 6;
    const edgeSlop = isTouch ? 18 : 13;

    const nodeId = pickNode(px, py, layout, nodeSlop);
    if (nodeId !== -1) {
      return { nodeId, edge: null };
    }

    const edge = pickEdge(px, py, state.graph, layout, edgeSlop);
    return { nodeId: -1, edge };
  }

  _pinchDistance() {
    const pts = Array.from(this._pointers.values());
    if (pts.length < 2) return 0;
    return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
  }

  _onPointerDown(e) {
    if (!this._isMapScreen()) return;

    if (typeof this.canvas.setPointerCapture === 'function') {
      try {
        this.canvas.setPointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    }

    this._pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this._clearLongPress();
    this._longPressTriggered = false;

    if (this._pointers.size === 1) {
      this._drag = {
        startX: e.clientX,
        startY: e.clientY,
        lastX: e.clientX,
        lastY: e.clientY,
        moved: false
      };
      this._suppressClick = false;
    } else if (this._pointers.size === 2) {
      // Second finger down: start pinch, never treat as a click
      this._pinchDist = this._pinchDistance();
      this._suppressClick = true;
      return;
    }

    const pos = this._getCanvasCoords(e);
    const isTouch = e.pointerType === 'touch';
    const { nodeId } = this._hitTest(pos.x, pos.y, isTouch);

    if (isTouch && nodeId !== -1) {
      // Long-press (420 ms) on touch displays the inspection tooltip without spending an action
      this._longPressTimer = window.setTimeout(() => {
        this._longPressTriggered = true;
        this.hoverNodeId = nodeId;
        this.cb.onHoverChange(nodeId, null, e.clientX, e.clientY);
      }, 420);
    }
  }

  _onPointerMove(e) {
    if (!this._isMapScreen()) return;
    const { activeScreen, activeTool } = this.cb.getContext();

    // ---- Pinch zoom ----
    if (this._pointers.has(e.pointerId)) {
      this._pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this._pointers.size >= 2) {
        const d = this._pinchDistance();
        if (this._pinchDist > 0 && d > 0) {
          this.cb.onZoom(d / this._pinchDist);
        }
        this._pinchDist = d;
        return;
      }
    }

    // ---- Drag to orbit ----
    if (this._drag && this._pointers.has(e.pointerId)) {
      const dx = e.clientX - this._drag.lastX;
      const dy = e.clientY - this._drag.lastY;
      if (!this._drag.moved) {
        const total = Math.hypot(e.clientX - this._drag.startX, e.clientY - this._drag.startY);
        if (total > DRAG_THRESHOLD) {
          this._drag.moved = true;
          this._suppressClick = true;
          this._clearLongPress();
          this.cb.onHoverChange(-1, null, 0, 0);
        }
      }
      this._drag.lastX = e.clientX;
      this._drag.lastY = e.clientY;
      if (this._drag.moved) {
        this.canvas.style.cursor = 'grabbing';
        this.cb.onOrbit(dx, dy);
        return;
      }
    }

    // ---- Hover ----
    const pos = this._getCanvasCoords(e);
    const { nodeId, edge } = this._hitTest(pos.x, pos.y, e.pointerType === 'touch');

    this.hoverNodeId = nodeId;
    this.hoverEdge = edge;

    if (activeScreen === 'game') {
      const canNode = (activeTool === 'auto' || activeTool === 'beacon') && nodeId !== -1;
      const canEdge = (activeTool === 'auto' || activeTool === 'sever') && edge !== null;
      this.canvas.style.cursor = canNode || canEdge ? 'pointer' : 'grab';
    } else {
      this.canvas.style.cursor = nodeId !== -1 ? 'help' : 'grab';
    }

    this.cb.onHoverChange(nodeId, edge, e.clientX, e.clientY);
  }

  _onPointerUp(e) {
    const wasLongPress = this._longPressTriggered;
    this._clearLongPress();
    this._pointers.delete(e.pointerId);
    if (this._pointers.size < 2) {
      this._pinchDist = 0;
    }

    if (this._suppressClick) {
      if (this._pointers.size === 0) {
        this._drag = null;
        this._suppressClick = false;
        this.canvas.style.cursor = 'grab';
      }
      return;
    }
    this._drag = null;

    if (wasLongPress) {
      return;
    }

    const { activeScreen, activeTool } = this.cb.getContext();
    if (activeScreen !== 'game') return;

    const pos = this._getCanvasCoords(e);
    const isTouch = e.pointerType === 'touch';
    const { nodeId, edge } = this._hitTest(pos.x, pos.y, isTouch);

    if (activeTool === 'beacon') {
      if (nodeId !== -1) {
        this.cb.onNodeClick(nodeId);
      }
      return;
    }

    if (activeTool === 'sever') {
      if (edge !== null) {
        this.cb.onEdgeClick(edge);
      } else if (nodeId !== -1) {
        // User clicked a node while in Sever mode: inform controller
        this.cb.onNodeClick(nodeId);
      }
      return;
    }

    // Default 'auto' mode: click node = beacon, click edge = sever
    if (nodeId !== -1) {
      this.cb.onNodeClick(nodeId);
    } else if (edge !== null) {
      this.cb.onEdgeClick(edge);
    }
  }

  _clearLongPress() {
    if (this._longPressTimer !== null) {
      clearTimeout(this._longPressTimer);
      this._longPressTimer = null;
    }
  }

  _onKeyDown(e) {
    // Do not intercept keys when typing inside an input or select
    const tag = e.target && e.target.tagName ? e.target.tagName.toLowerCase() : '';
    if (tag === 'input' || tag === 'textarea' || tag === 'select') {
      if (e.key === 'Escape') {
        e.target.blur();
      }
      return;
    }

    const key = e.key.toLowerCase();

    if (key === 'm') {
      this.cb.onShortcut('mute');
      return;
    }

    const { activeScreen } = this.cb.getContext();

    // Camera keys work on any map screen (game and arena)
    if (activeScreen === 'game' || activeScreen === 'arena') {
      if (key === 'v') {
        e.preventDefault();
        this.cb.onShortcut('toggle3d');
        return;
      }
      if (key === '0') {
        e.preventDefault();
        this.cb.onShortcut('resetView');
        return;
      }
      if (key === 'q' || key === 'arrowleft') {
        e.preventDefault();
        this.cb.onOrbit(-40, 0);
        return;
      }
      if (key === 'arrowright') {
        e.preventDefault();
        this.cb.onOrbit(40, 0);
        return;
      }
      if (key === '+' || key === '=') {
        this.cb.onZoom(1.15);
        return;
      }
      if (key === '-') {
        this.cb.onZoom(1 / 1.15);
        return;
      }
    }

    if (activeScreen !== 'game') {
      if (e.key === 'Escape') {
        this.cb.onShortcut('escape');
      }
      return;
    }

    switch (key) {
      case 'e':
        e.preventDefault();
        this.cb.onShortcut('endTurn');
        break;
      case 'u':
        e.preventDefault();
        this.cb.onShortcut('undo');
        break;
      case 'h':
        e.preventDefault();
        this.cb.onShortcut('hint');
        break;
      case 'f':
        e.preventDefault();
        this.cb.onShortcut('forecast');
        break;
      case 'z':
        e.preventDefault();
        this.cb.onShortcut('safeZones');
        break;
      case 'c':
        e.preventDefault();
        this.cb.onShortcut('critical');
        break;
      case '1':
        e.preventDefault();
        this.cb.onShortcut('toolBeacon');
        break;
      case '2':
        e.preventDefault();
        this.cb.onShortcut('toolSever');
        break;
      case 'r':
        e.preventDefault();
        this.cb.onShortcut('restart');
        break;
      case 'escape':
        e.preventDefault();
        this.cb.onShortcut('menu');
        break;
      default:
        break;
    }
  }
}
