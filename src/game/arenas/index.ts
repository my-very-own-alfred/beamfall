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

export type ArenaId = 'grid8x6' | 'wide12x6' | 'tall6x10' | 'cross10x10';

export const ARENAS: Record<ArenaId, () => Arena> = {
  grid8x6: createGrid8x6,
  wide12x6: createWide12x6,
  tall6x10: createTall6x10,
  cross10x10: createCross10x10,
};

export const ARENA_ORDER: readonly ArenaId[] = [
  'grid8x6',
  'wide12x6',
  'tall6x10',
  'cross10x10',
] as const;

export const DEFAULT_ARENA_ID: ArenaId = 'grid8x6';
