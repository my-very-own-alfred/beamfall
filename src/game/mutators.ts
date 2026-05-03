// Beamfall — match modifiers (mutators).
//
// Mutators are pre-match toggles selected in the lobby that modify world
// behavior for the duration of the match. Each mutator is applied once after
// `createWorld` returns and before `startNewMatch` runs, by mutating fields
// (multipliers / flags) on the World.
//
// Determinism: mutators only mutate world state and never consume wall-clock.
// As long as the same mutator set is applied to a World built with the same
// seed/bindings/characters/arena, the simulation must reproduce identically.

import type { World } from '@/types';

export type MutatorId =
  | 'fastSpeed'
  | 'sluggishLasers'
  | 'instantCharge'
  | 'noPickups'
  | 'chaosNodes';

export interface MutatorSpec {
  id: MutatorId;
  name: string;
  description: string;
}

export const MUTATORS: Record<MutatorId, MutatorSpec> = {
  fastSpeed: {
    id: 'fastSpeed',
    name: 'Fast Feet',
    description: 'All players move at 2x speed.',
  },
  sluggishLasers: {
    id: 'sluggishLasers',
    name: 'Sluggish Lasers',
    description: 'Laser patterns advance at half speed.',
  },
  instantCharge: {
    id: 'instantCharge',
    name: 'Instant Charge',
    description: 'Abilities start each round full and recharge 4x faster.',
  },
  noPickups: {
    id: 'noPickups',
    name: 'No Pickups',
    description: 'Disable pickup spawns entirely.',
  },
  chaosNodes: {
    id: 'chaosNodes',
    name: 'Chaos Nodes',
    description: 'Every 5s, a random node\u2019s pattern is reassigned.',
  },
};

/** Order in which mutators appear in the lobby (1\u20135 toggle keys). */
export const MUTATOR_ORDER: readonly MutatorId[] = [
  'fastSpeed',
  'sluggishLasers',
  'instantCharge',
  'noPickups',
  'chaosNodes',
] as const;

/**
 * Apply the given mutators to a freshly-built world. Mutates fields on the
 * world directly. Idempotent only when called once after `createWorld`.
 */
export function applyMutators(world: World, ids: readonly MutatorId[]): void {
  const set = new Set(ids);

  if (set.has('fastSpeed')) {
    for (const p of world.players) {
      p.speed *= 2;
    }
  }
  if (set.has('sluggishLasers')) {
    world.laserRateMultiplier = 0.5;
  }
  if (set.has('instantCharge')) {
    world.abilityRateMultiplier = 4;
  }
  if (set.has('noPickups')) {
    world.pickupsEnabled = false;
  }
  if (set.has('chaosNodes')) {
    // Non-zero arms the chaos system. The effect runs every 5 seconds; we
    // start the timer at 5s so the first reassignment happens 5s into round 1.
    world.chaosTimer = 5;
  }
}
