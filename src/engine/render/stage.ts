// Beamfall — Pixi stage wrapper.
// Owns the Application + the four rendering layers (bg / glow / fx / hud).
// Bloom is applied to the glow layer only so the HUD and arena grid stay crisp.

import { Application, Container } from 'pixi.js';
import { createBloomFilter } from './bloom';

/**
 * Public handle on the Pixi application + its layered scene graph.
 *
 * Layer ordering (back to front):
 *   1. bgLayer   — static arena geometry (grid, border). No bloom.
 *   2. glowLayer — lasers, players, pickups, nodes. Bloom applied.
 *   3. fxLayer   — particles, hit flashes; also the screen-shake target.
 *   4. hudLayer  — UI text, scoreboards, debug overlays. No bloom.
 */
export interface Stage {
  /** Initialized Pixi Application. `app.canvas` is already attached to the parent. */
  app: Application;
  /** Background layer — arena grid, no bloom. */
  bgLayer: Container;
  /** Glow layer — lasers/players/pickups; bloom filter applied here. */
  glowLayer: Container;
  /** Effects layer — particles & screen-shake target. */
  fxLayer: Container;
  /** HUD layer — text and UI on top of everything, no bloom. */
  hudLayer: Container;
  /** Resize the renderer's drawing buffer to the given CSS pixel size. */
  resize(width: number, height: number): void;
  /** Tear down the Pixi app and detach its canvas. */
  destroy(): void;
}

/**
 * Create and initialize a {@link Stage}.
 *
 * Pixi v8 quirk: `new Application()` is synchronous but yields an
 * uninitialized object; `app.init(...)` is async and must be awaited before
 * any other API (renderer, canvas, stage) is touched.
 */
export async function createStage(
  parent: HTMLElement,
  width: number,
  height: number,
): Promise<Stage> {
  const app = new Application();
  await app.init({
    background: 0x000000,
    width,
    height,
    antialias: true,
    resolution: window.devicePixelRatio || 1,
    autoDensity: true,
  });

  parent.appendChild(app.canvas);

  const bgLayer = new Container();
  const glowLayer = new Container();
  const fxLayer = new Container();
  const hudLayer = new Container();

  // Bloom is filter-on-container in v8: assigned via the `filters` array.
  // We instantiate the filter once; pixi-filters handles per-frame uniforms.
  glowLayer.filters = [createBloomFilter()];

  // Add in z-order: bg < glow < fx < hud.
  app.stage.addChild(bgLayer);
  app.stage.addChild(glowLayer);
  app.stage.addChild(fxLayer);
  app.stage.addChild(hudLayer);

  return {
    app,
    bgLayer,
    glowLayer,
    fxLayer,
    hudLayer,
    resize(w: number, h: number): void {
      app.renderer.resize(w, h);
    },
    destroy(): void {
      // `removeView` detaches the canvas; child containers are destroyed with the stage.
      app.destroy(
        { removeView: true },
        { children: true, texture: false, textureSource: false },
      );
    },
  };
}
