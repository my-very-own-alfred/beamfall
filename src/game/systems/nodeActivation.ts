// Beamfall — node activation system.
// MVP rule: any alive player overlapping a node claims it for their color.
// No button press required; stepping on the node is enough.

import type { World } from '@/types';

/**
 * Standard laser node interaction radius in cell units. Combined with the
 * player's own radius this yields the overlap threshold.
 */
const NODE_RADIUS = 0.5;

/**
 * Walk every alive player against every node and reassign ownership on
 * overlap. Last-writer-wins if two players touch the same node on the same
 * tick — acceptable for MVP, the 120 Hz cadence makes this near-instant.
 */
export function updateNodeActivation(world: World): void {
  for (const node of world.nodes) {
    for (const player of world.players) {
      if (!player.alive) continue;

      const dx = player.pos.x - node.pos.x;
      const dy = player.pos.y - node.pos.y;
      const threshold = NODE_RADIUS + player.radius;

      if (dx * dx + dy * dy <= threshold * threshold) {
        // Count a capture only on color change to avoid spamming the counter
        // every tick the player is parked on top of an already-owned node.
        if (node.ownerColor !== player.color) {
          player.stats.captures += 1;
          world.events.push({ kind: 'capture' });
        }
        node.ownerColor = player.color;
      }
    }
  }
}
