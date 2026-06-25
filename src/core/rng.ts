// 确定性随机（mulberry32）。同种子同序列，便于复现与测试。

export class RNG {
  private s: number;

  constructor(seed: number) {
    this.s = seed >>> 0;
  }

  /** [0,1) */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) | 0;
    let t = Math.imul(this.s ^ (this.s >>> 15), 1 | this.s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** [0, maxExclusive) 整数 */
  int(maxExclusive: number): number {
    return Math.floor(this.next() * maxExclusive);
  }

  pick<T>(arr: readonly T[]): T {
    return arr[this.int(arr.length)]!;
  }
}
