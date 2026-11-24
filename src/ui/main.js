/**
 * @file main.js
 * Application entry point, game state orchestrator, Strategy Arena playback engine,
 * and 60fps requestAnimationFrame loop for Frostveil (Member B).
 */

import {
  NodeState,
  createGameState,
  applyAction,
  undoAction,
  endWardenPhase,
  frostForecast,
  safeZones,
  articulationPointsAndBridges,
  blockedMask,
  evaluateOutcome,
  buildLevel,
  articulationGreedyStrategy,
  STRATEGIES,
  playOut,
  bruteForceOptimal
} from './core.js';

import { computeLayout } from './layout.js';
import { Camera } from './camera.js';
import { EffectsManager } from './effects.js';
import { Renderer } from './renderer.js';
import { InputController } from './input.js';
import { HudManager } from './hud.js';
import { StorageManager } from './storage.js';
import { AudioManager } from './audio.js';
import { ScreenManager } from './screens.js';

class FrostveilApp {
  constructor() {
    this.canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('game-canvas'));
    this.storage = new StorageManager();
    this.audio = new AudioManager(this.storage);
    this.effects = new EffectsManager();
    this.renderer = new Renderer(this.canvas, this.effects);
    this.hud = new HudManager();

    // Active game session state
    this.currentLevel = buildLevel(1);
    this.currentLevelLabel = 'Level 1: Outpost of Dawn';
    this.state = createGameState(this.currentLevel);
    this.camera = new Camera();
    this.baseLayout = computeLayout(this.currentLevel, this.renderer.width, this.renderer.height);
    this.layout = this.camera.projectLayout(this.baseLayout);

    // UI state for Game Screen
    this.activeTool = 'auto'; // 'auto' | 'beacon' | 'sever'
    this.overlays = {
      forecast: false,
      safeZones: false,
      critical: false
    };
    this.hintsLeft = 3;
    this.hintNodes = [];

    // Cached algorithmic analysis for current state (recomputed on state mutation, not every frame)
    this.analysis = {
      forecast: null,
      safeZones: null,
      critical: null
    };

    // Ending transition timer when state.over becomes true
    this._endTransitionTimer = null;

    // Strategy Arena playback state
    this.arenaLevel = null;
    this.arenaRuns = new Map();
    this.arenaStrategyId = 'articulationGreedy';
    this.arenaPlaying = false;
    this.arenaTurnIdx = 0;
    this.arenaSubPhase = 'warden'; // 'warden' | 'frost'
    this.arenaDelayMs = 600;
    this._arenaTimer = null;

    // Initialize ScreenManager
    this.screens = new ScreenManager({
      storage: this.storage,
      audio: this.audio,
      renderer: this.renderer,
      hud: this.hud,
      onStartLevel: (level, label) => this.startLevel(level, label),
      onArenaLevelLoaded: (level) => this.loadArenaLevel(level),
      onArenaStep: () => this.stepArena(true),
      onArenaReset: () => this.resetArenaPlayback(),
      onArenaTogglePlay: (forceState) => this.toggleArenaPlay(forceState),
      onArenaStrategyChange: (stratId) => this.selectArenaStrategy(stratId),
      onArenaSpeedChange: (delayMs) => {
        this.arenaDelayMs = delayMs;
        if (this.arenaPlaying) {
          this._scheduleNextArenaStep();
        }
      }
    });

    // Initialize Pointer & Keyboard InputController
    this.input = new InputController(this.canvas, {
      getContext: () => ({
        state: this.state,
        layout: this.layout,
        activeScreen: this.screens.activeScreen,
        activeTool: this.activeTool
      }),
      onNodeClick: (nodeId) => this.handleNodeClick(nodeId),
      onEdgeClick: (edge) => this.handleEdgeClick(edge),
      onHoverChange: (nodeId, edge, clientX, clientY) => {
        this._lastPointerX = clientX;
        this._lastPointerY = clientY;
        this.hud.updateTooltip({
          state: this.state,
          analysis: this.analysis,
          nodeId,
          edge,
          clientX,
          clientY
        });
      },
      onShortcut: (action) => this.handleShortcut(action),
      onOrbit: (dx, dy) => this.camera.orbit(dx, dy),
      onZoom: (factor) => this.camera.zoomBy(factor)
    });

