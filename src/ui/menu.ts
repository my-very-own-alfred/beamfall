// Beamfall — Main menu.
// A minimal v0.1 placeholder: BEAMFALL logo and two options ("Play", "Quit").
// Navigate with up/down (keyboard arrows or W/S) or D-pad, confirm with Enter
// or gamepad A. Like the lobby, this UI is driven — input ownership stays with
// the integrator via edge-triggered query hooks.

import { Container, Graphics, Rectangle, Text } from 'pixi.js';
import { hasStoredReplay } from '@/engine/replay';

const NEON_COLORS = [0xff3344, 0x3388ff, 0xffdd33, 0x33dd66] as const;

export type MenuChoice = 'play' | 'replay' | 'quit';

export interface Menu {
  /** Poll inputs and re-layout to the viewport. */
  update(viewportW: number, viewportH: number): void;
  /** Returns the chosen option on confirmation; otherwise null. */
  pick(): MenuChoice | null;
  /** Tear down display objects. */
  destroy(): void;
}

export interface MenuHooks {
  isKeyPressed: (code: string) => boolean;
  isGamepadButtonPressed: (idx: number, btn: number) => boolean;
}

const OPTIONS: readonly MenuChoice[] = ['play', 'replay', 'quit'] as const;
const OPTION_LABEL: Record<MenuChoice, string> = {
  play: 'Play',
  replay: 'Replay last match',
  quit: 'Quit',
};

const GAMEPAD_MAX = 4;
const GAMEPAD_DPAD_UP = 12;
const GAMEPAD_DPAD_DOWN = 13;
const GAMEPAD_A = 0;

/**
 * Create a Menu attached to the supplied parent container. Call `update()` each
 * frame; check `pick()` to detect a confirmed selection (returned exactly once).
 */
