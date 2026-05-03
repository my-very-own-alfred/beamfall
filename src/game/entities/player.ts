// Beamfall — Player entity factory.

import type {
  AbilityState,
  CharacterClass,
  Color,
  EntityId,
  Player,
  PlayerEffects,
  PlayerSlot,
  Vec2,
} from '@/types';
import { emptyStats } from '@/game/stats';

/**
 * Default collision radius in cell units. Roughly 40% of a cell, leaves
 * room to maneuver between adjacent laser tiles.
 */
const PLAYER_RADIUS = 0.4;

/**
 * Default movement speed in cells per second.
 */
const PLAYER_SPEED = 4;

/**
 * Build a fresh AbilityState. Charge starts at 0 — players must wait through
 * the first cooldown before their ultimate is usable. This is intentional:
 * stops opening-tick burst usage from dominating round 1.
 */
export function createAbilityState(): AbilityState {
  return {
    phase: 'idle',
    charge: 0,
    activeTimer: 0,
    marker: null,
    dashVel: null,
  };
}

/** Build a fresh PlayerEffects with no active modifiers. */
export function createPlayerEffects(): PlayerEffects {
  return {
    stunTimer: 0,
    speedBoostTimer: 0,
    invincibleTimer: 0,
    knockback: { x: 0, y: 0 },
  };
}

/**
 * Build a fresh Player at a spawn point. Velocity starts at zero and prevPos
 * mirrors pos so the first render-interpolation frame draws a stationary body.
 */
export function createPlayer(
  id: EntityId,
  slot: PlayerSlot,
  color: Color,
  spawn: Vec2,
  characterClass: CharacterClass,
): Player {
  return {
    id,
    slot,
    color,
    characterClass,
    pos: { x: spawn.x, y: spawn.y },
    prevPos: { x: spawn.x, y: spawn.y },
    vel: { x: 0, y: 0 },
    alive: true,
    radius: PLAYER_RADIUS,
    speed: PLAYER_SPEED,
    ability: createAbilityState(),
    effects: createPlayerEffects(),
    stats: emptyStats(),
  };
}
