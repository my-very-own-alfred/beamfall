// Beamfall — world renderer.
// Owns the Pixi Graphics for arena, nodes, lasers, and players. Each frame
// (except the static arena) is cleared and re-stroked from the latest world
// state, with prevPos -> pos interpolation driven by the loop's render alpha.
//
// This module also owns the cosmetic, render-scoped state:
//   - screen shake offset (applied to bg + glow layers, decayed here)
//   - particle system (death bursts, capture sparks, dash trail)
//   - ability-FX overlays (SHOCK ring, SNIPE line, GHOST halo, dash trail)
//   - per-player wasAlive cache for death-event detection
//   - per-node ownerColor cache for capture-event detection
//
// Convention: render reads world; render owns its own caches/buffers; gameplay
// systems set numeric trigger fields (world.shake, hitStopTimer) but never
// import from this module.

import { Graphics } from 'pixi.js';
import type { World, Color, Player, Vec2 } from '@/types';
import { COLOR_HEX } from '@/types';
import type { Stage } from './stage';
import { createParticles } from './particles';
import type { Particles } from './particles';
import { createAbilityFx, ghostBodyAlpha } from './abilityFx';
import type { AbilityFx } from './abilityFx';

/**
 * Per-frame renderer for the simulation world.
 * `render` is called once per animation frame; `alpha` is the interpolation
 * factor between the previous and current fixed-tick state, in [0, 1).
 */
export interface WorldRenderer {
  /** Render `world` for the current frame. `alpha` blends prevPos -> pos. */
  render(world: World, alpha: number): void;
  /** Free Graphics children and detach from the stage. */
  destroy(): void;
}

// ---------------------------------------------------------------------------
// Visual constants
// ---------------------------------------------------------------------------

/** Color for unowned laser nodes (mid-grey). */
const UNOWNED_NODE_COLOR = 0x666666;
/** Inner-border color for the arena (subtle blue-grey). */
const BORDER_COLOR = 0x1a2030;
/** Grid line color (very dim). */
const GRID_COLOR = 0x0c1018;
/** Grid line width in CSS pixels. */
const GRID_WIDTH = 1;
/** Arena inner border width in CSS pixels. */
const BORDER_WIDTH = 2;
/** Laser segment thickness in CSS pixels. */
const LASER_WIDTH = 6;
/** Laser core (inner bright line) thickness. */
const LASER_CORE_WIDTH = 2;
/** Node radius as fraction of cellSize. */
const NODE_RADIUS_FACTOR = 0.18;
/** Player highlight (inner) radius as fraction of player radius. */
const PLAYER_HIGHLIGHT_FACTOR = 0.45;
/** Exponential decay rate (1/sec) for screen-shake magnitude. */
const SHAKE_DECAY_RATE = 12;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Linear interpolation. */
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Resolve a Color brand to its hex value via the shared lookup. */
function colorHex(c: Color): number {
  return COLOR_HEX[c];
}

/**
 * Draw the static arena: dim grid + inner border. Called once at construction.
 * Drawing here is intentionally one-shot — re-stroking each frame would burn
 * fillrate on geometry that never changes.
 */
