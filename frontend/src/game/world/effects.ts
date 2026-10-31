import type { RNG } from '../math/random.ts';
import type { Point } from '../views.ts';
export interface EffectFlags { player?: boolean }
interface EffectLifetime extends EffectFlags { color: string; t: number; life: number }
interface NovaNote { a: number; sp: number; ch: string; size: number; rot: number; spin: number }
export type EffectDraft = EffectLifetime & (
  | (Point & { type: 'slash'; angle: number; range: number; arcDeg: number })
  | (Point & { type: 'thrust' | 'beam'; ex: number; ey: number; width: number })
  | (Point & { type: 'spin'; range: number })
  | (Point & { type: 'nova'; radius: number; notes: NovaNote[] })
  | (Point & { type: 'explosion' | 'shockwave'; radius: number })
  | { type: 'chain'; points: Point[] }
  | (Point & { type: 'sparkle'; vx: number; vy: number; size: number })
  | (Point & { type: 'hit' })
  | (Point & { type: 'impact'; power: number; angle: number; rays: number })
  | (Point & { type: 'shard'; ox: number; oy: number; vx: number; vy: number; spin: number; rot: number; size: number })
  | (Point & { type: 'damage_text'; vy: number; text: string; isCrit: boolean })
  | (Point & { type: 'ring'; radius: number; seed: number })
);
export type RuntimeEffect = EffectDraft & { id: number };

// 规则只记录短时视觉事件；显示丢弃或预算缩减不得改变命中和胜负。

import { TAU } from '../math/geometry.ts';
// 第一百六十二轮：移动端性能档位（桌面 MOBILE=false，maxItems 仍为 240）

// 玩家特效透明度属于显示设置，不改变规则效果、伤害或敌弹可见性。

export const FX_TYPE = {
  SLASH: 'slash', THRUST: 'thrust', SPIN: 'spin', BEAM: 'beam',
  NOVA: 'nova', EXPLOSION: 'explosion', CHAIN: 'chain',
  SPARKLE: 'sparkle', DAMAGE_TEXT: 'damage_text', RING: 'ring',
  HIT: 'hit',
  // ---- 第九轮新增 ----
  IMPACT: 'impact',       // 近战命中：放射碎片 + 白闪（打击感的核心）
  SHOCKWAVE: 'shockwave', // 冲击波：比 nova 更"钝"的压缩环，配重击
  SHARD: 'shard',         // 碎片：带旋转和重力的碎屑
} as const;

export class FXSystem {
  rng: RNG;
  items: RuntimeEffect[];
  nextId: number;
  maxItems: number;
  private readonly ageHeap: number[] = [];
  private heapDirty = false;

  constructor(rng: RNG, maxItems = 240) {
    this.rng = rng;
    this.items = [];
    this.nextId = 1;
    // 特效数量封顶防止峰值失控；命中与伤害在生成装饰前已完成。
    this.maxItems = maxItems;
    // 供测试断言"特效真的被创建了"用
  }

  private older(a: number, b: number): boolean {
    const left = this.items[a].t, right = this.items[b].t;
    return left > right || left === right && a < b;
  }
  private sink(index: number): void {
    const heap = this.ageHeap;
    for (;;) {
      const left = index * 2 + 1; if (left >= heap.length) return;
      const right = left + 1, child = right < heap.length && this.older(heap[right], heap[left]) ? right : left;
      if (!this.older(heap[child], heap[index])) return;
      const previous = heap[index]; heap[index] = heap[child]; heap[child] = previous; index = child;
    }
  }
  private prepareHeap(): void {
    if (!this.heapDirty && this.ageHeap.length === this.items.length) return;
    this.ageHeap.length = this.items.length;
    for (let i = 0; i < this.items.length; i++) this.ageHeap[i] = i;
    for (let i = (this.ageHeap.length >>> 1) - 1; i >= 0; i--) this.sink(i);
    this.heapDirty = false;
  }
  _push(draft: EffectDraft) {
    const fx = Object.assign(draft, { id: this.nextId++ });
    this.prepareHeap();
    if (this.items.length >= this.maxItems) {
      const oldest = this.ageHeap[0] ?? 0;
      this.items[oldest] = fx;
      if (this.ageHeap.length) this.sink(0); else this.heapDirty = true;
      return;
    }
    const row = this.items.length; this.items.push(fx); this.ageHeap.push(row);
    let i = this.ageHeap.length - 1;
    while (i) {
      const parent = (i - 1) >>> 1;
      if (!this.older(this.ageHeap[i], this.ageHeap[parent])) break;
      const previous = this.ageHeap[i]; this.ageHeap[i] = this.ageHeap[parent]; this.ageHeap[parent] = previous; i = parent;
    }
  }
  clear() { this.items.length = 0; this.ageHeap.length = 0; this.heapDirty = false; }

