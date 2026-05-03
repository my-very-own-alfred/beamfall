// Beamfall — lightweight particle system.
// Pixi-Graphics-based, stroke-only — no sprite assets exist at v0.2. Each
// frame we clear and redraw a single Graphics holding every live particle.
// This is purely cosmetic: particles do not feed into the simulation, so
// spawn calls may use Math.random() (no seeded RNG required).
//
// Lives in the render/fx layer; gameplay never imports this module.

import { Graphics } from 'pixi.js';
import type { Vec2 } from '@/types';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number; // seconds remaining
  maxLife: number;
  color: number;
  size: number; // CSS pixels
}

export interface Particles {
  /** Step every particle forward by `dt` seconds. */
  update(dt: number): void;
  /** Re-stroke the cached Graphics from the current particle list. */
  draw(): void;
  /** 12-particle radial burst — death feedback. */
  spawnDeathBurst(pos: Vec2, color: number): void;
  /** 6-particle short burst — node-capture feedback. */
  spawnCaptureSparks(pos: Vec2, color: number): void;
  /** 2 particles — call once per render frame during an active dash. */
  spawnDashTrail(pos: Vec2, color: number): void;
  /** Drop everything (used between matches). */
  reset(): void;
  /** Tear down owned Graphics. */
  destroy(): void;
}

/** Hard cap on simultaneous particles. Old ones drop first when over. */
const MAX_PARTICLES = 200;

/** Shared scaler so spawn calls below can be pixel-tuned in one place. */
const PIXEL_SCALE = 1;

/**
 * Create a particle system attached to the given Pixi container (typically
 * `stage.fxLayer`). The renderer is responsible for calling `update()` and
 * `draw()` once per frame, and any of the spawn methods on demand.
 *
 * `cellSize` converts world-cell positions to pixels for spawn calls — the
 * caller passes pixel-space positions directly, so no unit conversion happens
 * inside this module.
 */
export function createParticles(parent: { addChild(g: Graphics): Graphics }): Particles {
  const graphics = new Graphics();
  parent.addChild(graphics);

  const particles: Particle[] = [];

  const push = (p: Particle): void => {
    if (particles.length >= MAX_PARTICLES) {
      // Drop oldest — array order is insertion order.
      particles.shift();
    }
    particles.push(p);
  };

  return {
    update(dt: number): void {
      // Iterate backwards so we can splice without skipping indices.
      for (let i = particles.length - 1; i >= 0; i -= 1) {
        const p = particles[i]!;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.life -= dt;
        if (p.life <= 0) {
          particles.splice(i, 1);
        }
      }
    },

    draw(): void {
      graphics.clear();
      for (const p of particles) {
        const a = Math.max(0, Math.min(1, p.life / p.maxLife));
        graphics.circle(p.x, p.y, p.size).fill({ color: p.color, alpha: a });
      }
    },

    spawnDeathBurst(pos: Vec2, color: number): void {
      const N = 12;
      for (let i = 0; i < N; i += 1) {
        const angle = (i / N) * Math.PI * 2 + Math.random() * 0.3;
        const speed = (90 + Math.random() * 70) * PIXEL_SCALE;
        push({
          x: pos.x,
          y: pos.y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life: 0.5 + Math.random() * 0.2,
          maxLife: 0.7,
          color,
          size: 2.5 + Math.random() * 1.5,
        });
      }
    },

    spawnCaptureSparks(pos: Vec2, color: number): void {
      const N = 6;
      for (let i = 0; i < N; i += 1) {
        const angle = Math.random() * Math.PI * 2;
        const speed = (50 + Math.random() * 50) * PIXEL_SCALE;
        push({
          x: pos.x,
          y: pos.y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life: 0.25 + Math.random() * 0.1,
          maxLife: 0.35,
          color,
          size: 1.5 + Math.random() * 1.0,
        });
      }
    },

    spawnDashTrail(pos: Vec2, color: number): void {
      for (let i = 0; i < 2; i += 1) {
        const jitter = (Math.random() - 0.5) * 6;
        push({
          x: pos.x + jitter,
          y: pos.y + jitter,
          vx: (Math.random() - 0.5) * 30,
          vy: (Math.random() - 0.5) * 30,
          life: 0.2 + Math.random() * 0.1,
          maxLife: 0.3,
          color,
          size: 2 + Math.random() * 1.2,
        });
      }
    },

    reset(): void {
      particles.length = 0;
      graphics.clear();
    },

    destroy(): void {
      particles.length = 0;
      graphics.destroy();
    },
  };
}
