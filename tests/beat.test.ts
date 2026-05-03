// Beamfall — beat-locked laser scheduler tests.
// Pure math: when world.beat is provided, pulse / segment-flip phases align
// to a 2-beat cycle. When absent, behavior matches legacy time-based path.

import { describe, expect, it } from 'vitest';
import { updateLaserScheduler } from '@/game/systems/laserScheduler';
import type { Color, World } from '@/types';

function mkWorld(): World {
  return {
    state: 'playing',
    tickCount: 0,
    roundTimer: 30,
    roundNumber: 1,
    scores: { red: 0, blue: 0, yellow: 0, green: 0 },
    players: [],
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

function mkNode(pattern: 'pulse' | 'segment-flip' | 'sweep'): World['nodes'][number] {
  return {
    id: 1 as never,
    pos: { x: 4, y: 3 },
    ownerColor: 'red' as Color,
    pattern,
    phase: 0,
    flashTimer: 0,
  };
}

describe('beat-locked laser scheduler — pulse/segment-flip snap', () => {
  it('snaps pulse phase to (count%2 + phase)/2 when beat is set', () => {
    const w = mkWorld();
    w.nodes = [mkNode('pulse')];
    // beat count=0, phase=0.5 -> snapped phase = (0 + 0.5) / 2 = 0.25
    w.beat = { phase: 0.5, bpm: 130, count: 0 };
    updateLaserScheduler(w, 1 / 120);
    expect(w.nodes[0]!.phase).toBeCloseTo(0.25, 6);
  });

  it('full cycle = 2 beats: count=1 phase=0.0 -> snapped 0.5', () => {
    const w = mkWorld();
    w.nodes = [mkNode('segment-flip')];
    w.beat = { phase: 0, bpm: 130, count: 1 };
    updateLaserScheduler(w, 1 / 120);
    expect(w.nodes[0]!.phase).toBeCloseTo(0.5, 6);
  });

  it('count=2 (= count%2 = 0) wraps back to 0', () => {
    const w = mkWorld();
    w.nodes = [mkNode('pulse')];
    w.beat = { phase: 0, bpm: 130, count: 2 };
    updateLaserScheduler(w, 1 / 120);
    expect(w.nodes[0]!.phase).toBeCloseTo(0, 6);
  });
});

describe('beat-locked laser scheduler — sweep accent', () => {
  it('phase advances faster on the upbeat half', () => {
    const wA = mkWorld();
    wA.nodes = [mkNode('sweep')];
    wA.beat = { phase: 0.25, bpm: 130, count: 0 }; // upbeat -> 1.15x

    const wB = mkWorld();
    wB.nodes = [mkNode('sweep')];
    wB.beat = { phase: 0.75, bpm: 130, count: 0 }; // downbeat -> 1.0x

    const dt = 1 / 60;
    updateLaserScheduler(wA, dt);
    updateLaserScheduler(wB, dt);
    expect(wA.nodes[0]!.phase).toBeGreaterThan(wB.nodes[0]!.phase);
  });
});

describe('beat-locked laser scheduler — legacy fallback', () => {
  it('without world.beat, pulse advances by dt*rate (legacy)', () => {
    const w = mkWorld();
    w.nodes = [mkNode('pulse')];
    // no beat field set
    const dt = 1 / 60;
    updateLaserScheduler(w, dt);
    // 'pulse' rate is 0.6 cycles/sec.
    expect(w.nodes[0]!.phase).toBeCloseTo(dt * 0.6, 6);
  });
});
