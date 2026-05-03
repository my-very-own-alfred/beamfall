// Beamfall — beat-synced procedural music.
//
// Step-sequencer running on AudioContext.currentTime. Schedules a sliding
// horizon (~150 ms) of upcoming 16th-note steps so the actual sample-clock
// stays accurate even if requestAnimationFrame jitters. This is the standard
// Web Audio scheduling pattern (Wilson, "A Tale of Two Clocks").
//
// Style: dark synthwave — kick on every quarter, bass octaves on the
// off-beats, closed hi-hats on 8ths. No melody — the rhythm grid is the
// gameplay metronome and the laser scheduler will hook into it.

import { ensureAudio, getAudioContext, getMasterGain } from './engine';

// ---------------------------------------------------------------------------
// Public state — read by the host to populate world.beat each tick.
// ---------------------------------------------------------------------------

const BPM = 130;
const SECONDS_PER_BEAT = 60 / BPM;
const STEPS_PER_BEAT = 4; // 16th-note grid
const STEP_LOOKAHEAD_SEC = 0.15;
const SCHEDULER_INTERVAL_MS = 25;

let running = false;
let startTime = 0; // AudioContext.currentTime when music began
let nextStepTime = 0;
let stepIndex = 0;
let busGain: GainNode | null = null;
let schedTimer: ReturnType<typeof setInterval> | null = null;

/** Phase within the current beat in [0, 1). 0 if music hasn't started. */
export function getBeatPhase(): number {
  const ctx = getAudioContext();
  if (ctx === null || !running) return 0;
  const elapsed = Math.max(0, ctx.currentTime - startTime);
  const fractional = (elapsed / SECONDS_PER_BEAT) % 1;
  return fractional < 0 ? fractional + 1 : fractional;
}

/** Monotonic beat counter since music started. */
export function getBeatCount(): number {
  const ctx = getAudioContext();
  if (ctx === null || !running) return 0;
  const elapsed = Math.max(0, ctx.currentTime - startTime);
  return Math.floor(elapsed / SECONDS_PER_BEAT);
}

export function getBpm(): number {
  return BPM;
}

export function isMusicRunning(): boolean {
  return running;
}

// ---------------------------------------------------------------------------
// Voices — synthesized drum/bass hits.
// ---------------------------------------------------------------------------

function kickAt(ctx: AudioContext, dest: AudioNode, t: number): void {
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(140, t);
  osc.frequency.exponentialRampToValueAtTime(45, t + 0.15);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(0.7, t + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
  osc.connect(gain).connect(dest);
  osc.start(t);
  osc.stop(t + 0.22);
}

function hatAt(ctx: AudioContext, dest: AudioNode, t: number, accent: boolean): void {
  const len = 0.04;
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * len), ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 7000;
  const gain = ctx.createGain();
  const peak = accent ? 0.18 : 0.1;
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(peak, t + 0.001);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
  src.connect(hp).connect(gain).connect(dest);
  src.start(t);
  src.stop(t + 0.06);
}

function bassAt(ctx: AudioContext, dest: AudioNode, t: number, freq: number): void {
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(freq, t);
  const filt = ctx.createBiquadFilter();
  filt.type = 'lowpass';
  filt.frequency.setValueAtTime(900, t);
  filt.frequency.exponentialRampToValueAtTime(220, t + 0.3);
  filt.Q.value = 4;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(0.32, t + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
  osc.connect(filt).connect(gain).connect(dest);
  osc.start(t);
  osc.stop(t + 0.32);
}

// ---------------------------------------------------------------------------
// Scheduler — schedules ahead by STEP_LOOKAHEAD_SEC every SCHEDULER_INTERVAL_MS.
// ---------------------------------------------------------------------------

function scheduleStep(ctx: AudioContext, dest: AudioNode, step: number, t: number): void {
  // Step grid is 16 16ths per "bar" of 4 beats. Patterns are 16-step long.
  // Kick on every beat (steps 0, 4, 8, 12).
  const beatPos = step % STEPS_PER_BEAT;
  const inBar = step % 16;

  if (beatPos === 0) kickAt(ctx, dest, t);
  // Hat on every 8th, accent on beats.
  if (step % 2 === 0) hatAt(ctx, dest, t, beatPos === 0);
  // Bass: drop a low D on beats 2 and 4 of each bar; an octave higher on
  // the upbeat after the third kick. Subtle dark groove.
  // D2 = 73.42, D3 = 146.83.
  if (inBar === 4) bassAt(ctx, dest, t, 73.42);
  if (inBar === 12) bassAt(ctx, dest, t, 146.83);
  if (inBar === 14) bassAt(ctx, dest, t, 110.0); // A2 pickup
}

function tick(): void {
  const ctx = getAudioContext();
  if (ctx === null || busGain === null || !running) return;
  const horizon = ctx.currentTime + STEP_LOOKAHEAD_SEC;
  const stepDur = SECONDS_PER_BEAT / STEPS_PER_BEAT;
  while (nextStepTime < horizon) {
    scheduleStep(ctx, busGain, stepIndex, nextStepTime);
    stepIndex++;
    nextStepTime += stepDur;
  }
}

// ---------------------------------------------------------------------------
// Lifecycle.
// ---------------------------------------------------------------------------

/**
 * Start the music. Idempotent; if music is already playing, this is a no-op.
 * Audio context must already be unlocked (via `ensureAudio()` from a user
 * gesture). Returns true on success.
 */
export function startMusic(): boolean {
  if (running) return true;
  if (!ensureAudio()) return false;
  const ctx = getAudioContext();
  const master = getMasterGain();
  if (ctx === null || master === null) return false;

  busGain = ctx.createGain();
  busGain.gain.value = 0;
  busGain.connect(master);
  // Quick fade-in.
  const t = ctx.currentTime;
  busGain.gain.setValueAtTime(0, t);
  busGain.gain.linearRampToValueAtTime(0.55, t + 0.4);

  startTime = ctx.currentTime;
  nextStepTime = startTime;
  stepIndex = 0;
  running = true;
  // Prime the queue so we don't wait one interval before audio starts.
  tick();
  schedTimer = setInterval(tick, SCHEDULER_INTERVAL_MS);
  return true;
}

/**
 * Fade out and tear down the music graph. Idempotent.
 */
export function stopMusic(fadeSec = 0.5): void {
  if (!running) return;
  running = false;
  if (schedTimer !== null) {
    clearInterval(schedTimer);
    schedTimer = null;
  }
  const ctx = getAudioContext();
  if (ctx !== null && busGain !== null) {
    const t = ctx.currentTime;
    const g = busGain;
    g.gain.cancelScheduledValues(t);
    g.gain.setValueAtTime(g.gain.value, t);
    g.gain.linearRampToValueAtTime(0, t + fadeSec);
    // Disconnect after the fade so any tail samples flush cleanly.
    setTimeout(() => {
      try {
        g.disconnect();
      } catch {
        // Ignore — node may already be detached.
      }
    }, Math.ceil((fadeSec + 0.05) * 1000));
  }
  busGain = null;
}
