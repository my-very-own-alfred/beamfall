// Beamfall — MAZE arena. 18×12 grid with nodes positioned to create
// laser-corridors players must navigate. Ring + spiral nodes form rotating
// "doors" that open and close, forcing rhythm play.

import type { Arena } from '@/types';

export function createMaze18x12(): Arena {
  return {
    name: 'Maze',
    tagline: 'Laser corridors. Ring doors. 18×12 with 9 nodes — find the gaps.',
    cols: 18,
    rows: 12,
    cellSize: 56,
    nodes: [
      // Top row — ring doors
      { pos: { x: 4, y: 2 }, pattern: 'ring' },
      { pos: { x: 9, y: 2 }, pattern: 'star' },
      { pos: { x: 14, y: 2 }, pattern: 'ring' },
      // Middle — heavy coverage
      { pos: { x: 4, y: 6 }, pattern: 'cross-rotate' },
      { pos: { x: 9, y: 6 }, pattern: 'spiral' },
      { pos: { x: 14, y: 6 }, pattern: 'cross-rotate' },
      // Bottom — wave + sweeps
      { pos: { x: 4, y: 10 }, pattern: 'wave' },
      { pos: { x: 9, y: 10 }, pattern: 'sweep' },
      { pos: { x: 14, y: 10 }, pattern: 'wave' },
    ],
    spawnPoints: [
      { x: 1, y: 1 },
      { x: 17, y: 1 },
      { x: 1, y: 11 },
      { x: 17, y: 11 },
    ],
  };
}
