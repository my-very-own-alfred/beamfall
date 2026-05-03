// Beamfall — character class definitions.
// Each class has tunable physics/timing parameters used by the ability system.
// Numbers are deliberately tuned — change with care, all are interlinked.
//
// Inspiration: Laser League (Roll7, 2018). Mechanics re-implemented from
// scratch — no code or assets borrowed. Names match for genre familiarity.

import type { CharacterClass } from '@/types';

/** Default character if a slot has no explicit selection. */
export const DEFAULT_CHARACTER: CharacterClass = 'smash';

/** All 6 classes, in canonical lobby-display order. */
export const ALL_CHARACTERS: readonly CharacterClass[] = [
  'smash',
  'blade',
  'shock',
  'snipe',
  'ghost',
  'thief',
] as const;

/**
 * Per-class tunables. All durations in seconds, speeds in cells/sec, ranges
 * in cell units. The ability system reads these directly — there is no
 * indirection through balance JSON.
 */
export interface CharacterSpec {
  /** Display label. */
  readonly name: string;
  /** Short tagline shown in lobby. */
  readonly tagline: string;
  /**
   * Base recharge time (sec) for the ability gauge to fill from 0 to 1.
   * Effective recharge varies by class semantics (BLADE recharges fast on hit).
   */
  readonly cooldown: number;
  /** Active-phase duration. */
  readonly activeDuration: number;
  /**
   * Optional class-specific parameters. Documented per class below; see
   * `src/game/systems/abilities.ts` for how each is consumed.
   */
  readonly params: Readonly<Record<string, number>>;
}

/**
 * SMASH — short forward dash that pushes opponents on contact.
 *   - dashSpeed       cells/sec velocity applied during active window
 *   - knockbackImpulse  initial velocity transferred to a struck enemy
 *   - knockbackDecay  exponential decay rate (1/sec) for that knockback
 *   - dashRadius      contact radius for SMASH-vs-enemy hit test
 *
 * BLADE — short forward dash that kills on contact. Charge-based: on a hit
 * the gauge instantly refills; on miss the cooldown is the full value. This
 * mirrors Laser League's "miss is punished" feel.
 *   - dashSpeed       cells/sec velocity applied during active window
 *   - dashRadius      contact radius for BLADE-vs-enemy hit test
 *
 * SHOCK — radial AoE around the player. Enemies inside the radius are stunned
 * (movement frozen, ability charge reset to 0).
 *   - radius          cell-unit reach of the shock aura
 *   - stunDuration    seconds of stun applied to anyone caught
 *
 * SNIPE — two-step ability:
 *   1) First press places a marker at the player's current pos and enters
 *      'armed'. Movement continues normally.
 *   2) Second press teleports the player back to the marker. Anyone whose
 *      collision circle intersects the segment from current pos to marker
 *      is killed.
 *   - armWindow       seconds the marker remains valid before auto-cancel
 *
 * GHOST — temporary invincibility. Player ignores all enemy lasers and own
 * collision-with-laser checks during the active window.
 *   (no extra params; activeDuration is the invincibility window)
 *
 * THIEF — instant cast. Convert the nearest enemy-color node within `range`
 * to the player's color. No effect if there is no node in range.
 *   - range           cell-unit reach for nearest-node search
 */
export const CHARACTER_SPECS: Record<CharacterClass, CharacterSpec> = {
  smash: {
    name: 'SMASH',
    tagline: 'Dash and shove enemies into lasers.',
    cooldown: 6.0,
    activeDuration: 0.22,
    params: {
      dashSpeed: 12,
      knockbackImpulse: 14,
      knockbackDecay: 6.0,
      dashRadius: 0.55,
    },
  },
  blade: {
    name: 'BLADE',
    tagline: 'Slash through. Hit refills, miss punishes.',
    cooldown: 6.0, // miss penalty
    activeDuration: 0.18,
    params: {
      dashSpeed: 14,
      dashRadius: 0.45,
    },
  },
  shock: {
    name: 'SHOCK',
    tagline: 'Radial stun. Crowd control.',
    cooldown: 7.0,
    activeDuration: 0.5,
    params: {
      radius: 1.25,
      stunDuration: 1.0,
    },
  },
  snipe: {
    name: 'SNIPE',
    tagline: 'Marker + teleport. Cuts a fatal line.',
    cooldown: 8.0,
    activeDuration: 0.25, // teleport flash window
    params: {
      armWindow: 4.0,
    },
  },
  ghost: {
    name: 'GHOST',
    tagline: 'Walk through lasers for a moment.',
    cooldown: 7.0,
    activeDuration: 1.5,
    params: {},
  },
  thief: {
    name: 'THIEF',
    tagline: 'Steal nearest enemy node.',
    cooldown: 6.0,
    activeDuration: 0.1, // brief flash for feedback
    params: {
      range: 2.5,
    },
  },
};
