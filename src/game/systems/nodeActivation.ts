// Beamfall — node activation system.
// Rule: any alive player overlapping a node claims it for their color.
// No button press required; stepping on the node is enough.

import type { Player, World } from '@/types';

/**
 * Standard laser node interaction radius in cell units. Combined with the
 * player's own radius this yields the overlap threshold.
 */
const NODE_RADIUS = 0.5;

/**
 * Walk every alive player against every node and reassign ownership on
 * overlap. When multiple players overlap the same node on the same tick the
 * winner is the closest to the node center (squared distance). Exact ties
 * fall back to a deterministic coin-flip via world.rng — never Math.random,
 * so replays with the same seed reproduce identically.
 *
 * Capture stat / event are credited only on color change so a player parked
 * on top of an already-owned node doesn't spam the counter.
 */
export function updateNodeActivation(world: World): void {
  for (const node of world.nodes) {
    let winner: Player | null = null;
    let winnerDist2 = Infinity;

    for (const player of world.players) {
      if (!player.alive) continue;

      const dx = player.pos.x - node.pos.x;
      const dy = player.pos.y - node.pos.y;
      const threshold = NODE_RADIUS + player.radius;
      const dist2 = dx * dx + dy * dy;

      if (dist2 > threshold * threshold) continue;

      if (winner === null || dist2 < winnerDist2) {
        winner = player;
        winnerDist2 = dist2;
      } else if (dist2 === winnerDist2) {
        // Item #6: deterministic tiebreak using the world RNG. One draw per
        // tie keeps replays reproducible given the same seed.
        if (world.rng() < 0.5) {
          winner = player;
          winnerDist2 = dist2;
        }
      }
    }

    if (winner !== null) {
      if (node.ownerColor !== winner.color) {
        winner.stats.captures += 1;
        world.events.push({ kind: 'capture' });
      }
      node.ownerColor = winner.color;
    }
  }
}
