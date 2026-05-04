// Beamfall — COLOSSEUM arena. Enormous 24×14 with 10 nodes in a roughly
// circular layout around a central "arena" of dense patterns. Spawns at the
// four cardinal edges (not corners) so players collide in the middle.

import type { Arena } from '@/types';

export function createColosseum24x14(): Arena {
  return {
    name: 'Colosseum',
    tagline: 'Massive 24×14 ring of nodes. Center is a meat grinder.',
    cols: 24,
    rows: 14,
    cellSize: 44, // 24×44=1056, 14×44=616 — comfortably fits viewport
    nodes: [
      // Outer ring
      { pos: { x: 6, y: 3 }, pattern: 'sweep' },
      { pos: { x: 12, y: 2 }, pattern: 'star' },
      { pos: { x: 18, y: 3 }, pattern: 'rotate' },
      { pos: { x: 4, y: 7 }, pattern: 'wave' },
      { pos: { x: 20, y: 7 }, pattern: 'wave' },
      { pos: { x: 6, y: 11 }, pattern: 'pendulum' },
      { pos: { x: 12, y: 12 }, pattern: 'zigzag' },
      { pos: { x: 18, y: 11 }, pattern: 'pendulum' },
      // Center — dense coverage
      { pos: { x: 10, y: 7 }, pattern: 'cross-rotate' },
      { pos: { x: 14, y: 7 }, pattern: 'spiral' },
    ],
    spawnPoints: [
      { x: 1, y: 7 }, // left edge
      { x: 23, y: 7 }, // right edge
      { x: 12, y: 1 }, // top edge
      { x: 12, y: 13 }, // bottom edge
    ],
  };
}
