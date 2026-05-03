// Beamfall — bloom filter factory.
// Centralizes bloom configuration so the neon look is tuned in one place.

import type { Filter } from 'pixi.js';
import { AdvancedBloomFilter } from 'pixi-filters';

/**
 * Default bloom parameters tuned for neon-on-black look.
 *
 * - `threshold` (0..1): luminance below which pixels are not bloomed.
 * - `bloomScale`: multiplier on the extracted bright pass.
 * - `brightness`: post-blur brightness multiplier.
 * - `blur`: gaussian blur radius in pixels per pass.
 * - `quality`: number of blur passes (higher = smoother, costlier).
 */
const DEFAULT_BLOOM = {
  threshold: 0.3,
  bloomScale: 1.4,
  brightness: 1.0,
  blur: 8,
  quality: 4,
} as const;

/**
 * Create the engine's standard bloom filter.
 *
 * Returned as the structural `Filter` type so callers (notably stage.ts) can
 * drop it directly into `container.filters` without a concrete import.
 */
export function createBloomFilter(): Filter {
  return new AdvancedBloomFilter({
    threshold: DEFAULT_BLOOM.threshold,
    bloomScale: DEFAULT_BLOOM.bloomScale,
    brightness: DEFAULT_BLOOM.brightness,
    blur: DEFAULT_BLOOM.blur,
    quality: DEFAULT_BLOOM.quality,
  });
}
