// Beamfall — ability system tests.

import { describe, expect, it } from 'vitest';
import { updateAbilities } from '@/game/systems/abilities';
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
  };
}

const PWR = (axisX = 1, axisY = 0): InputSnapshot => ({
  axisX, axisY, activate: false, power: true,
});
const NEUTRAL: InputSnapshot = { axisX: 0, axisY: 0, activate: false, power: false };

describe('SHOCK', () => {
  it('stuns enemies in range and resets their charge', () => {
    const caster = mkPlayer(0, 'red', 'shock', 4, 3);
    const enemy = mkPlayer(1, 'blue', 'smash', 4.5, 3);
    enemy.ability.charge = 0.8;
    const w = mkWorld([caster, enemy]);
    updateAbilities(w, [PWR(), NEUTRAL], 1 / 120);
    expect(enemy.effects.stunTimer).toBeGreaterThan(0);
    expect(enemy.ability.charge).toBe(0);
  });

  it('does not affect same-color teammates', () => {
    const caster = mkPlayer(0, 'red', 'shock', 4, 3);
    const ally = mkPlayer(1, 'red', 'smash', 4.5, 3);
    const w = mkWorld([caster, ally]);
    updateAbilities(w, [PWR(), NEUTRAL], 1 / 120);
    expect(ally.effects.stunTimer).toBe(0);
  });

  it('does not affect enemies out of range', () => {
    const caster = mkPlayer(0, 'red', 'shock', 1, 1);
    const far = mkPlayer(1, 'blue', 'smash', 6, 5);
    const w = mkWorld([caster, far]);
    updateAbilities(w, [PWR(), NEUTRAL], 1 / 120);
    expect(far.effects.stunTimer).toBe(0);
  });
});

describe('THIEF', () => {
  it('swaps the nearest in-range enemy node to the caster color', () => {
    const caster = mkPlayer(0, 'red', 'thief', 2, 2);
    const w = mkWorld([caster]);
    w.nodes = [
      { id: 100 as never, pos: { x: 3, y: 2 }, ownerColor: 'blue', pattern: 'sweep', phase: 0 },
      { id: 101 as never, pos: { x: 2, y: 2.4 }, ownerColor: 'green', pattern: 'sweep', phase: 0 },
    ];
    updateAbilities(w, [PWR()], 1 / 120);
    // Closest is the green one (~0.4 away) — should be the swap target.
    expect(w.nodes[1]!.ownerColor).toBe('red');
    expect(w.nodes[0]!.ownerColor).toBe('blue');
  });

  it('does not consume charge if no eligible node in range', () => {
    const caster = mkPlayer(0, 'red', 'thief', 2, 2);
    const w = mkWorld([caster]);
    w.nodes = [
      { id: 100 as never, pos: { x: 7, y: 5 }, ownerColor: 'blue', pattern: 'sweep', phase: 0 },
    ];
    updateAbilities(w, [PWR()], 1 / 120);
    expect(w.nodes[0]!.ownerColor).toBe('blue');
    expect(caster.ability.charge).toBe(1);
  });
});

describe('GHOST', () => {
  it('enters active phase on trigger and counts down', () => {
    const caster = mkPlayer(0, 'red', 'ghost', 2, 2);
    const w = mkWorld([caster]);
    updateAbilities(w, [PWR()], 1 / 120);
    expect(caster.ability.phase).toBe('active');
    expect(caster.ability.activeTimer).toBeGreaterThan(0);
  });
});

describe('SNIPE', () => {
  it('arms on first press, teleports + kills on second', () => {
    const caster = mkPlayer(0, 'red', 'snipe', 2, 2);
    const enemy = mkPlayer(1, 'blue', 'smash', 4, 2); // on the line
    const w = mkWorld([caster, enemy]);

    updateAbilities(w, [PWR(), NEUTRAL], 1 / 120);
    expect(caster.ability.phase).toBe('armed');
    expect(caster.ability.marker).toEqual({ x: 2, y: 2 });

    // Move caster to the right, then press again to teleport back.
    caster.pos = { x: 6, y: 2 };
    updateAbilities(w, [PWR(), NEUTRAL], 1 / 120);
    expect(caster.pos).toEqual({ x: 2, y: 2 });
    expect(enemy.alive).toBe(false);
  });
});

describe('BLADE', () => {
  it('refills gauge on hit and consumes the dash', () => {
    const caster = mkPlayer(0, 'red', 'blade', 2, 3);
    const enemy = mkPlayer(1, 'blue', 'smash', 2.3, 3);
    const w = mkWorld([caster, enemy]);
    updateAbilities(w, [PWR(1, 0), NEUTRAL], 1 / 120);
    // Active window opens; dash hit resolved this same tick.
    expect(enemy.alive).toBe(false);
    expect(caster.ability.charge).toBe(1);
    expect(caster.ability.phase).toBe('idle');
  });
});

describe('SMASH', () => {
  it('applies knockback velocity to a struck enemy', () => {
    const caster = mkPlayer(0, 'red', 'smash', 2, 3);
    const enemy = mkPlayer(1, 'blue', 'ghost', 2.5, 3);
    const w = mkWorld([caster, enemy]);
    updateAbilities(w, [PWR(1, 0), NEUTRAL], 1 / 120);
    expect(enemy.effects.knockback.x).toBeGreaterThan(0);
    expect(enemy.alive).toBe(true);
  });
});
