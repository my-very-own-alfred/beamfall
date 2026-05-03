// Beamfall — wide 12x6 arena.
// 12 columns × 6 rows at cellSize 56 px (12·56 = 672, fits in 1280 viewport).
// 6 laser nodes spread across two rows of three. Spawns at four corners.

import type { Arena } from '@/types';

export function createWide12x6(): Arena {
  return {
    name: 'Long Hall',
    tagline: 'Wide horizontal sprawl. Mind the flank.',
    cols: 12,
    rows: 6,
    cellSize: 56,
    nodes: [
      { pos: { x: 2, y: 2 }, pattern: 'sweep' },
      { pos: { x: 6, y: 2 }, pattern: 'rotate' },
      { pos: { x: 10, y: 2 }, pattern: 'ring' },
      { pos: { x: 2, y: 4 }, pattern: 'pulse' },
      { pos: { x: 6, y: 4 }, pattern: 'zigzag' },
      { pos: { x: 10, y: 4 }, pattern: 'pendulum' },
    ],
    spawnPoints: [
      { x: 1, y: 1 },
      { x: 11, y: 1 },
      { x: 1, y: 5 },
      { x: 11, y: 5 },
    ],
  };
}
