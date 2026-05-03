// Beamfall — World construction and tick orchestration.

import type {
  CharacterClass,
  Color,
  EntityId,
  InputSnapshot,
  PlayerBinding,
  PlayerSlot,
  World,
} from '@/types';
import { ROUND_DURATION_SEC } from '@/types';

import { createGrid8x6 } from '@/game/arenas/grid8x6';
import { createNode } from '@/game/entities/node';
import { createPlayer } from '@/game/entities/player';
import { makeRng } from '@/game/rng';
import { DEFAULT_CHARACTER } from '@/game/characters';
import { emptyStats } from '@/game/stats';
import { updateAbilities } from '@/game/systems/abilities';
import { updateCollision } from '@/game/systems/collision';
import { updateEffects } from '@/game/systems/effects';
import { updateLaserScheduler } from '@/game/systems/laserScheduler';
import { updateMovement } from '@/game/systems/movement';
import { updateNodeActivation } from '@/game/systems/nodeActivation';
import { updatePickups } from '@/game/systems/pickups';
import { checkRoundEnd } from '@/game/systems/scoring';
import { getMatchWinner } from '@/game/rules';

const SLOT_COLORS: readonly Color[] = ['red', 'blue', 'yellow', 'green'];
const COUNTDOWN_SEC = 3;
const ROUND_END_HOLD_SEC = 2;
const PICKUP_FIRST_SPAWN_SEC = 5;

let inputProvider: () => InputSnapshot[] = () => [];
export function setInputProvider(p: () => InputSnapshot[]): void {
  inputProvider = p;
}

let nextEntityId = 1;
function allocId(): EntityId {
  return nextEntityId++ as EntityId;
}

/**
 * Construct a fresh World. `characters` is parallel to `bindings`; missing
 * entries fall back to DEFAULT_CHARACTER.
 */
export function createWorld(
  bindings: PlayerBinding[],
  characters: CharacterClass[] = [],
  seed?: number,
): World {
  const arena = createGrid8x6();
  const actualSeed = seed ?? Date.now();
  const rng = makeRng(actualSeed);

  const players = bindings.map((_b, idx) => {
    const slot = idx as PlayerSlot;
    const color = SLOT_COLORS[slot] as Color;
    const spawn = arena.spawnPoints[slot] ?? { x: 1, y: 1 };
    const cls = characters[idx] ?? DEFAULT_CHARACTER;
    return createPlayer(allocId(), slot, color, spawn, cls);
  });

  const nodes = arena.nodes.map((n) => createNode(allocId(), n.pos, n.pattern));

  const world: World = {
    state: 'lobby',
    tickCount: 0,
    roundTimer: ROUND_DURATION_SEC,
    roundNumber: 0,
    scores: { red: 0, blue: 0, yellow: 0, green: 0 },
    players,
    nodes,
    lasers: [],
    pickups: [],
    arena,
    bindings: bindings.slice(),
    characters: characters.slice(),
    rng,
    pickupCooldown: PICKUP_FIRST_SPAWN_SEC,
  };

  return world;
}

/**
 * Step the world forward by `dt` seconds. System order during 'playing':
 *   effects -> abilities -> movement -> nodeActivation -> laserScheduler
 *   -> collision -> pickups -> scoring.
 *
 * effects runs first to decay knockback/timers before movement reads them.
 * abilities runs before movement so dash velocities apply this same tick.
 * pickups runs after collision so a player who died this tick can't grab one.
 */
export function tick(world: World, dt: number): void {
  world.tickCount++;

  switch (world.state) {
    case 'lobby': {
      return;
    }
    case 'countdown': {
      world.roundTimer -= dt;
      if (world.roundTimer <= 0) {
        world.state = 'playing';
        world.roundTimer = ROUND_DURATION_SEC;
      }
      return;
    }
    case 'playing': {
      const snapshots = inputProvider();
      updateEffects(world, dt);
      updateAbilities(world, snapshots, dt);
      updateMovement(world, snapshots, dt);
      updateNodeActivation(world);
      updateLaserScheduler(world, dt);
      updateCollision(world);
      updatePickups(world, dt);

      world.roundTimer -= dt;

      const result = checkRoundEnd(world);
      if (result.ended) {
        if (result.winner !== null) {
          world.scores[result.winner]++;
          // Credit the round-win stat to every alive player of the winning
          // color. With one player per color this is just the survivor; but
          // keeping it loop-shaped lets future team modes work unchanged.
          for (const p of world.players) {
            if (p.color === result.winner && p.alive) {
              p.stats.roundsWon += 1;
            }
          }
        }
        world.state = 'roundEnd';
        world.roundTimer = ROUND_END_HOLD_SEC;
      }
      return;
    }
    case 'roundEnd': {
      world.roundTimer -= dt;
      if (world.roundTimer <= 0) {
        const matchWinner = getMatchWinner(world);
        if (matchWinner !== null) world.state = 'matchEnd';
        else startNewRound(world);
      }
      return;
    }
    case 'matchEnd': {
      return;
    }
    default: {
      const _exhaustive: never = world.state;
      return _exhaustive;
    }
  }
}

export function startNewRound(world: World): void {
  for (const player of world.players) {
    const spawn = world.arena.spawnPoints[player.slot] ?? { x: 1, y: 1 };
    player.pos = { x: spawn.x, y: spawn.y };
    player.prevPos = { x: spawn.x, y: spawn.y };
    player.vel = { x: 0, y: 0 };
    player.alive = true;
    player.ability.phase = 'idle';
    player.ability.charge = 0;
    player.ability.activeTimer = 0;
    player.ability.marker = null;
    player.ability.dashVel = null;
    player.effects.stunTimer = 0;
    player.effects.speedBoostTimer = 0;
    player.effects.invincibleTimer = 0;
    player.effects.knockback = { x: 0, y: 0 };
  }

  for (const node of world.nodes) {
    node.ownerColor = null;
    node.phase = 0;
  }

  world.lasers.length = 0;
  world.pickups.length = 0;
  world.pickupCooldown = PICKUP_FIRST_SPAWN_SEC;

  world.roundNumber++;
  world.state = 'countdown';
  world.roundTimer = COUNTDOWN_SEC;
}

export function startNewMatch(world: World): void {
  world.scores.red = 0;
  world.scores.blue = 0;
  world.scores.yellow = 0;
  world.scores.green = 0;
  world.roundNumber = 0;
  // Stats are scoped to a match (not a round) — wipe them here, not in
  // startNewRound, so the post-match leaderboard reflects the whole match.
  for (const p of world.players) {
    p.stats = emptyStats();
  }
  startNewRound(world);
}
