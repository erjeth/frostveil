/**
 * @file screens.js
 * Screen router and UI controller for Title, Level Select, Free Play,
 * Result, How to Play, and Strategy Arena screens (Member B).
 */

import {
  LEVEL_SPECS,
  STRATEGIES,
  buildLevel,
  generateLevel,
  playOut,
  bruteForceOptimal
} from './core.js';

export class ScreenManager {
  /**
   * @param {object} deps
   * @param {import('./storage.js').StorageManager} deps.storage
   * @param {import('./audio.js').AudioManager} deps.audio
   * @param {import('./renderer.js').Renderer} deps.renderer
   * @param {import('./hud.js').HudManager} deps.hud
   * @param {(level: object, label: string) => void} deps.onStartLevel
   * @param {(level: object) => void} deps.onArenaLevelLoaded
   * @param {() => void} deps.onArenaStep
   * @param {() => void} deps.onArenaReset
   * @param {(playing: boolean) => void} deps.onArenaTogglePlay
   * @param {(strategyId: string) => void} deps.onArenaStrategyChange
   * @param {(delayMs: number) => void} deps.onArenaSpeedChange
   */
  constructor(deps) {
    this.storage = deps.storage;
    this.audio = deps.audio;
    this.renderer = deps.renderer;
    this.hud = deps.hud;
    this.cb = deps;

    this.activeScreen = 'title';
    this._previousScreen = 'title';

    this.screens = {
      title: document.getElementById('screen-title'),
      levels: document.getElementById('screen-levels'),
      game: document.getElementById('screen-game'),
      result: document.getElementById('screen-result'),
      howto: document.getElementById('screen-howto'),
      arena: document.getElementById('screen-arena')
    };

    this._customFreePlayLevel = null;
    this._activeLevelId = 1;
    this._bindDomEvents();
    this._attachTilt(document.querySelector('.title-card'), 7);
    this._attachTilt(document.querySelector('.freeplay-card'), 5);
    this.renderExpeditionSidebar(1);
  }

