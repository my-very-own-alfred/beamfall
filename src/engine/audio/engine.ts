// Beamfall — audio engine.
//
// Lazy AudioContext init bound to the first user gesture (browsers gate
// AudioContext.start() on a user input). Master gain at ~0.6 by default,
// mute toggle exposed for the 'M' keybind in main.ts.
//
// All SFX are synthesized at runtime — no asset loading. Each `playSfx` call
// builds a fresh node graph and lets it tear itself down when the source
// stops; under typical multi-event load this allocates a handful of nodes
// per call which the implementation in `sfx.ts` keeps short-lived.

import { buildSfx, type SfxName } from './sfx';

let ctx: AudioContext | null = null;
let masterGain: GainNode | null = null;
let muted = false;
let masterLevel = 0.6;

/**
 * Return the active AudioContext, or null if no user gesture has occurred yet
 * to permit creation. Used by the music scheduler to time-stamp beats.
 */
export function getAudioContext(): AudioContext | null {
  return ctx;
}

/** Same for the master gain — music + sfx route through here. */
export function getMasterGain(): GainNode | null {
  return masterGain;
}

/**
 * Lazily construct the AudioContext. Call this from a user-gesture handler
 * (key press / pointer click) — no-op on subsequent calls.
 *
 * Returns true if an AudioContext was created (or already exists and was
 * resumed); false if creation is blocked or fails.
 */
export function ensureAudio(): boolean {
  if (ctx !== null) {
    if (ctx.state === 'suspended') {
      // Best-effort resume; returned promise ignored.
      void ctx.resume();
    }
    return true;
  }
  try {
    const Ctor: typeof AudioContext | undefined =
      typeof window !== 'undefined'
        ? (window.AudioContext ??
            (window as unknown as { webkitAudioContext?: typeof AudioContext })
              .webkitAudioContext)
        : undefined;
    if (Ctor === undefined) return false;
    ctx = new Ctor();
    masterGain = ctx.createGain();
    masterGain.gain.value = muted ? 0 : masterLevel;
    masterGain.connect(ctx.destination);
    return true;
  } catch {
    ctx = null;
    masterGain = null;
    return false;
  }
}

/** Play a short-lived synthesized SFX. No-ops if audio isn't ready. */
export function playSfx(name: SfxName): void {
  if (ctx === null || masterGain === null) return;
  if (muted) return;
  try {
    buildSfx(ctx, masterGain, name, ctx.currentTime);
  } catch {
    // SFX failures should never crash the game.
  }
}

/** Toggle mute. Music scheduler keeps running but inaudible while muted. */
export function setMuted(b: boolean): void {
  muted = b;
  if (masterGain !== null && ctx !== null) {
    // Slight ramp avoids click on toggle.
    const t = ctx.currentTime;
    masterGain.gain.cancelScheduledValues(t);
    masterGain.gain.setTargetAtTime(b ? 0 : masterLevel, t, 0.01);
  }
}

export function isMuted(): boolean {
  return muted;
}

/** Adjust master volume in [0, 1]. */
export function setMasterLevel(level: number): void {
  masterLevel = Math.max(0, Math.min(1, level));
  if (!muted && masterGain !== null && ctx !== null) {
    const t = ctx.currentTime;
    masterGain.gain.cancelScheduledValues(t);
    masterGain.gain.setTargetAtTime(masterLevel, t, 0.01);
  }
}
