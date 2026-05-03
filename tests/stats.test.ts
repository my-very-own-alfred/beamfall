// Beamfall — stats scoring tests.

import { describe, expect, it } from 'vitest';
import {
  CAPTURE_PTS,
  DEATH_PTS,
  LASER_KILL_PTS,
  ROUND_WIN_PTS,
  SHOCK_PTS,
  THIEF_PTS,
  ULT_KILL_PTS,
  emptyStats,
  rankPlayers,
  statsScore,
} from '@/game/stats';
import type { Player } from '@/types';

function mkPlayer(slot: 0 | 1 | 2 | 3, statsPatch: Partial<ReturnType<typeof emptyStats>>): Player {
  return {
    id: (slot + 1) as never,
    slot,
    color: 'red',
    characterClass: 'smash',
    pos: { x: 0, y: 0 },
    prevPos: { x: 0, y: 0 },
    vel: { x: 0, y: 0 },
    alive: true,
    radius: 0.4,
    speed: 4,
    ability: { phase: 'idle', charge: 0, activeTimer: 0, marker: null, dashVel: null },
    effects: { stunTimer: 0, speedBoostTimer: 0, invincibleTimer: 0, knockback: { x: 0, y: 0 } },
    stats: { ...emptyStats(), ...statsPatch },
  };
}

describe('statsScore', () => {
  it('returns 0 for empty stats', () => {
    expect(statsScore(emptyStats())).toBe(0);
  });

  it('weights ult kills heaviest among kills', () => {
    expect(ULT_KILL_PTS).toBeGreaterThan(LASER_KILL_PTS);
  });

  it('combines all weights linearly', () => {
    const s = {
      ultKills: 2,
      laserKills: 3,
      captures: 4,
      thiefSteals: 1,
      shockHits: 2,
      roundsWon: 1,
      deaths: 5,
    };
    const expected =
      2 * ULT_KILL_PTS +
      3 * LASER_KILL_PTS +
      4 * CAPTURE_PTS +
      1 * THIEF_PTS +
      2 * SHOCK_PTS +
      1 * ROUND_WIN_PTS +
      5 * DEATH_PTS;
    expect(statsScore(s)).toBe(expected);
  });
});

describe('rankPlayers', () => {
  it('sorts highest score first and assigns 1-based ranks', () => {
    const players = [
      mkPlayer(0, { ultKills: 1 }), // 5
      mkPlayer(1, { ultKills: 3 }), // 15
      mkPlayer(2, { laserKills: 1 }), // 2
    ];
    const ranked = rankPlayers(players);
    expect(ranked.map((r) => r.player.slot)).toEqual([1, 0, 2]);
    expect(ranked.map((r) => r.rank)).toEqual([1, 2, 3]);
  });

  it('assigns the same rank to ties (competition ranking)', () => {
    const players = [
      mkPlayer(0, { ultKills: 2 }), // 10
      mkPlayer(1, { ultKills: 2 }), // 10
      mkPlayer(2, { ultKills: 1 }), // 5
    ];
    const ranked = rankPlayers(players);
    expect(ranked[0]!.rank).toBe(1);
    expect(ranked[1]!.rank).toBe(1);
    expect(ranked[2]!.rank).toBe(3);
  });

  it('penalizes deaths', () => {
    const a = mkPlayer(0, { ultKills: 2 }); // 10
    const b = mkPlayer(1, { ultKills: 2, deaths: 3 }); // 10 - 3 = 7
    const ranked = rankPlayers([a, b]);
    expect(ranked[0]!.player.slot).toBe(0);
    expect(ranked[1]!.player.slot).toBe(1);
  });
});
