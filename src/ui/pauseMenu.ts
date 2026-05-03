// Beamfall — in-match pause menu.
//
// Activated during AppState 'match' on Escape (keyboard) or gamepad Start
// (button index 9). While paused, the host should stop ticking the world but
// keep rendering, so the play surface remains visible behind a dim overlay.
//
// Driven UI: the integrator polls input via hooks and reads `pick()` to detect
// the user's chosen action exactly once per confirm.

import { Container, Graphics, Text } from 'pixi.js';

export type PauseChoice = 'resume' | 'restart' | 'menu';

export interface PauseMenu {
  /** Re-layout to current viewport. Call every frame while paused. */
  update(viewportW: number, viewportH: number): void;
  /** Returns a confirmed choice exactly once, or null. */
  pick(): PauseChoice | null;
  /** Tear down display objects. */
  destroy(): void;
}

export interface PauseMenuHooks {
  isKeyPressed: (code: string) => boolean;
  isGamepadButtonPressed: (idx: number, btn: number) => boolean;
}

const OPTIONS: readonly PauseChoice[] = ['resume', 'restart', 'menu'] as const;
const OPTION_LABEL: Record<PauseChoice, string> = {
  resume: 'Resume',
  restart: 'Restart Round',
  menu: 'Return to Menu',
};

const GAMEPAD_MAX = 4;
const GAMEPAD_DPAD_UP = 12;
const GAMEPAD_DPAD_DOWN = 13;
const GAMEPAD_A = 0;

export function createPauseMenu(parent: Container, hooks: PauseMenuHooks): PauseMenu {
  const root = new Container();
  root.label = 'pause-menu';
  parent.addChild(root);

  const dim = new Graphics();
  root.addChild(dim);

  const title = new Text({
    text: 'PAUSED',
    style: {
      fontFamily: 'monospace',
      fontSize: 96,
      fill: 0xffffff,
      align: 'center',
      fontWeight: 'bold',
      letterSpacing: 12,
    },
  });
  title.anchor.set(0.5);
  root.addChild(title);

  const optionTexts: Text[] = OPTIONS.map((opt) => {
    const t = new Text({
      text: `  ${OPTION_LABEL[opt]}`,
      style: {
        fontFamily: 'monospace',
        fontSize: 32,
        fill: 0xffffff,
        align: 'center',
      },
    });
    t.anchor.set(0.5);
    root.addChild(t);
    return t;
  });

  let selected = 0;
  let pendingChoice: PauseChoice | null = null;

  const isAnyGamepadButton = (btn: number): boolean => {
    for (let g = 0; g < GAMEPAD_MAX; g++) {
      if (hooks.isGamepadButtonPressed(g, btn)) return true;
    }
    return false;
  };

  const update = (viewportW: number, viewportH: number): void => {
    // Navigation
    const upPressed =
      hooks.isKeyPressed('ArrowUp') ||
      hooks.isKeyPressed('KeyW') ||
      isAnyGamepadButton(GAMEPAD_DPAD_UP);
    const downPressed =
      hooks.isKeyPressed('ArrowDown') ||
      hooks.isKeyPressed('KeyS') ||
      isAnyGamepadButton(GAMEPAD_DPAD_DOWN);

    if (upPressed) {
      selected = (selected - 1 + OPTIONS.length) % OPTIONS.length;
    }
    if (downPressed) {
      selected = (selected + 1) % OPTIONS.length;
    }

    // Confirm
    const confirm = hooks.isKeyPressed('Enter') || isAnyGamepadButton(GAMEPAD_A);
    if (confirm && pendingChoice === null) {
      const choice = OPTIONS[selected];
      if (choice !== undefined) pendingChoice = choice;
    }

    // Layout — draw a fresh dim each frame to follow viewport resizes.
    dim.clear();
    dim.rect(0, 0, viewportW, viewportH).fill({ color: 0x000000, alpha: 0.7 });

    title.x = viewportW / 2;
    title.y = viewportH / 2 - 120;

    const optionsTop = viewportH / 2 + 20;
    const optionGap = 56;
    for (let i = 0; i < optionTexts.length; i++) {
      const t = optionTexts[i];
      if (!t) continue;
      const opt = OPTIONS[i];
      if (opt === undefined) continue;
      const isSelected = i === selected;
      t.text = isSelected ? `> ${OPTION_LABEL[opt]}` : `  ${OPTION_LABEL[opt]}`;
      t.style.fill = isSelected ? 0xffffff : 0x666666;
      t.x = viewportW / 2;
      t.y = optionsTop + i * optionGap;
    }
  };

  const pick = (): PauseChoice | null => {
    const c = pendingChoice;
    pendingChoice = null;
    return c;
  };

  const destroy = (): void => {
    root.destroy({ children: true });
  };

  return { update, pick, destroy };
}
