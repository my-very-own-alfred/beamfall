// Beamfall — Pre-match lobby UI.
// Lets up to 4 players claim a slot via keyboard layout (WASD/Arrows/IJKL/Numpad)
// or any connected gamepad. After claiming, each slot can cycle through the 6
// character classes using the slot's "activate" key (Space/Enter/U/Numpad-0)
// or gamepad A. Press Enter / Start once at least one player has claimed
// (and committed a class) to mark the lobby ready.

import { Container, Graphics, Text } from 'pixi.js';
import type {
  CharacterClass,
  Color,
  KeyboardLayout,
  PlayerBinding,
  PlayerSlot,
} from '@/types';
import { COLOR_HEX } from '@/types';
import { ALL_CHARACTERS, CHARACTER_SPECS, DEFAULT_CHARACTER } from '@/game/characters';
import { ARENAS, ARENA_ORDER, DEFAULT_ARENA_ID } from '@/game/arenas';
import type { ArenaId } from '@/game/arenas';
import { MUTATORS, MUTATOR_ORDER } from '@/game/mutators';
import type { MutatorId } from '@/game/mutators';

export interface LobbyResult {
  bindings: PlayerBinding[];
  characters: CharacterClass[];
}

export interface Lobby {
  update(viewportW: number, viewportH: number): void;
  bindings(): PlayerBinding[];
  characters(): CharacterClass[];
  /** Currently-selected arena. Cycle with Tab. */
  arenaId(): ArenaId;
  /** Selected mutators. Toggled with keys 1\u20135. */
  mutators(): MutatorId[];
  isReady(): boolean;
  destroy(): void;
}

export interface LobbyHooks {
  isKeyPressed: (code: string) => boolean;
  isGamepadConnected: (idx: number) => boolean;
  isGamepadButtonPressed: (idx: number, btn: number) => boolean;
}

interface SlotView {
  readonly slot: PlayerSlot;
  readonly color: Color;
  readonly root: Container;
  readonly bg: Graphics;
  readonly border: Graphics;
  readonly heading: Text;
  readonly status: Text;
  readonly classText: Text;
  readonly tagline: Text;
}

const SLOT_W = 280;
const SLOT_H = 180;
const SLOT_GAP = 24;

const SLOT_COLORS: readonly Color[] = ['red', 'blue', 'yellow', 'green'] as const;

const LAYOUT_KEY: Record<KeyboardLayout, string> = {
  wasd: 'KeyW',
  arrows: 'ArrowUp',
  ijkl: 'KeyI',
  numpad: 'Numpad8',
};

/** Per-layout cycle key (advances the chosen character class). */
const CYCLE_KEY: Record<KeyboardLayout, string> = {
  wasd: 'Space',
  arrows: 'Enter',
  ijkl: 'KeyU',
  numpad: 'Numpad0',
};

const ALL_LAYOUTS: readonly KeyboardLayout[] = ['wasd', 'arrows', 'ijkl', 'numpad'];

const GAMEPAD_CLAIM_BUTTON = 0; // A / cross
const GAMEPAD_CYCLE_BUTTON = 0; // also A — same button cycles after claim
const GAMEPAD_START_BUTTON = 9; // Start / options
const GAMEPAD_MAX = 4;

function bindingLabel(b: PlayerBinding): string {
  if (b.kind === 'keyboard') {
    switch (b.layout) {
      case 'wasd': return 'WASD';
      case 'arrows': return 'Arrows';
      case 'ijkl': return 'IJKL';
      case 'numpad': return 'Numpad';
    }
  }
  return `Gamepad #${b.index + 1}`;
}

function nextClass(current: CharacterClass): CharacterClass {
  const idx = ALL_CHARACTERS.indexOf(current);
  return ALL_CHARACTERS[(idx + 1) % ALL_CHARACTERS.length] ?? DEFAULT_CHARACTER;
}

