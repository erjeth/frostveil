/**
 * @file audio.js
 * Procedural Web Audio API synthesizer for Frostveil (Member B).
 *
 * Zero external audio files. Generates crisp arctic chimes, fire crackle tones,
 * road-sever snaps, frost shimmer chords, and victory/defeat cues.
 */

export class AudioManager {
  /**
   * @param {import('./storage.js').StorageManager} storage
   */
  constructor(storage) {
    this.storage = storage;
    this.muted = storage ? storage.isMuted() : false;
    /** @type {AudioContext | null} */
    this.ctx = null;
  }

  _ensureContext() {
    if (this.muted) return null;
    try {
      if (!this.ctx) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (AudioCtx) {
          this.ctx = new AudioCtx();
        }
      }
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
      return this.ctx;
    } catch {
      return null;
    }
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.storage) {
      this.storage.setMuted(this.muted);
    }
    if (!this.muted) {
      this.playClick();
    }
    return this.muted;
  }

  _tone(freq, duration, type = 'sine', gainPeak = 0.08, delay = 0, freqEnd = null) {
    const ctx = this._ensureContext();
    if (!ctx) return;

    try {
      const now = ctx.currentTime + delay;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = type;
      osc.frequency.setValueAtTime(freq, now);
      if (freqEnd !== null) {
        osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), now + duration);
      }

      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(gainPeak, now + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + duration + 0.02);
    } catch {
      // Ignore Web Audio errors on restricted devices
    }
  }

  playClick() {
    this._tone(520, 0.06, 'triangle', 0.05, 0, 620);
  }

  playBeacon() {
    // Warm rising amber chord
    this._tone(440, 0.18, 'triangle', 0.08, 0, 587.33);
    this._tone(659.25, 0.24, 'sine', 0.07, 0.05, 880);
  }

  playSever() {
    // Crisp descending snap
    this._tone(340, 0.13, 'sawtooth', 0.065, 0, 115);
  }

  playUndo() {
    this._tone(480, 0.11, 'sine', 0.06, 0, 360);
  }

  playFrost() {
    // Crystalline icy shimmer
    this._tone(784, 0.22, 'sine', 0.055, 0, 740);
    this._tone(1046.5, 0.28, 'triangle', 0.04, 0.04, 987.77);
  }

  playHint() {
    this._tone(587.33, 0.16, 'sine', 0.07, 0);
    this._tone(880, 0.26, 'sine', 0.07, 0.07);
  }

  playInvalid() {
    this._tone(155, 0.16, 'sawtooth', 0.07, 0, 120);
  }

  playWin() {
    this._tone(523.25, 0.18, 'triangle', 0.08, 0);
    this._tone(659.25, 0.18, 'triangle', 0.08, 0.11);
    this._tone(783.99, 0.22, 'triangle', 0.08, 0.22);
    this._tone(1046.5, 0.42, 'sine', 0.09, 0.34);
  }

  playLose() {
    this._tone(392.0, 0.22, 'sawtooth', 0.06, 0);
    this._tone(349.23, 0.24, 'sawtooth', 0.06, 0.16);
    this._tone(261.63, 0.45, 'triangle', 0.08, 0.32);
  }
}
