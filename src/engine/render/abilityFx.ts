// Beamfall — ability visual feedback.
// Pure render-side: reads world state (player.ability, node.flashTimer) and
// strokes overlays on the glow layer. Owns its own Graphics and ring buffers
// for trails — these are NOT part of World, since they're cosmetic and
// per-renderer.
//
// Trail policy: the renderer feeds prevPos samples into a per-player ring
// buffer once per render frame. Trails fade over the buffer length. SMASH
// uses the player's color; BLADE uses a hot white-yellow gradient. Both are
// only drawn during the dash's `active` phase.

import { Graphics } from 'pixi.js';
import type { Player, Vec2, World } from '@/types';
import { COLOR_HEX } from '@/types';
import { CHARACTER_SPECS } from '@/game/characters';

/** Number of samples held in each player's trail ring buffer. */
const TRAIL_SAMPLES = 6;

/** BLADE trail color — hot white-yellow regardless of caster color. */
const BLADE_TRAIL_COLOR = 0xffffaa;

/** GHOST alpha pulse limits and frequency. */
const GHOST_ALPHA_LO = 0.35;
const GHOST_ALPHA_HI = 0.85;
const GHOST_PULSE_HZ = 6;

/** SHOCK ring pulse frequency (visual ripple, fades with activeTimer). */
const SHOCK_RING_HZ = 4;

/** SNIPE armed line dash length and gap (in CSS px). */
const SNIPE_DASH = 10;
const SNIPE_GAP = 6;

/** Per-player visual-only state held by the renderer. */
interface PlayerFx {
  /** Pixel-space ring buffer of recent positions. Index 0 is most recent. */
  trail: Vec2[];
}

export interface AbilityFx {
  /**
   * Push a new sample onto each alive player's trail buffer (called once per
   * render frame from the world renderer, after positions are interpolated).
   */
  sampleTrails(world: World, posPx: (player: Player) => Vec2): void;
  /** Draw all ability overlays for the current frame. */
  draw(world: World, posPx: (player: Player) => Vec2): void;
  /** Drop trails — call between matches. */
  reset(): void;
  destroy(): void;
}

/**
 * Create an ability-FX renderer parented to the given container (typically
 * `stage.glowLayer` so it picks up bloom).
 */
