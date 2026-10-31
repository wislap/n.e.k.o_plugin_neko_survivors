import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { HudFrame } from '../../src/game';
import { advanceHud, hudLevelSize, hudSwipePosition, type HudAnimationState } from '../../src/ui/hud/animation';
import { createHudSvgPainter, measureHudGeometry, type HudGeometry, type HudSvgNodes } from '../../src/ui/hud/svg-painter';

const frame: HudFrame = { hp: 100, maxHp: 100, shield: 50, xp: 10, xpNeeded: 100, level: 1 };
const geometry: HudGeometry = { width: 1280, height: 720, hp: { x: 16, y: 686, w: 432, h: 16, textX: 458, textY: 694 } };

// Golden state captured by executing the untouched reference _drawHudBars method
// (5ade0bb, renderer.js SHA a4fbfa0cdf2a94a3114377c0dfae55e8c854e0db2afb5907849d593992f73630).
// Only Canvas paint calls were inert; its presentation recurrence ran unchanged.
const reference = [
  [0, 100, 50, 10, 1, 1, .5, 0, null],
  [1000 / 60, 50, 0, 40, 1, .9833333333333333, .423240862445307, 0, .05952380952380952],
  [2000 / 60, 50, 0, 40, 1, .9672222222222222, .3582656552868946, 0, .11904761904761904],
  [50, 100, 70, 95, 1, 1, .4107281224328868, 0, .05952380952380953],
  [200 / 3, 100, 70, 0, 2, 1, .4551366421146435, .4033333333333333, .05952380952380951],
  [100, 100, 70, 0, 2, 1, .5245477372629067, .37, .17857142857142855],
  [5000, 50, 0, 0, 2, .9, .19297032845202267, .27, .5357142857142857],
  [5100, 50, 0, 0, 2, .8200000000000003, .07098981659360003, .17000000000000037, .8928571428571415],
  [5200, 50, 0, 0, 2, .7560000000000002, .026115694057316764, .07000000000000037, null],
  [5300, 50, 0, 0, 2, .7048000000000003, .009607426935610085, 0, null],
] as const;

describe('display-frame HUD recurrence', () => {
  it('matches the original damage/heal/shield/XP/level trace at identical timestamps, including a long hidden gap', () => {
    let state: HudAnimationState | undefined;
    for (const [time, hp, shield, xp, level, expectedHp, expectedShield, bounce, swipeTime] of reference) {
      const input = Object.freeze({ ...frame, hp, shield, xp, level });
      state = advanceHud(state, input, time);
      expect(state.hp).toBe(expectedHp); expect(state.shield).toBe(expectedShield); expect(state.bounce).toBe(bounce);
      expect(state.xp).toBe(xp / 100); expect(state.level).toBe(level); expect(state.swipe?.t ?? null).toBe(swipeTime);
    }
  });
  it('retains the minimum ghost drain, instant healing and shield snap without mutating prior samples', () => {
    const first = Object.freeze(advanceHud(undefined, { ...frame, shield: 100 }, 0));
    const next = advanceHud(first, { ...frame, hp: 98, shield: 0 }, 100);
    expect(next.hp).toBe(.99); expect(first.hp).toBe(1); expect(first.shield).toBe(1);
    expect(advanceHud(next, { ...frame, hp: 100 }, 116).hp).toBe(1);
    let state = next;
    for (let i = 2; i < 20; i++) state = advanceHud(state, { ...frame, hp: 98, shield: 0 }, i * 100);
    expect(state.hp).toBe(.98); expect(state.shield).toBe(0);
  });
  it('keeps the .28s cubic swipe/trails and .42s sine/rounded-font bounce', () => {
    let state = advanceHud(undefined, { ...frame, xp: 95 }, 0);
    state = advanceHud(state, { ...frame, xp: 0, level: 2 }, 20);
    expect(state.swipe?.from).toBe(.95); expect(state.swipe?.to).toBe(1); expect(state.bounce).toBeCloseTo(.4);
    expect(hudSwipePosition({ from: .2, to: .8, t: .5 })).toBeCloseTo(.725);
    expect(hudSwipePosition({ from: .2, to: .8, t: .05 }, .07)).toBe(.2);
    expect(hudLevelSize({ ...state, bounce: .21 })).toBe(33);
    for (let time = 40; time <= 440; time += 20) state = advanceHud(state, { ...frame, xp: 0, level: 2 }, time);
    expect(state.swipe).toBeNull(); expect(state.bounce).toBe(0); expect(hudLevelSize(state)).toBe(21);
  });
});