    // Frame timing & FPS measurement
    this._lastFrameTime = performance.now();
    this._fpsFrames = 0;
    this._fpsAccum = 0;

    this._bindToolbarButtons();
    this._updateMuteButtonUI();
    this._recomputeAnalysis();

    window.addEventListener('resize', () => {
      this.renderer.resize();
      if (this.state && this.state.level) {
        this.baseLayout = computeLayout(this.state.level, this.renderer.width, this.renderer.height);
      }
      if (this.screens.activeScreen === 'howto') {
        this.renderer.drawHowToIllustrations();
      }
    });

    requestAnimationFrame((ts) => this._loop(ts));
  }

  _bindToolbarButtons() {
    this._bindClick('btn-mute', () => {
      this.audio.toggleMute();
      this._updateMuteButtonUI();
    });

    this._bindClick('btn-tool-auto', () => this.setTool('auto'));
    this._bindClick('btn-tool-beacon', () => this.setTool('beacon'));
    this._bindClick('btn-tool-sever', () => this.setTool('sever'));

    this._bindClick('btn-overlay-forecast', () => this.toggleOverlay('forecast'));
    this._bindClick('btn-overlay-safezones', () => this.toggleOverlay('safeZones'));
    this._bindClick('btn-overlay-critical', () => this.toggleOverlay('critical'));

    this._bindClick('btn-game-hint', () => this.triggerHint());
    this._bindClick('btn-view-3d', () => this.handleShortcut('toggle3d'));
    this._bindClick('btn-view-reset', () => this.handleShortcut('resetView'));
    this._bindClick('btn-arena-view-3d', () => this.handleShortcut('toggle3d'));
    this._bindClick('btn-game-undo', () => this.triggerUndo());
    this._bindClick('btn-game-endturn', () => this.triggerEndTurn());
    this._bindClick('btn-game-restart', () => this.restartCurrentLevel());
    this._bindClick('btn-game-menu', () => {
      this.audio.playClick();
      this._clearEndTransition();
      this.screens.showScreen('levels');
    });
  }

  _bindClick(id, fn) {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('click', fn);
    }
  }

  _updateMuteButtonUI() {
    const icon = document.getElementById('mute-icon');
    const label = document.getElementById('mute-label');
    const btn = document.getElementById('btn-mute');
    const muted = this.audio.muted;
    if (icon) {
      icon.innerHTML = muted
        ? '<svg width="14" height="14" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.8"><polygon points="3,7 7,7 11,3 11,15 7,11 3,11"/><line x1="14" y1="6" x2="17" y2="12"/><line x1="17" y1="6" x2="14" y2="12"/></svg>'
        : '<svg width="14" height="14" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.8"><polygon points="3,7 7,7 11,3 11,15 7,11 3,11"/><path d="M13.5 6.5a3.5 3.5 0 0 1 0 5"/><path d="M15.5 4.5a6.5 6.5 0 0 1 0 9"/></svg>';
    }
    if (label) label.textContent = muted ? 'Muted' : 'Sound';
    if (btn) btn.setAttribute('aria-pressed', String(muted));
  }

  /**
   * Starts a playable game session on the provided Level object.
   * @param {object} level
   * @param {string} label
   */
  startLevel(level, label) {
    this._clearEndTransition();
    this.toggleArenaPlay(false);

    this.currentLevel = level;
    this.currentLevelLabel = label;
    this.state = createGameState(level);
    this.baseLayout = computeLayout(level, this.renderer.width, this.renderer.height);
    this.camera.reset();
    this.effects.clearTransient();

    this.hintsLeft = 3;
    this.hintNodes = [];
    this._recomputeAnalysis();

    this.screens.showScreen('game');
    this._syncHud();

    const out = evaluateOutcome(this.state);
    this.hud.announce(
      `Started ${label}. Turn 1. ${this.state.actionsLeft} actions available. Saved population ${out.savedPercent} percent, target ${level.targetPercent} percent.`
    );
  }

  restartCurrentLevel() {
    this.audio.playClick();
    if (this.currentLevel) {
      this.startLevel(this.currentLevel, this.currentLevelLabel);
      this.hud.showToast('Level restarted.', 'info');
    }
  }

  setTool(tool) {
    this.audio.playClick();
    // If clicking an already active specific tool ('beacon' or 'sever'), toggle back to 'auto'
    if (tool !== 'auto' && this.activeTool === tool) {
      this.activeTool = 'auto';
    } else {
      this.activeTool = tool;
    }
    this._syncHud();
  }

  toggleOverlay(key) {
    this.audio.playClick();
    if (key in this.overlays) {
      this.overlays[key] = !this.overlays[key];
      this._syncHud();
    }
  }

  /**
   * Handles clicking a settlement node on the canvas.
   * @param {number} nodeId
   */
  handleNodeClick(nodeId) {
    if (!this.state || this.state.over) return;

    if (this.activeTool === 'sever') {
      this.audio.playInvalid();
      this.hud.showToast('Sever tool active: click a road between settlements, or press 1 for Beacon.');
      return;
    }

    const res = applyAction(this.state, { type: 'beacon', node: nodeId });
    if (!res.ok) {
      this.audio.playInvalid();
      this.hud.showToast(res.reason || 'Cannot place beacon here.');
      return;
    }

    this.audio.playBeacon();
    this.effects.spawnBeaconPulse(nodeId);
    this.hintNodes = this.hintNodes.filter((id) => id !== nodeId);
    this._recomputeAnalysis();
    this._syncHud();

    const node = this.state.level.nodes[nodeId];
    this.hud.announce(
      `Lit beacon on ${node.isCitadel ? 'The Citadel' : 'Settlement ' + nodeId}. ${this.state.actionsLeft} actions left.`
    );
  }

  /**
   * Handles clicking a road edge on the canvas.
   * @param {[number, number]} edge
   */
  handleEdgeClick(edge) {
    if (!this.state || this.state.over || !edge) return;

    const [u, v] = edge;
    const res = applyAction(this.state, { type: 'sever', u, v });
    if (!res.ok) {
      this.audio.playInvalid();
      this.hud.showToast(res.reason || 'Cannot sever that road.');
      return;
    }

    this.audio.playSever();
    this.effects.spawnSeveredRoad(u, v);
    this.hintNodes = [];
    this._recomputeAnalysis();
    this._syncHud();

    this.hud.announce(`Severed road between settlement ${u} and settlement ${v}. ${this.state.actionsLeft} actions left.`);
  }

  /**
   * Undoes the last Warden action in the current turn.
   */
  triggerUndo() {
    if (!this.state || this.state.over) return;
    const ok = undoAction(this.state);
    if (!ok) {
      this.audio.playInvalid();
      this.hud.showToast('Nothing to undo this turn.');
      return;
    }

    this.audio.playUndo();
    this.hintNodes = [];
    this._recomputeAnalysis();
    this._syncHud();
    this.hud.showToast('Undid last action.', 'info');
    this.hud.announce(`Undid last action. ${this.state.actionsLeft} actions left.`);
  }

  /**
   * Requests a strategic suggestion from `articulationGreedyStrategy(state)` (max 3 per level).
   */
  triggerHint() {
    if (!this.state || this.state.over) return;
    if (this.hintsLeft <= 0) {
      this.audio.playInvalid();
      this.hud.showToast('No hints remaining for this level (0/3).');
      return;
    }
    if (this.state.actionsLeft <= 0) {
      this.audio.playInvalid();
      this.hud.showToast('No actions left this turn. Undo an action or End Turn first.');
      return;
    }

    const suggestions = articulationGreedyStrategy(this.state) || [];
    const nodes = [];
    for (let i = 0; i < suggestions.length; i++) {
      if (suggestions[i] && typeof suggestions[i].node === 'number') {
        nodes.push(suggestions[i].node);
      }
    }

    if (nodes.length === 0) {
      this.hud.showToast('No reachable settlements require a beacon right now.', 'info');
      return;
    }

    this.hintsLeft -= 1;
    this.hintNodes = nodes;
    this.audio.playHint();
    this._syncHud();

    const labelList = nodes.map((id) => (this.state.level.nodes[id].isCitadel ? `Citadel (#${id})` : `#${id}`)).join(', ');
    this.hud.showToast(`💡 Hint: Consider lighting a beacon on settlement ${labelList}`, 'info');
    this.hud.announce(`Hint activated. Suggested settlement ${labelList}. ${this.hintsLeft} hints remaining.`);
  }

  /**
   * Ends the current Warden phase and advances frost by one BFS layer.
   */
  triggerEndTurn() {
    if (!this.state || this.state.over) return;

    const prevNodeState = this.state.nodeState.slice();
    const { newlyFrosted, contained } = endWardenPhase(this.state);

    if (newlyFrosted.length > 0) {
      this.audio.playFrost();
      this.effects.spawnFrostSpread(
        newlyFrosted,
        this.state.graph,
        prevNodeState,
        NodeState.FROSTED
      );
    } else {
      this.audio.playClick();
    }

    this.hintNodes = [];
    this._recomputeAnalysis();
    this._syncHud();

    const out = this.state.outcome || evaluateOutcome(this.state);

    if (contained || this.state.over) {
      // Save progress if campaign level 1..8
      if (this.state.level.id && this.state.level.id >= 1) {
        this.storage.recordLevelOutcome(this.state.level.id, out);
      }

      if (out.won) {
        this.audio.playWin();
        this.hud.showToast(`🎉 Frost Contained! Saved ${out.savedPercent}% (${out.stars}★)`, 'info');
      } else {
        this.audio.playLose();
        this.hud.showToast(
          out.citadelSafe
            ? `❄️ Frost overtook the realm (${out.savedPercent}% saved, needed ${this.state.level.targetPercent}%).`
            : '❄️ The Citadel was frosted! Realm lost.'
        );
      }

      this.hud.announce(
        `Game over. ${out.won ? 'Victory!' : 'Defeat.'} Saved ${out.savedPopulation} of ${out.totalPopulation} population (${out.savedPercent} percent). Earned ${out.stars} stars.`
      );

      const delay = this.effects.reducedMotion ? 120 : 620;
      this._clearEndTransition();
      this._endTransitionTimer = window.setTimeout(() => {
        this.screens.showResultScreen(this.state);
      }, delay);
    } else {
      this.hud.announce(
        `Turn ${this.state.turn}. Frost spread to ${newlyFrosted.length} settlements. Saved population ${out.savedPercent} percent.`
      );
    }
  }

  /**
   * Dispatches keyboard shortcuts from InputController.
   * @param {string} action
   */
  handleShortcut(action) {
    switch (action) {
      case 'toggle3d': {
        this.audio.playClick();
        const on = this.camera.toggle3D();
        for (const id of ['btn-view-3d', 'btn-arena-view-3d']) {
          const b = document.getElementById(id);
          if (b) b.setAttribute('aria-pressed', String(on));
        }
        this.hud.showToast(on ? '🧊 3D view: drag to orbit, scroll to zoom' : '🗺 Flat 2D top-down view', 'info');
        break;
      }
      case 'resetView':
        this.audio.playClick();
        this.camera.reset();
        break;
      case 'mute':
        this.audio.toggleMute();
        this._updateMuteButtonUI();
        break;
      case 'endTurn':
        this.triggerEndTurn();
        break;
      case 'undo':
        this.triggerUndo();
        break;
      case 'hint':
        this.triggerHint();
        break;
      case 'forecast':
        this.toggleOverlay('forecast');
        break;
      case 'safeZones':
        this.toggleOverlay('safeZones');
        break;
      case 'critical':
        this.toggleOverlay('critical');
        break;
      case 'toolBeacon':
        this.setTool('beacon');
        break;
      case 'toolSever':
        this.setTool('sever');
        break;
      case 'restart':
        this.restartCurrentLevel();
        break;
      case 'menu':
        this.audio.playClick();
        this._clearEndTransition();
        this.screens.showScreen('levels');
        break;
      case 'escape':
        if (this.screens.activeScreen === 'howto' || this.screens.activeScreen === 'arena') {
          this.audio.playClick();
          this.toggleArenaPlay(false);
          this.screens.showScreen('title');
        } else if (this.screens.activeScreen === 'levels' || this.screens.activeScreen === 'result') {
          this.audio.playClick();
          this.screens.showScreen('title');
        }
        break;
      default:
        break;
    }
  }

  // ==================== STRATEGY ARENA CONTROLLER ====================

  /**
   * Precomputes all strategies on `level` and prepares the animated Arena state.
   * @param {object} level
   */
  loadArenaLevel(level) {
    this.toggleArenaPlay(false);
    this.arenaLevel = level;
    this.arenaRuns.clear();

    // Benchmark each strategy in STRATEGIES
    for (let i = 0; i < STRATEGIES.length; i++) {
      const strat = STRATEGIES[i];
      const t0 = performance.now();
      const res = playOut(level, strat.fn);
      const elapsedMs = Math.max(0.05, performance.now() - t0);
      this.arenaRuns.set(strat.id, {
        id: strat.id,
        label: strat.label,
        outcome: res.outcome,
        turns: res.turns,
        elapsedMs
      });
    }

    // Include Brute-Force Optimal when level.n <= 20
    if (level.n <= 20) {
      const opt = bruteForceOptimal(level, { maxNodes: 20, timeLimitMs: 220 });
      if (opt && opt.outcome) {
        this.arenaRuns.set('bruteForce', {
          id: 'bruteForce',
          label: `Brute-Force Optimal ${opt.truncated ? '(Bounded)' : '(Exact)'}`,
          outcome: opt.outcome,
          turns: opt.turns,
          elapsedMs: opt.elapsedMs || 1
        });
      }
    }

    if (!this.arenaRuns.has(this.arenaStrategyId)) {
      this.arenaStrategyId = 'articulationGreedy';
    }

    const stratSel = document.getElementById('arena-strategy-select');
    if (stratSel instanceof HTMLSelectElement) {
      stratSel.value = this.arenaStrategyId;
    }

    this.resetArenaPlayback();
  }

  selectArenaStrategy(stratId) {
    this.toggleArenaPlay(false);
    if (this.arenaRuns.has(stratId)) {
      this.arenaStrategyId = stratId;
    }
    this.resetArenaPlayback();
  }

  resetArenaPlayback() {
    this.toggleArenaPlay(false);
    if (!this.arenaLevel) return;

    this.state = createGameState(this.arenaLevel);
    this.baseLayout = computeLayout(this.arenaLevel, this.renderer.width, this.renderer.height);
    this.effects.clearTransient();
    this.hintNodes = [];
    this.arenaTurnIdx = 0;
    this.arenaSubPhase = 'warden';
    this._recomputeAnalysis();

    const activeRun = this.arenaRuns.get(this.arenaStrategyId);
    const stratLabel = activeRun ? activeRun.label : this.arenaStrategyId;

    this.screens.renderArenaTable(this.arenaLevel, this.arenaRuns, this.arenaStrategyId);
    this.screens.updateArenaStatus(
      `Turn 1 · Ready (${stratLabel})`,
      'Press Play or Step Turn to watch the strategy execute turn by turn.',
      false
    );
  }

  toggleArenaPlay(forceState) {
    const nextState = typeof forceState === 'boolean' ? forceState : !this.arenaPlaying;
    this.arenaPlaying = nextState;

    if (this._arenaTimer !== null) {
      clearTimeout(this._arenaTimer);
      this._arenaTimer = null;
    }

    if (this.arenaPlaying) {
      // If already at game over, reset first before playing
      if (this.state && this.state.over) {
        this.resetArenaPlayback();
        this.arenaPlaying = true;
      }
      this.stepArena(false);
      this._scheduleNextArenaStep();
    } else if (this.arenaLevel) {
      const activeRun = this.arenaRuns.get(this.arenaStrategyId);
      const out = evaluateOutcome(this.state);
      this.screens.updateArenaStatus(
        this.state.over
          ? `Simulation Complete · Saved ${out.savedPercent}% (${out.won ? 'WIN' : 'LOSE'})`
          : `Turn ${this.state.turn} · Paused (${activeRun ? activeRun.label : ''})`,
        this.state.over
          ? 'Simulation finished. Press Reset or choose another strategy.'
          : 'Playback paused.',
        false
      );
    }
  }

  _scheduleNextArenaStep() {
    if (!this.arenaPlaying) return;
    if (this._arenaTimer !== null) {
      clearTimeout(this._arenaTimer);
    }
    this._arenaTimer = window.setTimeout(() => {
      if (!this.arenaPlaying) return;
      this.stepArena(false);
      if (this.arenaPlaying && this.state && !this.state.over) {
        this._scheduleNextArenaStep();
      }
    }, this.arenaDelayMs);
  }

  /**
   * Advances the Strategy Arena replay by one sub-step (Warden action phase -> Frost spread phase).
   * @param {boolean} manual
   */
  stepArena(manual = false) {
    if (!this.arenaLevel || !this.state) return;
    const activeRun = this.arenaRuns.get(this.arenaStrategyId);
    if (!activeRun) return;

    if (this.state.over || this.arenaTurnIdx >= activeRun.turns.length) {
      this.arenaPlaying = false;
      const out = evaluateOutcome(this.state);
      this.screens.updateArenaStatus(
        `Finished in ${activeRun.turns.length} turns · Saved ${out.savedPopulation}/${out.totalPopulation} (${out.savedPercent}%)`,
        `Final outcome: ${out.won ? 'VICTORY' : 'DEFEAT'} (${out.citadelSafe ? 'Citadel Safe' : 'Citadel Frosted'})`,
        false
      );
      return;
    }

    const turnData = activeRun.turns[this.arenaTurnIdx];

    if (this.arenaSubPhase === 'warden') {
      const appliedLabels = [];
      this.hintNodes = [];

      for (let i = 0; i < turnData.actions.length; i++) {
        const act = turnData.actions[i];
        const res = applyAction(this.state, act);
        if (res.ok) {
          if (act.type === 'beacon') {
            this.effects.spawnBeaconPulse(act.node);
            this.hintNodes.push(act.node);
            appliedLabels.push(`Beacon #${act.node}`);
          } else if (act.type === 'sever') {
            this.effects.spawnSeveredRoad(act.u, act.v);
            appliedLabels.push(`Sever #${act.u}↔#${act.v}`);
          }
        }
      }

      if (appliedLabels.length > 0 && !manual) {
        this.audio.playBeacon();
      }

      this._recomputeAnalysis();
      const out = evaluateOutcome(this.state);
      this.arenaSubPhase = 'frost';

      this.screens.updateArenaStatus(
        `Turn ${this.state.turn} [Warden Phase] · Saved ${out.savedPercent}%`,
        appliedLabels.length > 0
          ? `${activeRun.label} → ${appliedLabels.join(', ')}`
          : `${activeRun.label} → No actions taken`,
        this.arenaPlaying
      );
    } else {
      const prevNodeState = this.state.nodeState.slice();
      const { newlyFrosted } = endWardenPhase(this.state);

      if (newlyFrosted.length > 0) {
        this.effects.spawnFrostSpread(
          newlyFrosted,
          this.state.graph,
          prevNodeState,
          NodeState.FROSTED
        );
        if (!manual) {
          this.audio.playFrost();
        }
      }

      this.hintNodes = [];
      this.arenaTurnIdx += 1;
      this.arenaSubPhase = 'warden';
      this._recomputeAnalysis();

      const out = evaluateOutcome(this.state);
      if (this.state.over || this.arenaTurnIdx >= activeRun.turns.length) {
        this.arenaPlaying = false;
        this.screens.updateArenaStatus(
          `Finished (${activeRun.turns.length} turns) · Saved ${out.savedPopulation}/${out.totalPopulation} (${out.savedPercent}%)`,
          `Frost contained! Outcome: ${out.won ? 'WIN' : 'LOSE'}`,
          false
        );
      } else {
        this.screens.updateArenaStatus(
          `Turn ${this.state.turn - 1} [Frost Phase] · Saved ${out.savedPercent}%`,
          newlyFrosted.length > 0
            ? `Frost advanced to ${newlyFrosted.length} settlement(s): ${newlyFrosted.map((id) => '#' + id).join(', ')}`
            : 'Frost blocked on all fronts!',
          this.arenaPlaying
        );
      }
    }
  }

  // ==================== INTERNAL HELPERS & RENDER LOOP ====================

  _recomputeAnalysis() {
    if (!this.state) return;
    this.analysis.forecast = frostForecast(this.state);
    this.analysis.safeZones = safeZones(this.state);
    this.analysis.critical = articulationPointsAndBridges(
      this.state.graph,
      blockedMask(this.state)
    );
  }

  _syncHud() {
    this.hud.update({
      state: this.state,
      levelLabel: this.currentLevelLabel,
      activeTool: this.activeTool,
      overlays: this.overlays,
      hintsLeft: this.hintsLeft
    });
    if (this.input && (this.input.hoverNodeId !== -1 || this.input.hoverEdge)) {
      if (
        this.input.hoverEdge &&
        this.state &&
        !this.state.graph.hasEdge(this.input.hoverEdge[0], this.input.hoverEdge[1])
      ) {
        this.input.hoverEdge = null;
      }
      this.hud.updateTooltip({
        state: this.state,
        analysis: this.analysis,
        nodeId: this.input.hoverNodeId,
        edge: this.input.hoverEdge,
        clientX: this._lastPointerX || 0,
        clientY: this._lastPointerY || 0
      });
    }
  }

  _clearEndTransition() {
    if (this._endTransitionTimer !== null) {
      clearTimeout(this._endTransitionTimer);
      this._endTransitionTimer = null;
    }
  }

  _loop(timestamp) {
    const dt = Math.max(0, (timestamp - this._lastFrameTime) / 1000);
    this._lastFrameTime = timestamp;

    this._fpsFrames += 1;
    this._fpsAccum += dt;
    if (this._fpsAccum >= 0.5) {
      this.hud.updateFps(Math.min(60, this._fpsFrames / this._fpsAccum));
      this._fpsFrames = 0;
      this._fpsAccum = 0;
    }

    this.effects.update(dt);

    // Orbit camera: slowly auto-rotate behind menu screens, then project the map
    const scr = this.screens.activeScreen;
    this.camera.autoRotate = scr === 'title' || scr === 'levels' || scr === 'howto';
    this.camera.update(dt, this.effects.reducedMotion);
    this.layout = this.camera.projectLayout(this.baseLayout);
    this.effects.cameraYaw = this.camera.yaw;

    const activeOverlays =
      this.screens.activeScreen === 'arena'
        ? { forecast: true, safeZones: false, critical: false }
        : this.overlays;

    this.renderer.render({
      state: this.state,
      layout: this.layout,
      overlays: activeOverlays,
      analysis: this.analysis,
      hintNodes: this.hintNodes,
      hoverNodeId: this.input.hoverNodeId,
      hoverEdge: this.input.hoverEdge,
      activeTool: this.activeTool
    });

    requestAnimationFrame((ts) => this._loop(ts));
  }
}

// Bootstrap when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => new FrostveilApp());
} else {
  new FrostveilApp();
}