export function createLobby(parent: Container, hooks: LobbyHooks): Lobby {
  const root = new Container();
  root.label = 'lobby';
  parent.addChild(root);

  const title = new Text({
    text: 'BEAMFALL \u2014 Local Multiplayer',
    style: {
      fontFamily: 'monospace',
      fontSize: 44,
      fill: 0xffffff,
      align: 'center',
      fontWeight: 'bold',
    },
  });
  title.anchor.set(0.5, 0);
  root.addChild(title);

  const subtitle = new Text({
    text: 'Claim a slot, cycle class with your activate key, then press Start',
    style: { fontFamily: 'monospace', fontSize: 18, fill: 0xcccccc, align: 'center' },
  });
  subtitle.anchor.set(0.5, 0);
  root.addChild(subtitle);

  const slots: SlotView[] = SLOT_COLORS.map((c, i) =>
    createSlotView(root, i as PlayerSlot, c),
  );

  let arenaId: ArenaId = DEFAULT_ARENA_ID;

  // Arena info text — added below subtitle. Updated whenever arena cycles.
  const arenaInfo = new Text({
    text: '',
    style: { fontFamily: 'monospace', fontSize: 16, fill: 0xffd84d, align: 'center' },
  });
  arenaInfo.anchor.set(0.5, 0);
  root.addChild(arenaInfo);

  const refreshArenaInfo = (): void => {
    const a = ARENAS[arenaId]();
    arenaInfo.text = `Arena: ${a.name ?? arenaId} \u2014 ${a.tagline ?? ''}   [Tab to cycle]`;
  };
  refreshArenaInfo();

  // --- Mutator panel ------------------------------------------------------
  // Selected mutators are restored from localStorage if present (defensive
  // parse: any malformed entry is silently dropped).
  const selectedMutators = new Set<MutatorId>();
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem('beamfall:lastMutators');
      if (raw !== null) {
        const parsed = JSON.parse(raw) as unknown;
        if (Array.isArray(parsed)) {
          for (const id of parsed) {
            if (typeof id === 'string' && (MUTATOR_ORDER as readonly string[]).includes(id)) {
              selectedMutators.add(id as MutatorId);
            }
          }
        }
      }
    }
  } catch {
    // Ignore — fall through to empty set.
  }

  const mutatorHeading = new Text({
    text: 'Mutators (1\u20135 to toggle):',
    style: { fontFamily: 'monospace', fontSize: 14, fill: 0xffffff, align: 'left' },
  });
  root.addChild(mutatorHeading);

  const mutatorRows: Text[] = MUTATOR_ORDER.map(() => {
    const t = new Text({
      text: '',
      style: { fontFamily: 'monospace', fontSize: 13, fill: 0xcccccc, align: 'left' },
    });
    root.addChild(t);
    return t;
  });

  const refreshMutatorRows = (): void => {
    for (let i = 0; i < MUTATOR_ORDER.length; i++) {
      const id = MUTATOR_ORDER[i]!;
      const spec = MUTATORS[id];
      const t = mutatorRows[i];
      if (!t) continue;
      const mark = selectedMutators.has(id) ? '[x]' : '[ ]';
      t.text = `${i + 1} ${mark} ${spec.name} \u2014 ${spec.description}`;
      t.style.fill = selectedMutators.has(id) ? 0xffd84d : 0xaaaaaa;
    }
  };
  refreshMutatorRows();

  const MUTATOR_KEYS: readonly string[] = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5'];

  const bindings: (PlayerBinding | null)[] = [null, null, null, null];
  const chars: CharacterClass[] = [
    DEFAULT_CHARACTER, DEFAULT_CHARACTER, DEFAULT_CHARACTER, DEFAULT_CHARACTER,
  ];
  const takenLayouts = new Set<KeyboardLayout>();
  const takenGamepads = new Set<number>();
  let ready = false;

  const claimNext = (binding: PlayerBinding): number => {
    for (let i = 0; i < bindings.length; i++) {
      if (bindings[i] === null) {
        bindings[i] = binding;
        return i;
      }
    }
    return -1;
  };

  const update = (viewportW: number, viewportH: number): void => {
    // Claim layouts
    for (const layout of ALL_LAYOUTS) {
      if (takenLayouts.has(layout)) continue;
      if (hooks.isKeyPressed(LAYOUT_KEY[layout])) {
        takenLayouts.add(layout);
        claimNext({ kind: 'keyboard', layout });
      }
    }
    // Claim gamepads
    for (let g = 0; g < GAMEPAD_MAX; g++) {
      if (takenGamepads.has(g)) continue;
      if (!hooks.isGamepadConnected(g)) continue;
      if (hooks.isGamepadButtonPressed(g, GAMEPAD_CLAIM_BUTTON)) {
        takenGamepads.add(g);
        claimNext({ kind: 'gamepad', index: g });
      }
    }

    // Cycle class on activate key for already-claimed slots.
    for (let i = 0; i < bindings.length; i++) {
      const b = bindings[i];
      if (b === null || b === undefined) continue;
      let cycled = false;
      if (b.kind === 'keyboard') {
        if (hooks.isKeyPressed(CYCLE_KEY[b.layout])) cycled = true;
      } else if (hooks.isGamepadButtonPressed(b.index, GAMEPAD_CYCLE_BUTTON)) {
        // Same A button — but we ate the claim edge above, so subsequent
        // presses fall here.
        cycled = true;
      }
      if (cycled) {
        chars[i] = nextClass(chars[i] ?? DEFAULT_CHARACTER);
      }
    }

    // Arena cycle (Tab).
    if (hooks.isKeyPressed('Tab')) {
      const idx = ARENA_ORDER.indexOf(arenaId);
      arenaId = ARENA_ORDER[(idx + 1) % ARENA_ORDER.length] ?? DEFAULT_ARENA_ID;
      refreshArenaInfo();
    }

    // Mutator toggles (1\u20135).
    let mutatorsChanged = false;
    for (let i = 0; i < MUTATOR_KEYS.length; i++) {
      const key = MUTATOR_KEYS[i]!;
      const id = MUTATOR_ORDER[i];
      if (id === undefined) continue;
      if (hooks.isKeyPressed(key)) {
        if (selectedMutators.has(id)) selectedMutators.delete(id);
        else selectedMutators.add(id);
        mutatorsChanged = true;
      }
    }
    if (mutatorsChanged) refreshMutatorRows();

    // Start trigger
    if (!ready && bindings.some((b) => b !== null)) {
      let startPressed = hooks.isKeyPressed('Enter');
      if (!startPressed) {
        for (let g = 0; g < GAMEPAD_MAX; g++) {
          if (!hooks.isGamepadConnected(g)) continue;
          if (hooks.isGamepadButtonPressed(g, GAMEPAD_START_BUTTON)) {
            startPressed = true;
            break;
          }
        }
      }
      if (startPressed) ready = true;
    }

    // Layout
    title.x = viewportW / 2;
    title.y = 36;
    subtitle.x = viewportW / 2;
    subtitle.y = 88;
    arenaInfo.x = viewportW / 2;
    arenaInfo.y = 112;

    const gridW = SLOT_W * 2 + SLOT_GAP;
    const gridH = SLOT_H * 2 + SLOT_GAP;
    const gridLeft = (viewportW - gridW) / 2;
    const gridTop = Math.max(140, (viewportH - gridH) / 2);

    for (let i = 0; i < slots.length; i++) {
      const view = slots[i];
      if (!view) continue;
      const col = i % 2;
      const row = Math.floor(i / 2);
      view.root.x = gridLeft + col * (SLOT_W + SLOT_GAP);
      view.root.y = gridTop + row * (SLOT_H + SLOT_GAP);

      const binding = bindings[i] ?? null;
      view.status.text = binding === null ? 'Press claim key/button' : bindingLabel(binding);

      const cls = chars[i] ?? DEFAULT_CHARACTER;
      const spec = CHARACTER_SPECS[cls];
      view.classText.text = binding === null ? '—' : spec.name;
      view.tagline.text = binding === null ? '' : spec.tagline;
    }

    // Mutator panel — placed below the slot grid.
    const mutatorTop = gridTop + gridH + 16;
    mutatorHeading.x = gridLeft;
    mutatorHeading.y = mutatorTop;
    for (let i = 0; i < mutatorRows.length; i++) {
      const t = mutatorRows[i];
      if (!t) continue;
      t.x = gridLeft;
      t.y = mutatorTop + 22 + i * 18;
    }
  };

  return {
    update,
    bindings: () => bindings.filter((b): b is PlayerBinding => b !== null),
    arenaId: () => arenaId,
    mutators: () => MUTATOR_ORDER.filter((id) => selectedMutators.has(id)),
    characters: () =>
      bindings
        .map((b, i) => (b !== null ? chars[i] ?? DEFAULT_CHARACTER : null))
        .filter((c): c is CharacterClass => c !== null),
    isReady: () => ready,
    destroy: () => root.destroy({ children: true }),
  };
}

