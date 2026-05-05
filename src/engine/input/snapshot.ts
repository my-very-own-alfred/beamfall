// Beamfall — per-frame input snapshot builder.
// Bridges raw input sources (keyboard + gamepad) to the game-readable
// `InputSnapshot` shape defined in @/types. One snapshot per binding.

import type { InputSnapshot, PlayerBinding } from '@/types';
import type { KeyboardSource } from './keyboard';
import type { GamepadSource } from './gamepad';
import { KEYBOARD_LAYOUTS } from './bindings';

// Standard gamepad button indices.
const GAMEPAD_BUTTON_A = 0;
const GAMEPAD_BUTTON_B = 1;
// Standard gamepad axis indices for the left stick.
const GAMEPAD_AXIS_LX = 0;
const GAMEPAD_AXIS_LY = 1;

/**
 * Build per-binding input snapshots for the current frame.
 *
 * Axis convention: we use screen-space y, where UP is `-1` and DOWN is `+1`.
 * For the keyboard this means `axisY = (down ? 1 : 0) - (up ? 1 : 0)`. The
 * standard Gamepad API's left-stick Y already matches this convention (stick
 * up reports negative), so we forward it as-is.
 *
 * Activate / power are edge-triggered: they read true on the rising-edge
 * frame only. The caller is responsible for invoking
 * {@link KeyboardSource.clearEdges} after this returns so subsequent frames
 * see fresh edges.
 */
export function buildSnapshots(
  bindings: PlayerBinding[],
  keyboard: KeyboardSource,
  gamepad: GamepadSource,
): InputSnapshot[] {
  const out: InputSnapshot[] = [];
  for (const binding of bindings) {
    if (binding.kind === 'keyboard') {
      const k = KEYBOARD_LAYOUTS[binding.layout];
      const up = keyboard.isDown(k.up) ? 1 : 0;
      const down = keyboard.isDown(k.down) ? 1 : 0;
      const left = keyboard.isDown(k.left) ? 1 : 0;
      const right = keyboard.isDown(k.right) ? 1 : 0;
      out.push({
        axisX: right - left,
        axisY: down - up,
        activate: keyboard.wasPressed(k.activate),
        power: keyboard.wasPressed(k.power),
        disconnected: false,
      });
    } else {
      // Item #7: when the bound gamepad is disconnected we still emit a
      // snapshot so the sim's shape stays deterministic, but with zeroed
      // axes / buttons and `disconnected: true` so a future PR can pause.
      const idx = binding.index;
      const connected = gamepad.isConnected(idx);
      out.push({
        axisX: connected ? gamepad.axis(idx, GAMEPAD_AXIS_LX) : 0,
        axisY: connected ? gamepad.axis(idx, GAMEPAD_AXIS_LY) : 0,
        activate: connected ? gamepad.buttonPressed(idx, GAMEPAD_BUTTON_A) : false,
        power: connected ? gamepad.buttonPressed(idx, GAMEPAD_BUTTON_B) : false,
        disconnected: !connected,
      });
    }
  }
  return out;
}
