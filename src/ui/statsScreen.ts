// Beamfall — post-match stats screen.
// Full-screen leaderboard shown when state transitions to 'matchEnd'.
// Renders ranked players, their per-stat breakdown, and crowns the MVP.
//
// Driven (no input ownership). The integrator polls `wantsRestart()` to
// detect Start/Enter and route back to lobby.

import { Container, Graphics, Text } from 'pixi.js';
import type { Color, Player, World } from '@/types';
import { COLOR_HEX } from '@/types';
import { CHARACTER_SPECS } from '@/game/characters';
import {
  CAPTURE_PTS,
  DEATH_PTS,
  LASER_KILL_PTS,
  ROUND_WIN_PTS,
  SHOCK_PTS,
  THIEF_PTS,
  ULT_KILL_PTS,
  rankPlayers,
  statsScore,
} from '@/game/stats';

export interface StatsScreen {
  /** Re-layout to viewport size. Reads world data once at creation; static after. */
  update(viewportW: number, viewportH: number): void;
  /** True if Start/Enter was pressed and the host should return to lobby. */
  wantsRestart(): boolean;
  destroy(): void;
}

export interface StatsScreenHooks {
  isKeyPressed: (code: string) => boolean;
  isGamepadButtonPressed: (idx: number, btn: number) => boolean;
}

const ROW_H = 56;
const PADDING = 32;
const GAMEPAD_MAX = 4;
const GAMEPAD_START = 9;
const GAMEPAD_A = 0;

interface RowView {
  readonly root: Container;
  readonly bg: Graphics;
  readonly rankText: Text;
  readonly nameText: Text;
  readonly classText: Text;
  readonly statsText: Text;
  readonly scoreText: Text;
}

function fmtRow(p: Player): string {
  const s = p.stats;
  // Compact tooltip-like breakdown so the numbers are scannable side-by-side.
  return [
    `ULT ${s.ultKills}`,
    `LSR ${s.laserKills}`,
    `CAP ${s.captures}`,
    `THF ${s.thiefSteals}`,
    `SHK ${s.shockHits}`,
    `RW ${s.roundsWon}`,
    `D ${s.deaths}`,
  ].join('  ');
}

function colorName(c: Color): string {
  return c.charAt(0).toUpperCase() + c.slice(1);
}

