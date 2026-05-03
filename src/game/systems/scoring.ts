// Beamfall — scoring / round-end detection.
// Pure check; never mutates state or scores. The world tick loop is
// responsible for state transitions and score updates based on the result.

import type { Color, World } from '@/types';

/**
 * Outcome of a round-end probe.
 */
export interface RoundResult {
  /** True if the round has terminated this tick. */
  ended: boolean;
  /** Winning color if a single team is the last standing or has a count
   *  lead at timer expiry. Null on tie / no points awarded. */
  winner: Color | null;
}

/**
 * Decide whether the round should end this tick and who (if anyone) wins.
 *
 * Rules:
 *   - If only one color has alive players left: that color wins immediately.
 *   - If zero alive players: round ends in a tie (no points).
 *   - Otherwise the round only ends when roundTimer reaches 0; at that point
 *     the color with the highest alive count wins. Ties at timeout = no points.
 */
export function checkRoundEnd(world: World): RoundResult {
  const counts: Record<Color, number> = { red: 0, blue: 0, yellow: 0, green: 0 };

  for (const player of world.players) {
    if (player.alive) counts[player.color]++;
  }

  const colorsWithAlive: Color[] = [];
  (Object.keys(counts) as Color[]).forEach((c) => {
    if (counts[c] > 0) colorsWithAlive.push(c);
  });

  if (colorsWithAlive.length === 0) {
    // Total wipe: the round ends with no winner.
    return { ended: true, winner: null };
  }

  if (colorsWithAlive.length === 1) {
    const winner = colorsWithAlive[0] as Color;
    return { ended: true, winner };
  }

  // Multiple colors still in play.
  if (world.roundTimer > 0) {
    return { ended: false, winner: null };
  }

  // Timer expired: highest alive count wins, ties = no points.
  let topCount = -1;
  let topColor: Color | null = null;
  let tied = false;

  for (const c of colorsWithAlive) {
    const n = counts[c];
    if (n > topCount) {
      topCount = n;
      topColor = c;
      tied = false;
    } else if (n === topCount) {
      tied = true;
    }
  }

  return { ended: true, winner: tied ? null : topColor };
}
