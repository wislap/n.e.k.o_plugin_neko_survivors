// 可复现随机数（mulberry32）
// 每局用种子初始化，方便复现 bug 与做每日挑战。


export class RNG {
  declare seed: number;
  declare state: number;

  constructor(seed = 1) {
    this.seed = seed >>> 0;
    this.state = this.seed || 1;
  }

  // [0, 1)
  next() {
    this.state |= 0;
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  // [min, max)
  range(min: number, max: number) {
    return min + this.next() * (max - min);
  }

  // [min, max] 整数
  int(min: number, max: number) {
    return Math.floor(min + this.next() * (max - min + 1));
  }



  pick<T>(arr: readonly T[] | null | undefined): T | undefined {
    if (!arr || arr.length === 0) return undefined;
    return arr[Math.floor(this.next() * arr.length)];
  }





  fork(salt: number) {
    return new RNG((this.state ^ Math.imul(salt | 0, 0x9e3779b9)) >>> 0);
  }
}
