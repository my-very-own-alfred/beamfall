// Beamfall — movement system.
// Reads input snapshots and integrates player position. Honors stun,
// speed-boost effects, and dash velocity from BLADE/SMASH abilities.
// Run order: AFTER updateEffects (which decays knockback) and AFTER
// updateAbilities (which sets dashVel for the active dash window).
//
// Hot-path: prevPos / vel are mutated in place (never reassigned) to avoid
// allocating fresh Vec2 objects every tick. At 120 Hz with 4 players that's
// ~960 obj/s avoided just here.

import type { InputSnapshot, World } from '@/types';

/** Speed multiplier while a 'speed' pickup boost is active. */
const SPEED_BOOST_MULT = 1.6;

export function updateMovement(
  world: World,
  snapshots: InputSnapshot[],
  dt: number,
): void {
  const arena = world.arena;

  for (const player of world.players) {
    if (!player.alive) continue;

    player.prevPos.x = player.pos.x;
    player.prevPos.y = player.pos.y;

    // If a dash is active, that velocity overrides input — feels punchy and
    // commits the player to the line they chose at trigger time.
    const dash = player.ability.dashVel;
    let vx: number;
    let vy: number;

    if (dash !== null && player.ability.phase === 'active') {
      vx = dash.x;
      vy = dash.y;
    } else if (player.effects.stunTimer > 0) {
      vx = 0;
      vy = 0;
    } else {
      const snap = snapshots[player.slot];
      if (!snap) {
        player.vel.x = 0;
        player.vel.y = 0;
        continue;
      }
      const speed =
        player.effects.speedBoostTimer > 0 ? player.speed * SPEED_BOOST_MULT : player.speed;
      vx = snap.axisX * speed;
      vy = snap.axisY * speed;
    }

    player.vel.x = vx;
    player.vel.y = vy;

    let nx = player.pos.x + vx * dt;
    let ny = player.pos.y + vy * dt;

    const minX = player.radius;
    const maxX = arena.cols - player.radius;
    const minY = player.radius;
    const maxY = arena.rows - player.radius;

    if (nx < minX) nx = minX;
    else if (nx > maxX) nx = maxX;
    if (ny < minY) ny = minY;
    else if (ny > maxY) ny = maxY;

    player.pos.x = nx;
    player.pos.y = ny;
  }
}
