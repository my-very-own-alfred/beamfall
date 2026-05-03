// Beamfall — character ability system.
// Drives every player's ability state machine: charge accumulation, trigger
// on `power` edge, active-phase tick-down, and class-specific effects.
//
// Run order: AFTER inputs are bound to players (movement) but BEFORE collision.
// This lets BLADE/SMASH dash hits apply before laser collisions.
//
// Design: pure-ish — mutates world.players, world.nodes, world.lasers entries.
// Each class's logic is in its own helper for testability.

import type { InputSnapshot, Player, Vec2, World } from '@/types';
import { CHARACTER_SPECS } from '@/game/characters';

const SQ = (x: number): number => x * x;

/** Square-distance between two 2D points. */
function dist2(a: Vec2, b: Vec2): number {
  return SQ(a.x - b.x) + SQ(a.y - b.y);
}

/** Heading vector from input snapshot, falling back to (1, 0) if neutral. */
function inputHeading(snap: InputSnapshot | undefined): Vec2 {
  if (!snap) return { x: 1, y: 0 };
  const ax = snap.axisX;
  const ay = snap.axisY;
  const len = Math.hypot(ax, ay);
  if (len < 0.1) return { x: 1, y: 0 };
  return { x: ax / len, y: ay / len };
}

/**
 * Shortest distance from point P to line segment AB. Mirrors the impl in
 * collision.ts — duplicated to keep modules independent (no cross-system
 * imports of helpers).
 */