function createSlotView(parent: Container, slot: PlayerSlot, color: Color): SlotView {
  const hex = COLOR_HEX[color];
  const root = new Container();
  root.label = `lobby-slot-${slot}`;
  parent.addChild(root);

  const bg = new Graphics();
  bg.rect(0, 0, SLOT_W, SLOT_H).fill({ color: hex, alpha: 0.18 });
  root.addChild(bg);

  const border = new Graphics();
  border.rect(0, 0, SLOT_W, SLOT_H).stroke({ width: 2, color: hex });
  root.addChild(border);

  const heading = new Text({
    text: `Slot ${slot + 1} (${color[0]!.toUpperCase()}${color.slice(1)})`,
    style: {
      fontFamily: 'monospace',
      fontSize: 20,
      fill: hex,
      align: 'center',
      fontWeight: 'bold',
    },
  });
  heading.anchor.set(0.5, 0);
  heading.x = SLOT_W / 2;
  heading.y = 10;
  root.addChild(heading);

  const status = new Text({
    text: 'Press claim key/button',
    style: { fontFamily: 'monospace', fontSize: 14, fill: 0xffffff, align: 'center' },
  });
  status.anchor.set(0.5, 0);
  status.x = SLOT_W / 2;
  status.y = 40;
  root.addChild(status);

  const classText = new Text({
    text: '—',
    style: {
      fontFamily: 'monospace',
      fontSize: 28,
      fill: 0xffffff,
      align: 'center',
      fontWeight: 'bold',
    },
  });
  classText.anchor.set(0.5, 0);
  classText.x = SLOT_W / 2;
  classText.y = 72;
  root.addChild(classText);

  const tagline = new Text({
    text: '',
    style: {
      fontFamily: 'monospace',
      fontSize: 12,
      fill: 0xbbbbbb,
      align: 'center',
      wordWrap: true,
      wordWrapWidth: SLOT_W - 24,
    },
  });
  tagline.anchor.set(0.5, 0);
  tagline.x = SLOT_W / 2;
  tagline.y = 116;
  root.addChild(tagline);

  return { slot, color, root, bg, border, heading, status, classText, tagline };
}
