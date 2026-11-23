/**
 * @file hud.js
 * Heads-Up Display (HUD), tooltip, toast notification, and ARIA live-region
 * manager for Frostveil (Member B).
 */

import { NodeState, evaluateOutcome } from './core.js';

export class HudManager {
  constructor() {
    this.elLevelTitle = document.getElementById('hud-level-title');
    this.elSeedBadge = document.getElementById('hud-seed-badge');
    this.elTurn = document.getElementById('hud-turn');
    this.elActions = document.getElementById('hud-actions');
    this.elCitadel = document.getElementById('hud-citadel');
    this.elPopText = document.getElementById('hud-pop-text');
    this.elTargetText = document.getElementById('hud-target-text');
    this.elProgressBar = document.getElementById('hud-progress-bar');
    this.elProgressFill = document.getElementById('hud-progress-fill');
    this.elTargetMarker = document.getElementById('hud-target-marker');
    this.elFps = document.getElementById('hud-fps');
    this.elHintsLeft = document.getElementById('hud-hints-left');

    this.btnToolAuto = document.getElementById('btn-tool-auto');
    this.btnToolBeacon = document.getElementById('btn-tool-beacon');
    this.btnToolSever = document.getElementById('btn-tool-sever');

    this.btnForecast = document.getElementById('btn-overlay-forecast');
    this.btnSafeZones = document.getElementById('btn-overlay-safezones');
    this.btnCritical = document.getElementById('btn-overlay-critical');
    this.btnHint = document.getElementById('btn-game-hint');
    this.btnUndo = document.getElementById('btn-game-undo');
    this.btnEndTurn = document.getElementById('btn-game-endturn');

    this.elToast = document.getElementById('hud-toast');
    this.elTooltip = document.getElementById('map-tooltip');
    this.elAriaStatus = document.getElementById('aria-status');

    this._toastTimer = null;
  }

  /**
   * Synchronizes all HUD elements with the current game state, tool, and overlays.
   *
   * @param {object} params
   * @param {object} params.state
   * @param {string} params.levelLabel
   * @param {string} params.activeTool
   * @param {{ forecast: boolean, safeZones: boolean, critical: boolean }} params.overlays
   * @param {number} params.hintsLeft
   */
  update({ state, levelLabel, activeTool, overlays, hintsLeft }) {
    if (!state) return;

    const outcome = evaluateOutcome(state);
    const level = state.level;

    if (this.elLevelTitle) {
      this.elLevelTitle.textContent = levelLabel || (level.name ? `Level ${level.id}: ${level.name}` : 'Free Play');
    }
    if (this.elSeedBadge) {
      this.elSeedBadge.textContent = `Seed #${level.seed} · n=${level.n}`;
    }
    if (this.elTurn) {
      this.elTurn.textContent = String(state.turn);
    }
    if (this.elActions) {
      this.elActions.textContent = `${state.actionsLeft} / ${level.k}`;
    }

    if (this.elCitadel) {
      if (outcome.citadelSafe) {
        this.elCitadel.textContent = '♛ Safe';
        this.elCitadel.className = 'stat-value status-safe';
      } else {
        this.elCitadel.textContent = '❄ FROSTED!';
        this.elCitadel.className = 'stat-value status-danger';
      }
    }

    if (this.elPopText) {
      this.elPopText.textContent = `Saved: ${outcome.savedPopulation} / ${outcome.totalPopulation} (${outcome.savedPercent}%)`;
    }
    if (this.elTargetText) {
      this.elTargetText.textContent = `Target: ${level.targetPercent}%`;
    }
    if (this.elProgressFill) {
      const pct = Math.max(0, Math.min(100, outcome.savedPercent));
      this.elProgressFill.style.width = `${pct}%`;
      this.elProgressFill.classList.toggle('below-target', pct < level.targetPercent);
    }
    if (this.elProgressBar) {
      this.elProgressBar.setAttribute('aria-valuenow', String(outcome.savedPercent));
    }
    if (this.elTargetMarker) {
      this.elTargetMarker.style.left = `${Math.max(0, Math.min(100, level.targetPercent))}%`;
    }

    // Tool buttons
    if (this.btnToolAuto) this.btnToolAuto.classList.toggle('active', activeTool === 'auto');
    if (this.btnToolBeacon) this.btnToolBeacon.classList.toggle('active', activeTool === 'beacon');
    if (this.btnToolSever) this.btnToolSever.classList.toggle('active', activeTool === 'sever');

    // Overlay toggle buttons
    if (this.btnForecast) {
      this.btnForecast.setAttribute('aria-pressed', String(Boolean(overlays.forecast)));
    }
    if (this.btnSafeZones) {
      this.btnSafeZones.setAttribute('aria-pressed', String(Boolean(overlays.safeZones)));
    }
    if (this.btnCritical) {
      this.btnCritical.setAttribute('aria-pressed', String(Boolean(overlays.critical)));
    }

    // Hint & Turn buttons
    if (this.elHintsLeft) {
      this.elHintsLeft.textContent = String(hintsLeft);
    }
    if (this.btnHint) {
      this.btnHint.disabled = state.over || hintsLeft <= 0 || state.actionsLeft <= 0;
    }
    if (this.btnUndo) {
      this.btnUndo.disabled = state.over || state.actions.length === 0;
    }
    if (this.btnEndTurn) {
      this.btnEndTurn.disabled = state.over;
    }
  }

