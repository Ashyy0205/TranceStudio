// Port of trance's util.h randomness helpers and Shuffler.
// Uses a seedable PRNG so exports can be reproduced.

class Sfc32 {
  private a: number;
  private b: number;
  private c: number;
  private d: number;

  constructor(seed: number) {
    this.a = 0x9e3779b9;
    this.b = 0x243f6a88;
    this.c = 0xb7e15162;
    this.d = seed >>> 0;
    for (let i = 0; i < 16; ++i) this.next();
  }

  next(): number {
    this.a >>>= 0;
    this.b >>>= 0;
    this.c >>>= 0;
    this.d >>>= 0;
    let t = (this.a + this.b) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.d = (this.d + 1) | 0;
    t = (t + this.d) | 0;
    this.c = (this.c + t) | 0;
    return (t >>> 0) / 4294967296;
  }
}

let rng = new Sfc32((Date.now() ^ (Math.random() * 0xffffffff)) >>> 0);

export function seedRandom(seed: number): void {
  rng = new Sfc32(seed);
}

// Uniform integer in [0, max). Mirrors random<T>(max).
export function random(max: number): number {
  if (max <= 0) return 0;
  return Math.floor(rng.next() * max);
}

// True with probability 1/divisor. Mirrors random_chance().
export function randomChance(divisor = 2): boolean {
  return random(divisor) === 0;
}

// Chooses randomly from elements. Elements start with 0 priority, which can be
// increased or decreased; next() gets a random element among all those with
// the highest priority. Direct port of trance's Shuffler, including its
// counting quirks, so selection behaviour matches the original.
export class Shuffler {
  private readonly size: number;
  // enabledCount[n] == |{k : enabled[k] > n}|
  private readonly enabledCount = new Map<number, number>();
  private readonly enabled: number[];
  private sortedKeys: number[] | null = null;

  constructor(size: number) {
    this.size = size;
    this.enabledCount.set(-1, size);
    this.enabled = new Array(size).fill(0);
  }

  increase(index: number): void {
    const v = this.enabled[index];
    if (!this.enabledCount.has(v)) {
      this.enabledCount.set(v, 0);
      this.sortedKeys = null;
    }
    this.enabledCount.set(v, this.enabledCount.get(v)! + 1);
    this.enabled[index] = v + 1;
  }

  decrease(index: number): void {
    const v = this.enabled[index] - 1;
    this.enabled[index] = v;
    if (!this.enabledCount.has(v)) {
      this.enabledCount.set(v, this.size);
      this.sortedKeys = null;
    }
    this.enabledCount.set(v, this.enabledCount.get(v)! - 1);
  }

  modify(index: number, amount: number): void {
    for (; amount > 0; --amount) this.increase(index);
    for (; amount < 0; ++amount) this.decrease(index);
  }

  next(): number {
    if (!this.sortedKeys) {
      this.sortedKeys = [...this.enabledCount.keys()].sort((a, b) => b - a);
    }
    for (const key of this.sortedKeys) {
      const count = this.enabledCount.get(key)!;
      // random(0) in the original yields a huge value that never matches,
      // which falls through to the next priority level.
      if (count <= 0) continue;
      const r = random(count);
      let t = 0;
      for (let i = 0; i < this.size; ++i) {
        if (this.enabled[i] > key) ++t;
        if (r < t) return i;
      }
    }
    return this.size ? random(this.size) : -1;
  }
}
