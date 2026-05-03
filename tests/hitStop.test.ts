// Beamfall — hit-stop tests.
// When World.hitStopTimer > 0 the world.tick() during 'playing' must:
//   1) decrement the timer by dt
//   2) skip every gameplay system (movement, lasers, collision, etc.)
// Once the timer reaches 0, the next tick resumes normal updates.

import { describe, expect, it } from 'vitest';
import { tick, setInputProvider } from '@/game/world';
import type { CharacterClass, Color, InputSnapshot, Player, World } from '@/types';

function mkPlayer(slot: 0 | 1 | 2 | 3, color: Color, cls: CharacterClass, x: number, y: number): Player {
  return {
    id: (slot + 1) as never,
    slot,
    color,
    characterClass: cls,
    pos: { x, y },
    prevPos: { x, y },
    vel: { x: 0, y: 0 },
    alive: true,
    radius: 0.4,
    speed: 4,
    ability: { phase: 'idle', charge: 0, activeTimer: 0, marker: null, dashVel: null },
    effects: { stunTimer: 0, speedBoostTimer: 0, invincibleTimer: 0, knockback: { x: 0, y: 0 } },
    stats: { ultKills: 0, laserKills: 0, deaths: 0, captures: 0, thiefSteals: 0, shockHits: 0, roundsWon: 0 },
  };
}

function mkWorld(players: Player[]): World {
  return {
    state: 'playing',
    tickCount: 0,
    roundTimer: 30,
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
    hitStopTimer: 0,
    shake: 0,
    events: [],
  };
}

const NEUTRAL: InputSnapshot = { axisX: 0, axisY: 0, activate: false, power: false };

describe('hit-stop', () => {
  it('decrements hitStopTimer by dt without advancing gameplay', () => {
    const p = mkPlayer(0, 'red', 'smash', 2, 2);
    // Pre-load a velocity-driving input — if movement runs, pos.x should change.
    setInputProvider(() => [{ axisX: 1, axisY: 0, activate: false, power: false }]);
    const w = mkWorld([p]);
    w.hitStopTimer = 0.08;

    const dt = 1 / 120;
    tick(w, dt);

    expect(w.hitStopTimer).toBeCloseTo(0.08 - dt, 6);
    expect(p.pos.x).toBe(2); // movement skipped
    expect(p.pos.y).toBe(2);
  });

  it('does not advance laser scheduler while frozen', () => {
    const p = mkPlayer(0, 'red', 'smash', 2, 2);
    const w = mkWorld([p]);
    w.nodes = [
      { id: 100 as never, pos: { x: 4, y: 3 }, ownerColor: 'red', pattern: 'sweep', phase: 0.25, flashTimer: 0 },
    ];
    w.hitStopTimer = 0.08;
    const phaseBefore = w.nodes[0]!.phase;

    setInputProvider(() => [NEUTRAL]);
    tick(w, 1 / 120);

    expect(w.nodes[0]!.phase).toBe(phaseBefore);
    expect(w.lasers.length).toBe(0);
  });

  it('resumes normal updates once the timer reaches 0', () => {
    const p = mkPlayer(0, 'red', 'smash', 2, 2);
    const w = mkWorld([p]);
    w.hitStopTimer = 1 / 240; // less than one tick — will go to 0 this tick

    setInputProvider(() => [{ axisX: 1, axisY: 0, activate: false, power: false }]);
    tick(w, 1 / 120);
    expect(w.hitStopTimer).toBe(0);
    // This tick was the freeze tick — pos still untouched.
    expect(p.pos.x).toBe(2);

    // Next tick, hitStopTimer is 0 → movement runs.
    tick(w, 1 / 120);
    expect(p.pos.x).toBeGreaterThan(2);
  });
});
