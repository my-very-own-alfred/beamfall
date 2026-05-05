// Beamfall — collision system.
// Tests live players against hostile lasers. A player dies if their body
// overlaps any laser segment owned by a different color, UNLESS they have
// a GHOST active or a pickup-shield 'invincibleTimer' running.

import type { Vec2, World } from '@/types';

/** Half-width of a laser line in cell units. */
const LASER_HALF_WIDTH = 0.05;

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
  const ex = px - cx;
  const ey = py - cy;
  return Math.sqrt(ex * ex + ey * ey);
}

/**
 * Minimum distance between two finite line segments A=(a1->a2) and B=(b1->b2)
 * in 2D. Solves the closest-point pair on the parametric segments by clamping
 * both u,v in [0,1]. Falls back to point-segment / point-point checks when
 * either segment is degenerate or the segments are parallel/colinear (in
 * which case the analytic system is singular).
 */
function segSegMinDistance(a1: Vec2, a2: Vec2, b1: Vec2, b2: Vec2): number {
  const dax = a2.x - a1.x;
  const day = a2.y - a1.y;
  const dbx = b2.x - b1.x;
  const dby = b2.y - b1.y;
  const rx = a1.x - b1.x;
  const ry = a1.y - b1.y;

  const a = dax * dax + day * day; // |A|^2
  const e = dbx * dbx + dby * dby; // |B|^2
  const f = dbx * rx + dby * ry;

  const EPS = 1e-12;

  // Both segments are points.
  if (a <= EPS && e <= EPS) {
    const ex = a1.x - b1.x;
    const ey = a1.y - b1.y;
    return Math.sqrt(ex * ex + ey * ey);
  }

  // Segment A is a point.
  if (a <= EPS) {
    return pointToSegmentDistance(a1.x, a1.y, b1.x, b1.y, b2.x, b2.y);
  }

  // Segment B is a point.
  if (e <= EPS) {
    return pointToSegmentDistance(b1.x, b1.y, a1.x, a1.y, a2.x, a2.y);
  }

  const c = dax * rx + day * ry;
  const b = dax * dbx + day * dby;
  const denom = a * e - b * b; // >= 0

  let s: number;
  let t: number;

  if (denom > EPS) {
    s = (b * f - c * e) / denom;
    if (s < 0) s = 0;
    else if (s > 1) s = 1;
  } else {
    // Parallel / colinear — pick s=0 and resolve t below.
    s = 0;
  }

  t = (b * s + f) / e;

  if (t < 0) {
    t = 0;
    s = -c / a;
    if (s < 0) s = 0;
    else if (s > 1) s = 1;
  } else if (t > 1) {
    t = 1;
    s = (b - c) / a;
    if (s < 0) s = 0;
    else if (s > 1) s = 1;
  }

  const cx = a1.x + dax * s - (b1.x + dbx * t);
  const cy = a1.y + day * s - (b1.y + dby * t);
  return Math.sqrt(cx * cx + cy * cy);
}

/** True if the player is currently immune to enemy lasers. */
function isInvincible(p: { ability: { phase: string }; characterClass: string; effects: { invincibleTimer: number } }): boolean {
  if (p.effects.invincibleTimer > 0) return true;
  if (p.characterClass === 'ghost' && p.ability.phase === 'active') return true;
  return false;
}

/**
 * Resolve player-vs-laser contacts for this tick. At 120 Hz the laser tip
 * sweeps fast enough that a point-vs-segment test misses corner-clip cases,
 * so we approximate a swept-vs-swept test: distance between the player's
 * motion segment (prevPos->pos) and BOTH the previous and current laser
 * segments. If either is within the contact radius, it counts as a hit.
 */
export function updateCollision(world: World): void {
  for (const player of world.players) {
    if (!player.alive) continue;
    if (isInvincible(player)) continue;

    // Fallback to current pos if prevPos somehow missing (shouldn't happen,
    // but cheap guard for first tick / partial state).
    const playerPrev: Vec2 = player.prevPos ?? player.pos;
    const contact = player.radius + LASER_HALF_WIDTH;

    for (const laser of world.lasers) {
      if (!laser.active) continue;
      if (laser.ownerColor === player.color) continue;

      // First-tick guard: prevSegA/B may equal segA/B (seeded by factory) or
      // could be undefined if a laser was just spawned mid-tick — fall back.
      const lprevA: Vec2 = laser.prevSegA ?? laser.segA;
      const lprevB: Vec2 = laser.prevSegB ?? laser.segB;

      // Test player swept-segment against current laser segment, then
      // against previous laser segment. Either hit kills.
      const dCurr = segSegMinDistance(playerPrev, player.pos, laser.segA, laser.segB);
      const dPrev =
        dCurr > contact
          ? segSegMinDistance(playerPrev, player.pos, lprevA, lprevB)
          : Infinity;

      if (dCurr <= contact || dPrev <= contact) {
        player.alive = false;
        player.stats.deaths += 1;
        // Credit the laser kill to a same-color player (typically the one
        // who activated that node — there's one player per color in MVP).
        for (const credit of world.players) {
          if (credit.color === laser.ownerColor && credit.id !== player.id) {
            credit.stats.laserKills += 1;
            break;
          }
        }
        world.events.push({ kind: 'kill', cause: 'laser' });
        // Impact feedback: hit-stop + medium shake on any laser death.
        world.hitStopTimer = Math.max(world.hitStopTimer, 0.08);
        world.shake = Math.max(world.shake, 9);
        break;
      }
    }
  }
}
