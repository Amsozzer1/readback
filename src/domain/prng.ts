// Seeded randomness for the simulator. sfc32 (Chris Doty-Humphrey's Small Fast Counter,
// public domain) seeded through splitmix32. No Math.random anywhere on a measured path.

function splitmix32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x9e3779b9) | 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
    return (z ^ (z >>> 16)) >>> 0;
  };
}

function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export class Rng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;

  /** `stream` names an independent sequence for the same seed (e.g. "world", "faults"). */
  constructor(seed: number, stream: string) {
    const next = splitmix32((seed >>> 0) ^ fnv1a(stream));
    this.a = next();
    this.b = next();
    this.c = next();
    this.d = next();
    for (let i = 0; i < 12; i++) this.uint32();
  }

  uint32(): number {
    const t = (((this.a + this.b) | 0) + this.d) | 0;
    this.d = (this.d + 1) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.c = (this.c + t) | 0;
    return t >>> 0;
  }

  /** Uniform in [0, 1). */
  float(): number {
    return this.uint32() / 4294967296;
  }

  /** Uniform integer in [lo, hi], inclusive. */
  int(lo: number, hi: number): number {
    return lo + Math.floor(this.float() * (hi - lo + 1));
  }

  pick<T>(items: readonly T[]): T {
    const item = items[this.int(0, items.length - 1)];
    if (item === undefined) throw new Error("pick from empty list");
    return item;
  }

  /** Picks by weight; weights need not sum to 1. */
  weighted<T>(items: readonly (readonly [T, number])[]): T {
    const total = items.reduce((sum, [, w]) => sum + w, 0);
    let u = this.float() * total;
    for (const [item, w] of items) {
      if (u < w) return item;
      u -= w;
    }
    const last = items[items.length - 1];
    if (!last) throw new Error("weighted pick from empty list");
    return last[0];
  }

  /** Standard normal via Box-Muller. */
  normal(): number {
    const u1 = 1 - this.float(); // (0, 1], keeps log finite
    const u2 = this.float();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }

  /** Lognormal with the given median and log-space standard deviation. */
  lognormal(median: number, sigma: number): number {
    return median * Math.exp(sigma * this.normal());
  }

  /** Fisher-Yates over a copy. */
  shuffle<T>(items: readonly T[]): T[] {
    const out = items.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      const tmp = out[i] as T;
      out[i] = out[j] as T;
      out[j] = tmp;
    }
    return out;
  }
}