export function createStatsScreen(
  parent: Container,
  world: World,
  hooks: StatsScreenHooks,
): StatsScreen {
  const root = new Container();
  root.label = 'stats-screen';
  parent.addChild(root);

  const dim = new Graphics();
  root.addChild(dim);

  const title = new Text({
    text: 'MATCH STATS',
    style: {
      fontFamily: 'monospace',
      fontSize: 48,
      fill: 0xffffff,
      align: 'center',
      fontWeight: 'bold',
      letterSpacing: 4,
    },
  });
  title.anchor.set(0.5, 0);
  root.addChild(title);

  const mvpHeading = new Text({
    text: '',
    style: {
      fontFamily: 'monospace',
      fontSize: 28,
      fill: 0xffffff,
      align: 'center',
    },
  });
  mvpHeading.anchor.set(0.5, 0);
  root.addChild(mvpHeading);

  const formula = new Text({
    text: `Score = ${ULT_KILL_PTS}·ULT + ${LASER_KILL_PTS}·LSR + ${CAPTURE_PTS}·CAP + ${THIEF_PTS}·THF + ${SHOCK_PTS}·SHK + ${ROUND_WIN_PTS}·RW ${DEATH_PTS}·D`,
    style: {
      fontFamily: 'monospace',
      fontSize: 12,
      fill: 0x999999,
      align: 'center',
    },
  });
  formula.anchor.set(0.5, 0);
  root.addChild(formula);

  const ranked = rankPlayers(world.players);

  const rows: RowView[] = ranked.map((entry) => {
    const rowRoot = new Container();
    root.addChild(rowRoot);

    const bg = new Graphics();
    rowRoot.addChild(bg);

    const rankText = new Text({
      text: `#${entry.rank}`,
      style: {
        fontFamily: 'monospace',
        fontSize: 28,
        fill: 0xffffff,
        align: 'left',
        fontWeight: 'bold',
      },
    });
    rowRoot.addChild(rankText);

    const nameText = new Text({
      text: `${colorName(entry.player.color)} (Slot ${entry.player.slot + 1})`,
      style: {
        fontFamily: 'monospace',
        fontSize: 22,
        fill: COLOR_HEX[entry.player.color],
        align: 'left',
        fontWeight: 'bold',
      },
    });
    rowRoot.addChild(nameText);

    const classText = new Text({
      text: CHARACTER_SPECS[entry.player.characterClass].name,
      style: {
        fontFamily: 'monospace',
        fontSize: 14,
        fill: 0xcccccc,
        align: 'left',
      },
    });
    rowRoot.addChild(classText);

    const statsText = new Text({
      text: fmtRow(entry.player),
      style: {
        fontFamily: 'monospace',
        fontSize: 14,
        fill: 0xeeeeee,
        align: 'left',
      },
    });
    rowRoot.addChild(statsText);

    const scoreText = new Text({
      text: `${entry.score}`,
      style: {
        fontFamily: 'monospace',
        fontSize: 32,
        fill: entry.rank === 1 ? 0xffd84d : 0xffffff,
        align: 'right',
        fontWeight: 'bold',
      },
    });
    scoreText.anchor.set(1, 0);
    rowRoot.addChild(scoreText);

    return { root: rowRoot, bg, rankText, nameText, classText, statsText, scoreText };
  });

  const footer = new Text({
    text: 'Press Start / Enter to return to lobby',
    style: { fontFamily: 'monospace', fontSize: 16, fill: 0xaaaaaa, align: 'center' },
  });
  footer.anchor.set(0.5, 0);
  root.addChild(footer);

  let restart = false;

  // MVP heading (winner of the leaderboard, not necessarily the round-color winner).
  if (ranked.length > 0) {
    const mvp = ranked[0]!;
    const tied = ranked.length > 1 && ranked[1]!.score === mvp.score;
    if (tied) {
      mvpHeading.text = `TIE — top score: ${mvp.score}`;
      mvpHeading.style.fill = 0xffffff;
    } else {
      mvpHeading.text = `MVP — ${colorName(mvp.player.color)} (${CHARACTER_SPECS[mvp.player.characterClass].name})`;
      mvpHeading.style.fill = COLOR_HEX[mvp.player.color];
    }
  }

  // Sanity log so debugging the leaderboard score doesn't require breakpoints.
  // eslint-disable-next-line no-console
  console.log(
    'Beamfall match stats',
    ranked.map((r) => ({
      slot: r.player.slot,
      color: r.player.color,
      class: r.player.characterClass,
      rank: r.rank,
      score: r.score,
      stats: r.player.stats,
      computed: statsScore(r.player.stats),
    })),
  );

  const update = (viewportW: number, viewportH: number): void => {
    // Inputs first so the host sees `wantsRestart()` ASAP.
    let pressed = hooks.isKeyPressed('Enter') || hooks.isKeyPressed('Space');
    if (!pressed) {
      for (let g = 0; g < GAMEPAD_MAX; g++) {
        if (hooks.isGamepadButtonPressed(g, GAMEPAD_START)) { pressed = true; break; }
        if (hooks.isGamepadButtonPressed(g, GAMEPAD_A)) { pressed = true; break; }
      }
    }
    if (pressed) restart = true;

    // Layout.
    dim.clear();
    dim.rect(0, 0, viewportW, viewportH).fill({ color: 0x000000, alpha: 0.85 });

    title.x = viewportW / 2;
    title.y = 36;

    mvpHeading.x = viewportW / 2;
    mvpHeading.y = 96;

    formula.x = viewportW / 2;
    formula.y = 134;

    // Rows: vertically centered block.
    const rowsY0 = 170;
    const rowW = Math.min(900, viewportW - PADDING * 2);
    const rowX0 = (viewportW - rowW) / 2;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!;
      row.root.x = rowX0;
      row.root.y = rowsY0 + i * (ROW_H + 8);

      row.bg.clear();
      row.bg
        .rect(0, 0, rowW, ROW_H)
        .fill({ color: i === 0 ? 0x222a18 : 0x111418, alpha: 0.9 })
        .stroke({ width: 1, color: 0x333333 });

      row.rankText.x = 14;
      row.rankText.y = (ROW_H - row.rankText.height) / 2;

      row.nameText.x = 64;
      row.nameText.y = 6;

      row.classText.x = 64;
      row.classText.y = 32;

      row.statsText.x = 240;
      row.statsText.y = (ROW_H - row.statsText.height) / 2;

      row.scoreText.x = rowW - 16;
      row.scoreText.y = (ROW_H - row.scoreText.height) / 2;
    }

    footer.x = viewportW / 2;
    footer.y = Math.min(rowsY0 + rows.length * (ROW_H + 8) + 24, viewportH - 36);
  };

  const wantsRestart = (): boolean => restart;

  const destroy = (): void => {
    root.destroy({ children: true });
  };

  return { update, wantsRestart, destroy };
}