function pointToSegmentDistance(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  let t: number;
  if (lenSq === 0) t = 0;
  else {
    t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
  }
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

/**
 * Recharge the gauge for an idle ability. Capped at 1.0. Stunned players do
 * not recharge — symmetric with Laser League's SHOCK/SMASH "reset" behavior.
 */
function rechargeGauge(player: Player, dt: number): void {
  if (player.effects.stunTimer > 0) return;
  const spec = CHARACTER_SPECS[player.characterClass];
  const rate = 1 / spec.cooldown; // gauge units per second
  player.ability.charge = Math.min(1, player.ability.charge + rate * dt);
}

/**
 * Trigger the player's ability. Returns true if it actually fired (charge
 * was full and class-specific preconditions pass).
 */
function tryTrigger(world: World, player: Player, snap: InputSnapshot | undefined): boolean {
  const spec = CHARACTER_SPECS[player.characterClass];
  const ab = player.ability;

  // SNIPE has a two-step trigger: first press arms, second press teleports.
  if (player.characterClass === 'snipe') {
    if (ab.phase === 'armed' && ab.marker !== null) {
      doSnipeTeleport(world, player);
      return true;
    }
    if (ab.charge < 1) return false;
    ab.phase = 'armed';
    ab.marker = { x: player.pos.x, y: player.pos.y };
    ab.activeTimer = spec.params.armWindow;
    ab.charge = 0;
    return true;
  }

  if (ab.charge < 1) return false;

  switch (player.characterClass) {
    case 'smash':
    case 'blade': {
      const heading = inputHeading(snap);
      ab.phase = 'active';
      ab.activeTimer = spec.activeDuration;
      ab.dashVel = {
        x: heading.x * spec.params.dashSpeed,
        y: heading.y * spec.params.dashSpeed,
      };
      ab.charge = 0;
      return true;
    }
    case 'shock': {
      ab.phase = 'active';
      ab.activeTimer = spec.activeDuration;
      ab.charge = 0;
      doShockBurst(world, player);
      return true;
    }
    case 'ghost': {
      ab.phase = 'active';
      ab.activeTimer = spec.activeDuration;
      ab.charge = 0;
      return true;
    }
    case 'thief': {
      const swapped = doThiefSwap(world, player);
      if (swapped) {
        ab.phase = 'active';
        ab.activeTimer = spec.activeDuration;
        ab.charge = 0;
      }
      // If no eligible node was in range, charge is preserved — no waste.
      return swapped;
    }
  }
  return false;
}

/**
 * SHOCK burst: stun every alive enemy whose center is within `radius` of
 * the player. Reset their ability charge — matches Laser League SHOCK feel.
 */
function doShockBurst(world: World, caster: Player): void {
  const spec = CHARACTER_SPECS.shock;
  const r2 = SQ(spec.params.radius);
  for (const other of world.players) {
    if (other.id === caster.id) continue;
    if (!other.alive) continue;
    if (other.color === caster.color) continue;
    if (dist2(other.pos, caster.pos) <= r2) {
      other.effects.stunTimer = Math.max(other.effects.stunTimer, spec.params.stunDuration);
      other.ability.charge = 0;
      other.ability.phase = 'idle';
      other.ability.activeTimer = 0;
      other.ability.marker = null;
      other.ability.dashVel = null;
      caster.stats.shockHits += 1;
    }
  }
}

/** THIEF capture flash duration (seconds) for visual feedback. */
const THIEF_FLASH_DURATION = 0.35;

/**
 * THIEF swap: convert the closest enemy-owned node within `range` to the
 * caster's color. Returns true on success.
 */
function doThiefSwap(world: World, caster: Player): boolean {
  const spec = CHARACTER_SPECS.thief;
  const r2 = SQ(spec.params.range);
  let bestD = Infinity;
  let bestIdx = -1;
  for (let i = 0; i < world.nodes.length; i++) {
    const node = world.nodes[i]!;
    if (node.ownerColor === null) continue;
    if (node.ownerColor === caster.color) continue;
    const d = dist2(node.pos, caster.pos);
    if (d <= r2 && d < bestD) {
      bestD = d;
      bestIdx = i;
    }
  }
  if (bestIdx < 0) return false;
  const stolen = world.nodes[bestIdx]!;
  stolen.ownerColor = caster.color;
  // Set the visual flash; decayed by laserScheduler each tick.
  stolen.flashTimer = THIEF_FLASH_DURATION;
  caster.stats.thiefSteals += 1;
  caster.stats.captures += 1;
  return true;
}

/**
 * SNIPE teleport: kills all enemies whose collision circle intersects the
 * segment from current pos to marker, then teleports the caster to marker.
 */
function doSnipeTeleport(world: World, caster: Player): void {
  const spec = CHARACTER_SPECS.snipe;
  const ab = caster.ability;
  if (ab.marker === null) return;
  const a = caster.pos;
  const b = ab.marker;
  for (const other of world.players) {
    if (other.id === caster.id) continue;
    if (!other.alive) continue;
    if (other.color === caster.color) continue;
    if (other.effects.invincibleTimer > 0) continue;
    const d = pointToSegmentDistance(other.pos.x, other.pos.y, a.x, a.y, b.x, b.y);
    if (d <= other.radius + 0.1) {
      other.alive = false;
      other.stats.deaths += 1;
      caster.stats.ultKills += 1;
      // Impact: hit-stop + medium shake on kill.
      world.hitStopTimer = Math.max(world.hitStopTimer, 0.08);
      world.shake = Math.max(world.shake, 9);
    }
  }
  caster.prevPos = { x: caster.pos.x, y: caster.pos.y };
  caster.pos = { x: b.x, y: b.y };
  ab.phase = 'active';
  ab.activeTimer = spec.activeDuration;
  ab.marker = null;
}

/**
 * Resolve dash-vs-enemy contacts during BLADE/SMASH active windows. Called
 * each tick of the active phase. Returns true if the dash hit something
 * (BLADE uses this to refill its gauge instantly).
 */
function resolveDashHits(world: World, attacker: Player): boolean {
  const spec = CHARACTER_SPECS[attacker.characterClass];
  const dashRadius = spec.params.dashRadius;
  let hit = false;

  for (const other of world.players) {
    if (other.id === attacker.id) continue;
    if (!other.alive) continue;
    if (other.color === attacker.color) continue;
    if (other.effects.invincibleTimer > 0) continue;

    const r = dashRadius + other.radius;
    if (dist2(attacker.pos, other.pos) <= SQ(r)) {
      hit = true;
      if (attacker.characterClass === 'blade') {
        other.alive = false;
        other.stats.deaths += 1;
        attacker.stats.ultKills += 1;
        // BLADE kill: full hit-stop + medium-shake impact.
        world.hitStopTimer = Math.max(world.hitStopTimer, 0.08);
        world.shake = Math.max(world.shake, 9);
      } else {
        // SMASH: knockback in direction of dash velocity.
        const dv = attacker.ability.dashVel;
        if (dv !== null) {
          const len = Math.hypot(dv.x, dv.y);
          if (len > 0.001) {
            const nx = dv.x / len;
            const ny = dv.y / len;
            const imp = spec.params.knockbackImpulse;
            other.effects.knockback.x = nx * imp;
            other.effects.knockback.y = ny * imp;
          }
        }
        // SMASH dash hit: small shake + hit-stop for the impact thump.
        world.hitStopTimer = Math.max(world.hitStopTimer, 0.08);
        world.shake = Math.max(world.shake, 5);
      }
    }
  }
  return hit;
}

/**
 * Per-tick entry point. Snapshots are slot-indexed and may be undefined for
 * unbound slots. Called from world.tick() during 'playing'.
 */
export function updateAbilities(
  world: World,
  snapshots: InputSnapshot[],
  dt: number,
): void {
  for (const player of world.players) {
    if (!player.alive) continue;

    const ab = player.ability;
    const snap = snapshots[player.slot];

    // Trigger edge.
    if (snap?.power) {
      tryTrigger(world, player, snap);
    }

    // Active-phase tick-down + class side effects.
    if (ab.phase === 'active') {
      ab.activeTimer -= dt;
      if (ab.activeTimer <= 0) {
        ab.phase = 'idle';
        ab.activeTimer = 0;
        ab.dashVel = null;
      } else if (player.characterClass === 'blade' && ab.dashVel !== null) {
        // Resolve dash hits each tick the dash is active. On hit, refill
        // immediately to reward aggression. The dash is consumed (back to idle)
        // so a single press = a single slash.
        if (resolveDashHits(world, player)) {
          ab.charge = 1;
          ab.phase = 'idle';
          ab.activeTimer = 0;
          ab.dashVel = null;
        }
      } else if (player.characterClass === 'smash' && ab.dashVel !== null) {
        resolveDashHits(world, player);
      }
    } else if (ab.phase === 'armed') {
      // SNIPE: marker auto-cancels when the arm window expires.
      ab.activeTimer -= dt;
      if (ab.activeTimer <= 0) {
        ab.phase = 'idle';
        ab.activeTimer = 0;
        ab.marker = null;
        ab.charge = 0; // armed marker spent — small cost for cancel
      }
    } else {
      // 'idle': gauge fills.
      rechargeGauge(player, dt);
    }
  }
}
