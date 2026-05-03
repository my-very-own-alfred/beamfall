// Beamfall — replay determinism + encode/decode tests.

import { describe, expect, it } from 'vitest';
import {
  createPlayer,
  createRecorder,
  decodeSnapshot,
  encodeSnapshot,
} from '@/engine/replay';
import { createWorld, setInputProvider, tick } from '@/game/world';
import type { InputSnapshot, PlayerBinding } from '@/types';

describe('replay snapshot encoding', () => {
  it('round-trips representative axes + flags', () => {
    const cases: InputSnapshot[] = [
      { axisX: 0, axisY: 0, activate: false, power: false },
      { axisX: 1, axisY: 0, activate: true, power: false },
      { axisX: -1, axisY: 0, activate: false, power: true },
      { axisX: 0, axisY: 1, activate: true, power: true },
      { axisX: 0.5, axisY: -0.25, activate: false, power: false },
      { axisX: -0.99, axisY: 0.99, activate: true, power: false },
    ];
    for (const orig of cases) {
      const enc = encodeSnapshot(orig);
      const dec = decodeSnapshot(enc);
      expect(dec.activate).toBe(orig.activate);
      expect(dec.power).toBe(orig.power);
      // Encoding rounds to int8/127 — within ~1/127 tolerance.
      expect(Math.abs(dec.axisX - orig.axisX)).toBeLessThan(1 / 127 + 1e-6);
      expect(Math.abs(dec.axisY - orig.axisY)).toBeLessThan(1 / 127 + 1e-6);
    }
  });

  it('clamps out-of-range axes to ~ \u00b11', () => {
    const enc = encodeSnapshot({ axisX: 2.5, axisY: -2.5, activate: false, power: false });
    const dec = decodeSnapshot(enc);
    // After clamping the rounded byte to int8 [-128, 127] and dividing by 127,
    // values land within \u00b11.01 (the minor overshoot is the int8 asymmetry).
    expect(Math.abs(dec.axisX)).toBeLessThan(1.02);
    expect(Math.abs(dec.axisY)).toBeLessThan(1.02);
  });
});

describe('replay determinism', () => {
  it('reproduces identical player positions for the same seed + inputs', () => {
    const SEED = 12345;
    const bindings: PlayerBinding[] = [{ kind: 'keyboard', layout: 'wasd' }];

    // Build a deterministic input pattern: move right for 60 ticks, down for 60.
    const inputs: InputSnapshot[][] = [];
    for (let i = 0; i < 240; i++) {
      const phase = Math.floor(i / 60) % 4;
      let ax = 0;
      let ay = 0;
      if (phase === 0) ax = 1;
      else if (phase === 1) ay = 1;
      else if (phase === 2) ax = -1;
      else ay = -1;
      inputs.push([{ axisX: ax, axisY: ay, activate: false, power: false }]);
    }

    // ---- Recording run ---------------------------------------------------
    const w1 = createWorld(bindings, ['smash'], SEED);
    // Force into 'playing' state directly so movement runs.
    w1.state = 'playing';
    const recorder = createRecorder();
    let cursor1 = 0;
    setInputProvider(() => {
      const row = inputs[cursor1] ?? [
        { axisX: 0, axisY: 0, activate: false, power: false },
      ];
      cursor1++;
      recorder.record(row);
      return row;
    });

    const checkpoints = [30, 90, 150, 220];
    const recorded: { x: number; y: number }[] = [];
    for (let i = 0; i < 240; i++) {
      tick(w1, 1 / 120);
      if (checkpoints.includes(i + 1)) {
        const p = w1.players[0]!;
        recorded.push({ x: p.pos.x, y: p.pos.y });
      }
    }

    const replay = recorder.finalize({
      seed: SEED,
      bindings,
      characters: ['smash'],
      arenaId: 'grid8x6',
      mutators: [],
    });

    // ---- Playback run ----------------------------------------------------
    const w2 = createWorld(replay.bindings, replay.characters, replay.seed, replay.arenaId);
    w2.state = 'playing';
    const player = createPlayer(replay);
    setInputProvider(() => player.next());

    const replayed: { x: number; y: number }[] = [];
    for (let i = 0; i < 240; i++) {
      tick(w2, 1 / 120);
      if (checkpoints.includes(i + 1)) {
        const p = w2.players[0]!;
        replayed.push({ x: p.pos.x, y: p.pos.y });
      }
    }

    expect(replayed.length).toBe(recorded.length);
    for (let i = 0; i < recorded.length; i++) {
      expect(replayed[i]!.x).toBeCloseTo(recorded[i]!.x, 10);
      expect(replayed[i]!.y).toBeCloseTo(recorded[i]!.y, 10);
    }
  });
});
