/**
 * Seeded pseudo-random number generator.
 *
 * The whole simulation is deterministic per seed: a given seed always replays
 * the exact same game. Variety across games comes from sweeping many seeds in
 * the harness, not from non-determinism. No code in `src/engine` may call
 * `Math.random` — all randomness flows through an injected `Rng`.
 *
 * Uses mulberry32: a tiny, fast, well-distributed 32-bit generator.
 */
export class Rng {
  private state: number;

  constructor(seed: number) {
    // Force into an unsigned 32-bit integer; avoid a 0 state degenerate-ish start.
    this.state = (seed >>> 0) || 0x9e3779b9;
  }

  /** Next float in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    if (max < min) [min, max] = [max, min];
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** Float in [min, max). */
  float(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** True with probability p (clamped to [0, 1]). */
  chance(p: number): boolean {
    return this.next() < p;
  }

  /** Uniformly pick one element. Throws on empty input. */
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error("Rng.pick on empty array");
    return items[this.int(0, items.length - 1)]!;
  }

  /** In-place Fisher–Yates shuffle; returns the same array for convenience. */
  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      [items[i], items[j]] = [items[j]!, items[i]!];
    }
    return items;
  }
}
