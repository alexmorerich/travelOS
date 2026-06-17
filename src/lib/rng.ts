// Deterministic, seedable PRNG (mulberry32) + Gaussian sampler (Box-Muller).
// Every stochastic step in the system draws from one of these so a given
// (dataset, seed) pair is fully reproducible.

export interface Rng {
  uniform(): number;
  normal(mean: number, sd: number): number;
}

export function makeRng(seed: number): Rng {
  let s = seed >>> 0;

  const uniform = (): number => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  let spare: number | null = null;
  const normal = (mean: number, sd: number): number => {
    if (spare !== null) {
      const z = spare;
      spare = null;
      return mean + sd * z;
    }
    let u1 = 0;
    while (u1 === 0) u1 = uniform();
    const u2 = uniform();
    const r = Math.sqrt(-2 * Math.log(u1));
    const z0 = r * Math.cos(2 * Math.PI * u2);
    spare = r * Math.sin(2 * Math.PI * u2);
    return mean + sd * z0;
  };

  return { uniform, normal };
}

/** Mix two integers into a fresh 32-bit seed (for per-year / per-path streams). */
export function deriveSeed(base: number, salt: number): number {
  return (base ^ Math.imul(salt, 0x9e3779b1)) >>> 0;
}