class SvgNode {
  values = new Map<string, string>(); textContent = ''; writes = 0;
  setAttribute(name: string, value: string) { this.values.set(name, value); this.writes++; }
  getAttribute(name: string) { return this.values.get(name) ?? null; }
}
function setupPainter() {
  const all: SvgNode[] = [], make = () => { const node = new SvgNode(); all.push(node); return node; };
  const raw = {
    root: make(), hpGroup: make(), xpGroup: make(), damage: make(), hpFill: make(), hpHighlight: make(),
    shield: make(), shieldFill: make(), shieldHighlight: make(), streaks: [make(), make(), make()], hpTexts: [make(), make()],
    xpFill: make(), xpRect: make(), xpHighlight: make(), xpShadow: make(), swipe: make(), swipeCircles: [make(), make(), make(), make()],
    levelTexts: [make(), make()], levelGradient: make(),
  };
  const painter = createHudSvgPainter(raw as unknown as HudSvgNodes, geometry, { mobile: false, referenceDpr: 1 });
  return { painter, raw, writes: () => all.reduce((total, node) => total + node.writes, 0) };
}

describe('single-owner persistent SVG painting', () => {
  it('updates actual SVG attributes on intervening display frames through pause/shop/upgrade/result', () => {
    const { painter, raw } = setupPainter();
    painter.paint({ timestampMs: 0, combat: true, hud: frame, resetClock: true });
    const damaged = { ...frame, hp: 50, shield: 0, xp: 95 };
    painter.paint({ timestampMs: 1000 / 60, combat: false, hud: damaged });
    const ghostWidth = Number(raw.damage.getAttribute('width')), shieldWidth = Number(raw.shieldFill.getAttribute('width'));
    painter.paint({ timestampMs: 2000 / 60, combat: false, hud: damaged });
    expect(Number(raw.damage.getAttribute('width'))).toBeLessThan(ghostWidth);
    expect(Number(raw.shieldFill.getAttribute('width'))).toBeLessThan(shieldWidth);
    expect(raw.hpTexts[0].textContent).toBe('50 / 100'); expect(raw.hpTexts[1].textContent).toBe('50 / 100');
    expect(raw.xpRect.getAttribute('width')).toBe('1216');
    painter.paint({ timestampMs: 50, combat: false, hud: { ...damaged, level: 2, xp: 0 } });
    expect(raw.levelTexts[0].textContent).toBe('Lv.2'); expect(raw.swipe.getAttribute('display')).toBe('inline');
    painter.paint({ timestampMs: 60, combat: false, hud: damaged });
    expect(raw.root.getAttribute('visibility')).toBe('visible');
  });
  it('paints the terminal XP swipe once, including the original unclamped trailing dot, before retirement', () => {
    const { painter, raw } = setupPainter();
    painter.paint({ timestampMs: 0, combat: true, hud: frame });
    const gained = { ...frame, xp: 80 };
    for (const timestampMs of [100, 200, 300]) painter.paint({ timestampMs, combat: true, hud: gained });
    expect(raw.swipe.getAttribute('display')).toBe('inline');
    expect(Number(raw.swipeCircles[3].getAttribute('cx'))).toBe(1280 * .8);
    const elapsed = .1 / .28 + .1 / .28 + (.3 - .2) / .28;
    expect(Number(raw.swipeCircles[0].getAttribute('cx'))).toBe((.1 + (.8 - .1) * (1 - (1 - Math.max(0, elapsed - .07)) ** 3)) * 1280);
    painter.paint({ timestampMs: 301, combat: true, hud: gained });
    expect(raw.swipe.getAttribute('display')).toBe('none');
  });
  it('keeps history on relayout and clamps the first restored frame instead of treating its delta as zero', () => {
    const { painter, raw } = setupPainter();
    painter.paint({ timestampMs: 0, combat: true, hud: frame });
    painter.paint({ timestampMs: 5000, combat: true, hud: { ...frame, hp: 50 } });
    expect(Number(raw.damage.getAttribute('width'))).toBe(428 * .4);
    painter.relayout({ ...geometry, width: 1000, hp: { ...geometry.hp, w: 300 } });
    expect(Number(raw.damage.getAttribute('width'))).toBe(296 * .4);
    painter.paint({ timestampMs: 6000, combat: true, hud: { ...frame, hp: 50 }, resetClock: true });
    expect(raw.damage.getAttribute('display')).toBe('none');
  });
  it('retains the cached shell on result, but remeasures hidden shell and pins XP/level to the resized viewport', () => {
    const zero = { left: 0, top: 0, width: 0, height: 0 };
    const viewport = { left: 0, top: 0, width: 1280, height: 720, clientWidth: 1280, clientHeight: 720 };
    const hidden = measureHudGeometry(geometry, viewport, zero, zero, true);
    expect(hidden).toBe(geometry);
    const resized = measureHudGeometry(hidden, { ...viewport, width: 960, height: 540, clientWidth: 960, clientHeight: 540 }, zero, zero, true)!;
    expect(resized.hp).toEqual({ x: 0, y: 0, w: 0, h: 0, textX: 0, textY: 0 });
    const { painter, raw } = setupPainter();
    painter.paint({ timestampMs: 0, combat: true, hud: frame });
    painter.paint({ timestampMs: 10, combat: false, hud: frame });
    painter.relayout(resized);
    expect(raw.xpRect.getAttribute('y')).toBe('529'); // fill inset 1 from H - 12
    expect(raw.levelTexts[0].getAttribute('y')).toBe('521');
    expect(raw.levelTexts[0].getAttribute('x')).toBe('946');
    expect(raw.shieldFill.getAttribute('width')).toBe('0');
  });
  it('clips all three moving shield primitives to the same original rounded HP slot', () => {
    // This checks the declarative clip seam, not browser rasterization or a pixel tolerance.
    const source = readFileSync(new URL('../../src/ui/hud/Hud.tsx', import.meta.url), 'utf8');
    const primitive = source.match(/<rect key=\{index\} data-hud-node=\{`streak-\$\{index\}`\}[^>]+\/>/);
    expect(primitive?.[0]).toContain("clipPath={ref('hp-clip')}");
    for (const name of ['shield-fill', 'shield-highlight']) {
      expect(source.match(new RegExp(`<rect data-hud-node="${name}"[^>]+/>`))?.[0]).toContain("clipPath={ref('hp-clip')}");
    }
  });
  it('does not dirty unchanged attributes and retires every old callback before detached nodes can be written', () => {
    const { painter, raw, writes } = setupPainter();
    const sample = { timestampMs: 0, combat: true, hud: { ...frame, shield: 0 } };
    painter.paint(sample); const count = writes(); painter.paint(sample); expect(writes()).toBe(count);
    painter.paint({ ...sample, hud: null }); expect(raw.root.getAttribute('visibility')).toBe('hidden');
    painter.relayout({ ...geometry, width: 900 }); expect(raw.root.getAttribute('visibility')).toBe('hidden');
    const retired = painter.paint; painter.dispose(); painter.dispose(); const afterDispose = writes();
    retired({ ...sample, timestampMs: 100, hud: { ...frame, level: 99 } }); painter.relayout(geometry);
    expect(writes()).toBe(afterDispose); expect(raw.levelTexts[0].textContent).toBe('Lv.1');
  });
});