  /**
   * Updates the FPS badge in the top HUD.
   * @param {number} fps
   */
  updateFps(fps) {
    if (this.elFps) {
      this.elFps.textContent = `${Math.round(fps)} FPS`;
    }
  }

  /**
   * Shows a brief visible toast notification (e.g. invalid action reason or hint feedback).
   * @param {string} message
   * @param {'error' | 'info'} [type='error']
   */
  showToast(message, type = 'error') {
    if (!this.elToast || !message) return;

    this.elToast.textContent = message;
    this.elToast.className = type === 'info' ? 'hud-toast toast-info' : 'hud-toast';
    this.elToast.hidden = false;

    if (this._toastTimer) {
      clearTimeout(this._toastTimer);
    }
    this._toastTimer = window.setTimeout(() => {
      if (this.elToast) {
        this.elToast.hidden = true;
      }
    }, 2400);
  }

  hideToast() {
    if (this.elToast) {
      this.elToast.hidden = true;
    }
  }

  /**
   * Updates or hides the floating inspection tooltip when hovering a node or road.
   */
  updateTooltip({ state, analysis, nodeId, edge, clientX, clientY }) {
    if (!this.elTooltip || !state) return;

    if (nodeId === -1 && !edge) {
      this.elTooltip.hidden = true;
      return;
    }

    if (nodeId !== -1) {
      const node = state.level.nodes[nodeId];
      const st = state.nodeState[nodeId];
      const deg = state.graph.degree(nodeId);
      const eta = analysis && analysis.forecast ? analysis.forecast[nodeId] : -1;
      const isCrit =
        analysis && analysis.critical && analysis.critical.points
          ? analysis.critical.points.has(nodeId)
          : false;

      const stateLabel =
        st === NodeState.FROSTED
          ? '❄️ Frosted'
          : st === NodeState.WARDED
          ? '🔥 Warded (Beacon)'
          : '🏠 Clear';

      let etaLabel = 'Never / Protected (✓)';
      if (st === NodeState.FROSTED) {
        etaLabel = 'Already Frosted (0t)';
      } else if (eta === 1) {
        etaLabel = '⚠️ Next Frost Phase (1 turn)';
      } else if (eta > 1) {
        etaLabel = `In ${eta} turns`;
      }

      const title = node.isCitadel
        ? `♛ The Citadel (#${node.id})`
        : `Settlement #${node.id}`;

      this.elTooltip.innerHTML = `
        <div class="tooltip-title">
          <span>${title}</span>
          <span>${stateLabel}</span>
        </div>
        <div class="tooltip-row"><span>Population:</span><strong>${node.population}</strong></div>
        <div class="tooltip-row"><span>Active Roads (Degree):</span><strong>${deg}</strong></div>
        <div class="tooltip-row"><span>Frost Arrival (BFS):</span><strong>${etaLabel}</strong></div>
        ${isCrit ? '<div class="tooltip-row"><span>Tarjan Role:</span><strong style="color:#ff79c6">◆ Articulation Point</strong></div>' : ''}
      `;
    } else if (edge) {
      const [u, v] = edge;
      let isBridge = false;
      if (analysis && analysis.critical && analysis.critical.bridges) {
        for (let i = 0; i < analysis.critical.bridges.length; i++) {
          const [bu, bv] = analysis.critical.bridges[i];
          if ((bu === u && bv === v) || (bu === v && bv === u)) {
            isBridge = true;
            break;
          }
        }
      }

      this.elTooltip.innerHTML = `
        <div class="tooltip-title">
          <span>Road #${u} ↔ #${v}</span>
          <span>✂️ Active</span>
        </div>
        <div class="tooltip-row"><span>Action:</span><strong>Click to Sever Road</strong></div>
        ${isBridge ? '<div class="tooltip-row"><span>Tarjan Role:</span><strong style="color:#ff79c6">⚠️ Critical Bridge</strong></div>' : ''}
      `;
    }

    this.elTooltip.hidden = false;
    const pad = 16;
    const maxW = window.innerWidth - 230;
    const maxH = window.innerHeight - 130;
    const left = Math.max(12, Math.min(maxW, clientX + pad));
    const top = Math.max(12, Math.min(maxH, clientY + pad));
    this.elTooltip.style.left = `${left}px`;
    this.elTooltip.style.top = `${top}px`;
  }

  hideTooltip() {
    if (this.elTooltip) {
      this.elTooltip.hidden = true;
    }
  }

  /**
   * Announces game status updates to assistive technologies (`aria-live="polite"`).
   * @param {string} text
   */
  announce(text) {
    if (this.elAriaStatus && text) {
      this.elAriaStatus.textContent = text;
    }
  }
}
