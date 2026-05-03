// Beamfall — shared type contract.
// Load-bearing: imported by engine, game systems, render, input, and audio modules.
// Do not change names or signatures without coordinating with all consumers.

// ---------------------------------------------------------------------------
// Brand types for safety
// ---------------------------------------------------------------------------

export type EntityId = number & { readonly __brand: 'EntityId' };
export type Color = 'red' | 'blue' | 'yellow' | 'green';
export type PlayerSlot = 0 | 1 | 2 | 3;

// ---------------------------------------------------------------------------
// Vec2
// ---------------------------------------------------------------------------

export interface Vec2 {
  x: number;
  y: number;
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export interface InputSnapshot {
  axisX: number; // -1..1
  axisY: number; // -1..1
  activate: boolean; // edge-triggered: true on rising edge of activate button
  power: boolean; // edge-triggered: true on rising edge of power button
}

export type KeyboardLayout = 'wasd' | 'arrows' | 'ijkl' | 'numpad';

export type PlayerBinding =
  | { kind: 'keyboard'; layout: KeyboardLayout }
  | { kind: 'gamepad'; index: number };

// ---------------------------------------------------------------------------
// Characters (class system inspired by Laser League)
// ---------------------------------------------------------------------------

/**
 * Six classes, each with a distinct ultimate. See `src/game/characters.ts`
 * for tunable parameters and the ability system in `systems/abilities.ts`
 * for the per-tick state machine driving them.
 */
export type CharacterClass = 'smash' | 'thief' | 'ghost' | 'shock' | 'snipe' | 'blade';

/**
 * Per-player ability state machine. Drives charge gauges, active windows, and
 * multi-step actions like SNIPE's marker -> teleport.
 *
 * `phase`:
 *   - 'idle'   — gauge filling; not currently using ability.
 *   - 'active' — ability window open (e.g. ghost invincibility, shock aura,
 *                blade dash, smash dash). `activeTimer` ticks down to 0.
 *   - 'armed'  — SNIPE-only: marker placed; second press triggers teleport.
 *
 * `charge` is normalized to [0,1]. At 1.0 the ability is ready.
 */
export interface AbilityState {
  phase: 'idle' | 'active' | 'armed';
  charge: number; // 0..1
  activeTimer: number; // seconds remaining in 'active' phase
  /** Marker for SNIPE — set on first press of 'armed'. */
  marker: Vec2 | null;
  /** Stored dash velocity for SMASH/BLADE so movement system can apply it. */
  dashVel: Vec2 | null;
}

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

/**
 * Transient per-player effects. Independent from CharacterClass — these come
 * from arena pickups or being hit by another character's ability.
 */
export interface PlayerEffects {
  /** Seconds of stun remaining. While >0 movement input is ignored. */
  stunTimer: number;
  /** Seconds of pickup speed-boost remaining. Stacks multiplicatively. */
  speedBoostTimer: number;
  /** Seconds of pickup invincibility remaining (separate from GHOST). */
  invincibleTimer: number;
  /** Knockback velocity applied by SMASH; decays exponentially. */
  knockback: Vec2;
}

/**
 * Per-player match-long stats. Used to compute the post-match leaderboard /
 * MVP screen. Reset by `startNewMatch`; round transitions do NOT clear these.
 *
 * Score weights live in `src/game/stats.ts`. Keep them centralized so balance
 * tweaks don't ripple through every system that updates the counters.
 */
export interface PlayerStats {
  /** Times this player killed someone with their ultimate (BLADE/SNIPE/SMASH-knocked-into-laser). */
  ultKills: number;
  /** Times this player killed someone via a laser they activated (laser kill credit). */
  laserKills: number;
  /** Times this player died (any cause). */
  deaths: number;
  /** Times this player took ownership of a node (counts each capture, not held). */
  captures: number;
  /** Times this player stole a node from an enemy via THIEF. */
  thiefSteals: number;
  /** Times this player stunned an enemy with SHOCK. */
  shockHits: number;
  /** Rounds this player's color won. */
  roundsWon: number;
}

export interface Player {
  id: EntityId;
  slot: PlayerSlot;
  color: Color;
  characterClass: CharacterClass;
  pos: Vec2;
  prevPos: Vec2; // for render interpolation
  vel: Vec2;
  alive: boolean;
  radius: number; // collision radius in cell units
  speed: number; // base cells per second
  ability: AbilityState;
  effects: PlayerEffects;
  stats: PlayerStats;
}

export type LaserPattern =
  | 'sweep'
  | 'rotate'
  | 'pulse'
  | 'segment-flip'
  | 'zigzag'
  | 'ring'
  | 'pendulum';

export interface LaserNode {
  id: EntityId;
  pos: Vec2;
  ownerColor: Color | null;
  pattern: LaserPattern;
  phase: number; // 0..1, advances with beat clock
  /**
   * Visual flash timer (seconds) for THIEF capture feedback. Set by
   * `abilities.ts` `doThiefSwap`, decayed by `laserScheduler.ts` each tick.
   * Render reads it; gameplay does not branch on it.
   */
  flashTimer: number;
}

export interface LaserSegment {
  id: EntityId;
  ownerColor: Color;
  segA: Vec2;
  segB: Vec2;
  prevSegA: Vec2;
  prevSegB: Vec2;
  active: boolean;
}

export type PickupKind = 'speed' | 'stun' | 'shield';

export interface Pickup {
  id: EntityId;
  pos: Vec2;
  kind: PickupKind;
}

// ---------------------------------------------------------------------------
// World state
// ---------------------------------------------------------------------------

export type GameState = 'lobby' | 'countdown' | 'playing' | 'roundEnd' | 'matchEnd';

export interface Arena {
  cols: number;
  rows: number;
  cellSize: number; // pixels per cell at 1x zoom
  nodes: Array<{ pos: Vec2; pattern?: LaserPattern }>;
  spawnPoints: Vec2[]; // player spawn positions per slot
  /** Optional human-readable name displayed in the lobby. */
  name?: string;
  /** Optional one-line tagline displayed below the name. */
  tagline?: string;
}

export interface World {
  state: GameState;
  tickCount: number;
  roundTimer: number; // seconds remaining
  roundNumber: number;
  scores: Record<Color, number>;
  players: Player[];
  nodes: LaserNode[];
  lasers: LaserSegment[]; // rebuilt each tick by laserScheduler
  pickups: Pickup[];
  arena: Arena;
  bindings: PlayerBinding[];
  characters: CharacterClass[]; // parallel to bindings
  rng: () => number; // seeded PRNG (xoshiro128**)
  /** Seconds until the next pickup spawn check. */
  pickupCooldown: number;
  /**
   * Hit-stop timer (seconds). When >0 the world tick skips all gameplay
   * system updates but continues to decrement this timer. Used to emphasize
   * impact moments (BLADE/SMASH/SNIPE hits, laser deaths). Deterministic.
   */
  hitStopTimer: number;
  /**
   * Screen-shake magnitude in CSS pixels. Pure render-scoped feedback; the
   * world renderer applies the offset and decays this value each frame.
   * Cosmetic only — not part of the deterministic simulation.
   */
  shake: number;
  // ---------------------------------------------------------------------------
  // Mutator-driven fields. All optional with safe defaults so existing test
  // helpers and call sites continue to compile.
  // ---------------------------------------------------------------------------
  /** Multiplier on laser-pattern phase rate. 1 = normal, 0.5 = sluggish. */
  laserRateMultiplier?: number;
  /** Multiplier on ability gauge recharge rate. 1 = normal. */
  abilityRateMultiplier?: number;
  /** When false, pickup spawning is disabled. */
  pickupsEnabled?: boolean;
  /**
   * Chaos-nodes timer (seconds). When >0, every 5 seconds a randomly chosen
   * node's pattern is reassigned via world.rng(). 0 disables the effect.
   */
  chaosTimer?: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const TICK_HZ = 120;
export const TICK_DT = 1 / TICK_HZ;
export const RENDER_HZ_TARGET = 60;
export const ROUND_DURATION_SEC = 30;
export const MATCH_WIN_SCORE = 5;

// Color -> hex
export const COLOR_HEX: Record<Color, number> = {
  red: 0xff3344,
  blue: 0x3388ff,
  yellow: 0xffdd33,
  green: 0x33dd66,
};
