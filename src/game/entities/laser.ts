// Beamfall — LaserSegment entity factory.

import type { Color, EntityId, LaserSegment, Vec2 } from '@/types';

/**
 * Build a fresh LaserSegment. prev endpoints are seeded equal to the current
 * endpoints so the first interpolated frame doesn't smear from the origin.
 * The laser scheduler is responsible for updating prev each tick.
 */
export function createLaser(
  id: EntityId,
  ownerColor: Color,
  segA: Vec2,
  segB: Vec2,
): LaserSegment {
  return {
    id,
    ownerColor,
    segA: { x: segA.x, y: segA.y },
    segB: { x: segB.x, y: segB.y },
    prevSegA: { x: segA.x, y: segA.y },
    prevSegB: { x: segB.x, y: segB.y },
    active: true,
  };
}