  /**
   * Interactive 3D card tilt: the element rotates toward the pointer with a moving glare.
   * Disabled when the user prefers reduced motion.
   */
  _attachTilt(el, maxDeg) {
    if (!el) return;
    el.classList.add('tilt');
    const reduced =
      typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) return;
    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width - 0.5;
      const py = (e.clientY - r.top) / r.height - 0.5;
      el.style.transform = `perspective(900px) rotateX(${(-py * maxDeg).toFixed(2)}deg) rotateY(${(px * maxDeg).toFixed(2)}deg) translateY(-3px)`;
      el.style.setProperty('--gx', `${((px + 0.5) * 100).toFixed(1)}%`);
      el.style.setProperty('--gy', `${((py + 0.5) * 100).toFixed(1)}%`);
    });
    el.addEventListener('pointerleave', () => {
      el.style.transform = '';
    });
  }

  _buildNamedLevel(id) {
    const numId = Number(id) || 1;
    const spec = LEVEL_SPECS.find((s) => s.id === numId) || LEVEL_SPECS[0];
    const level = buildLevel(spec.id);
    level.id = spec.id;
    level.name = spec.name;
    return level;
  }

  /**
   * Switches the active visible screen.
   * @param {'title' | 'levels' | 'game' | 'result' | 'howto' | 'arena'} name
   */
  showScreen(name) {
    if (!this.screens[name]) return;
    if (name !== 'howto') {
      this._previousScreen = this.activeScreen;
    }
    this.activeScreen = name;

    for (const [key, el] of Object.entries(this.screens)) {
      if (!el) continue;
      if (key === name) {
        el.hidden = false;
        el.classList.add('active');
      } else {
        el.hidden = true;
        el.classList.remove('active');
      }
    }

    this.hud.hideTooltip();
    this.hud.hideToast();

    if (name === 'levels') {
      this.renderLevelSelect();
    } else if (name === 'game') {
      this.renderExpeditionSidebar(this._activeLevelId);
    } else if (name === 'howto') {
      this.renderer.drawHowToIllustrations();
    }
  }

  _bindDomEvents() {
    // 1. Title screen buttons
    this._onClick('btn-title-play', () => {
      this.audio.playClick();
      this.showScreen('levels');
    });

    this._onClick('btn-title-arena', () => {
      this.audio.playClick();
      this.openStrategyArena(1);
    });

    this._onClick('btn-title-howto', () => {
      this.audio.playClick();
      this.showScreen('howto');
    });

    // 2. Level Select & Free Play controls
    this._onClick('btn-levels-back', () => {
      this.audio.playClick();
      this.showScreen('title');
    });

    const chkUnlock = document.getElementById('chk-unlock-all');
    if (chkUnlock instanceof HTMLInputElement) {
      chkUnlock.checked = this.storage.getUnlockAllDemo();
      chkUnlock.addEventListener('change', () => {
        this.audio.playClick();
        this.storage.setUnlockAllDemo(chkUnlock.checked);
        this.renderLevelSelect();
      });
    }

    this._bindRangePreview('fp-nodes', 'fp-nodes-val', (v) => v);
    this._bindRangePreview('fp-actions', 'fp-actions-val', (v) => v);
    this._bindRangePreview('fp-sources', 'fp-sources-val', (v) => v);
    this._bindRangePreview('fp-target', 'fp-target-val', (v) => `${v}%`);

    this._onClick('btn-fp-random-seed', () => {
      this.audio.playClick();
      const seedInput = document.getElementById('fp-seed');
      if (seedInput instanceof HTMLInputElement) {
        seedInput.value = String(1000 + Math.floor(Math.random() * 998999));
      }
    });

    this._onClick('btn-fp-launch', () => {
      this.audio.playClick();
      const n = Number(this._getInputValue('fp-nodes', 24));
      const k = Number(this._getInputValue('fp-actions', 2));
      const sources = Number(this._getInputValue('fp-sources', 1));
      const targetPercent = Number(this._getInputValue('fp-target', 60));
      const seed = Math.max(1, Number(this._getInputValue('fp-seed', 2026)) || 2026);

      const level = generateLevel({
        n,
        k,
        sources,
        targetPercent,
        seed,
        avgDegree: 3.2
      });
      level.id = 0;
      level.name = `Free Play (${n} nodes)`;
      this._customFreePlayLevel = level;

      this.cb.onStartLevel(level, `Free Play · ${n} Settlements`);
    });

    // 3. How to Play back button
    this._onClick('btn-howto-close', () => {
      this.audio.playClick();
      this.showScreen(this._previousScreen || 'title');
    });

    // 4. Strategy Arena controls
    const arenaLevelSel = document.getElementById('arena-level-select');
    if (arenaLevelSel instanceof HTMLSelectElement) {
      arenaLevelSel.addEventListener('change', () => {
        this.audio.playClick();
        const val = Number(arenaLevelSel.value);
        const level = val === 0 && this._customFreePlayLevel
          ? this._customFreePlayLevel
          : this._buildNamedLevel(val || 1);
        this._populateArenaStrategies(level);
        this.cb.onArenaLevelLoaded(level);
      });
    }

    const arenaStratSel = document.getElementById('arena-strategy-select');
    if (arenaStratSel instanceof HTMLSelectElement) {
      arenaStratSel.addEventListener('change', () => {
        this.audio.playClick();
        this.cb.onArenaStrategyChange(arenaStratSel.value);
      });
    }

    this._onClick('btn-arena-play', () => {
      this.audio.playClick();
      this.cb.onArenaTogglePlay();
    });

    this._onClick('btn-arena-step', () => {
      this.audio.playClick();
      this.cb.onArenaStep();
    });

    this._onClick('btn-arena-reset', () => {
      this.audio.playClick();
      this.cb.onArenaReset();
    });

    const speedInput = document.getElementById('arena-speed');
    const speedLabel = document.getElementById('arena-speed-label');
    if (speedInput instanceof HTMLInputElement) {
      speedInput.addEventListener('input', () => {
        const raw = Number(speedInput.value) || 600;
        // Invert slider so moving right = faster playback (lower delay)
        const delayMs = 1650 - raw;
        const speedMult = (600 / delayMs).toFixed(1);
        if (speedLabel) {
          speedLabel.textContent = `${speedMult}x`;
        }
        this.cb.onArenaSpeedChange(delayMs);
      });
    }

    this._onClick('btn-arena-play-self', () => {
      this.audio.playClick();
      const val = arenaLevelSel instanceof HTMLSelectElement ? Number(arenaLevelSel.value) : 1;
      const level = val === 0 && this._customFreePlayLevel
        ? this._customFreePlayLevel
        : buildLevel(val || 1);
      const label = level.id ? `Level ${level.id}: ${level.name}` : level.name;
      this.cb.onStartLevel(level, label);
    });

    this._onClick('btn-arena-back', () => {
      this.audio.playClick();
      this.cb.onArenaTogglePlay(false);
      this.showScreen('levels');
    });
  }

  /**
   * Renders the 8 campaign level cards in the Level Select grid.
   */
  renderLevelSelect() {
    const grid = document.getElementById('level-cards-grid');
    if (!grid) return;

    const chkUnlock = document.getElementById('chk-unlock-all');
    if (chkUnlock instanceof HTMLInputElement) {
      chkUnlock.checked = this.storage.getUnlockAllDemo();
    }

    grid.innerHTML = '';

    for (let i = 0; i < LEVEL_SPECS.length; i++) {
      const spec = LEVEL_SPECS[i];
      const unlocked = this.storage.isLevelUnlocked(spec.id);
      const rec = this.storage.getLevelRecord(spec.id);

      const card = document.createElement('button');
      card.type = 'button';
      card.className = `level-card${unlocked ? '' : ' locked'}`;
      card.setAttribute('role', 'listitem');
      card.disabled = !unlocked;

      const starsHtml = this._formatStarsHtml(rec.stars);
      const lockBadge = unlocked ? starsHtml : '<span title="Win previous level to unlock">🔒 Locked</span>';
      const bestLine = rec.bestPercent > 0
        ? `Best Saved: ${rec.bestPercent}% (${rec.bestSaved} pop)`
        : unlocked
        ? 'Not yet completed'
        : 'Win Level ' + (spec.id - 1) + ' to unlock';

      card.innerHTML = `
        <div>
          <div class="level-card-top">
            <span class="level-num">Realm ${spec.id}</span>
            <span class="level-stars">${lockBadge}</span>
          </div>
          <div class="level-name">${spec.name}</div>
          <div class="level-meta">
            <span>Nodes <strong>${spec.n}</strong></span>
            <span>Actions <strong>${spec.k}/t</strong></span>
            <span>Origins <strong>${spec.sources}</strong></span>
            <span>Goal <strong>${spec.targetPercent}%</strong></span>
          </div>
        </div>
        <div class="level-best">${bestLine}</div>
      `;

      if (unlocked) {
        card.addEventListener('click', () => {
          this.audio.playClick();
          this._activeLevelId = spec.id;
          const level = this._buildNamedLevel(spec.id);
          this.cb.onStartLevel(level, `Level ${spec.id}: ${spec.name}`);
        });
      }

      grid.appendChild(card);
      if (unlocked) {
        this._attachTilt(card, 10);
      }
    }
    this.renderExpeditionSidebar(this._activeLevelId);
  }

  /**
   * Renders the left-side Expedition Command sidebar with snow-capped wooden Realm cards
   * on the Game screen (matching Reference Image 1).
   * @param {number} [activeId]
   */
  renderExpeditionSidebar(activeId = this._activeLevelId) {
    this._activeLevelId = activeId;
    const list = document.getElementById('sidebar-realm-list');
    if (!list) return;

    list.innerHTML = '';
    for (let i = 0; i < LEVEL_SPECS.length; i++) {
      const spec = LEVEL_SPECS[i];
      const unlocked = this.storage.isLevelUnlocked(spec.id);
      const rec = this.storage.getLevelRecord(spec.id);
      const isCurrent = spec.id === activeId;

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `wood-realm-card${isCurrent ? ' active-realm' : ''}${unlocked ? '' : ' locked'}`;
      btn.setAttribute('role', 'listitem');
      btn.disabled = !unlocked;

      const starsHtml = unlocked
        ? this._formatStarsHtml(rec.stars > 0 ? rec.stars : 3)
        : '<span class="star-empty">🔒</span>';

      btn.innerHTML = `
        <div class="wood-snow-cap" aria-hidden="true"></div>
        <span class="wood-rope wood-rope-left" aria-hidden="true"></span>
        <span class="wood-rope wood-rope-right" aria-hidden="true"></span>
        <div class="wood-card-top">
          <span class="wood-realm-num">REALM ${spec.id}</span>
          <span class="wood-realm-stars">${starsHtml}</span>
        </div>
        <div class="wood-realm-name">${spec.name}</div>
        <div class="wood-realm-sub">n=${spec.n} · k=${spec.k} · Goal ${spec.targetPercent}%</div>
      `;

      if (unlocked) {
        btn.addEventListener('click', () => {
          this.audio.playClick();
          this._activeLevelId = spec.id;
          const level = this._buildNamedLevel(spec.id);
          this.cb.onStartLevel(level, `Level ${spec.id}: ${spec.name}`);
        });
      }

      list.appendChild(btn);
    }
  }

  /**
   * Populates and displays the Result Screen after a game ends.
   *
   * @param {object} state Final game state (`state.over === true`)
   */
  showResultScreen(state) {
    const outcome = state.outcome;
    const level = state.level;
    if (!outcome) return;

    const banner = document.getElementById('result-banner');
    const starsEl = document.getElementById('result-stars');
    const titleEl = document.getElementById('result-heading');
    const subEl = document.getElementById('result-subtitle');

    if (banner) {
      banner.className = `result-banner ${outcome.won ? 'won' : 'lost'}`;
    }
    if (starsEl) {
      starsEl.textContent = '★'.repeat(outcome.stars) + '☆'.repeat(Math.max(0, 3 - outcome.stars));
    }
    if (titleEl) {
      titleEl.textContent = outcome.won ? 'Frost Contained!' : 'The Realm Has Fallen';
    }
    if (subEl) {
      if (outcome.won) {
        subEl.textContent = `You saved ${outcome.savedPercent}% of the realm and protected the Citadel!`;
      } else if (!outcome.citadelSafe) {
        subEl.textContent = 'The Citadel was overtaken by frost. Protect the Citadel at all costs!';
      } else {
        subEl.textContent = `Saved ${outcome.savedPercent}% population, below the required ${level.targetPercent}% target.`;
      }
    }

    this._setText('res-saved-pop', `${outcome.savedPopulation} / ${outcome.totalPopulation} (${outcome.savedPercent}%)`);
    this._setText('res-target-pop', `${level.targetPercent}%`);
    this._setText('res-citadel', outcome.citadelSafe ? '♛ Safe' : '❄ Frosted');
    this._setText('res-turns', String(state.log.length));

    // Populate Strategy Comparison Table on this exact level
    const tbody = document.getElementById('result-comparison-tbody');
    if (tbody) {
      tbody.innerHTML = '';

      // 1. Player's own run
      const playerRow = document.createElement('tr');
      playerRow.className = 'row-player';
      playerRow.innerHTML = `
        <td>👤 Your Playthrough (Warden)</td>
        <td>${outcome.savedPopulation} / ${outcome.totalPopulation}</td>
        <td>${outcome.savedPercent}%</td>
        <td>${outcome.citadelSafe ? '♛ Safe' : '❄ Lost'}</td>
        <td><strong style="color:${outcome.won ? '#34d399' : '#ff5b6e'}">${outcome.won ? 'WIN' : 'LOSE'} (${'★'.repeat(outcome.stars) || '0★'})</strong></td>
        <td>${state.log.length}</td>
      `;
      tbody.appendChild(playerRow);

      // 2. Built-in STRATEGIES
      for (let i = 0; i < STRATEGIES.length; i++) {
        const strat = STRATEGIES[i];
        const sim = playOut(level, strat.fn);
        const out = sim.outcome;
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>🤖 ${strat.label}</td>
          <td>${out.savedPopulation} / ${out.totalPopulation}</td>
          <td>${out.savedPercent}%</td>
          <td>${out.citadelSafe ? '♛ Safe' : '❄ Lost'}</td>
          <td><span style="color:${out.won ? '#34d399' : '#ff5b6e'}">${out.won ? 'WIN' : 'LOSE'}</span></td>
          <td>${sim.turns.length}</td>
        `;
        tbody.appendChild(tr);
      }

      // 3. Brute-Force Optimal when n <= 20
      if (level.n <= 20) {
        const opt = bruteForceOptimal(level, { maxNodes: 20, timeLimitMs: 180 });
        if (opt && opt.outcome) {
          const out = opt.outcome;
          const tr = document.createElement('tr');
          tr.innerHTML = `
            <td>🏆 Brute-Force Optimal ${opt.truncated ? '(Bounded)' : '(Exact)'}</td>
            <td>${out.savedPopulation} / ${out.totalPopulation}</td>
            <td>${out.savedPercent}%</td>
            <td>${out.citadelSafe ? '♛ Safe' : '❄ Lost'}</td>
            <td><span style="color:${out.won ? '#34d399' : '#ff5b6e'}">${out.won ? 'WIN' : 'LOSE'}</span></td>
            <td>${opt.turns.length}</td>
          `;
          tbody.appendChild(tr);
        }
      }
    }

    // Wire Result Action Buttons
    const btnRetry = document.getElementById('btn-result-retry');
    if (btnRetry) {
      btnRetry.onclick = () => {
        this.audio.playClick();
        const label = level.id ? `Level ${level.id}: ${level.name}` : level.name || 'Free Play';
        this.cb.onStartLevel(level, label);
      };
    }

    const btnNext = document.getElementById('btn-result-next');
    if (btnNext instanceof HTMLButtonElement) {
      const hasNext = Boolean(level.id && level.id >= 1 && level.id < 8);
      btnNext.hidden = !hasNext;
      btnNext.disabled = !hasNext || !this.storage.isLevelUnlocked(level.id + 1);
      btnNext.onclick = () => {
        this.audio.playClick();
        if (hasNext) {
          const nextLvl = this._buildNamedLevel(level.id + 1);
          this.cb.onStartLevel(nextLvl, `Level ${nextLvl.id}: ${nextLvl.name}`);
        }
      };
    }

    const btnArena = document.getElementById('btn-result-arena');
    if (btnArena) {
      btnArena.onclick = () => {
        this.audio.playClick();
        if (level.id && level.id >= 1) {
          this.openStrategyArena(level.id);
        } else {
          this._customFreePlayLevel = level;
          this.openStrategyArena(0);
        }
      };
    }

    const btnMenu = document.getElementById('btn-result-menu');
    if (btnMenu) {
      btnMenu.onclick = () => {
        this.audio.playClick();
        this.showScreen('levels');
      };
    }

    this.showScreen('result');
  }

  /**
   * Opens the Strategy Arena screen on the specified level ID (1..8, or 0 for custom Free Play).
   * @param {number} [levelId=1]
   */
  openStrategyArena(levelId = 1) {
    const arenaLevelSel = document.getElementById('arena-level-select');
    if (arenaLevelSel instanceof HTMLSelectElement) {
      arenaLevelSel.innerHTML = '';
      for (let i = 0; i < LEVEL_SPECS.length; i++) {
        const spec = LEVEL_SPECS[i];
        const opt = document.createElement('option');
        opt.value = String(spec.id);
        opt.textContent = `Level ${spec.id}: ${spec.name} (n=${spec.n}, k=${spec.k})`;
        arenaLevelSel.appendChild(opt);
      }
      if (this._customFreePlayLevel) {
        const opt = document.createElement('option');
        opt.value = '0';
        opt.textContent = `Custom Free Play (n=${this._customFreePlayLevel.n}, seed=${this._customFreePlayLevel.seed})`;
        arenaLevelSel.appendChild(opt);
      }
      arenaLevelSel.value = String(levelId);
    }

    const level = levelId === 0 && this._customFreePlayLevel
      ? this._customFreePlayLevel
      : this._buildNamedLevel(levelId || 1);

    this._populateArenaStrategies(level);
    this.showScreen('arena');
    this.cb.onArenaLevelLoaded(level);
  }

  _populateArenaStrategies(level) {
    const arenaStratSel = document.getElementById('arena-strategy-select');
    if (!(arenaStratSel instanceof HTMLSelectElement)) return;

    const prevVal = arenaStratSel.value;
    arenaStratSel.innerHTML = '';

    for (let i = 0; i < STRATEGIES.length; i++) {
      const strat = STRATEGIES[i];
      const opt = document.createElement('option');
      opt.value = strat.id;
      opt.textContent = strat.label;
      arenaStratSel.appendChild(opt);
    }

    if (level.n <= 20) {
      const opt = document.createElement('option');
      opt.value = 'bruteForce';
      opt.textContent = 'Brute-Force Optimal (n ≤ 20)';
      arenaStratSel.appendChild(opt);
    }

    const canKeep = Array.from(arenaStratSel.options).some((o) => o.value === prevVal);
    arenaStratSel.value = canKeep ? prevVal : 'articulationGreedy';
  }

  /**
   * Renders the Strategy Arena benchmark comparison table for the active level.
   *
   * @param {object} level
   * @param {Map<string, { label: string, outcome: any, turns: any[], elapsedMs: number }>} runsMap
   * @param {string} activeStrategyId
   */
  renderArenaTable(level, runsMap, activeStrategyId) {
    const tbody = document.getElementById('arena-comparison-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    // Player's best stored score if campaign level
    if (level.id && level.id >= 1) {
      const rec = this.storage.getLevelRecord(level.id);
      if (rec.bestPercent > 0) {
        const tr = document.createElement('tr');
        tr.className = 'row-player';
        tr.innerHTML = `
          <td>👤 Your Best Record</td>
          <td>${rec.bestSaved} / ${level.totalPopulation}</td>
          <td>${rec.bestPercent}%</td>
          <td>♛ Safe</td>
          <td><strong>${'★'.repeat(rec.stars) || 'Played'}</strong></td>
          <td>—</td>
          <td>—</td>
        `;
        tbody.appendChild(tr);
      }
    }

    for (const [stratId, run] of runsMap.entries()) {
      const out = run.outcome;
      const tr = document.createElement('tr');
      if (stratId === activeStrategyId) {
        tr.className = 'row-active-strategy';
      }
      tr.innerHTML = `
        <td>${stratId === activeStrategyId ? '▶ ' : ''}${run.label}</td>
        <td>${out.savedPopulation} / ${out.totalPopulation}</td>
        <td>${out.savedPercent}%</td>
        <td>${out.citadelSafe ? '♛ Safe' : '❄ Lost'}</td>
        <td><strong style="color:${out.won ? '#34d399' : '#ff5b6e'}">${out.won ? 'WIN' : 'LOSE'}</strong></td>
        <td>${run.turns.length}</td>
        <td>${run.elapsedMs.toFixed(2)} ms</td>
      `;
      tbody.appendChild(tr);
    }
  }

  updateArenaStatus(statusText, logText, isPlaying) {
    this._setText('arena-live-status', statusText);
    this._setText('arena-action-log', logText);
    const btnPlay = document.getElementById('btn-arena-play');
    if (btnPlay) {
      btnPlay.textContent = isPlaying ? '⏸ Pause' : '▶ Play';
    }
  }

  _formatStarsHtml(stars) {
    let html = '';
    for (let i = 1; i <= 3; i++) {
      if (i <= stars) {
        html += '<span>★</span>';
      } else {
        html += '<span class="star-empty">★</span>';
      }
    }
    return html;
  }

  _onClick(id, handler) {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('click', handler);
    }
  }

  _bindRangePreview(inputId, labelId, formatter) {
    const input = document.getElementById(inputId);
    const label = document.getElementById(labelId);
    if (input instanceof HTMLInputElement && label) {
      input.addEventListener('input', () => {
        label.textContent = String(formatter(input.value));
      });
    }
  }

  _getInputValue(id, fallback) {
    const el = document.getElementById(id);
    return el instanceof HTMLInputElement ? el.value : fallback;
  }

  _setText(id, text) {
    const el = document.getElementById(id);
    if (el) {
      el.textContent = text;
    }
  }
}
