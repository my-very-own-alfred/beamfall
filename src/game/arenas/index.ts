// Beamfall — arena registry.
// Single source of truth for selectable arenas. Add a new arena by:
//   1. Implementing `create<Name>(): Arena` in its own file under this dir.
//   2. Registering it in ARENAS and ARENA_ORDER below.
// The lobby cycles through ARENA_ORDER; createWorld accepts an ArenaId.

import type { Arena } from '@/types';
import { createGrid8x6 } from './grid8x6';
import { createWide12x6 } from './wide12x6';
import { createTall6x10 } from './tall6x10';
import { createCross10x10 } from './cross10x10';
import { createMega20x14 } from './mega20x14';
import { createMaze18x12 } from './maze18x12';
import { createColosseum24x14 } from './colosseum24x14';

export type ArenaId =
  | 'grid8x6'
  | 'wide12x6'
  | 'tall6x10'
  | 'cross10x10'
  | 'mega20x14'
  | 'maze18x12'
  | 'colosseum24x14';

export const ARENAS: Record<ArenaId, () => Arena> = {
  grid8x6: createGrid8x6,
  wide12x6: createWide12x6,
  tall6x10: createTall6x10,
  cross10x10: createCross10x10,
  mega20x14: createMega20x14,
  maze18x12: createMaze18x12,
  colosseum24x14: createColosseum24x14,
};

export const ARENA_ORDER: readonly ArenaId[] = [
  'grid8x6',
  'wide12x6',
  'tall6x10',
  'cross10x10',
  'mega20x14',
  'maze18x12',
  'colosseum24x14',
] as const;

export const DEFAULT_ARENA_ID: ArenaId = 'mega20x14';
