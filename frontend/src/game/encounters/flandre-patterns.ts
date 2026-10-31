import type { SpellScripts } from './flandre-types.ts';
import { TAU } from '../math/geometry.ts';
import { COLORS } from './flandre-definition.ts';
import { FLANDRE_ARENA as ARENA } from './arenas.ts';
import { NEW_SPELLS } from './flandre-spells.ts';

/** Only active baseline scripts are kept; superseded implementations were removed. */
export const SPELLS: SpellScripts = {
  prologue: {
    tick(sp, dt, f) {
      const st = sp.st;
      // 教学卡每 10 秒变式：四臂、反转加速、内外反向八臂。
      const phase = sp.t >= 20 ? 3 : sp.t >= 10 ? 2 : 1;
      if (st.phase !== phase) {
        st.phase = phase;
        if (phase === 2) st.dir = -(st.dir ?? 1);   // 反转在这时发生
      }
      const dir = st.dir ?? 1;
      const cfg = phase === 1
        ? { up: 1, step: 0.085, ring: 2.2, ringSpeed: 120 }
        : phase === 2
          ? { up: 1.45, step: 0.058, ring: 1.5, ringSpeed: 150 }
          : { up: 1.85, step: 0.05, ring: 1.0, ringSpeed: 175 };
      st.rot = (st.rot ?? 0) + dt * 0.85 * cfg.up * dir;
      st.acc = (st.acc ?? 0) + dt;
      while (st.acc >= cfg.step) {
        st.acc -= cfg.step;
        const arms = phase === 3 ? 8 : 4;
        for (let arm = 0; arm < arms; arm++) {
          // 阶段3：内圈 4 臂顺 rot 转、外圈 4 臂**反向**转且错开 22.5°
          const inner = arm < 4;
          const a = inner
            ? st.rot + (arm % 4) * TAU / 4
            : -st.rot * 1.2 + (arm % 4) * TAU / 4 + Math.PI / 8;
          const rad = inner ? 360 : 300;
          const px = f.ax + Math.cos(a) * rad;
          const py = f.ay + Math.sin(a) * rad;
          f.emit({ x: px, y: py, angle: a + Math.PI / 2,
            speed: 150 * cfg.up * (inner ? 1 : 0.85),
            radius: 6, color: phase === 3 && !inner ? COLORS.gold
              : (arm % 2 ? COLORS.red : COLORS.white) });
        }
      }
      st.ringAcc = (st.ringAcc ?? 0) + dt;
      if (st.ringAcc >= cfg.ring) {
        st.ringAcc -= cfg.ring;
        const base = f.rnd() * TAU;
        if (phase === 3) {
          // 双环：两个相反方向的圆环同时炸开
          f.ring(f.ax, f.ay, 22, base, cfg.ringSpeed, COLORS.dark, 5);
          f.ring(f.ax, f.ay, 22, base + Math.PI, cfg.ringSpeed * 1.15, COLORS.red, 5);
        } else {
          f.ring(f.ax, f.ay, 22, base, cfg.ringSpeed, COLORS.dark, 5);
        }
      }
    },
  },

  // 495 年的波纹：反弹弹环与旋转缺口。
  ripples: {
    tick(sp, dt, f) {
      const st = sp.st;
      st.wall = st.wall ?? {
        minX: ARENA.cx - ARENA.hw, maxX: ARENA.cx + ARENA.hw,
        minY: ARENA.cy - ARENA.hh,
      };
      st.acc = (st.acc ?? 0) + dt;
      // 射速在 30 秒内线性增至 175%，不改变单圈数量。
      const prog = Math.min(1, sp.t / 30);            // 0 → 1（30 秒卡走满）
      const interval = 1.5 / (1 + 0.75 * prog);       // 1.5 → ≈0.857
      if (st.acc >= interval) {
        st.acc -= interval;
        st.gap = ((st.gap ?? 0) + 5) % 31;   // 缺口每次转 5 格
        // 每圈整体依次使用暗红、金、浅蓝。
        st.wave = (st.wave ?? 0) + 1;
        const waveColor = [COLORS.deep, COLORS.gold, COLORS.sky][(st.wave - 1) % 3];
        for (let i = 0; i < 31; i++) {
          if (i >= st.gap && i < st.gap + 7) continue;   // 7 格安全缝
          const a = (i / 31) * TAU;
          f.emit({ x: f.bx, y: f.by, angle: a, speed: 190, radius: 6, color: waveColor, wall: st.wall, shape: 'longball' });
        }
        st.inner = (st.inner ?? 0) + 1;
        if (st.inner % 3 === 0) f.ring(f.bx, f.by, 22, f.rnd() * TAU, 130, COLORS.red, 5, 0, 'longball');
      }
    },
  },



  ...NEW_SPELLS,
};
