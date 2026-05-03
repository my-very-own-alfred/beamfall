// Beamfall — world renderer.
// Owns the Pixi Graphics for arena, nodes, lasers, and players. Each frame
// (except the static arena) is cleared and re-stroked from the latest world
// state, with prevPos -> pos interpolation driven by the loop's render alpha.

import { Graphics } from 'pixi.js';
import type { World, Color, Vec2 } from '@/types';
import { COLOR_HEX } from '@/types';
import type { Stage } from './stage';

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

  /** Lazily grow the players Graphics pool to match world.players.length. */
  const ensurePlayerGraphics = (count: number): void => {
    while (playersGraphics.length < count) {
      const g = new Graphics();
      stage.glowLayer.addChild(g);
      playersGraphics.push(g);
    }
  };

  return {
    render(world: World, alpha: number): void {
      const { cellSize } = world.arena;

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
          // MVP: hide dead players. Particle burst is a future enhancement.
          g.visible = false;
          continue;
        }
        g.visible = true;

        const px: Vec2 = {
          x: lerp(player.prevPos.x, player.pos.x, alpha) * cellSize,
          y: lerp(player.prevPos.y, player.pos.y, alpha) * cellSize,
        };
        const radiusPx = player.radius * cellSize;
        const hex = colorHex(player.color);

        // Body.
        g.circle(px.x, px.y, radiusPx).fill({ color: hex, alpha: 1 });
        // Inner highlight — small white core for readability against bloom.
        g.circle(px.x, px.y, radiusPx * PLAYER_HIGHLIGHT_FACTOR).fill({
          color: 0xffffff,
          alpha: 0.85,
        });
      }
    },

    destroy(): void {
      arenaGraphics.destroy();
      nodesGraphics.destroy();
      lasersGraphics.destroy();
      for (const g of playersGraphics) g.destroy();
      playersGraphics.length = 0;
    },
  };
}
