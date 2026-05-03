// Beamfall — scoring/round-end pure-function tests.

import { describe, expect, it } from 'vitest';
import { checkRoundEnd } from '@/game/systems/scoring';
import type { Color, Player, World } from '@/types';

function mkPlayer(color: Color, alive: boolean): Player {
  return {
    id: 1 as never,
    slot: 0,
    color,
    characterClass: 'smash',
    pos: { x: 0, y: 0 },
    prevPos: { x: 0, y: 0 },
    vel: { x: 0, y: 0 },
    alive,
    radius: 0.4,
    speed: 4,
    ability: { phase: 'idle', charge: 0, activeTimer: 0, marker: null, dashVel: null },
    effects: { stunTimer: 0, speedBoostTimer: 0, invincibleTimer: 0, knockback: { x: 0, y: 0 } },
  };
}

function mkWorld(players: Player[], roundTimer: number): World {
  return {
    state: 'playing',
    tickCount: 0,
    roundTimer,
    roundNumber: 1,
    scores: { red: 0, blue: 0, yellow: 0, green: 0 },
    players,
    nodes: [],
    lasers: [],
    pickups: [],
    arena: { cols: 8, rows: 6, cellSize: 64, nodes: [], spawnPoints: [] },
    bindings: [],
    characters: [],
    rng: () => 0.5,
    pickupCooldown: 0,
  };
}

describe('checkRoundEnd', () => {
  it('returns ended+winner when only one color survives', () => {
    const w = mkWorld([mkPlayer('red', true), mkPlayer('blue', false)], 10);
    const r = checkRoundEnd(w);
    expect(r.ended).toBe(true);
    expect(r.winner).toBe('red');
  });

  it('returns ended with null winner on total wipe', () => {
    const w = mkWorld([mkPlayer('red', false), mkPlayer('blue', false)], 10);
    expect(checkRoundEnd(w)).toEqual({ ended: true, winner: null });
  });

  it('does not end while multiple colors are alive and timer > 0', () => {
    const w = mkWorld([mkPlayer('red', true), mkPlayer('blue', true)], 5);
    expect(checkRoundEnd(w).ended).toBe(false);
  });

  it('ties at timer=0 yield no winner', () => {
    const w = mkWorld(
      [mkPlayer('red', true), mkPlayer('red', true), mkPlayer('blue', true), mkPlayer('blue', true)],
      0,
    );
    const r = checkRoundEnd(w);
    expect(r.ended).toBe(true);
    expect(r.winner).toBe(null);
  });

  it('count-majority wins at timer=0', () => {
    const w = mkWorld(
      [mkPlayer('red', true), mkPlayer('red', true), mkPlayer('blue', true)],
      0,
    );
    const r = checkRoundEnd(w);
    expect(r.ended).toBe(true);
    expect(r.winner).toBe('red');
  });
});
