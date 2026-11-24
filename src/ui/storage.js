/**
 * @file storage.js
 * Persistent storage manager for Frostveil (Member B).
 *
 * Wraps all `localStorage` access in `try/catch` blocks so the game runs
 * reliably even in private browsing or restricted iframe contexts.
 */

const STORAGE_KEY = 'frostveil_progress_v1';

const DEFAULT_DATA = {
  unlockedUpTo: 1,
  unlockAllDemo: false,
  muted: false,
  levels: {} // { [levelId]: { stars: number, bestPercent: number, bestSaved: number } }
};

export class StorageManager {
  constructor() {
    this.data = this._load();
  }

  _load() {
    try {
      if (typeof window === 'undefined' || !window.localStorage) {
        return structuredCloneFallback(DEFAULT_DATA);
      }
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return structuredCloneFallback(DEFAULT_DATA);
      }
      const parsed = JSON.parse(raw);
      return {
        unlockedUpTo: Number(parsed.unlockedUpTo) || 1,
        unlockAllDemo: Boolean(parsed.unlockAllDemo),
        muted: Boolean(parsed.muted),
        levels: parsed.levels && typeof parsed.levels === 'object' ? parsed.levels : {}
      };
    } catch {
      return structuredCloneFallback(DEFAULT_DATA);
    }
  }

  _save() {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
      }
    } catch {
      // Ignore storage quota or security errors
    }
  }

  isLevelUnlocked(levelId) {
    if (this.data.unlockAllDemo) return true;
    return levelId <= this.data.unlockedUpTo;
  }

  getUnlockAllDemo() {
    return Boolean(this.data.unlockAllDemo);
  }

  setUnlockAllDemo(enabled) {
    this.data.unlockAllDemo = Boolean(enabled);
    this._save();
  }

  getLevelRecord(levelId) {
    const rec = this.data.levels[String(levelId)];
    return rec || { stars: 0, bestPercent: 0, bestSaved: 0 };
  }

  /**
   * Records a completed campaign level outcome and unlocks levelId + 1 on victory.
   * @param {number} levelId
   * @param {{ won: boolean, stars: number, savedPercent: number, savedPopulation: number }} outcome
   */
  recordLevelOutcome(levelId, outcome) {
    if (!levelId || levelId < 1) return;
    const key = String(levelId);
    const prev = this.getLevelRecord(levelId);

    this.data.levels[key] = {
      stars: Math.max(prev.stars, outcome.stars || 0),
      bestPercent: Math.max(prev.bestPercent, outcome.savedPercent || 0),
      bestSaved: Math.max(prev.bestSaved, outcome.savedPopulation || 0)
    };

    if (outcome.won && levelId >= this.data.unlockedUpTo) {
      this.data.unlockedUpTo = Math.min(8, levelId + 1);
    }

    this._save();
  }

  isMuted() {
    return Boolean(this.data.muted);
  }

  setMuted(muted) {
    this.data.muted = Boolean(muted);
    this._save();
  }
}

function structuredCloneFallback(obj) {
  return JSON.parse(JSON.stringify(obj));
}
