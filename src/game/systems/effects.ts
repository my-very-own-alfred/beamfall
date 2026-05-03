// Beamfall — per-player effects ticker.
// Handles stun, speed boost, pickup invincibility, and knockback decay.
// Pure: mutates only `world.players[i].effects` and `.pos` for knockback.
//
// Run order: BEFORE movement, so movement reads up-to-date stun/boost flags
// and applies the residual knockback velocity for the tick.

import type { World } from '@/types';

/**
 * Decay knockback this fast (1/sec). At 6.0 a knockback halves every ~0.12s.
 * Tuned so SMASH shoves feel punchy but don't fling enemies forever.
 */
const KNOCKBACK_DECAY = 6.0;

/** Tick down all transient effects and apply knockback drift. */
export function updateEffects(world: World, dt: number): void {
  for (const player of world.players) {
    if (!player.alive) continue;

    const e = player.effects;

    if (e.stunTimer > 0) e.stunTimer = Math.max(0, e.stunTimer - dt);
    if (e.speedBoostTimer > 0) e.speedBoostTimer = Math.max(0, e.speedBoostTimer - dt);
    if (e.invincibleTimer > 0) e.invincibleTimer = Math.max(0, e.invincibleTimer - dt);

    // Knockback: integrate, then exponential decay.
    if (e.knockback.x !== 0 || e.knockback.y !== 0) {
      const arena = world.arena;
      const minX = player.radius;
      const maxX = arena.cols - player.radius;
      const minY = player.radius;
      const maxY = arena.rows - player.radius;

      let nx = player.pos.x + e.knockback.x * dt;
      let ny = player.pos.y + e.knockback.y * dt;
      if (nx < minX) nx = minX;
      else if (nx > maxX) nx = maxX;
      if (ny < minY) ny = minY;
      else if (ny > maxY) ny = maxY;
      player.pos.x = nx;
      player.pos.y = ny;

      // Exponential decay: v *= exp(-k*dt). Guarded against tiny residuals.
      const decay = Math.exp(-KNOCKBACK_DECAY * dt);
      e.knockback.x *= decay;
      e.knockback.y *= decay;
      if (Math.abs(e.knockback.x) < 0.05) e.knockback.x = 0;
      if (Math.abs(e.knockback.y) < 0.05) e.knockback.y = 0;
    }
  }
}
