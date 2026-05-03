// Beamfall — gameplay event sink tests.
// Covers push semantics, drain-and-clear, and that representative systems
// emit the expected events (capture, kill, ability trigger, pickup).

import { describe, expect, it } from 'vitest';
import { drainEvents, pushEvent } from '@/game/events';
import type { GameEvent } from '@/game/events';
import { updateAbilities } from '@/game/systems/abilities';
import { updateCollision } from '@/game/systems/collision';
import { updateNodeActivation } from '@/game/systems/nodeActivation';
import { updatePickups } from '@/game/systems/pickups';
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
    ability: { phase: 'idle', charge: 1, activeTimer: 0, marker: null, dashVel: null },
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
const PWR = (axisX = 1, axisY = 0): InputSnapshot => ({ axisX, axisY, activate: false, power: true });

describe('event queue plumbing', () => {
  it('push appends', () => {
    const buf: GameEvent[] = [];
    pushEvent(buf, { kind: 'capture' });
    pushEvent(buf, { kind: 'roundEnd' });
    expect(buf.length).toBe(2);
    expect(buf[0]!.kind).toBe('capture');
  });

  it('drain returns and clears', () => {
    const buf: GameEvent[] = [{ kind: 'capture' }, { kind: 'matchEnd' }];
    const drained = drainEvents(buf);
    expect(drained.length).toBe(2);
    expect(buf.length).toBe(0);
  });

  it('drain on empty queue is a no-op', () => {
    const buf: GameEvent[] = [];
    expect(drainEvents(buf).length).toBe(0);
    expect(buf.length).toBe(0);
  });
});

describe('systems emit events', () => {
  it('node capture pushes a "capture" event on color change only', () => {
    const p = mkPlayer(0, 'red', 'smash', 3, 2);
    const w = mkWorld([p]);
    w.nodes = [
      { id: 100 as never, pos: { x: 3, y: 2 }, ownerColor: null, pattern: 'sweep', phase: 0, flashTimer: 0 },
    ];
    updateNodeActivation(w);
    expect(w.events.filter((e) => e.kind === 'capture').length).toBe(1);
    // Second tick — same color owner, no new event.
    updateNodeActivation(w);
    expect(w.events.filter((e) => e.kind === 'capture').length).toBe(1);
  });

  it('laser collision pushes a "kill { cause: laser }" event', () => {
    const victim = mkPlayer(0, 'red', 'smash', 4, 3);
    const w = mkWorld([victim]);
    w.lasers = [
      {
        id: 999 as never,
        ownerColor: 'blue',
        segA: { x: 3, y: 3 },
        segB: { x: 5, y: 3 },
        prevSegA: { x: 3, y: 3 },
        prevSegB: { x: 5, y: 3 },
        active: true,
      },
    ];
    updateCollision(w);
    const killEvts = w.events.filter((e): e is { kind: 'kill'; cause: 'laser' | 'blade' | 'snipe' } => e.kind === 'kill');
    expect(killEvts.length).toBe(1);
    expect(killEvts[0]!.cause).toBe('laser');
  });

  it('BLADE dash hit pushes "abilityTrigger" + "kill blade"', () => {
    const caster = mkPlayer(0, 'red', 'blade', 2, 3);
    const enemy = mkPlayer(1, 'blue', 'smash', 2.3, 3);
    const w = mkWorld([caster, enemy]);
    updateAbilities(w, [PWR(1, 0), NEUTRAL], 1 / 120);
    expect(w.events.some((e) => e.kind === 'abilityTrigger' && e.class === 'blade')).toBe(true);
    expect(w.events.some((e) => e.kind === 'kill' && e.cause === 'blade')).toBe(true);
  });

  it('SHOCK trigger pushes "abilityTrigger { class: shock }"', () => {
    const caster = mkPlayer(0, 'red', 'shock', 4, 3);
    const w = mkWorld([caster]);
    updateAbilities(w, [PWR()], 1 / 120);
    expect(w.events.some((e) => e.kind === 'abilityTrigger' && e.class === 'shock')).toBe(true);
  });

  it('SNIPE arm and fire push distinct events', () => {
    const caster = mkPlayer(0, 'red', 'snipe', 2, 2);
    const w = mkWorld([caster]);
    updateAbilities(w, [PWR()], 1 / 120);
    expect(w.events.some((e) => e.kind === 'snipeArm')).toBe(true);
    // Move and fire.
    caster.pos = { x: 6, y: 2 };
    updateAbilities(w, [PWR()], 1 / 120);
    expect(w.events.some((e) => e.kind === 'snipeFire')).toBe(true);
  });

  it('pickup collection pushes "pickupCollected"', () => {
    const p = mkPlayer(0, 'red', 'smash', 3, 3);
    const w = mkWorld([p]);
    w.pickups = [{ id: 200 as never, pos: { x: 3, y: 3 }, kind: 'speed' }];
    // Disable spawning so we don't introduce other state.
    w.pickupsEnabled = false;
    updatePickups(w, 1 / 120);
    expect(w.events.some((e) => e.kind === 'pickupCollected' && e.pickup === 'speed')).toBe(true);
  });
});