export function createAbilityFx(parent: { addChild(g: Graphics): Graphics }): AbilityFx {
  const graphics = new Graphics();
  parent.addChild(graphics);

  const fxBySlot = new Map<number, PlayerFx>();

  const ensure = (slot: number): PlayerFx => {
    let fx = fxBySlot.get(slot);
    if (!fx) {
      fx = { trail: [] };
      fxBySlot.set(slot, fx);
    }
    return fx;
  };

  return {
    sampleTrails(world: World, posPx: (player: Player) => Vec2): void {
      for (const p of world.players) {
        const fx = ensure(p.slot);
        if (!p.alive) {
          fx.trail.length = 0;
          continue;
        }
        const px = posPx(p);
        fx.trail.unshift({ x: px.x, y: px.y });
        if (fx.trail.length > TRAIL_SAMPLES) fx.trail.length = TRAIL_SAMPLES;
      }
    },

    draw(world: World, posPx: (player: Player) => Vec2): void {
      const g = graphics;
      g.clear();
      const cellSize = world.arena.cellSize;
      const t = world.tickCount / 120; // approx seconds for visual oscillation

      // ---- THIEF capture flash on nodes -------------------------------------
      const nodeR = cellSize * 0.18;
      for (const node of world.nodes) {
        if (node.flashTimer <= 0) continue;
        const a = Math.min(1, node.flashTimer / 0.35);
        const x = node.pos.x * cellSize;
        const y = node.pos.y * cellSize;
        // Outer expanding white ring.
        g.circle(x, y, nodeR + (1 - a) * cellSize * 0.6).stroke({
          width: 2,
          color: 0xffffff,
          alpha: a * 0.9,
        });
        // Inner bright ring at the node radius.
        g.circle(x, y, nodeR + 4).stroke({
          width: 2,
          color: 0xffffff,
          alpha: a * 0.7,
        });
      }

      // ---- Per-player overlays ---------------------------------------------
      for (const p of world.players) {
        if (!p.alive) continue;
        const ab = p.ability;
        const here = posPx(p);
        const colorHex = COLOR_HEX[p.color];

        // SMASH / BLADE trails — drawn during 'active' phase.
        if (
          ab.phase === 'active' &&
          (p.characterClass === 'smash' || p.characterClass === 'blade')
        ) {
          const fx = ensure(p.slot);
          const trailColor = p.characterClass === 'blade' ? BLADE_TRAIL_COLOR : colorHex;
          for (let i = 0; i < fx.trail.length - 1; i += 1) {
            const a = fx.trail[i]!;
            const b = fx.trail[i + 1]!;
            const fade = 1 - i / TRAIL_SAMPLES;
            g.moveTo(a.x, a.y)
              .lineTo(b.x, b.y)
              .stroke({
                width: 6 * fade,
                color: trailColor,
                alpha: 0.55 * fade,
              });
          }
        }

        // SHOCK aura — pulsing radial ring while active.
        if (p.characterClass === 'shock' && ab.phase === 'active') {
          const spec = CHARACTER_SPECS.shock;
          const radiusPx = spec.params.radius! * cellSize;
          const lifeFrac = Math.max(0, ab.activeTimer / spec.activeDuration);
          // Two stacked rings, slightly out-of-phase.
          const pulse = 0.5 + 0.5 * Math.sin(t * Math.PI * 2 * SHOCK_RING_HZ);
          g.circle(here.x, here.y, radiusPx * (0.85 + 0.15 * pulse)).stroke({
            width: 3,
            color: colorHex,
            alpha: 0.55 * lifeFrac,
          });
          g.circle(here.x, here.y, radiusPx * (0.55 + 0.15 * (1 - pulse))).stroke({
            width: 2,
            color: 0xffffff,
            alpha: 0.4 * lifeFrac,
          });
        }

        // SNIPE armed: dashed line from caster to marker.
        if (p.characterClass === 'snipe' && ab.phase === 'armed' && ab.marker !== null) {
          const mx = ab.marker.x * cellSize;
          const my = ab.marker.y * cellSize;
          drawDashedLine(g, here.x, here.y, mx, my, SNIPE_DASH, SNIPE_GAP, colorHex, 0.75);
          // Marker pip.
          g.circle(mx, my, 6).stroke({ width: 2, color: colorHex, alpha: 0.9 });
        }

        // SNIPE active: bright fading ghost line over the active window.
        if (p.characterClass === 'snipe' && ab.phase === 'active') {
          const spec = CHARACTER_SPECS.snipe;
          const lifeFrac = Math.max(0, ab.activeTimer / spec.activeDuration);
          // The teleport already snapped pos to marker, so we draw from
          // prevPos -> pos to capture the line cut.
          const fromX = p.prevPos.x * cellSize;
          const fromY = p.prevPos.y * cellSize;
          g.moveTo(fromX, fromY)
            .lineTo(here.x, here.y)
            .stroke({ width: 4, color: 0xffffff, alpha: lifeFrac * 0.9 });
          g.moveTo(fromX, fromY)
            .lineTo(here.x, here.y)
            .stroke({ width: 12, color: colorHex, alpha: lifeFrac * 0.4 });
        }

        // GHOST — body alpha pulse handled by the world renderer (it owns
        // the body draw); here we add a faint translucent halo for clarity.
        if (p.characterClass === 'ghost' && ab.phase === 'active') {
          const radiusPx = p.radius * cellSize;
          const pulse = 0.5 + 0.5 * Math.sin(t * Math.PI * 2 * GHOST_PULSE_HZ);
          g.circle(here.x, here.y, radiusPx * 1.6).stroke({
            width: 2,
            color: 0xffffff,
            alpha: 0.2 + 0.4 * pulse,
          });
        }
      }
    },

    reset(): void {
      fxBySlot.clear();
      graphics.clear();
    },

    destroy(): void {
      fxBySlot.clear();
      graphics.destroy();
    },
  };
}

/**
 * Compute the ghost alpha multiplier for a player (1.0 if not GHOST/active).
 * Exported so the world renderer can use it on the player body draw.
 */
export function ghostBodyAlpha(player: Player, world: World): number {
  if (player.characterClass !== 'ghost') return 1;
  if (player.ability.phase !== 'active') return 1;
  const t = world.tickCount / 120;
  const pulse = 0.5 + 0.5 * Math.sin(t * Math.PI * 2 * GHOST_PULSE_HZ);
  return GHOST_ALPHA_LO + (GHOST_ALPHA_HI - GHOST_ALPHA_LO) * pulse;
}

/** Draw a dashed line A→B onto `g` with the given dash/gap lengths. */
function drawDashedLine(
  g: Graphics,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  dash: number,
  gap: number,
  color: number,
  alpha: number,
): void {
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy);
  if (len < 0.01) return;
  const ux = dx / len;
  const uy = dy / len;
  let consumed = 0;
  while (consumed < len) {
    const segLen = Math.min(dash, len - consumed);
    const sx = ax + ux * consumed;
    const sy = ay + uy * consumed;
    const ex = ax + ux * (consumed + segLen);
    const ey = ay + uy * (consumed + segLen);
    g.moveTo(sx, sy).lineTo(ex, ey).stroke({ width: 2, color, alpha });
    consumed += dash + gap;
  }
}
