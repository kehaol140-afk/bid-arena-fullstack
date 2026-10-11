/**
 * 可复现随机源（mulberry32）：同 seed 得同随机序列。
 * 用于：机器人挑选、出价节奏抖动、并发分组等，保证场景可复现。
 */

export class Rng {
  private s: number;
  readonly seed: number;

  constructor(seed: number) {
    this.seed = seed >>> 0;
    this.s = this.seed;
  }

  /** [0,1) */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** [min,max] 整数 */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)] as T;
  }

  /** 从数组中不重复抽取 n 个 */
  sample<T>(arr: readonly T[], n: number): T[] {
    const copy = [...arr];
    const out: T[] = [];
    for (let k = 0; k < n && copy.length > 0; k++) {
      out.push(copy.splice(Math.floor(this.next() * copy.length), 1)[0] as T);
    }
    return out;
  }
}
