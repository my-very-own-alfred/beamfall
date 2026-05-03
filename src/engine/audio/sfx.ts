// Beamfall — synthesized SFX.
//
// Each SFX is a small function that builds an oscillator/noise graph with a
// gain envelope and connects it to the master bus. Nothing is cached: a fresh
// graph per call keeps polyphony trivially correct, at the cost of a few GC
// allocations per event (acceptable for the call rate of an arena game).
//
// Distinct timbres are the goal — the player should be able to read every
// event by ear without color cues.

export type SfxName =
  | 'dash'
  | 'slash'
  | 'zap'
  | 'teleport'
  | 'capture'
  | 'steal'
  | 'death'
  | 'pickup'
  | 'roundEnd'
  | 'matchEnd'
  | 'countdownTick'
  | 'countdownGo';

/** Build a short noise buffer. Reused across instances within one tick. */
function makeNoiseBuffer(ctx: AudioContext, durationSec: number): AudioBuffer {
  const len = Math.max(1, Math.floor(ctx.sampleRate * durationSec));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

/** Apply a basic ADSR-ish gain envelope. */
function envelope(
  gain: GainNode,
  t0: number,
  attack: number,
  peak: number,
  release: number,
): void {
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(peak, t0 + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + release);
}

/**
 * Dispatch table — builds and starts a graph for the named SFX. Each handler
 * connects to `dest` (master gain) and schedules its own `osc.stop()` so
 * nodes self-clean once the envelope decays.
 */
export function buildSfx(
  ctx: AudioContext,
  dest: AudioNode,
  name: SfxName,
  t0: number,
): void {
  switch (name) {
    case 'dash':
      sfxDash(ctx, dest, t0);
      return;
    case 'slash':
      sfxSlash(ctx, dest, t0);
      return;
    case 'zap':
      sfxZap(ctx, dest, t0);
      return;
    case 'teleport':
      sfxTeleport(ctx, dest, t0);
      return;
    case 'capture':
      sfxCapture(ctx, dest, t0);
      return;
    case 'steal':
      sfxSteal(ctx, dest, t0);
      return;
    case 'death':
      sfxDeath(ctx, dest, t0);
      return;
    case 'pickup':
      sfxPickup(ctx, dest, t0);
      return;
    case 'roundEnd':
      sfxRoundEnd(ctx, dest, t0);
      return;
    case 'matchEnd':
      sfxMatchEnd(ctx, dest, t0);
      return;
    case 'countdownTick':
      sfxCountdownTick(ctx, dest, t0, false);
      return;
    case 'countdownGo':
      sfxCountdownTick(ctx, dest, t0, true);
      return;
  }
}

function sfxDash(ctx: AudioContext, dest: AudioNode, t0: number): void {
  // Filtered noise + downward sweep — short whoosh.
  const dur = 0.12;
  const src = ctx.createBufferSource();
  src.buffer = makeNoiseBuffer(ctx, dur);
  const filt = ctx.createBiquadFilter();
  filt.type = 'bandpass';
  filt.Q.value = 4;
  filt.frequency.setValueAtTime(2200, t0);
  filt.frequency.exponentialRampToValueAtTime(500, t0 + dur);
  const gain = ctx.createGain();
  envelope(gain, t0, 0.005, 0.4, dur);
  src.connect(filt).connect(gain).connect(dest);
  src.start(t0);
  src.stop(t0 + dur + 0.02);
}

function sfxSlash(ctx: AudioContext, dest: AudioNode, t0: number): void {
  // Sharp metallic tick — square burst, fast decay.
  const dur = 0.08;
  const osc = ctx.createOscillator();
  osc.type = 'square';
  osc.frequency.setValueAtTime(1800, t0);
  osc.frequency.exponentialRampToValueAtTime(900, t0 + dur);
  const filt = ctx.createBiquadFilter();
  filt.type = 'highpass';
  filt.frequency.value = 700;
  const gain = ctx.createGain();
  envelope(gain, t0, 0.002, 0.35, dur);
  osc.connect(filt).connect(gain).connect(dest);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

function sfxZap(ctx: AudioContext, dest: AudioNode, t0: number): void {
  // Bright noise burst with high-pass — SHOCK feel.
  const dur = 0.15;
  const src = ctx.createBufferSource();
  src.buffer = makeNoiseBuffer(ctx, dur);
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.setValueAtTime(3000, t0);
  hp.frequency.exponentialRampToValueAtTime(1200, t0 + dur);
  const gain = ctx.createGain();
  envelope(gain, t0, 0.003, 0.5, dur);
  src.connect(hp).connect(gain).connect(dest);
  src.start(t0);
  src.stop(t0 + dur + 0.02);
}

function sfxTeleport(ctx: AudioContext, dest: AudioNode, t0: number): void {
  // Descending sine sweep.
  const dur = 0.2;
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(1200, t0);
  osc.frequency.exponentialRampToValueAtTime(220, t0 + dur);
  const gain = ctx.createGain();
  envelope(gain, t0, 0.005, 0.4, dur);
  osc.connect(gain).connect(dest);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

function sfxCapture(ctx: AudioContext, dest: AudioNode, t0: number): void {
  // Two-osc fifth chime.
  const dur = 0.25;
  const f1 = 880; // A5
  const f2 = 1318.5; // E6 (perfect fifth above)
  for (const f of [f1, f2]) {
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(f, t0);
    const gain = ctx.createGain();
    envelope(gain, t0, 0.004, 0.25, dur);
    osc.connect(gain).connect(dest);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }
}

function sfxSteal(ctx: AudioContext, dest: AudioNode, t0: number): void {
  // Chime + downward bend.
  const dur = 0.25;
  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(1100, t0);
  osc.frequency.exponentialRampToValueAtTime(550, t0 + dur);
  const osc2 = ctx.createOscillator();
  osc2.type = 'sine';
  osc2.frequency.setValueAtTime(1650, t0);
  osc2.frequency.exponentialRampToValueAtTime(820, t0 + dur);
  const gain = ctx.createGain();
  envelope(gain, t0, 0.004, 0.28, dur);
  osc.connect(gain);
  osc2.connect(gain);
  gain.connect(dest);
  osc.start(t0);
  osc2.start(t0);
  osc.stop(t0 + dur + 0.02);
  osc2.stop(t0 + dur + 0.02);
}

function sfxDeath(ctx: AudioContext, dest: AudioNode, t0: number): void {
  // Noise burst with low-pass dropping.
  const dur = 0.3;
  const src = ctx.createBufferSource();
  src.buffer = makeNoiseBuffer(ctx, dur);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(1800, t0);
  lp.frequency.exponentialRampToValueAtTime(180, t0 + dur);
  lp.Q.value = 1.2;
  const gain = ctx.createGain();
  envelope(gain, t0, 0.003, 0.55, dur);
  src.connect(lp).connect(gain).connect(dest);
  src.start(t0);
  src.stop(t0 + dur + 0.02);
}

function sfxPickup(ctx: AudioContext, dest: AudioNode, t0: number): void {
  // Bright triangle blip.
  const dur = 0.1;
  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(1600, t0);
  osc.frequency.exponentialRampToValueAtTime(2400, t0 + dur);
  const gain = ctx.createGain();
  envelope(gain, t0, 0.003, 0.3, dur);
  osc.connect(gain).connect(dest);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

function sfxRoundEnd(ctx: AudioContext, dest: AudioNode, t0: number): void {
  // Major-triad arpeggio up.
  const notes = [523.25, 659.25, 783.99]; // C5 E5 G5
  const step = 0.12;
  const noteDur = 0.18;
  for (let i = 0; i < notes.length; i++) {
    const f = notes[i]!;
    const start = t0 + i * step;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(f, start);
    const gain = ctx.createGain();
    envelope(gain, start, 0.005, 0.32, noteDur);
    osc.connect(gain).connect(dest);
    osc.start(start);
    osc.stop(start + noteDur + 0.02);
  }
}

function sfxMatchEnd(ctx: AudioContext, dest: AudioNode, t0: number): void {
  // Bigger triad + sustained tail.
  const notes = [261.63, 329.63, 392.0, 523.25]; // C4 E4 G4 C5
  const step = 0.1;
  const tailDur = 1.4;
  for (let i = 0; i < notes.length; i++) {
    const f = notes[i]!;
    const start = t0 + i * step;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(f, start);
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = 1600;
    const gain = ctx.createGain();
    envelope(gain, start, 0.01, 0.2, tailDur);
    osc.connect(filt).connect(gain).connect(dest);
    osc.start(start);
    osc.stop(start + tailDur + 0.05);
  }
}

function sfxCountdownTick(
  ctx: AudioContext,
  dest: AudioNode,
  t0: number,
  isGo: boolean,
): void {
  // Pitched higher on the GO! cue.
  const dur = isGo ? 0.22 : 0.08;
  const f = isGo ? 1320 : 880;
  const osc = ctx.createOscillator();
  osc.type = 'square';
  osc.frequency.setValueAtTime(f, t0);
  if (isGo) osc.frequency.exponentialRampToValueAtTime(f * 1.5, t0 + dur);
  const filt = ctx.createBiquadFilter();
  filt.type = 'lowpass';
  filt.frequency.value = isGo ? 4000 : 2400;
  const gain = ctx.createGain();
  envelope(gain, t0, 0.003, isGo ? 0.45 : 0.3, dur);
  osc.connect(filt).connect(gain).connect(dest);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}
