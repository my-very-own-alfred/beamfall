// Beamfall — collision system.
// Tests live players against hostile lasers. A player dies if their body
// overlaps any laser segment owned by a different color, UNLESS they have
// a GHOST active or a pickup-shield 'invincibleTimer' running.

import type { World } from '@/types';

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

/** True if the player is currently immune to enemy lasers. */
function isInvincible(p: { ability: { phase: string }; characterClass: string; effects: { invincibleTimer: number } }): boolean {
  if (p.effects.invincibleTimer > 0) return true;
  if (p.characterClass === 'ghost' && p.ability.phase === 'active') return true;
  return false;
}

export function updateCollision(world: World): void {
  for (const player of world.players) {
    if (!player.alive) continue;
    if (isInvincible(player)) continue;

    for (const laser of world.lasers) {
      if (!laser.active) continue;
      if (laser.ownerColor === player.color) continue;

      const d = pointToSegmentDistance(
        player.pos.x,
        player.pos.y,
        laser.segA.x,
        laser.segA.y,
        laser.segB.x,
        laser.segB.y,
      );

      if (d <= player.radius + LASER_HALF_WIDTH) {
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
        break;
      }
    }
  }
}
