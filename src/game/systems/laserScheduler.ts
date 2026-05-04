// Beamfall — laser scheduler system.
// Rebuilds the active laser list each tick from owned nodes. Lasers are
// transient: they live exactly one tick before being regenerated.
//
// Patterns:
//   sweep        — single radial beam rotating CCW around the node.
//   rotate       — two opposing beams (pi-offset) rotating CCW; covers more.
//   pulse        — fixed-axis beam that toggles on/off on each half-period.
//                  Off-phase produces no segment (collision-safe gap).
//   segment-flip — horizontal vs. vertical beam, alternating each half-period.
//   zigzag       — single beam wiping a ~90° arc around the horizontal axis,
//                  driven by sin(phase·2π).
//   ring         — 8 short tangent segments forming an expanding ring whose
//                  radius cycles 0.3 → 2.8 cells, then resets each cycle.
//   pendulum     — single beam swinging back-and-forth across ~150° via
//                  ease-in-out around the horizontal axis.

import type { Color, EntityId, LaserPattern, LaserSegment, Vec2, World } from '@/types';

/** Phase advance per second by pattern (cycles/sec). */
const RATES: Record<LaserPattern, number> = {
  sweep: 0.4,
  rotate: 0.35,
  pulse: 0.6,
  'segment-flip': 0.5,
  zigzag: 0.55,
  ring: 0.45,
  pendulum: 0.4,
  'cross-rotate': 0.3,
  spiral: 0.6,
  wave: 0.7,
  star: 0.55,
};

const CROSS_LENGTH = 3.5;
const SPIRAL_LENGTH = 3.5;
const WAVE_LENGTH = 4;
const WAVE_AMPLITUDE = 1.2;
const WAVE_SAMPLES = 12; // segments approximating the curve
const STAR_LENGTH = 3;
const STAR_ARMS = 5;

/** Beam half-length (radial patterns) or full-length (axis patterns). */
const SWEEP_LENGTH = 3;
const PULSE_LENGTH = 3.5;
const FLIP_LENGTH = 3;
const ZIGZAG_LENGTH = 3;
const PENDULUM_LENGTH = 3;
const PENDULUM_HALF_ARC = (150 * Math.PI) / 180 / 2; // ±75° around horizontal axis
const ZIGZAG_HALF_ARC = (90 * Math.PI) / 180 / 2; // ±45° around horizontal axis
const RING_R_MIN = 0.3;
const RING_R_MAX = 2.8;
const RING_TANGENT_COUNT = 8;
const RING_TANGENT_HALF = (Math.PI / RING_TANGENT_COUNT) * 0.9; // segment length along tangent

const TWO_PI = Math.PI * 2;

let nextLaserId = 1;
function allocLaserId(): EntityId {
  return nextLaserId++ as EntityId;
}

function wrapPhase(p: number): number {
  let r = p % 1;
  if (r < 0) r += 1;
  return r;
}

function makeSeg(
  id: EntityId,
  ownerColor: Color,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  pax: number,
  pay: number,
  pbx: number,
  pby: number,
): LaserSegment {
  return {
    id,
    ownerColor,
    segA: { x: ax, y: ay },
    segB: { x: bx, y: by },
    prevSegA: { x: pax, y: pay },
    prevSegB: { x: pbx, y: pby },
    active: true,
  };
}