function drawArena(
  g: Graphics,
  cols: number,
  rows: number,
  cellSize: number,
  pxW: number,
  pxH: number,
): void {
  g.clear();

  // Vertical grid lines.
  for (let c = 0; c <= cols; c += 1) {
    const x = c * cellSize;
    g.moveTo(x, 0).lineTo(x, rows * cellSize);
  }
  // Horizontal grid lines.
  for (let r = 0; r <= rows; r += 1) {
    const y = r * cellSize;
    g.moveTo(0, y).lineTo(cols * cellSize, y);
  }
  g.stroke({ width: GRID_WIDTH, color: GRID_COLOR, alpha: 1 });

  // Inner border rectangle, sized to the arena (which may be smaller than the
  // viewport if the stage is bigger than cols*cellSize x rows*cellSize).
  g.rect(0, 0, pxW, pxH).stroke({ width: BORDER_WIDTH, color: BORDER_COLOR, alpha: 1 });
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a {@link WorldRenderer} that paints into the given stage.
 *
 * `arenaPxWidth` / `arenaPxHeight` define the arena's pixel footprint and are
 * used for the static background border. The arena geometry uses world cell
 * coordinates internally; conversion to pixels is `worldUnits * cellSize`.
 */
export function createWorldRenderer(
  stage: Stage,
  arenaPxWidth: number,
  arenaPxHeight: number,
): WorldRenderer {
  // --- Arena (static) -----------------------------------------------------
  const arenaGraphics = new Graphics();
  stage.bgLayer.addChild(arenaGraphics);
  let arenaDrawn = false;

  // --- Glow-layer graphics ------------------------------------------------
  const nodesGraphics = new Graphics();
  const lasersGraphics = new Graphics();
  // Per-player Graphics so we can later parameterize per-player effects
  // without repainting unrelated entities.
  const playersGraphics: Graphics[] = [];

  stage.glowLayer.addChild(nodesGraphics);
  // Lasers use additive blending so overlapping beams build to bright cores.
  // Pixi v8 blend modes are string-typed: assign on the Graphics instance.
  lasersGraphics.blendMode = 'add';
  stage.glowLayer.addChild(lasersGraphics);

  // --- Ability FX (drawn on glow layer so bloom kisses them) --------------
  const abilityFx: AbilityFx = createAbilityFx(stage.glowLayer);

  // --- Particles (fx layer; not bloomed, intentional — keeps them crisp)
  const particles: Particles = createParticles(stage.fxLayer);

  // --- Render-scoped event-detection caches -------------------------------
  // Per-player previous alive flag — used to fire death bursts on the
  // alive→dead transition.
  const wasAlive = new Map<number, boolean>();
  // Per-node previous owner — used to fire capture sparks on color change.
  const prevNodeOwner = new Map<number, Color | null>();

  // Last render timestamp for shake decay (render-scoped, not sim time).
  let lastRenderMs = performance.now();

  // Base layer offsets — captured so we restore them between shake frames.
  let baseBgX = stage.bgLayer.x;
  let baseBgY = stage.bgLayer.y;
  let baseGlowX = stage.glowLayer.x;
  let baseGlowY = stage.glowLayer.y;
  let baseFxX = stage.fxLayer.x;
  let baseFxY = stage.fxLayer.y;
  let basesCaptured = false;

  /** Lazily grow the players Graphics pool to match world.players.length. */
  const ensurePlayerGraphics = (count: number): void => {
    while (playersGraphics.length < count) {
      const g = new Graphics();
      stage.glowLayer.addChild(g);
      playersGraphics.push(g);
    }
  };

  /** Resolve a player's interpolated pixel-space position for this frame. */
  const playerPosPx = (player: Player, alpha: number, cellSize: number): Vec2 => ({
    x: lerp(player.prevPos.x, player.pos.x, alpha) * cellSize,
    y: lerp(player.prevPos.y, player.pos.y, alpha) * cellSize,
  });

  return {
    render(world: World, alpha: number): void {
      const { cellSize } = world.arena;

      // ----- Capture base layer offsets the first frame ------------------
      // We do this lazily because main.ts sets bg/glow offsets after
      // construction (arena centering).
      if (!basesCaptured) {
        baseBgX = stage.bgLayer.x;
        baseBgY = stage.bgLayer.y;
        baseGlowX = stage.glowLayer.x;
        baseGlowY = stage.glowLayer.y;
        baseFxX = stage.fxLayer.x;
        baseFxY = stage.fxLayer.y;
        basesCaptured = true;
      }

      // ----- Render-side timing for shake/particles ----------------------
      const nowMs = performance.now();
      const dtRender = Math.max(0, Math.min(0.1, (nowMs - lastRenderMs) / 1000));
      lastRenderMs = nowMs;

      // ----- Apply screen shake (and decay) ------------------------------
      // Shake is render-scoped: gameplay sets `world.shake` (px), render
      // reads/decays it. Cosmetic; uses Math.random() — not seeded.
      const shake = world.shake;
      if (shake > 0.05) {
        const ox = (Math.random() * 2 - 1) * shake;
        const oy = (Math.random() * 2 - 1) * shake;
        stage.bgLayer.position.set(baseBgX + ox, baseBgY + oy);
        stage.glowLayer.position.set(baseGlowX + ox, baseGlowY + oy);
        stage.fxLayer.position.set(baseFxX + ox, baseFxY + oy);
        world.shake = shake * Math.exp(-SHAKE_DECAY_RATE * dtRender);
      } else if (world.shake !== 0) {
        world.shake = 0;
        stage.bgLayer.position.set(baseBgX, baseBgY);
        stage.glowLayer.position.set(baseGlowX, baseGlowY);
        stage.fxLayer.position.set(baseFxX, baseFxY);
      }

      // ----- Arena (one-shot) -------------------------------------------
      if (!arenaDrawn) {
        drawArena(
          arenaGraphics,
          world.arena.cols,
          world.arena.rows,
          cellSize,
          arenaPxWidth,
          arenaPxHeight,
        );
        arenaDrawn = true;
      }

      // ----- Event detection: deaths + captures -------------------------
      for (const player of world.players) {
        const prev = wasAlive.get(player.slot);
        if (prev === true && !player.alive) {
          // Death: spawn a burst at the player's last interpolated position.
          const where = playerPosPx(player, 1, cellSize);
          particles.spawnDeathBurst(where, COLOR_HEX[player.color]);
        }
        wasAlive.set(player.slot, player.alive);
      }
      for (const node of world.nodes) {
        const prev = prevNodeOwner.get(node.id);
        if (prev !== node.ownerColor && node.ownerColor !== null) {
          // Capture: sparks in the new owner's color.
          particles.spawnCaptureSparks(
            { x: node.pos.x * cellSize, y: node.pos.y * cellSize },
            COLOR_HEX[node.ownerColor],
          );
        }
        prevNodeOwner.set(node.id, node.ownerColor);
      }

      // ----- Nodes ------------------------------------------------------
      nodesGraphics.clear();
      const nodeRadiusPx = cellSize * NODE_RADIUS_FACTOR;
      for (const node of world.nodes) {
        const x = node.pos.x * cellSize;
        const y = node.pos.y * cellSize;
        const fill =
          node.ownerColor === null ? UNOWNED_NODE_COLOR : colorHex(node.ownerColor);
        nodesGraphics.circle(x, y, nodeRadiusPx).fill({ color: fill, alpha: 1 });
      }

      // ----- Lasers (additive) ------------------------------------------
      lasersGraphics.clear();
      for (const laser of world.lasers) {
        if (!laser.active) continue;

        const ax = lerp(laser.prevSegA.x, laser.segA.x, alpha) * cellSize;
        const ay = lerp(laser.prevSegA.y, laser.segA.y, alpha) * cellSize;
        const bx = lerp(laser.prevSegB.x, laser.segB.x, alpha) * cellSize;
        const by = lerp(laser.prevSegB.y, laser.segB.y, alpha) * cellSize;
        const hex = colorHex(laser.ownerColor);

        // Outer (wide, translucent) pass — gives the bloom something to bite.
        lasersGraphics
          .moveTo(ax, ay)
          .lineTo(bx, by)
          .stroke({ width: LASER_WIDTH, color: hex, alpha: 0.7 });
        // Inner (narrow, hot) core pass.
        lasersGraphics
          .moveTo(ax, ay)
          .lineTo(bx, by)
          .stroke({ width: LASER_CORE_WIDTH, color: 0xffffff, alpha: 0.9 });
      }

      // ----- Players ----------------------------------------------------
      ensurePlayerGraphics(world.players.length);
      for (let i = 0; i < playersGraphics.length; i += 1) {
        const g = playersGraphics[i];
        if (g === undefined) continue;
        g.clear();

        const player = world.players[i];
        if (player === undefined) {
          // Slot has no player this frame — leave cleared & invisible.
          g.visible = false;
          continue;
        }

        if (!player.alive) {
          // Body hidden; death burst already spawned via event detection.
          g.visible = false;
          continue;
        }
        g.visible = true;

        const px = playerPosPx(player, alpha, cellSize);
        const radiusPx = player.radius * cellSize;
        const hex = colorHex(player.color);
        const bodyAlpha = ghostBodyAlpha(player, world);

        // Body.
        g.circle(px.x, px.y, radiusPx).fill({ color: hex, alpha: bodyAlpha });
        // Inner highlight — small white core for readability against bloom.
        g.circle(px.x, px.y, radiusPx * PLAYER_HIGHLIGHT_FACTOR).fill({
          color: 0xffffff,
          alpha: 0.85 * bodyAlpha,
        });

        // Per-frame dash trail spawn — particle system at the player's pos.
        if (
          player.ability.phase === 'active' &&
          (player.characterClass === 'smash' || player.characterClass === 'blade')
        ) {
          const trailColor =
            player.characterClass === 'blade' ? 0xffffaa : COLOR_HEX[player.color];
          particles.spawnDashTrail(px, trailColor);
        }
      }

      // ----- Ability FX overlays ---------------------------------------
      // Sample trail buffer first so dashes can read it on the same frame.
      abilityFx.sampleTrails(world, (p) => playerPosPx(p, alpha, cellSize));
      abilityFx.draw(world, (p) => playerPosPx(p, alpha, cellSize));

      // ----- Particles update + draw -----------------------------------
      particles.update(dtRender);
      particles.draw();
    },

    destroy(): void {
      arenaGraphics.destroy();
      nodesGraphics.destroy();
      lasersGraphics.destroy();
      for (const g of playersGraphics) g.destroy();
      playersGraphics.length = 0;
      abilityFx.destroy();
      particles.destroy();
      wasAlive.clear();
      prevNodeOwner.clear();
      // Restore base offsets so a subsequent renderer doesn't inherit shake.
      stage.bgLayer.position.set(baseBgX, baseBgY);
      stage.glowLayer.position.set(baseGlowX, baseGlowY);
      stage.fxLayer.position.set(baseFxX, baseFxY);
    },
  };
}
