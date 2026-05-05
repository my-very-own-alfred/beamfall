// Beamfall — deterministic replay system.
//
// Records the inputs of an entire match plus the parameters needed to
// reconstruct an identical World, then plays back by feeding the recorded
// inputs to the simulation in place of live keyboard/gamepad reads.
//
// ===========================================================================
// Encoding
// ===========================================================================
// One match is described by a `Replay` object. The hot path is `perTickInputs`,
// a `number[][]` of length = total ticks executed during recording. Each tick
// entry is an array of length = `bindings.length`, where each entry encodes a
// single `InputSnapshot` as a 24-bit integer:
//
//   bits  0..7   axisX  : signed 8-bit  (Math.round(axisX * 127))
//   bits  8..15  axisY  : signed 8-bit  (Math.round(axisY * 127))
//   bits 16..23  flags  : bit0 = activate, bit1 = power
//
// Encoded values fit comfortably inside JS safe-integer range (24 bits) and
// JSON-stringify cleanly. Decoding reverses the layout. Round-trip should be
// lossless within ±1/127 on each axis (well below input precision).
//
// ===========================================================================
// Determinism contract
// ===========================================================================
// Replay reproduces a match iff:
//   * The same `seed` is passed to `createWorld`.
//   * The same `bindings`, `characters`, `arenaId`, and `mutators` are used.
//   * No system in the simulation consumes wall-clock time.
//
// Note: `createWorld` historically falls back to `Date.now()` when no seed is
// provided. The replay system always passes an explicit seed, so this fallback
// is only used for live matches that are never replayed.

import type { CharacterClass, InputSnapshot, PlayerBinding } from '@/types';
import type { ArenaId } from '@/game/arenas';
import type { MutatorId } from '@/game/mutators';

export interface Replay {
  version: 1;
  seed: number;
  bindings: PlayerBinding[];
  characters: CharacterClass[];
  arenaId: ArenaId;
  mutators: MutatorId[];
  /** One entry per tick. Inner array length = bindings.length. */
  perTickInputs: number[][];
}

const STORAGE_KEY = 'beamfall:lastReplay';
const MAX_STORAGE_BYTES = 1_000_000; // 1 MB

// ---------------------------------------------------------------------------
// Encoding helpers
// ---------------------------------------------------------------------------

/** Encode a single snapshot into a 24-bit packed integer. */
export function encodeSnapshot(snap: InputSnapshot): number {
  const ax = clamp8(Math.round(snap.axisX * 127));
  const ay = clamp8(Math.round(snap.axisY * 127));
  const flags = (snap.activate ? 1 : 0) | (snap.power ? 2 : 0);
  // Pack as unsigned: each byte is low 8 bits.
  return (ax & 0xff) | ((ay & 0xff) << 8) | ((flags & 0xff) << 16);
}

/** Decode a single packed integer back into an InputSnapshot. */
export function decodeSnapshot(v: number): InputSnapshot {
  const axRaw = v & 0xff;
  const ayRaw = (v >>> 8) & 0xff;
  const flags = (v >>> 16) & 0xff;
  // Sign-extend the 8-bit byte back to JS number.
  const ax = axRaw > 127 ? axRaw - 256 : axRaw;
  const ay = ayRaw > 127 ? ayRaw - 256 : ayRaw;
  return {
    axisX: ax / 127,
    axisY: ay / 127,
    activate: (flags & 1) !== 0,
    power: (flags & 2) !== 0,
    // Item #7: disconnected isn't recorded — replays are always replayed
    // from a connected source. False is the sim-correct default.
    disconnected: false,
  };
}

function clamp8(n: number): number {
  if (n > 127) return 127;
  if (n < -128) return -128;
  return n;
}

// ---------------------------------------------------------------------------
// Recorder
// ---------------------------------------------------------------------------

export interface ReplayRecorder {
  /** Append the given snapshots (one per binding) for this tick. */
  record(snapshots: readonly InputSnapshot[]): void;
  /** Number of ticks recorded so far. */
  tickCount(): number;
  /** Build the final Replay, embedding the supplied metadata. */
  finalize(meta: {
    seed: number;
    bindings: PlayerBinding[];
    characters: CharacterClass[];
    arenaId: ArenaId;
    mutators: MutatorId[];
  }): Replay;
}