function buildSegments(
  origin: Vec2,
  ownerColor: Color,
  prevPhase: number,
  newPhase: number,
  pattern: LaserPattern,
): LaserSegment[] {
  switch (pattern) {
    case 'sweep': {
      const a = newPhase * TWO_PI;
      const pa = prevPhase * TWO_PI;
      return [
        makeSeg(
          allocLaserId(),
          ownerColor,
          origin.x,
          origin.y,
          origin.x + Math.cos(a) * SWEEP_LENGTH,
          origin.y + Math.sin(a) * SWEEP_LENGTH,
          origin.x,
          origin.y,
          origin.x + Math.cos(pa) * SWEEP_LENGTH,
          origin.y + Math.sin(pa) * SWEEP_LENGTH,
        ),
      ];
    }
    case 'rotate': {
      const a = newPhase * TWO_PI;
      const pa = prevPhase * TWO_PI;
      const segs: LaserSegment[] = [];
      for (const k of [0, 1] as const) {
        const off = k * Math.PI;
        segs.push(
          makeSeg(
            allocLaserId(),
            ownerColor,
            origin.x,
            origin.y,
            origin.x + Math.cos(a + off) * SWEEP_LENGTH,
            origin.y + Math.sin(a + off) * SWEEP_LENGTH,
            origin.x,
            origin.y,
            origin.x + Math.cos(pa + off) * SWEEP_LENGTH,
            origin.y + Math.sin(pa + off) * SWEEP_LENGTH,
          ),
        );
      }
      return segs;
    }
    case 'pulse': {
      // Beam on during [0, 0.5), off during [0.5, 1). Horizontal axis.
      if (newPhase >= 0.5) return [];
      return [
        makeSeg(
          allocLaserId(),
          ownerColor,
          origin.x - PULSE_LENGTH,
          origin.y,
          origin.x + PULSE_LENGTH,
          origin.y,
          origin.x - PULSE_LENGTH,
          origin.y,
          origin.x + PULSE_LENGTH,
          origin.y,
        ),
      ];
    }
    case 'segment-flip': {
      // Horizontal during [0, 0.5), vertical during [0.5, 1).
      if (newPhase < 0.5) {
        return [
          makeSeg(
            allocLaserId(),
            ownerColor,
            origin.x - FLIP_LENGTH,
            origin.y,
            origin.x + FLIP_LENGTH,
            origin.y,
            origin.x - FLIP_LENGTH,
            origin.y,
            origin.x + FLIP_LENGTH,
            origin.y,
          ),
        ];
      }
      return [
        makeSeg(
          allocLaserId(),
          ownerColor,
          origin.x,
          origin.y - FLIP_LENGTH,
          origin.x,
          origin.y + FLIP_LENGTH,
          origin.x,
          origin.y - FLIP_LENGTH,
          origin.x,
          origin.y + FLIP_LENGTH,
        ),
      ];
    }
    case 'zigzag': {
      // Beam wipes a ~90° arc around horizontal axis using sin(phase·2π).
      const a = Math.sin(newPhase * TWO_PI) * ZIGZAG_HALF_ARC;
      const pa = Math.sin(prevPhase * TWO_PI) * ZIGZAG_HALF_ARC;
      return [
        makeSeg(
          allocLaserId(),
          ownerColor,
          origin.x,
          origin.y,
          origin.x + Math.cos(a) * ZIGZAG_LENGTH,
          origin.y + Math.sin(a) * ZIGZAG_LENGTH,
          origin.x,
          origin.y,
          origin.x + Math.cos(pa) * ZIGZAG_LENGTH,
          origin.y + Math.sin(pa) * ZIGZAG_LENGTH,
        ),
      ];
    }
    case 'ring': {
      // 8 short tangent segments around an expanding radius. Radius cycles
      // RING_R_MIN -> RING_R_MAX over [0,1) then snaps back at wrap.
      const radius = RING_R_MIN + (RING_R_MAX - RING_R_MIN) * newPhase;
      const prevRadius = RING_R_MIN + (RING_R_MAX - RING_R_MIN) * prevPhase;
      const segs: LaserSegment[] = [];
      for (let k = 0; k < RING_TANGENT_COUNT; k++) {
        const theta = (k / RING_TANGENT_COUNT) * TWO_PI;
        // Tangent direction at this point on the circle.
        const tx = -Math.sin(theta);
        const ty = Math.cos(theta);
        const cx = origin.x + Math.cos(theta) * radius;
        const cy = origin.y + Math.sin(theta) * radius;
        const pcx = origin.x + Math.cos(theta) * prevRadius;
        const pcy = origin.y + Math.sin(theta) * prevRadius;
        const halfLen = radius * RING_TANGENT_HALF;
        const pHalfLen = prevRadius * RING_TANGENT_HALF;
        segs.push(
          makeSeg(
            allocLaserId(),
            ownerColor,
            cx - tx * halfLen,
            cy - ty * halfLen,
            cx + tx * halfLen,
            cy + ty * halfLen,
            pcx - tx * pHalfLen,
            pcy - ty * pHalfLen,
            pcx + tx * pHalfLen,
            pcy + ty * pHalfLen,
          ),
        );
      }
      return segs;
    }
    case 'pendulum': {
      // Back-and-forth swing across ~150° via sin(phase·2π) ease-in-out.
      const a = Math.sin(newPhase * TWO_PI) * PENDULUM_HALF_ARC;
      const pa = Math.sin(prevPhase * TWO_PI) * PENDULUM_HALF_ARC;
      return [
        makeSeg(
          allocLaserId(),
          ownerColor,
          origin.x,
          origin.y,
          origin.x + Math.cos(a) * PENDULUM_LENGTH,
          origin.y + Math.sin(a) * PENDULUM_LENGTH,
          origin.x,
          origin.y,
          origin.x + Math.cos(pa) * PENDULUM_LENGTH,
          origin.y + Math.sin(pa) * PENDULUM_LENGTH,
        ),
      ];
    }
    case 'cross-rotate': {
      // 4 perpendicular arms rotating together. Heavy area coverage.
      const a = newPhase * TWO_PI;
      const pa = prevPhase * TWO_PI;
      const segs: LaserSegment[] = [];
      for (let k = 0; k < 4; k++) {
        const off = (k * Math.PI) / 2;
        segs.push(
          makeSeg(
            allocLaserId(),
            ownerColor,
            origin.x,
            origin.y,
            origin.x + Math.cos(a + off) * CROSS_LENGTH,
            origin.y + Math.sin(a + off) * CROSS_LENGTH,
            origin.x,
            origin.y,
            origin.x + Math.cos(pa + off) * CROSS_LENGTH,
            origin.y + Math.sin(pa + off) * CROSS_LENGTH,
          ),
        );
      }
      return segs;
    }
    case 'spiral': {
      // One arm whose length grows with phase while rotating; wraps & resets.
      const turns = 2.5; // angular turns per cycle
      const a = newPhase * TWO_PI * turns;
      const pa = prevPhase * TWO_PI * turns;
      const len = SPIRAL_LENGTH * (0.3 + 0.7 * newPhase);
      const plen = SPIRAL_LENGTH * (0.3 + 0.7 * prevPhase);
      return [
        makeSeg(
          allocLaserId(),
          ownerColor,
          origin.x,
          origin.y,
          origin.x + Math.cos(a) * len,
          origin.y + Math.sin(a) * len,
          origin.x,
          origin.y,
          origin.x + Math.cos(pa) * plen,
          origin.y + Math.sin(pa) * plen,
        ),
      ];
    }
    case 'wave': {
      // Horizontal beam approximated by N short segments where y is sin-modulated.
      // The wave travels along x as phase advances. Visually a moving sine.
      const segs: LaserSegment[] = [];
      const k = TWO_PI * 1.4; // wavenumber (peaks per unit length)
      const phaseOffset = newPhase * TWO_PI;
      const prevPhaseOffset = prevPhase * TWO_PI;
      for (let i = 0; i < WAVE_SAMPLES; i++) {
        const t0 = i / WAVE_SAMPLES;
        const t1 = (i + 1) / WAVE_SAMPLES;
        const x0 = origin.x - WAVE_LENGTH + 2 * WAVE_LENGTH * t0;
        const x1 = origin.x - WAVE_LENGTH + 2 * WAVE_LENGTH * t1;
        const y0 = origin.y + Math.sin(t0 * 2 * WAVE_LENGTH * k + phaseOffset) * WAVE_AMPLITUDE;
        const y1 = origin.y + Math.sin(t1 * 2 * WAVE_LENGTH * k + phaseOffset) * WAVE_AMPLITUDE;
        const py0 = origin.y + Math.sin(t0 * 2 * WAVE_LENGTH * k + prevPhaseOffset) * WAVE_AMPLITUDE;
        const py1 = origin.y + Math.sin(t1 * 2 * WAVE_LENGTH * k + prevPhaseOffset) * WAVE_AMPLITUDE;
        segs.push(makeSeg(allocLaserId(), ownerColor, x0, y0, x1, y1, x0, py0, x1, py1));
      }
      return segs;
    }
    case 'star': {
      // 5 fixed-angle arms; each arm pulses on/off in a phased rotation around
      // the star so it looks like a chasing star. Two arms active at any time.
      const segs: LaserSegment[] = [];
      for (let k = 0; k < STAR_ARMS; k++) {
        const armPhase = wrapPhase(newPhase - k / STAR_ARMS);
        if (armPhase >= 0.4) continue; // arm is "off" 60% of the time
        const angle = (k / STAR_ARMS) * TWO_PI;
        segs.push(
          makeSeg(
            allocLaserId(),
            ownerColor,
            origin.x,
            origin.y,
            origin.x + Math.cos(angle) * STAR_LENGTH,
            origin.y + Math.sin(angle) * STAR_LENGTH,
            origin.x,
            origin.y,
            origin.x + Math.cos(angle) * STAR_LENGTH,
            origin.y + Math.sin(angle) * STAR_LENGTH,
          ),
        );
      }
      return segs;
    }
  }
}

