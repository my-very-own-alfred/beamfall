// Beamfall — In-game HUD layer.
// Renders score boxes, round timer, round number, and state overlays
// (lobby / countdown / roundEnd / matchEnd) on top of the play field.
// Owned by T5 UI scope. Reads World; never mutates it.

import { Container, Graphics, Text } from 'pixi.js';
import type { CharacterClass, Color, GameState, Player, World } from '@/types';
import { COLOR_HEX } from '@/types';

export interface Hud {
  /**
   * Re-layout and re-bind HUD content to the current world snapshot.
   * Safe to call every frame.
   */
  update(world: World, viewportW: number, viewportH: number): void;
  /** Tear down the HUD's display objects from its parent. */
  destroy(): void;
}

interface ScoreBox {
  readonly color: Color;
  readonly root: Container;
  readonly bg: Graphics;
  readonly border: Graphics;
  readonly label: Text;
  /** Charge gauge (background outline + fill) under the score box. */
  readonly gauge: Graphics;
  /** Class badge text — single letter inside the gauge. */
  readonly badge: Text;
}

const SCORE_BOX_W = 80;
const SCORE_BOX_H = 60;
const SCORE_BOX_MARGIN = 16;
const GAUGE_W = 80;
const GAUGE_H = 6;
const GAUGE_GAP = 4; // px between score box and gauge
const BADGE_GAP = 4; // px between gauge end and badge text

/** Corner placement order, mapping to colors red/blue/yellow/green. */
type Corner = 'tl' | 'tr' | 'bl' | 'br';
const CORNER_BY_COLOR: Record<Color, Corner> = {
  red: 'tl',
  blue: 'tr',
  yellow: 'bl',
  green: 'br',
};

const STATE_TEXT_BY_WIN_COLOR: Record<Color, string> = {
  red: 'RED',
  blue: 'BLUE',
  yellow: 'YELLOW',
  green: 'GREEN',
};

/**
 * Create a HUD attached to the supplied parent container (typically the hudLayer).
 * The HUD owns its own Container and child display objects; call `destroy()` to
 * remove them.
 */
