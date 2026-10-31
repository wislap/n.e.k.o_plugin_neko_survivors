// Boss过载按短窗口的实际失血触发独立减伤层；每层自行到期。

/** 触发阈值：0.5 秒窗口内累计掉血 ≥ 10% maxHp → 一层 */
export const OVERLOAD_THRESHOLD = 0.10;
/** 触发窗口（秒） */
export const OVERLOAD_WINDOW = 0.5;
/** 每层持续秒数（各层独立计时） */
export const OVERLOAD_LAYER_SECONDS = 5;
/** 每层减伤比例（乘算叠加：1 层 50%、2 层 75%、3 层 87.5%…） */
export const OVERLOAD_LAYER_FRAC = 0.5;

export interface OverloadOptions { threshold?: number; window?: number; layerSeconds?: number; layerFrac?: number }
export class OverloadGuard {
  declare maxHp: number;
  declare threshold: number;
  declare window: number;
  declare layerSeconds: number;
  declare layerFrac: number;
  declare layers: { expireAt: number }[];
  declare _acc: number;
  declare _windowStart: number;
  /**
   */
  constructor(maxHp: number, opts: OverloadOptions = {}) {
    this.maxHp = Math.max(1, maxHp);
    this.threshold = opts.threshold ?? OVERLOAD_THRESHOLD;
    this.window = opts.window ?? OVERLOAD_WINDOW;
    this.layerSeconds = opts.layerSeconds ?? OVERLOAD_LAYER_SECONDS;
    this.layerFrac = opts.layerFrac ?? OVERLOAD_LAYER_FRAC;
    /** 层列表：每项 { expireAt }，各自独立计时 */
    /** @type {{expireAt:number}[]} */
    this.layers = [];
    /** 窗口累计器：最近 window 秒内实际掉血量（触发后清零重攒） */
    this._acc = 0;
    this._windowStart = 0;
  }

  // 按减伤后实际失血记账；窗口超阈值才生成一层，不把一击重复拆成多层。
  recordDamage(now: number, dmg: number) {
    if (now - this._windowStart >= this.window) {
      const fired = this._settle(now);
      this._windowStart = now;
      this._acc = 0;
      if (dmg > 0) this._acc += dmg;
      return fired;
    }
    if (dmg > 0) this._acc += dmg;
    return false;
  }

  /** 结算当前窗口：累计掉血 ≥ 阈值 → 给一层（各自独立计时） */
  _settle(now: number) {
    if (this._acc >= this.threshold * this.maxHp) {
      this.layers.push({ expireAt: now + this.layerSeconds });
      this._acc = 0;
      return true;
    }
    return false;
  }

  // 无攻击时也推进并结算到期窗口，不能只在下一次命中时处理。
  update(now: number) {
    let fired = false;
    if (now - this._windowStart >= this.window) {
      fired = this._settle(now);
      this._windowStart = now;
      this._acc = 0;
    }
    this.tick(now);
    return fired;
  }

  /** 过期清理：到点的层各自消失（新层不刷新旧层时间） */
  tick(now: number) {
    if (!this.layers.length) return;
    this.layers = this.layers.filter((l) => l.expireAt > now);
  }

  /** 当前总减伤比例（乘算叠加）：1 − 0.5^层数 */
  get reduction() {
    return 1 - Math.pow(this.layerFrac, this.layers.length);
  }

  /** 伤害乘区（直接乘到 incoming 伤害上）：0.5^层数 */
  get multiplier() {
    return Math.pow(this.layerFrac, this.layers.length);
  }
}
