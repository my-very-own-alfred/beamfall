// Beamfall — Pickup entity factory.

import type { EntityId, Pickup, PickupKind, Vec2 } from '@/types';

export function createPickup(id: EntityId, pos: Vec2, kind: PickupKind): Pickup {
  return {
    id,
    pos: { x: pos.x, y: pos.y },
    kind,
  };
}