export function createHud(parent: Container): Hud {
  const root = new Container();
  root.label = 'hud';
  parent.addChild(root);

  // Score boxes — one per color.
  const colors: Color[] = ['red', 'blue', 'yellow', 'green'];
  const scoreBoxes: ScoreBox[] = colors.map((c) => createScoreBox(root, c));

  // Round timer (top-center).
  const timer = new Text({
    text: '0:30',
    style: {
      fontFamily: 'monospace',
      fontSize: 48,
      fill: 0xffffff,
      align: 'center',
    },
  });
  timer.anchor.set(0.5, 0);
  root.addChild(timer);

  // Round number (just below timer).
  const roundNumber = new Text({
    text: 'Round 1',
    style: {
      fontFamily: 'monospace',
      fontSize: 18,
      fill: 0xffffff,
      align: 'center',
    },
  });
  roundNumber.anchor.set(0.5, 0);
  root.addChild(roundNumber);

  // Overlay (lazily populated). Rebuilt when state changes.
  const overlay = new Container();
  overlay.label = 'hud-overlay';
  overlay.visible = false;
  root.addChild(overlay);

  const overlayDim = new Graphics();
  overlay.addChild(overlayDim);

  const overlayPrimary = new Text({
    text: '',
    style: {
      fontFamily: 'monospace',
      fontSize: 64,
      fill: 0xffffff,
      align: 'center',
      fontWeight: 'bold',
    },
  });
  overlayPrimary.anchor.set(0.5);
  overlay.addChild(overlayPrimary);

  const overlaySecondary = new Text({
    text: '',
    style: {
      fontFamily: 'monospace',
      fontSize: 24,
      fill: 0xffffff,
      align: 'center',
    },
  });
  overlaySecondary.anchor.set(0.5);
  overlay.addChild(overlaySecondary);

  let lastOverlayKey = '';

  const update = (world: World, viewportW: number, viewportH: number): void => {
    // --- Score boxes positioning ---------------------------------------------
    for (const box of scoreBoxes) {
      const corner = CORNER_BY_COLOR[box.color];
      const { x, y } = cornerXY(corner, viewportW, viewportH);
      box.root.x = x;
      box.root.y = y;
      box.label.text = String(world.scores[box.color] ?? 0);
      // Center the number within the box.
      box.label.x = SCORE_BOX_W / 2;
      box.label.y = SCORE_BOX_H / 2;

      // --- Ability charge gauge under the score box -----------------------
      // Gauges are anchored differently per corner:
      //   tl/tr (top): below the score box.
      //   bl/br (bottom): above the score box (so they stay on-screen).
      const gaugeY = corner === 'bl' || corner === 'br' ? -GAUGE_GAP - GAUGE_H : SCORE_BOX_H + GAUGE_GAP;

      const player = findAlivePlayerByColor(world, box.color);
      const hex = COLOR_HEX[box.color];
      box.gauge.clear();

      if (player !== null) {
        const charge = Math.max(0, Math.min(1, player.ability.charge));
        const isFull = charge >= 0.999;
        const armed = player.ability.phase === 'armed';
        // SNIPE-armed pulse: ~3 Hz oscillation derived from tickCount (deterministic look).
        // Tick rate is 120 Hz; a 3 Hz cycle is 40 ticks.
        const pulse = armed
          ? 0.5 + 0.5 * Math.sin((world.tickCount / 40) * Math.PI * 2)
          : 1;
        const fillAlpha = isFull ? 1 : 0.55;
        const finalAlpha = fillAlpha * (armed ? 0.5 + 0.5 * pulse : 1);

        // Background outline (always visible) + fill.
        box.gauge.rect(0, gaugeY, GAUGE_W, GAUGE_H).stroke({ width: 1, color: hex, alpha: 0.9 });
        if (charge > 0) {
          box.gauge.rect(0, gaugeY, GAUGE_W * charge, GAUGE_H).fill({ color: hex, alpha: finalAlpha });
        }

        const cls = player.characterClass;
        box.badge.text = badgeFor(cls);
        box.badge.style.fill = isFull ? 0xffffff : 0xcccccc;
        box.badge.x = GAUGE_W + BADGE_GAP;
        box.badge.y = gaugeY + GAUGE_H / 2;
        box.badge.visible = true;
      } else {
        // Slot empty — outline only, no fill, no badge.
        box.gauge.rect(0, gaugeY, GAUGE_W, GAUGE_H).stroke({ width: 1, color: hex, alpha: 0.3 });
        box.badge.visible = false;
      }
    }

    // --- Round timer + round number -----------------------------------------
    timer.text = formatTimer(world.roundTimer);
    timer.x = viewportW / 2;
    timer.y = 12;

    roundNumber.text = `Round ${world.roundNumber}`;
    roundNumber.x = viewportW / 2;
    roundNumber.y = 12 + 48 + 4;

    // --- State overlay -------------------------------------------------------
    const overlayKey = computeOverlayKey(world);
    if (overlayKey !== lastOverlayKey) {
      applyOverlay(overlay, overlayDim, overlayPrimary, overlaySecondary, world, viewportW, viewportH);
      lastOverlayKey = overlayKey;
    } else {
      // Even when the key didn't change, viewport may have, so re-center.
      reflowOverlay(overlayDim, overlayPrimary, overlaySecondary, viewportW, viewportH);
    }

    // Countdown number can change frame to frame; keep it fresh.
    if (world.state === 'countdown') {
      overlayPrimary.text = formatCountdown(world.roundTimer);
    }
  };

  const destroy = (): void => {
    root.destroy({ children: true });
  };

  return { update, destroy };
}

function createScoreBox(parent: Container, color: Color): ScoreBox {
  const hex = COLOR_HEX[color];
  const root = new Container();
  root.label = `score-${color}`;
  parent.addChild(root);

  const bg = new Graphics();
  bg.rect(0, 0, SCORE_BOX_W, SCORE_BOX_H).fill({ color: hex, alpha: 0.3 });
  root.addChild(bg);

  const border = new Graphics();
  border.rect(0, 0, SCORE_BOX_W, SCORE_BOX_H).stroke({ width: 2, color: hex });
  root.addChild(border);

  const label = new Text({
    text: '0',
    style: {
      fontFamily: 'monospace',
      fontSize: 32,
      fill: 0xffffff,
      align: 'center',
      fontWeight: 'bold',
    },
  });
  label.anchor.set(0.5);
  root.addChild(label);

  // Ability charge gauge — background outline visible, fill written each frame.
  const gauge = new Graphics();
  root.addChild(gauge);

  const badge = new Text({
    text: '',
    style: {
      fontFamily: 'monospace',
      fontSize: 12,
      fill: 0xffffff,
      align: 'center',
      fontWeight: 'bold',
    },
  });
  badge.anchor.set(0, 0.5);
  root.addChild(badge);

  return { color, root, bg, border, label, gauge, badge };
}

function cornerXY(corner: Corner, w: number, h: number): { x: number; y: number } {
  switch (corner) {
    case 'tl':
      return { x: SCORE_BOX_MARGIN, y: SCORE_BOX_MARGIN };
    case 'tr':
      return { x: w - SCORE_BOX_W - SCORE_BOX_MARGIN, y: SCORE_BOX_MARGIN };
    case 'bl':
      return { x: SCORE_BOX_MARGIN, y: h - SCORE_BOX_H - SCORE_BOX_MARGIN };
    case 'br':
      return { x: w - SCORE_BOX_W - SCORE_BOX_MARGIN, y: h - SCORE_BOX_H - SCORE_BOX_MARGIN };
  }
}

