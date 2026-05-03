// Beamfall — default 8x6 grid arena.
// Four laser nodes in a rectangle, four corner spawn points (one per slot).
// Node patterns are mixed to showcase the variety in v0.2.

import type { Arena } from '@/types';

export function createGrid8x6(): Arena {
  return {
    name: 'Grid',
    tagline: 'The classic 8×6 starter. All four legacy patterns.',
    cols: 8,
    rows: 6,
    cellSize: 64,
    nodes: [
      { pos: { x: 2, y: 1.5 }, pattern: 'sweep' },
      { pos: { x: 6, y: 1.5 }, pattern: 'rotate' },
      { pos: { x: 2, y: 4.5 }, pattern: 'pulse' },
      { pos: { x: 6, y: 4.5 }, pattern: 'segment-flip' },
    ],
    spawnPoints: [
      { x: 1, y: 1 },
      { x: 7, y: 1 },
      { x: 1, y: 5 },
      { x: 7, y: 5 },
    ],
  };
}