/**
 * Clear and repopulate world.lasers based on current node ownership. Called
 * once per tick during the 'playing' state.
 *
 * Beat-locking: when `world.beat` is defined, certain patterns align to
 * musical beats:
 *   - 'pulse', 'segment-flip': phase is *snapped* to a 2-beat full cycle so
 *     the on/off (or H/V) toggle lands exactly on beat boundaries.
 *   - 'sweep', 'rotate': soft 1.15x phase-rate accent during the upbeat half
 *     of each beat (count % 1 < 0.5).
 *   - 'zigzag', 'ring', 'pendulum': unchanged (their motion already feels
 *     fluid; locking them looks robotic).
 *
 * If `world.beat` is undefined, behavior is identical to the pre-audio code
 * path — required for replay determinism on legacy recordings.
 */
export function updateLaserScheduler(world: World, dt: number): void {
  world.lasers.length = 0;

  const beat = world.beat;

  for (const node of world.nodes) {
    // Decay the visual flash timer regardless of ownership — purely cosmetic.
    if (node.flashTimer > 0) {
      node.flashTimer = Math.max(0, node.flashTimer - dt);
    }

    if (node.ownerColor === null) continue;

    const prevPhase = node.phase;
    const rateMul = world.laserRateMultiplier ?? 1;

    let newPhase: number;
    if (beat !== undefined && (node.pattern === 'pulse' || node.pattern === 'segment-flip')) {
      // Snap: full pattern cycle = 2 beats. phase = ((count % 2) + phase-in-beat) / 2.
      const beatPos = ((beat.count % 2) + beat.phase) / 2;
      newPhase = wrapPhase(beatPos);
    } else if (beat !== undefined && (node.pattern === 'sweep' || node.pattern === 'rotate')) {
      // Soft accent: 1.15x rate on the upbeat half of each beat.
      const accent = beat.phase < 0.5 ? 1.15 : 1.0;
      newPhase = wrapPhase(prevPhase + dt * RATES[node.pattern] * rateMul * accent);
    } else {
      newPhase = wrapPhase(prevPhase + dt * RATES[node.pattern] * rateMul);
    }
    node.phase = newPhase;

    const segs = buildSegments(node.pos, node.ownerColor, prevPhase, newPhase, node.pattern);
    for (const s of segs) world.lasers.push(s);
  }
}
