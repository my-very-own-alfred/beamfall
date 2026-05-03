// Beamfall — pickup system.
// Spawns pickups periodically at random open arena cells and applies their
// effect when an alive player overlaps one. Independent of CharacterClass.
//
// Effects:
//   speed  — +60% speed for SPEED_DURATION seconds.
//   stun   — instantly stuns nearest enemy color player for STUN_DURATION.
//   shield — invincibility for SHIELD_DURATION seconds (lasers ignore you).

import type { EntityId, PickupKind, World } from '@/types';
import { createPickup } from '@/game/entities/pickup';

const SPAWN_INTERVAL_SEC = 8.0;
const MAX_ACTIVE_PICKUPS = 2;
const PICKUP_RADIUS = 0.4;

const SPEED_DURATION = 4.0;
const STUN_DURATION = 1.2;
const SHIELD_DURATION = 2.5;

const KINDS: PickupKind[] = ['speed', 'stun', 'shield'];

let nextPickupId = 10000;
function allocPickupId(): EntityId {
  return nextPickupId++ as EntityId;
}

/** Pick a random open cell-center position not too close to any player. */
function pickSpawnPos(world: World): { x: number; y: number } | null {
  const arena = world.arena;
  const margin = 1;
  for (let attempt = 0; attempt < 20; attempt++) {
    const x = margin + world.rng() * (arena.cols - 2 * margin);
    const y = margin + world.rng() * (arena.rows - 2 * margin);
    let ok = true;
    for (const p of world.players) {
      if (!p.alive) continue;
      const dx = p.pos.x - x;
      const dy = p.pos.y - y;
      if (dx * dx + dy * dy < 1.5 * 1.5) {
        ok = false;
        break;
      }
    }
    if (ok) return { x, y };
  }
  return null;
}

function applyPickup(world: World, pickupKind: PickupKind, playerId: EntityId): void {
  const player = world.players.find((p) => p.id === playerId);
  if (!player) return;
  switch (pickupKind) {
    case 'speed':
      player.effects.speedBoostTimer = Math.max(player.effects.speedBoostTimer, SPEED_DURATION);
      break;
    case 'shield':
      player.effects.invincibleTimer = Math.max(player.effects.invincibleTimer, SHIELD_DURATION);
      break;
    case 'stun': {
      // Stun the nearest enemy-color alive player.
      let bestId: EntityId | null = null;
      let bestD = Infinity;
      for (const other of world.players) {
        if (other.id === player.id) continue;
        if (!other.alive) continue;
        if (other.color === player.color) continue;
        const dx = other.pos.x - player.pos.x;
        const dy = other.pos.y - player.pos.y;
        const d = dx * dx + dy * dy;
        if (d < bestD) {
          bestD = d;
          bestId = other.id;
        }
      }
      if (bestId !== null) {
        const target = world.players.find((p) => p.id === bestId);
        if (target) target.effects.stunTimer = Math.max(target.effects.stunTimer, STUN_DURATION);
      }
      break;
    }
  }
}

export function updatePickups(world: World, dt: number): void {
  // `noPickups` mutator: skip the entire spawn loop (still process collected
  // pickups already in-flight, though under this mutator there should be none).
  const spawnsEnabled = world.pickupsEnabled ?? true;
  if (spawnsEnabled) {
    // Spawn cadence.
    world.pickupCooldown -= dt;
    if (world.pickupCooldown <= 0 && world.pickups.length < MAX_ACTIVE_PICKUPS) {
      world.pickupCooldown = SPAWN_INTERVAL_SEC;
      const pos = pickSpawnPos(world);
      if (pos) {
        const kind = KINDS[Math.floor(world.rng() * KINDS.length)] ?? 'speed';
        world.pickups.push(createPickup(allocPickupId(), pos, kind));
      }
    } else if (world.pickupCooldown <= 0) {
      // Re-arm even if blocked, so we retry next tick.
      world.pickupCooldown = 0.5;
    }
  }

  // Pickup-vs-player overlap.
  for (let i = world.pickups.length - 1; i >= 0; i--) {
    const pickup = world.pickups[i]!;
    for (const player of world.players) {
      if (!player.alive) continue;
      const dx = player.pos.x - pickup.pos.x;
      const dy = player.pos.y - pickup.pos.y;
      const r = player.radius + PICKUP_RADIUS;
      if (dx * dx + dy * dy <= r * r) {
        applyPickup(world, pickup.kind, player.id);
        world.pickups.splice(i, 1);
        break;
      }
    }
  }
}