export function createRecorder(): ReplayRecorder {
  const ticks: number[][] = [];
  return {
    record(snapshots: readonly InputSnapshot[]): void {
      const row: number[] = new Array(snapshots.length);
      for (let i = 0; i < snapshots.length; i++) {
        row[i] = encodeSnapshot(snapshots[i]!);
      }
      ticks.push(row);
    },
    tickCount(): number {
      return ticks.length;
    },
    finalize(meta): Replay {
      return {
        version: 1,
        seed: meta.seed,
        bindings: meta.bindings.slice(),
        characters: meta.characters.slice(),
        arenaId: meta.arenaId,
        mutators: meta.mutators.slice(),
        perTickInputs: ticks,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Player
// ---------------------------------------------------------------------------

export interface ReplayPlayer {
  /** Provide the snapshots for the current tick; advances internal cursor. */
  next(): InputSnapshot[];
  /** True once the recorded tick stream has been fully consumed. */
  exhausted(): boolean;
  /** Total ticks in this replay. */
  totalTicks(): number;
  /** Current playback tick index (0-based). */
  currentTick(): number;
}

export function createPlayer(replay: Replay): ReplayPlayer {
  let cursor = 0;
  const slotCount = replay.bindings.length;
  return {
    next(): InputSnapshot[] {
      const row = replay.perTickInputs[cursor];
      cursor++;
      if (!row) {
        // Ran out — return neutral snapshots so the sim doesn't NaN out.
        const out: InputSnapshot[] = [];
        for (let i = 0; i < slotCount; i++) {
          out.push({ axisX: 0, axisY: 0, activate: false, power: false, disconnected: false });
        }
        return out;
      }
      const out: InputSnapshot[] = new Array(row.length);
      for (let i = 0; i < row.length; i++) {
        out[i] = decodeSnapshot(row[i]!);
      }
      return out;
    },
    exhausted(): boolean {
      return cursor >= replay.perTickInputs.length;
    },
    totalTicks(): number {
      return replay.perTickInputs.length;
    },
    currentTick(): number {
      return cursor;
    },
  };
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

/**
 * Persist a replay to localStorage. Silently no-ops if localStorage is
 * unavailable (Node/test envs) or the serialized payload exceeds the size
 * cap.
 */
export function saveReplay(replay: Replay): void {
  if (typeof localStorage === 'undefined') return;
  let json: string;
  try {
    json = JSON.stringify(replay);
  } catch {
    return;
  }
  if (json.length > MAX_STORAGE_BYTES) {
    // eslint-disable-next-line no-console
    console.warn(
      `Beamfall: replay too large (${json.length} bytes), dropping. Cap is ${MAX_STORAGE_BYTES}.`,
    );
    return;
  }
  try {
    localStorage.setItem(STORAGE_KEY, json);
  } catch {
    // Quota or permissions issue — best-effort persistence, don't crash.
  }
}

/**
 * Load the last persisted replay, or null if none / parsing fails. Validates
 * shape defensively so a corrupt payload can't crash the menu.
 */
export function loadReplay(): Replay | null {
  if (typeof localStorage === 'undefined') return null;
  let raw: string | null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isValidReplay(parsed)) return null;
  return parsed;
}

/** Defensive validation — never trust localStorage. */
function isValidReplay(x: unknown): x is Replay {
  if (typeof x !== 'object' || x === null) return false;
  const o = x as Record<string, unknown>;
  if (o.version !== 1) return false;
  if (typeof o.seed !== 'number') return false;
  if (!Array.isArray(o.bindings)) return false;
  if (!Array.isArray(o.characters)) return false;
  if (typeof o.arenaId !== 'string') return false;
  if (!Array.isArray(o.mutators)) return false;
  if (!Array.isArray(o.perTickInputs)) return false;
  return true;
}

export function hasStoredReplay(): boolean {
  return loadReplay() !== null;
}
