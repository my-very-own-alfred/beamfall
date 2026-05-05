// Beamfall — keyboard input source.
// Tracks held keys and edge-triggered "just pressed" keys for a single frame.
// Uses `KeyboardEvent.code` so bindings are layout-independent (e.g. KeyW
// works the same on AZERTY as on QWERTY).

/**
 * Window-level keyboard state tracker.
 *
 * Lifecycle:
 *   const kb = new KeyboardSource();
 *   kb.attach();
 *   // each frame: read state, then call kb.clearEdges() after building snapshots
 *   kb.detach(); // on teardown
 */
export class KeyboardSource {
  private readonly down: Set<string> = new Set();
  private readonly justPressed: Set<string> = new Set();
  private attached = false;

  private readonly handleKeyDown = (e: KeyboardEvent): void => {
    // Ignore auto-repeat: only fire edge once per physical press.
    if (e.repeat) {
      this.down.add(e.code);
      return;
    }
    if (!this.down.has(e.code)) {
      this.justPressed.add(e.code);
    }
    this.down.add(e.code);
  };

  private readonly handleKeyUp = (e: KeyboardEvent): void => {
    this.down.delete(e.code);
  };

  // Item #5: when the window loses focus we miss keyup events for any
  // currently-held keys. Same when the tab is hidden. Treat both as
  // "release everything" to avoid stuck-key states on return.
  private readonly handleBlur = (): void => {
    this.releaseAll();
  };

  private readonly handleVisibility = (): void => {
    if (document.hidden) this.releaseAll();
  };

  /** Add the keydown/keyup/blur/visibility listeners to `window`. Idempotent. */
  attach(): void {
    if (this.attached) return;
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    window.addEventListener('blur', this.handleBlur);
    document.addEventListener('visibilitychange', this.handleVisibility);
    this.attached = true;
  }

  /** Remove the listeners and clear all state. Idempotent. */
  detach(): void {
    if (!this.attached) return;
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    window.removeEventListener('blur', this.handleBlur);
    document.removeEventListener('visibilitychange', this.handleVisibility);
    this.attached = false;
    this.down.clear();
    this.justPressed.clear();
  }

  /** True while the key is held. */
  isDown(code: string): boolean {
    return this.down.has(code);
  }

  /** True for exactly one frame after the key was first pressed. */
  wasPressed(code: string): boolean {
    return this.justPressed.has(code);
  }

  /** Clear edge-triggered state. Call once per frame after building snapshots. */
  clearEdges(): void {
    this.justPressed.clear();
  }

  /**
   * Drop all held/just-pressed state. Used on focus loss to avoid stuck keys
   * when keyup never fires (e.g. user alt-tabs while holding W).
   */
  releaseAll(): void {
    this.down.clear();
    this.justPressed.clear();
  }

  /**
   * Item #5: public alias of {@link releaseAll}. Exposed for integrators
   * (e.g. main.ts window-blur hook, scene transitions) that want a stable
   * documented name for "drop all input state right now".
   */
  flush(): void {
    this.releaseAll();
  }
}
