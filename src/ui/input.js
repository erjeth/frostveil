/**
 * @file input.js
 * Mouse, touch (pointer events + long-press tooltip), and keyboard shortcut
 * handler for Frostveil (Member B).
 */

import { pickNode, pickEdge } from './layout.js';

export class InputController {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {object} callbacks
   * @param {() => { state: any, layout: any, activeScreen: string, activeTool: string }} callbacks.getContext
   * @param {(nodeId: number) => void} callbacks.onNodeClick
   * @param {(edge: [number, number]) => void} callbacks.onEdgeClick
   * @param {(nodeId: number, edge: [number, number] | null, clientX: number, clientY: number) => void} callbacks.onHoverChange
   * @param {(keyAction: string) => void} callbacks.onShortcut
   */
  constructor(canvas, callbacks) {
    this.canvas = canvas;
    this.cb = callbacks;

    this.hoverNodeId = -1;
    this.hoverEdge = null;

    this._longPressTimer = null;
    this._longPressTriggered = false;
    this._downPos = null;

    this._bindEvents();
  }

  _bindEvents() {
    this.canvas.addEventListener('pointermove', (e) => this._onPointerMove(e));
    this.canvas.addEventListener('pointerdown', (e) => this._onPointerDown(e));
    this.canvas.addEventListener('pointerup', (e) => this._onPointerUp(e));
    this.canvas.addEventListener('pointercancel', () => this._clearLongPress());
    this.canvas.addEventListener('pointerleave', () => {
      this._clearLongPress();
      this.hoverNodeId = -1;
      this.hoverEdge = null;
      this.canvas.style.cursor = 'default';
      this.cb.onHoverChange(-1, null, 0, 0);
    });

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

  _onPointerMove(e) {
    const { activeScreen, activeTool } = this.cb.getContext();
    if (activeScreen !== 'game' && activeScreen !== 'arena') return;

    if (this._downPos) {
      const moved = Math.hypot(e.clientX - this._downPos.x, e.clientY - this._downPos.y);
      if (moved > 12) {
        this._clearLongPress();
      }
    }

    const pos = this._getCanvasCoords(e);
    const { nodeId, edge } = this._hitTest(pos.x, pos.y, e.pointerType === 'touch');

    this.hoverNodeId = nodeId;
    this.hoverEdge = edge;

    // Update cursor shape depending on active tool & hovered entity
    if (activeScreen === 'game') {
      const canNode = (activeTool === 'auto' || activeTool === 'beacon') && nodeId !== -1;
      const canEdge = (activeTool === 'auto' || activeTool === 'sever') && edge !== null;
      this.canvas.style.cursor = canNode || canEdge ? 'pointer' : 'default';
    } else {
      this.canvas.style.cursor = nodeId !== -1 ? 'help' : 'default';
    }

    this.cb.onHoverChange(nodeId, edge, e.clientX, e.clientY);
  }

  _onPointerDown(e) {
    const { activeScreen } = this.cb.getContext();
    if (activeScreen !== 'game' && activeScreen !== 'arena') return;

    this._clearLongPress();
    this._longPressTriggered = false;
    this._downPos = { x: e.clientX, y: e.clientY };

    const pos = this._getCanvasCoords(e);
    const isTouch = e.pointerType === 'touch';
    const { nodeId, edge } = this._hitTest(pos.x, pos.y, isTouch);

    if (isTouch && nodeId !== -1) {
      // Long-press (420 ms) on touch displays the inspection tooltip without spending an action
      this._longPressTimer = window.setTimeout(() => {
        this._longPressTriggered = true;
        this.hoverNodeId = nodeId;
        this.cb.onHoverChange(nodeId, null, e.clientX, e.clientY);
      }, 420);
    }
  }

  _onPointerUp(e) {
    const wasLongPress = this._longPressTriggered;
    this._clearLongPress();
    this._downPos = null;

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
