// Beamfall — fixed-timestep game loop.
// Implements the Glenn Fiedler accumulator pattern: physics ticks at a fixed
// rate while rendering runs once per animation frame, with an interpolation
// alpha bridging the two.

import { TICK_DT } from '@/types';

/**
 * Options for {@link startLoop}. Each callback is invoked at a different
 * cadence — see field docs.
 */
export interface LoopOptions {
  /** Fixed simulation rate in Hz. Used to compute the fixed step delta. */
  tickHz: number;
  /** Called exactly once per rendered frame, before any ticks run. */
  onPollInputs: () => void;
  /** Called for each fixed-step that fits in the accumulator. `dt` is constant (1 / tickHz). */
  onTick: (dt: number) => void;
  /** Called exactly once per rendered frame, after ticks. `alpha` in [0, 1) is acc / dt. */
  onRender: (alpha: number) => void;
}

/** Maximum time we allow the accumulator to consume from a single frame.
 * Guards against the spiral-of-death after a tab pause / breakpoint. */
const MAX_FRAME_DELTA_SEC = 0.25;

/**
 * Start a fixed-timestep loop driven by `requestAnimationFrame`.
 *
 * The returned `stop()` cancels the pending animation frame and prevents any
 * further callbacks. Calling it more than once is a no-op.
 */
export function startLoop(opts: LoopOptions): { stop: () => void } {
  const dt = 1 / opts.tickHz;
  let acc = 0;
  let last = performance.now();
  let rafId = 0;
  let running = true;

  const frame = (): void => {
    if (!running) return;
    const now = performance.now();
    let frameDelta = (now - last) / 1000;
    last = now;
    if (frameDelta > MAX_FRAME_DELTA_SEC) frameDelta = MAX_FRAME_DELTA_SEC;
    acc += frameDelta;

    opts.onPollInputs();

    while (acc >= dt) {
      opts.onTick(dt);
      acc -= dt;
    }

    const alpha = acc / dt;
    opts.onRender(alpha);

    rafId = requestAnimationFrame(frame);
  };

  rafId = requestAnimationFrame(frame);

  return {
    stop: (): void => {
      if (!running) return;
      running = false;
      cancelAnimationFrame(rafId);
    },
  };
}

// Re-export TICK_DT consumers can use to sanity-check tickHz wiring.
export { TICK_DT };
