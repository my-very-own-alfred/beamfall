// Beamfall — tall 6x10 arena.
// 6 columns × 10 rows at cellSize 56 px (10·56 = 560, fits in 720 viewport).
// 6 laser nodes in two columns. Pattern mix favors vertical play
// (pulse / segment-flip / pendulum).

import type { Arena } from '@/types';

export function createTall6x10(): Arena {
  return {
    name: 'Spire',
    tagline: 'Tight vertical channel. Time the gaps.',
    cols: 6,
    rows: 10,
    cellSize: 56,
    nodes: [
      { pos: { x: 2, y: 2 }, pattern: 'pulse' },
      { pos: { x: 4, y: 2 }, pattern: 'segment-flip' },
      { pos: { x: 2, y: 5 }, pattern: 'pendulum' },
      { pos: { x: 4, y: 5 }, pattern: 'pulse' },
      { pos: { x: 2, y: 8 }, pattern: 'segment-flip' },
      { pos: { x: 4, y: 8 }, pattern: 'pendulum' },
    ],
    spawnPoints: [
      { x: 1, y: 1 },
      { x: 5, y: 1 },
      { x: 1, y: 9 },
      { x: 5, y: 9 },
    ],
  };
}
