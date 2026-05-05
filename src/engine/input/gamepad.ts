// Beamfall — gamepad input source.
// Wraps the browser Gamepad API. Polls once per frame so axis/button reads
// during snapshot construction are consistent within a frame.

/** Radial deadzone applied to stick magnitude. Below this the stick reads 0. */
const STICK_DEADZONE = 0.15;

interface PadSnapshot {
  connected: boolean;
  id: string;
  axes: number[];
  buttons: boolean[];
}

type ConnectCallback = (index: number, id: string) => void;
type DisconnectCallback = (index: number) => void;

/**
 * Polled gamepad source. Call {@link poll} once per frame BEFORE reading
 * axis/button state for snapshots. Edge detection (`buttonPressed`) is
 * computed against the previous frame's snapshot.
 */
export class GamepadSource {
  private current: PadSnapshot[] = [];
  private prevButtons: boolean[][] = [];
  private connectCbs: ConnectCallback[] = [];
  private disconnectCbs: DisconnectCallback[] = [];
  private attached = false;
  // Item #5: when paused we skip polling entirely so current/prev stays frozen.
  private paused = false;

  private readonly handleConnected = (e: GamepadEvent): void => {
    for (const cb of this.connectCbs) cb(e.gamepad.index, e.gamepad.id);
  };

  private readonly handleDisconnected = (e: GamepadEvent): void => {
    // Item #7: clear internal state for the slot so a future reconnect at
    // the same index doesn't inherit stale axes/buttons.
    const idx = e.gamepad.index;
    const slot = this.current[idx];
    if (slot) {
      slot.connected = false;
      slot.id = '';
      for (let a = 0; a < slot.axes.length; a++) slot.axes[a] = 0;
      for (let b = 0; b < slot.buttons.length; b++) slot.buttons[b] = false;
    }
    const prev = this.prevButtons[idx];
    if (prev) {
      for (let b = 0; b < prev.length; b++) prev[b] = false;
    }
    for (const cb of this.disconnectCbs) cb(idx);
  };

  /** Attach `gamepadconnected` / `gamepaddisconnected` listeners. Idempotent. */
  attach(): void {
    if (this.attached) return;
    window.addEventListener('gamepadconnected', this.handleConnected);
    window.addEventListener('gamepaddisconnected', this.handleDisconnected);
    this.attached = true;
  }

  /** Remove listeners. Idempotent. */
  detach(): void {
    if (!this.attached) return;
    window.removeEventListener('gamepadconnected', this.handleConnected);
    window.removeEventListener('gamepaddisconnected', this.handleDisconnected);
    this.attached = false;
  }

  /** Snapshot current gamepad state. Must be called once per frame before reads. */
  poll(): void {
    // Item #5: when paused (window blurred / tab hidden) we want state to
    // stay frozen and produce no edges. Skip polling outright.
    if (this.paused) return;

    // Promote current.buttons to prevButtons for edge detection on this frame.
    this.prevButtons = this.current.map((p) => p.buttons.slice());

    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const next: PadSnapshot[] = [];

    for (let i = 0; i < pads.length; i++) {
      const gp = pads[i];
      if (!gp) {
        next[i] = { connected: false, id: '', axes: [], buttons: [] };
        continue;
      }
      const axes: number[] = [];
      for (let a = 0; a < gp.axes.length; a++) {
        const v = gp.axes[a];
        axes[a] = typeof v === 'number' ? v : 0;
      }
      const buttons: boolean[] = [];
      for (let b = 0; b < gp.buttons.length; b++) {
        const btn = gp.buttons[b];
        buttons[b] = btn ? btn.pressed : false;
      }
      next[i] = { connected: gp.connected, id: gp.id, axes, buttons };
    }
    this.current = next;
  }

  /** True if a gamepad is reported connected at this index. */
  isConnected(index: number): boolean {
    const pad = this.current[index];
    return pad ? pad.connected : false;
  }

  /**
   * Read an axis with radial deadzone applied to the (axis, axis+1) stick pair.
   *
   * For a left stick (axes 0, 1) we treat them as a 2D vector and apply a
   * radial deadzone: if magnitude < 0.15, return 0; otherwise renormalize so
   * the dead band is invisible to consumers.
   *
   * For odd axes (e.g. axis 1 = LY) we still use the (axis-1, axis) pair so
   * both components share the same deadzone treatment.
   */
  axis(index: number, axis: number): number {
    const pad = this.current[index];
    if (!pad || !pad.connected) return 0;

    // Determine paired axis: even axes pair with axis+1, odd with axis-1.
    const isEven = axis % 2 === 0;
    const otherAxis = isEven ? axis + 1 : axis - 1;
    const xRaw = pad.axes[axis];
    const yRaw = pad.axes[otherAxis];
    const x = typeof xRaw === 'number' ? xRaw : 0;
    const y = typeof yRaw === 'number' ? yRaw : 0;

    const mag = Math.sqrt(x * x + y * y);
    if (mag < STICK_DEADZONE) return 0;
    const scaled = (mag - STICK_DEADZONE) / (1 - STICK_DEADZONE);
    // Clamp at 1 to guard against magnitudes >1 reported by some drivers.
    const clamped = scaled > 1 ? 1 : scaled;
    return (x / mag) * clamped;
  }

  /** True while the button is held this frame. */
  button(index: number, btn: number): boolean {
    const pad = this.current[index];
    if (!pad) return false;
    const v = pad.buttons[btn];
    return v ?? false;
  }

  /** True for exactly one frame on the rising edge of the button. */
  buttonPressed(index: number, btn: number): boolean {
    const pad = this.current[index];
    if (!pad) return false;
    const cur = pad.buttons[btn] ?? false;
    const prev = this.prevButtons[index]?.[btn] ?? false;
    return cur && !prev;
  }

  /** Register a callback fired when a gamepad is connected. */
  onConnect(cb: (index: number, id: string) => void): void {
    this.connectCbs.push(cb);
  }

  /** Register a callback fired when a gamepad is disconnected. */
  onDisconnect(cb: (index: number) => void): void {
    this.disconnectCbs.push(cb);
  }

  /**
   * Item #5: freeze input snapshotting. While paused, {@link poll} is a no-op
   * so neither held nor edge state changes. Idempotent.
   */
  pause(): void {
    this.paused = true;
  }

  /**
   * Item #5: resume polling after a pause. Forces "all released" on current
   * and prev so the first post-resume `poll()` cannot synthesize a fake
   * rising edge from a button that was held while the tab was inactive.
   * Idempotent.
   */
  resume(): void {
    this.paused = false;
    for (const pad of this.current) {
      for (let b = 0; b < pad.buttons.length; b++) pad.buttons[b] = false;
    }
    this.prevButtons = this.current.map((p) => p.buttons.slice());
  }
}
