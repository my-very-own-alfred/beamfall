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

  /** Add the keydown/keyup listeners to `window`. Idempotent. */
  attach(): void {
    if (this.attached) return;
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    this.attached = true;
  }

  /** Remove the listeners and clear all state. Idempotent. */
  detach(): void {
    if (!this.attached) return;
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
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
}