function formatTimer(secondsRemaining: number): string {
  const clamped = Math.max(0, Math.ceil(secondsRemaining));
  const m = Math.floor(clamped / 60);
  const s = clamped % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatCountdown(secondsRemaining: number): string {
  // World.roundTimer during 'countdown' encodes seconds until 'playing'.
  // 3..2..1..GO!  We display ceil() of remaining, with <=0 collapsing to GO!.
  if (secondsRemaining <= 0) return 'GO!';
  const n = Math.ceil(secondsRemaining);
  if (n >= 4) return String(n);
  return String(n);
}

function leadingScoreColor(scores: Record<Color, number>): Color {
  const order: Color[] = ['red', 'blue', 'yellow', 'green'];
  let best: Color = 'red';
  let bestScore = -Infinity;
  for (const c of order) {
    const s = scores[c];
    if (s > bestScore) {
      bestScore = s;
      best = c;
    }
  }
  return best;
}

function computeOverlayKey(world: World): string {
  // The overlay rebuild is cheap; key derivation is just to avoid re-styling text
  // every frame when nothing relevant changed.
  switch (world.state) {
    case 'playing':
      return 'playing';
    case 'lobby':
      return 'lobby';
    case 'countdown':
      return 'countdown';
    case 'roundEnd':
      return `roundEnd:${leadingScoreColor(world.scores)}`;
    case 'matchEnd':
      return `matchEnd:${leadingScoreColor(world.scores)}`;
  }
}

function applyOverlay(
  overlay: Container,
  dim: Graphics,
  primary: Text,
  secondary: Text,
  world: World,
  w: number,
  h: number,
): void {
  const state: GameState = world.state;
  if (state === 'playing') {
    overlay.visible = false;
    return;
  }
  overlay.visible = true;

  // Re-draw dim layer to viewport.
  dim.clear();
  dim.rect(0, 0, w, h).fill({ color: 0x000000, alpha: 0.6 });

  // Default style adjustments per state.
  let primaryText = '';
  let primaryFill: number = 0xffffff;
  let primaryFontSize = 64;
  let secondaryText = '';

  if (state === 'lobby') {
    primaryText = 'Press Start / Enter to begin';
    primaryFontSize = 40;
  } else if (state === 'countdown') {
    primaryText = formatCountdown(world.roundTimer);
    primaryFontSize = 160;
  } else if (state === 'roundEnd') {
    const winner = leadingScoreColor(world.scores);
    primaryText = `${STATE_TEXT_BY_WIN_COLOR[winner]} WINS`;
    primaryFill = COLOR_HEX[winner];
    primaryFontSize = 80;
  } else if (state === 'matchEnd') {
    const winner = leadingScoreColor(world.scores);
    primaryText = `${STATE_TEXT_BY_WIN_COLOR[winner]} \u2014 MATCH WINNER`;
    primaryFill = COLOR_HEX[winner];
    primaryFontSize = 64;
    secondaryText = 'Press Start to play again';
  }

  primary.text = primaryText;
  primary.style.fill = primaryFill;
  primary.style.fontSize = primaryFontSize;
  secondary.text = secondaryText;

  reflowOverlay(dim, primary, secondary, w, h);
}

/**
 * Disambiguated single-letter class badge. SNIPE/SHOCK/SMASH all start with
 * 'S', so we map them to N/K/M respectively.
 */
export function badgeFor(cls: CharacterClass): string {
  switch (cls) {
    case 'smash':
      return 'M';
    case 'snipe':
      return 'N';
    case 'shock':
      return 'K';
    case 'blade':
      return 'B';
    case 'ghost':
      return 'G';
    case 'thief':
      return 'T';
  }
}

/**
 * Find the first alive player matching the given color. Returns null if no
 * alive player exists for that color (slot empty / dead). Sourced separately
 * from the score box so future per-slot HUDs can reuse the helper.
 */
function findAlivePlayerByColor(world: World, color: Color): Player | null {
  for (const p of world.players) {
    if (p.color === color && p.alive) return p;
  }
  // If nobody alive but slot exists, fall back to the dead player so we still
  // display their class & last-charge (so the gauge doesn't pop in/out).
  for (const p of world.players) {
    if (p.color === color) return p;
  }
  return null;
}

function reflowOverlay(
  dim: Graphics,
  primary: Text,
  secondary: Text,
  w: number,
  h: number,
): void {
  // Always make sure the dim covers the current viewport size.
  dim.clear();
  dim.rect(0, 0, w, h).fill({ color: 0x000000, alpha: 0.6 });

  primary.x = w / 2;
  primary.y = h / 2;

  secondary.x = w / 2;
  secondary.y = h / 2 + 64;
}
