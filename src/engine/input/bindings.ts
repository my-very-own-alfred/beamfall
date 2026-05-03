// Beamfall — keyboard layout definitions.
// Maps each abstract action (up/down/left/right/activate/power) to a concrete
// `KeyboardEvent.code` per layout. Codes are layout-independent (KeyW is the
// physical W position regardless of QWERTY/AZERTY/Dvorak).

import type { KeyboardLayout } from '@/types';

/** Per-action key codes for a single keyboard layout. */
export interface KeyboardLayoutKeys {
  up: string;
  down: string;
  left: string;
  right: string;
  activate: string;
  power: string;
}

/** Concrete key codes for each supported {@link KeyboardLayout}. */
export const KEYBOARD_LAYOUTS: Record<KeyboardLayout, KeyboardLayoutKeys> = {
  wasd: {
    up: 'KeyW',
    down: 'KeyS',
    left: 'KeyA',
    right: 'KeyD',
    activate: 'Space',
    power: 'KeyQ',
  },
  arrows: {
    up: 'ArrowUp',
    down: 'ArrowDown',
    left: 'ArrowLeft',
    right: 'ArrowRight',
    activate: 'Enter',
    power: 'ShiftRight',
  },
  ijkl: {
    up: 'KeyI',
    down: 'KeyK',
    left: 'KeyJ',
    right: 'KeyL',
    activate: 'KeyU',
    power: 'KeyO',
  },
  numpad: {
    up: 'Numpad8',
    down: 'Numpad2',
    left: 'Numpad4',
    right: 'Numpad6',
    activate: 'Numpad0',
    power: 'NumpadEnter',
  },
};
