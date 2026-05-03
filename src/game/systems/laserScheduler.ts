// Beamfall — laser scheduler system.
// Rebuilds the active laser list each tick from owned nodes. Lasers are
// transient: they live exactly one tick before being regenerated.
//
// Patterns:
//   sweep        — single radial beam rotating CCW around the node.
//   rotate       — two opposing beams (pi-offset) rotating CCW; covers more.
//   pulse        — fixed-axis beam that toggles on/off on each half-period.
//                  Off-phase produces no segment (collision-safe gap).
//   segment-flip — horizontal vs. vertical beam, alternating each half-period.

import type { Color, EntityId, LaserPattern, LaserSegment, Vec2, World } from '@/types';

/** Phase advance per second by pattern (cycles/sec). */
const RATES: Record<LaserPattern, number> = {
  sweep: 0.4,
  rotate: 0.35,
  pulse: 0.6,
  'segment-flip': 0.5,
};

/** Beam half-length (radial patterns) or full-length (axis patterns). */
const SWEEP_LENGTH = 3;
const PULSE_LENGTH = 3.5;
const FLIP_LENGTH = 3;

const TWO_PI = Math.PI * 2;

let nextLaserId = 1;
function allocLaserId(): EntityId {
  return nextLaserId++ as EntityId;
}

function wrapPhase(p: number): number {
  let r = p % 1;
  if (r < 0) r += 1;
  return r;
}

function makeSeg(
  id: EntityId,
  ownerColor: Color,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  pax: number,
  pay: number,
  pbx: number,
  pby: number,
): LaserSegment {
  return {
    id,
    ownerColor,
    segA: { x: ax, y: ay },
    segB: { x: bx, y: by },
    prevSegA: { x: pax, y: pay },
    prevSegB: { x: pbx, y: pby },
    active: true,
  };
}

function buildSegments(
  origin: Vec2,
  ownerColor: Color,
  prevPhase: number,
  newPhase: number,
  pattern: LaserPattern,
): LaserSegment[] {
  switch (pattern) {
    case 'sweep': {
      const a = newPhase * TWO_PI;
      const pa = prevPhase * TWO_PI;
      return [
        makeSeg(
          allocLaserId(),
          ownerColor,
          origin.x,
          origin.y,
          origin.x + Math.cos(a) * SWEEP_LENGTH,
          origin.y + Math.sin(a) * SWEEP_LENGTH,
          origin.x,
          origin.y,
          origin.x + Math.cos(pa) * SWEEP_LENGTH,
          origin.y + Math.sin(pa) * SWEEP_LENGTH,
        ),
      ];
    }
    case 'rotate': {
      const a = newPhase * TWO_PI;
      const pa = prevPhase * TWO_PI;
      const segs: LaserSegment[] = [];
      for (const k of [0, 1] as const) {
        const off = k * Math.PI;
        segs.push(
          makeSeg(
            allocLaserId(),
            ownerColor,
            origin.x,
            origin.y,
            origin.x + Math.cos(a + off) * SWEEP_LENGTH,
            origin.y + Math.sin(a + off) * SWEEP_LENGTH,
            origin.x,
            origin.y,
            origin.x + Math.cos(pa + off) * SWEEP_LENGTH,
            origin.y + Math.sin(pa + off) * SWEEP_LENGTH,
          ),
        );
      }
      return segs;
    }
    case 'pulse': {
      // Beam on during [0, 0.5), off during [0.5, 1). Horizontal axis.
      if (newPhase >= 0.5) return [];
      return [
        makeSeg(
          allocLaserId(),
          ownerColor,
          origin.x - PULSE_LENGTH,
          origin.y,
          origin.x + PULSE_LENGTH,
          origin.y,
          origin.x - PULSE_LENGTH,
          origin.y,
          origin.x + PULSE_LENGTH,
          origin.y,
        ),
      ];
    }
    case 'segment-flip': {
      // Horizontal during [0, 0.5), vertical during [0.5, 1).
      if (newPhase < 0.5) {
        return [
          makeSeg(
            allocLaserId(),
            ownerColor,
            origin.x - FLIP_LENGTH,
            origin.y,
            origin.x + FLIP_LENGTH,
            origin.y,
            origin.x - FLIP_LENGTH,
            origin.y,
            origin.x + FLIP_LENGTH,
            origin.y,
          ),
        ];
      }
      return [
        makeSeg(
          allocLaserId(),
          ownerColor,
          origin.x,
          origin.y - FLIP_LENGTH,
          origin.x,
          origin.y + FLIP_LENGTH,
          origin.x,
          origin.y - FLIP_LENGTH,
          origin.x,
          origin.y + FLIP_LENGTH,
        ),
      ];
    }
  }
}

/**
 * Clear and repopulate world.lasers based on current node ownership. Called
 * once per tick during the 'playing' state.
 */
export function updateLaserScheduler(world: World, dt: number): void {
  world.lasers.length = 0;

  for (const node of world.nodes) {
    if (node.ownerColor === null) continue;

    const prevPhase = node.phase;
    const newPhase = wrapPhase(prevPhase + dt * RATES[node.pattern]);
    node.phase = newPhase;

    const segs = buildSegments(node.pos, node.ownerColor, prevPhase, newPhase, node.pattern);
    for (const s of segs) world.lasers.push(s);
  }
}
