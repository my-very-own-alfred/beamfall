// Beamfall — match-level rule helpers.

import type { Color, World } from '@/types';
import { MATCH_WIN_SCORE } from '@/types';

const ALL_COLORS: Color[] = ['red', 'blue', 'yellow', 'green'];

/**
 * Return the first color whose score has reached MATCH_WIN_SCORE, or null if
 * no color has hit the cap yet. Slot order ('red', 'blue', 'yellow', 'green')
 * is used as a deterministic tiebreaker if two colors hit the threshold on
 * the same scoring tick.
 */
export function getMatchWinner(world: World): Color | null {
  for (const c of ALL_COLORS) {
    if (world.scores[c] >= MATCH_WIN_SCORE) return c;
  }
  return null;
}

/**
 * Return the colors that have at least one bound player in the current match.
 * Useful for HUD rendering and match-end logic that should ignore unfilled
 * slots.
 */
export function getActiveColors(world: World): Color[] {
  const seen: Record<Color, boolean> = {
    red: false,
    blue: false,
    yellow: false,
    green: false,
  };
  for (const p of world.players) seen[p.color] = true;
  return ALL_COLORS.filter((c) => seen[c]);
}
