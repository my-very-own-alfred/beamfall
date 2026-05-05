// Beamfall — World construction and tick orchestration.

import type {
  CharacterClass,
  Color,
  EntityId,
  InputSnapshot,
  LaserPattern,
  PlayerBinding,
  PlayerSlot,
  World,
} from '@/types';
import { ROUND_DURATION_SEC } from '@/types';

import { ARENAS, DEFAULT_ARENA_ID } from '@/game/arenas';
import type { ArenaId } from '@/game/arenas';
import { createNode } from '@/game/entities/node';
import { createPlayer } from '@/game/entities/player';
import type { GameEvent } from '@/game/events';
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
/** Interval between chaos-nodes pattern reassignments, in seconds. */
const CHAOS_INTERVAL_SEC = 5;
/** All laser patterns reachable to chaos-nodes. Must include every union variant. */
const ALL_LASER_PATTERNS: readonly LaserPattern[] = [
  'sweep',
  'rotate',
  'pulse',
  'segment-flip',
  'zigzag',
  'ring',
  'pendulum',
] as const;

/**
 * `chaosNodes` mutator step. When `world.chaosTimer > 0` the system counts
 * down each tick; on every CHAOS_INTERVAL_SEC tick boundary a randomly chosen
 * node has its pattern reassigned via `world.rng()`.
 *
 * Skips if `chaosTimer === 0` (mutator off). Pure determinism: all randomness
 * routes through `world.rng`.
 */
function updateChaosNodes(world: World, dt: number): void {
  if ((world.chaosTimer ?? 0) === 0) return;
  if (world.nodes.length === 0) return;
  world.chaosTimer = (world.chaosTimer ?? 0) - dt;
  if ((world.chaosTimer ?? 0) > 0) return;
  // Reassign one random node's pattern.
  const nodeIdx = Math.floor(world.rng() * world.nodes.length) % world.nodes.length;
  const patternIdx = Math.floor(world.rng() * ALL_LASER_PATTERNS.length) % ALL_LASER_PATTERNS.length;
  const node = world.nodes[nodeIdx];
  const pattern = ALL_LASER_PATTERNS[patternIdx];
  if (node && pattern) {
    node.pattern = pattern;
    node.flashTimer = 0.35;
  }
  world.chaosTimer = CHAOS_INTERVAL_SEC;
}

let inputProvider: () => InputSnapshot[] = () => [];
export function setInputProvider(p: () => InputSnapshot[]): void {
  inputProvider = p;
}

let nextEntityId = 1;
function allocId(): EntityId {
  return nextEntityId++ as EntityId;
}

/**
 * Item #6: read a seed from the page URL (?seed=12345). Returns null when not
 * in a browser context, when the param is absent, or when it does not parse
 * to a finite integer. Kept local so non-browser test harnesses can call
 * createWorld without DOM.
 */
function readSeedFromUrl(): number | null {
  if (typeof window === 'undefined' || typeof window.location === 'undefined') {
    return null;
  }
  const raw = new URLSearchParams(window.location.search).get('seed');
  if (raw === null) return null;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Construct a fresh World. `characters` is parallel to `bindings`; missing
 * entries fall back to DEFAULT_CHARACTER.
 */
export function createWorld(
  bindings: PlayerBinding[],
  characters: CharacterClass[] = [],
  seed?: number,
  arenaId: ArenaId = DEFAULT_ARENA_ID,
): World {
  const arenaFactory = ARENAS[arenaId] ?? ARENAS[DEFAULT_ARENA_ID];
  const arena = arenaFactory();
  // Item #6: seed selection. Explicit `seed` arg wins, otherwise a `?seed=N`
  // URL param (parseable int) is honored, else Date.now(). The chosen seed is
  // stored on world.seed so it can be surfaced to UI and serialized for
  // replays / debug.
  const actualSeed = seed ?? readSeedFromUrl() ?? Date.now();
  const rng = makeRng(actualSeed);
  // eslint-disable-next-line no-console
  console.info('[world] seed:', actualSeed);

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
    seed: actualSeed,
    pickupCooldown: PICKUP_FIRST_SPAWN_SEC,
    hitStopTimer: 0,
    shake: 0,
    // Mutator defaults — applyMutators may overwrite these post-construction.
    laserRateMultiplier: 1,
    abilityRateMultiplier: 1,
    pickupsEnabled: true,
    chaosTimer: 0,
    events: [],
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
      const before = world.roundTimer;
      world.roundTimer -= dt;
      // Emit a 'tick' event each whole-second crossing. value counts down:
      // 3, 2, 1, then 0 (the GO! cue) at zero-crossing.
      const beforeFloor = Math.ceil(before);
      const afterFloor = Math.ceil(Math.max(0, world.roundTimer));
      if (beforeFloor !== afterFloor) {
        const v = afterFloor;
        const evList: GameEvent[] = world.events;
        evList.push({ kind: 'countdownTick', value: v });
      }
      if (world.roundTimer <= 0) {
        world.state = 'playing';
        world.roundTimer = ROUND_DURATION_SEC;
      }
      return;
    }
    case 'playing': {
      // Hit-stop: when active, freeze every gameplay system but keep the
      // timer counting down so we eventually unfreeze. Render still runs at
      // the call-site — that's the whole point (frozen-frame impact).
      if (world.hitStopTimer > 0) {
        world.hitStopTimer = Math.max(0, world.hitStopTimer - dt);
        return;
      }

      const snapshots = inputProvider();
      updateEffects(world, dt);
      updateAbilities(world, snapshots, dt);
      updateMovement(world, snapshots, dt);
      updateNodeActivation(world);
      updateLaserScheduler(world, dt);
      updateCollision(world);
      updatePickups(world, dt);
      updateChaosNodes(world, dt);

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
        world.events.push({ kind: 'roundEnd' });
      }
      return;
    }
    case 'roundEnd': {
      world.roundTimer -= dt;
      if (world.roundTimer <= 0) {
        const matchWinner = getMatchWinner(world);
        if (matchWinner !== null) {
          world.state = 'matchEnd';
          // Big match-end shake (decayed by render).
          world.shake = Math.max(world.shake, 16);
          world.events.push({ kind: 'matchEnd' });
        } else startNewRound(world);
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
  // `instantCharge` mutator: ability gauge starts pre-charged each round.
  const instantCharge = (world.abilityRateMultiplier ?? 1) > 1;
  for (const player of world.players) {
    const spawn = world.arena.spawnPoints[player.slot] ?? { x: 1, y: 1 };
    player.pos = { x: spawn.x, y: spawn.y };
    player.prevPos = { x: spawn.x, y: spawn.y };
    player.vel = { x: 0, y: 0 };
    player.alive = true;
    player.ability.phase = 'idle';
    player.ability.charge = instantCharge ? 1 : 0;
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
    node.flashTimer = 0;
  }

  world.lasers.length = 0;
  world.pickups.length = 0;
  world.pickupCooldown = PICKUP_FIRST_SPAWN_SEC;
  world.hitStopTimer = 0;

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
