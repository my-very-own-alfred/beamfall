// Beamfall — MEGA arena. 20×14 grid, smaller cells, 8 nodes scattered.
// Designed for chaos: enough room to run, enough nodes to constantly contest.

import type { Arena } from '@/types';

export function createMega20x14(): Arena {
  return {
    name: 'Mega',
    tagline: 'Huge 20×14 arena. 8 nodes. Mixed patterns. Pure chaos.',
    cols: 20,
    rows: 14,
    cellSize: 48, // 20×48=960, 14×48=672 — fits 1280×720 with margin
    nodes: [
      { pos: { x: 4, y: 3 }, pattern: 'sweep' },
      { pos: { x: 16, y: 3 }, pattern: 'rotate' },
      { pos: { x: 10, y: 5 }, pattern: 'cross-rotate' },
      { pos: { x: 6, y: 8 }, pattern: 'wave' },
      { pos: { x: 14, y: 8 }, pattern: 'spiral' },
      { pos: { x: 10, y: 10 }, pattern: 'star' },
      { pos: { x: 4, y: 11 }, pattern: 'pendulum' },
      { pos: { x: 16, y: 11 }, pattern: 'zigzag' },
    ],
    spawnPoints: [
      { x: 1, y: 1 },
      { x: 19, y: 1 },
      { x: 1, y: 13 },
      { x: 19, y: 13 },
    ],
  };
}
