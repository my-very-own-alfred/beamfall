// Beamfall — debug overlay.
// Tiny FPS / tickrate / state readout pinned to the top-left of the HUD layer.

import { Text } from 'pixi.js';
import type { Stage } from './stage';

/**
 * Live debug overlay handle. Owners call {@link DebugOverlay.update} once per
 * rendered frame with the latest sampled metrics; the overlay reflows its
 * single Text node in place.
 */
export interface DebugOverlay {
  /** Update the displayed FPS / tick rate / game state string. */
  update(fps: number, tickRate: number, gameState: string): void;
  /** Remove the Text node from the stage and free GPU resources. */
  destroy(): void;
}

/** Pixel padding from the top-left of the HUD layer. */
const HUD_PADDING = 8;

/**
 * Create the debug overlay and attach it to `stage.hudLayer`.
 *
 * Pixi v8 quirk: `Text` takes a single options object — the v7 positional
 * `new Text(text, style)` form is gone.
 */
export function createDebugOverlay(stage: Stage): DebugOverlay {
  const text = new Text({
    text: 'FPS: -- | Tick: -- | State: --',
    style: {
      fill: 0xffffff,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      fontSize: 14,
      fontWeight: '500',
      align: 'left',
    },
  });
  text.x = HUD_PADDING;
  text.y = HUD_PADDING;

  stage.hudLayer.addChild(text);

  return {
    update(fps: number, tickRate: number, gameState: string): void {
      // Round FPS for stability; tick rate is usually a fixed constant.
      text.text = `FPS: ${Math.round(fps)} | Tick: ${Math.round(tickRate)} | State: ${gameState}`;
    },
    destroy(): void {
      text.destroy();
    },
  };
}