export function createMenu(parent: Container, hooks: MenuHooks): Menu {
  const root = new Container();
  root.label = 'menu';
  parent.addChild(root);

  // Decorative neon bars behind the logo — gives the title some Laser-League-y
  // bite without needing real art assets.
  const decor = new Graphics();
  root.addChild(decor);

  const logo = new Text({
    text: 'BEAMFALL',
    style: {
      fontFamily: 'monospace',
      fontSize: 112,
      fill: 0xffffff,
      align: 'center',
      fontWeight: 'bold',
      letterSpacing: 10,
    },
  });
  logo.anchor.set(0.5);
  root.addChild(logo);

  const tagline = new Text({
    text: 'open-source local arena',
    style: {
      fontFamily: 'monospace',
      fontSize: 18,
      fill: 0xaaaaaa,
      align: 'center',
      letterSpacing: 4,
    },
  });
  tagline.anchor.set(0.5);
  root.addChild(tagline);

  const version = new Text({
    text: 'v0.2.0  \u2014  6 classes \u00b7 4 patterns \u00b7 hot-seat 1\u20134p',
    style: {
      fontFamily: 'monospace',
      fontSize: 12,
      fill: 0x666666,
      align: 'center',
    },
  });
  version.anchor.set(0.5, 1);
  root.addChild(version);

  // Each option is a Container (text + invisible hit area) so it can be
  // clicked / hovered. We expand the hit area horizontally so the click
  // target is generous — the small text glyphs alone would be a nightmare.
  const OPTION_HIT_W = 480;
  const OPTION_HIT_H = 48;

  const optionContainers: Container[] = OPTIONS.map((opt, idx) => {
    const c = new Container();
    c.eventMode = 'static';
    c.cursor = 'pointer';
    c.hitArea = new Rectangle(-OPTION_HIT_W / 2, -OPTION_HIT_H / 2, OPTION_HIT_W, OPTION_HIT_H);
    const t = new Text({
      text: `  ${OPTION_LABEL[opt]}`,
      style: {
        fontFamily: 'monospace',
        fontSize: 36,
        fill: 0xffffff,
        align: 'left',
      },
    });
    t.anchor.set(0.5, 0.5);
    c.addChild(t);
    // Hover → set this option as the selected highlight (visual + commit on click).
    c.on('pointerover', () => {
      selected = idx;
    });
    c.on('pointerdown', () => {
      const replayAvailable = hasStoredReplay();
      const choice = OPTIONS[idx];
      if (choice === undefined) return;
      if (choice === 'replay' && !replayAvailable) return; // greyed-out, ignore
      if (pendingChoice === null) pendingChoice = choice;
    });
    root.addChild(c);
    return c;
  });

  // Helper to get the inner Text for layout/style updates.
  const optionText = (i: number): Text | null => {
    const c = optionContainers[i];
    if (!c) return null;
    const t = c.children[0];
    return t instanceof Text ? t : null;
  };

  let selected = 0;
  let pendingChoice: MenuChoice | null = null;

  const isAnyGamepadButton = (btn: number): boolean => {
    for (let g = 0; g < GAMEPAD_MAX; g++) {
      if (hooks.isGamepadButtonPressed(g, btn)) return true;
    }
    return false;
  };

  const update = (viewportW: number, viewportH: number): void => {
    // --- Navigation ---------------------------------------------------------
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

    // --- Confirm ------------------------------------------------------------
    // The "replay" option is disabled whenever no replay has been stored yet.
    const replayAvailable = hasStoredReplay();
    const confirm = hooks.isKeyPressed('Enter') || isAnyGamepadButton(GAMEPAD_A);
    if (confirm && pendingChoice === null) {
      const choice = OPTIONS[selected];
      if (choice !== undefined && !(choice === 'replay' && !replayAvailable)) {
        pendingChoice = choice;
      }
    }

    // --- Layout -------------------------------------------------------------
    logo.x = viewportW / 2;
    logo.y = viewportH / 3;

    tagline.x = viewportW / 2;
    tagline.y = logo.y + 70;

    version.x = viewportW / 2;
    version.y = viewportH - 24;

    // Decorative neon bars: four short colored stripes flanking the logo,
    // one per slot color. Re-stroked each frame to follow viewport.
    decor.clear();
    const barW = 180;
    const barH = 4;
    const barY = logo.y - 8;
    for (let i = 0; i < NEON_COLORS.length; i++) {
      const col = NEON_COLORS[i]!;
      const x = viewportW / 2 - 320 + i * 24 - 60;
      decor
        .rect(x, barY + (i % 2 === 0 ? -16 : 16), barW, barH)
        .fill({ color: col, alpha: 0.85 });
      decor
        .rect(viewportW - x - barW, barY + (i % 2 === 0 ? 16 : -16), barW, barH)
        .fill({ color: col, alpha: 0.85 });
    }

    const optionsTop = viewportH / 3 + 140;
    const optionGap = 56;
    for (let i = 0; i < optionContainers.length; i++) {
      const c = optionContainers[i];
      if (!c) continue;
      const t = optionText(i);
      if (!t) continue;
      const opt = OPTIONS[i];
      if (opt === undefined) continue;
      const isSelected = i === selected;
      const disabled = opt === 'replay' && !replayAvailable;
      t.text = isSelected ? `> ${OPTION_LABEL[opt]}` : `  ${OPTION_LABEL[opt]}`;
      // Disabled option: dim grey regardless of selection so the user can see
      // it can't be picked. Otherwise selected = white, unselected = grey.
      t.style.fill = disabled ? 0x333333 : isSelected ? 0xffffff : 0x666666;
      // Position the container — Text inside is anchored at (0.5, 0.5) so
      // it auto-centers; the hit area Rectangle is centered around the same.
      c.x = viewportW / 2;
      c.y = optionsTop + i * optionGap;
      c.cursor = disabled ? 'default' : 'pointer';
      c.eventMode = disabled ? 'auto' : 'static';
    }
  };

  const pick = (): MenuChoice | null => {
    const c = pendingChoice;
    pendingChoice = null;
    return c;
  };

  const destroy = (): void => {
    root.destroy({ children: true });
  };

  return { update, pick, destroy };
}
