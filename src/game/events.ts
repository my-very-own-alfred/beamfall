// Beamfall — gameplay event sink.
//
// Systems push GameEvents into world.events. The host (main.ts) drains the
// queue once per render frame and dispatches them to the audio engine. Keeping
// this queue inside `World` lets the replay system reproduce the same audio
// timeline without ever importing the audio engine from gameplay code.
//
// Events are append-only within a tick and cleared by the consumer (the host
// drains; the gameplay sim never reads them back). This preserves the one-way
// data flow input -> sim -> render/audio.

import type { CharacterClass, PickupKind } from '@/types';

/** Cause attribution for a kill event. Drives which SFX is played. */
export type KillCause = 'laser' | 'blade' | 'snipe';

/**
 * Discriminated-union of all gameplay-emitted audio cues.
 *
 * Determinism: events are produced by deterministic systems given a fixed
 * input stream and seed, so a recorded match replays the same audio.
 */
export type GameEvent =
  | { kind: 'kill'; cause: KillCause }
  | { kind: 'capture' }
  | { kind: 'pickupCollected'; pickup: PickupKind }
  | { kind: 'abilityTrigger'; class: CharacterClass }
  | { kind: 'snipeArm' }
  | { kind: 'snipeFire' }
  | { kind: 'roundEnd' }
  | { kind: 'matchEnd' }
  | { kind: 'countdownTick'; value: number };

/** Push helper. Equivalent to `world.events.push(ev)` but keeps the import surface small. */
export function pushEvent(events: GameEvent[], ev: GameEvent): void {
  events.push(ev);
}

/**
 * Drain (return + clear) the event queue. Caller takes ownership of the
 * returned array. Used by the host audio dispatch on each render frame.
 */
export function drainEvents(events: GameEvent[]): GameEvent[] {
  if (events.length === 0) return [];
  const out = events.slice();
  events.length = 0;
  return out;
}
