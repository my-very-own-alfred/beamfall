// Beamfall — cross 10x10 arena.
// 10 columns × 10 rows at cellSize 56 px. Four central laser nodes 1.5 cells
// from center forming a tight cross. Spawns at four edge midpoints
// (non-corner positions).

import type { Arena } from '@/types';

export function createCross10x10(): Arena {
  // Center of a 10x10 grid sits at (5,5). Cross arm offset = 1.5 cells.
  return {
    name: 'Crucible',
    tagline: 'Centerpiece chaos. The middle is a meatgrinder.',
    cols: 10,
    rows: 10,
    cellSize: 56,
    nodes: [
      { pos: { x: 5, y: 3.5 }, pattern: 'ring' },
      { pos: { x: 6.5, y: 5 }, pattern: 'pendulum' },
      { pos: { x: 5, y: 6.5 }, pattern: 'zigzag' },
      { pos: { x: 3.5, y: 5 }, pattern: 'sweep' },
    ],
    spawnPoints: [
      // Four edge midpoints, none at a corner (col 0/9, row 0/9 mid picks).
      { x: 0, y: 5 },
      { x: 9, y: 5 },
      { x: 5, y: 0 },
      { x: 5, y: 9 },
    ],
  };
}
