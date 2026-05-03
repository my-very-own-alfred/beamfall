// Beamfall — seeded PRNG (xoshiro128**).
// Deterministic random source for round generation, pickup spawns, and any
// gameplay roll that must replay identically given the same seed.

/**
 * splitmix32 — used to expand a single 32-bit seed into the 4 words of
 * xoshiro128** internal state. Standard reference implementation.
 */
function splitmix32(seed: number): () => number {
  let s = seed >>> 0;
  return (): number => {
    s = (s + 0x9e3779b9) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
    return (z ^ (z >>> 16)) >>> 0;
  };
}

/**
 * Create a seeded PRNG using xoshiro128**. Returns a function that yields
 * uniform floats in [0, 1).
 *
 * The state is initialized from `seed` via splitmix32 to ensure good bit
 * distribution even from low-entropy seeds (e.g. small integers).
 */
export function makeRng(seed: number): () => number {
  const sm = splitmix32(seed | 0);
  let s0 = sm();
  let s1 = sm();
  let s2 = sm();
  let s3 = sm();

  return (): number => {
    // xoshiro128** scrambler
    const result = (Math.imul(s1, 5) << 7) | (Math.imul(s1, 5) >>> 25);
    const scrambled = Math.imul(result, 9) >>> 0;

    const t = (s1 << 9) >>> 0;

    s2 = (s2 ^ s0) >>> 0;
    s3 = (s3 ^ s1) >>> 0;
    s1 = (s1 ^ s2) >>> 0;
    s0 = (s0 ^ s3) >>> 0;

    s2 = (s2 ^ t) >>> 0;
    s3 = ((s3 << 11) | (s3 >>> 21)) >>> 0;

    // Convert 32 bits to [0, 1). Divide by 2^32.
    return scrambled / 0x100000000;
  };
}
