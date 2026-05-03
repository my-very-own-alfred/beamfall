// Beamfall — LaserNode entity factory.

import type { EntityId, LaserNode, LaserPattern, Vec2 } from '@/types';

/**
 * Build a LaserNode at the given position. Defaults to the 'sweep' pattern.
 * ownerColor is null until a player steps on the node.
 */
export function createNode(
  id: EntityId,
  pos: Vec2,
  pattern: LaserPattern = 'sweep',
): LaserNode {
  return {
    id,
    pos: { x: pos.x, y: pos.y },
    ownerColor: null,
    pattern,
    phase: 0,
    flashTimer: 0,
  };
}