  update(dt: number) {
    // Rebuild lazily at the next birth. This also preserves floating-point age
    // ties and the reverse-sweep physical-slot order exactly.
    this.heapDirty = true;
    const arr = this.items;
    for (let i = arr.length - 1; i >= 0; i--) {
      const fx = arr[i];
      fx.t += dt;
      if (fx.t >= fx.life) {
        arr[i] = arr[arr.length - 1];
        arr.pop();
      }
    }
  }

  // ---------------- 具体特效 ----------------

  // 近战挥砍记录方向、弧度与范围，显示只消费该事实，不参与命中。
  slash(x: number, y: number, angle: number, range: number, arcDeg: number, color?: string | null, extra: EffectFlags | null = null) {
    this._push({
      type: FX_TYPE.SLASH, x, y, angle, range, arcDeg,
      color: color ?? '#ffffff', t: 0, life: 0.22, ...extra,
    });
    // 沿近战弧生成短寿白色火星与碎屑，保留切割的视觉层次。
    const rad = (arcDeg * Math.PI / 180);
    for (let i = 0; i < 4; i++) {
      const ma = angle + (this.rng.next() - 0.5) * rad * 0.85;
      const pr = range * (0.62 + this.rng.next() * 0.32);
      this.sparkle(x + Math.cos(ma) * pr, y + Math.sin(ma) * pr, '#ffffff', 1, extra);
    }
    const ma2 = angle + (this.rng.next() - 0.5) * rad * 0.7;
    this.shards(x + Math.cos(ma2) * range * 0.8, y + Math.sin(ma2) * range * 0.8,
      8, '#cfefff', 2, extra);
  }

  thrust(x: number, y: number, ex: number, ey: number, width: number, color?: string | null, extra: EffectFlags | null = null) {
    this._push({
      type: FX_TYPE.THRUST, x, y, ex, ey, width,
      color: color ?? '#ffffff', t: 0, life: 0.18, ...extra,
    });
  }

  spin(x: number, y: number, range: number, color?: string | null, extra: EffectFlags | null = null) {
    this._push({
      type: FX_TYPE.SPIN, x, y, range,
      color: color ?? '#ffffff', t: 0, life: 0.3, ...extra,
    });
  }

  beam(x: number, y: number, ex: number, ey: number, width: number, color?: string | null, extra: EffectFlags | null = null) {
    this._push({
      type: FX_TYPE.BEAM, x, y, ex, ey, width,
      color: color ?? '#ffffff', t: 0, life: 0.2, ...extra,
    });
  }

  nova(x: number, y: number, radius: number, color?: string | null, extra: EffectFlags | null = null) {
    // 音波伴飞粒子随环扩散并淡出，显示按各自进度绘制。
    const notes = [];
    const n = 6 + Math.floor(this.rng.next() * 3);
    for (let i = 0; i < n; i++) {
      notes.push({
        a: (i / n) * Math.PI * 2 + this.rng.next() * 0.8,
        sp: 0.8 + this.rng.next() * 0.3,
        ch: this.rng.next() < 0.75 ? '🎵' : '🐾',
        size: 15 + this.rng.next() * 6,
        rot: this.rng.next() * Math.PI,
        spin: (this.rng.next() - 0.5) * 5,
      });
    }
    this._push({
      type: FX_TYPE.NOVA, x, y, radius, notes,
      color: color ?? '#ffffff', t: 0, life: 0.38, ...extra,
    });
  }

  explosion(x: number, y: number, radius: number, color?: string | null, extra: EffectFlags | null = null) {
    this._push({
      type: FX_TYPE.EXPLOSION, x, y, radius,
      color: color ?? '#ff9f68', t: 0, life: 0.42, ...extra,
    });
    // 第九轮：爆炸额外甩出碎片，让"炸开"有实体感（碎片继承调用方标记）
    this.shards(x, y, radius, color ?? '#ff9f68', 6, extra);
  }

  chain(points: readonly Point[], color?: string | null, extra: EffectFlags | null = null) {
    this._push({
      type: FX_TYPE.CHAIN, points: points.map((p) => ({ ...p })),
      color: color ?? '#ffe066', t: 0, life: 0.24, ...extra,
    });
  }

  sparkle(x: number, y: number, color?: string | null, count = 1, extra: EffectFlags | null = null) {
    for (let i = 0; i < count; i++) {
      const a = this.rng.next() * TAU;
      const s = 20 + this.rng.next() * 60;
      this._push({
        type: FX_TYPE.SPARKLE,
        x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        color: color ?? '#ffffff', t: 0, life: 0.4, size: 2 + this.rng.next() * 3,
        ...extra,
      });
    }
  }

  hit(x: number, y: number, color?: string | null, extra: EffectFlags | null = null) {
    this._push({
      type: FX_TYPE.HIT, x, y,
      color: color ?? '#ffffff', t: 0, life: 0.16, ...extra,
    });
  }

  // ---------------- 第九轮新增：打击感三件套 ----------------

  // 命中冲击按强度记录射线/大小，提供打击反馈且不消耗战斗随机流。
  impact(x: number, y: number, power = 0.5, color = '#ffffff', angle: number | null = null, extra: EffectFlags | null = null) {
    const p = Math.max(0, Math.min(1, power));
    this._push({
      type: FX_TYPE.IMPACT, x, y, power: p,
      angle: angle ?? this.rng.next() * TAU,
      rays: 6 + Math.round(p * 6),
      color, t: 0, life: 0.13 + p * 0.09, ...extra,
    });
    // 重击额外给一圈冲击波
    if (p > 0.6) this.shockwave(x, y, 30 + p * 60, color, 0.34, extra);
  }

  /** 冲击波：一圈又粗又钝的压缩环，配重击/爆炸 */
  shockwave(x: number, y: number, radius: number, color = '#ffffff', life = 0.34, extra: EffectFlags | null = null) {
    this._push({
      type: FX_TYPE.SHOCKWAVE, x, y, radius,
      color, t: 0, life, ...extra,
    });
  }

  // 碎片记录初速、自转与重力运动参数；显示按寿命推导位置。
  shards(x: number, y: number, radius: number, color = '#ffffff', count = 5, extra: EffectFlags | null = null) {
    for (let i = 0; i < count; i++) {
      const a = this.rng.next() * TAU;
      const s = radius * (0.9 + this.rng.next() * 1.6);
      const ox = Math.cos(a) * radius * (0.35 + this.rng.next() * 0.4);
      const oy = Math.sin(a) * radius * (0.35 + this.rng.next() * 0.4);
      this._push({
        type: FX_TYPE.SHARD,
        x, y, ox, oy,
        vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        spin: (this.rng.next() - 0.5) * 22,
        rot: this.rng.next() * TAU,
        size: radius * (0.10 + this.rng.next() * 0.14),
        color, t: 0, life: 0.32 + this.rng.next() * 0.24, ...extra,
      });
    }
  }

  damageText(x: number, y: number, value: string | number | undefined, isCrit = false, color: string | null = null) {
    this._push({
      type: FX_TYPE.DAMAGE_TEXT,
      x: x + (this.rng.next() - 0.5) * 14,
      y: y - 8,
      vy: -46 - this.rng.next() * 20,
      text: typeof value === 'number' ? String(Math.round(value)) : String(value),
      isCrit,
      color: color ?? (isCrit ? '#ffc857' : '#ffffff'),
      t: 0, life: 0.72,
    });
  }

  ring(x: number, y: number, radius: number, color?: string | null, life = 0.5, extra: EffectFlags | null = null) {
    this._push({
      type: FX_TYPE.RING, x, y, radius,
      // 第一百三十九轮 E：破碎虚线圈的随机起角（每圈碎口位置不同）
      seed: this.rng.next() * Math.PI * 2,
      color: color ?? '#ffffff', t: 0, life, ...extra,
    });
  }
}
