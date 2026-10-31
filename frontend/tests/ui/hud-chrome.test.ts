import type { GamePhase } from '../../src/game';
import { expect, it } from 'vitest';
import { createHudChromePainter } from '../../src/ui/hud/chrome-painter';
import { createHudDisplay } from '../../src/app/hud-display';
import type { HudDisplaySample } from '../../src/app/hud-display';

function nodes() {
  const classes = new Set<string>();
  const box = { classList: { toggle(name: string, enabled: boolean) { if (enabled) classes.add(name); else classes.delete(name); } } };
  const map = Object.fromEntries(['hud-wave-num', 'hud-materials', 'hud-timer-text', 'hud-timer-label', 'hud-timer-fill'].map(id =>
    [`#${id}`, { textContent: '', style: {} as Record<string, string>, parentElement: { parentElement: box } }]));
  return { map, classes, root: { querySelector: (id: string) => map[id] } as unknown as HTMLElement };
}
const sample = (secondsLeft: number, phase: GamePhase = 'playing'): HudDisplaySample => ({
  timestampMs: 100, combat: ['playing', 'flandre', 'vergil', 'remilia', 'halloween'].includes(phase), hud: null, chrome: { wave: 2, materials: 1234, secondsLeft,
    timerTotal: 30, timerLabel: '', timerVisible: true, flandre: false },
});
it('paints fresh top-bar samples each display frame and freezes menus without another clock or React update', () => {
  const dom = nodes(), painter = createHudChromePainter(dom.root), channel = createHudDisplay(error => { throw error; });
  const disconnect = channel.display.connect(painter.paint);
  channel.publish(sample(29.98)); const first = dom.map['#hud-timer-fill']!.style.transform;
  channel.publish(sample(29.96)); const second = dom.map['#hud-timer-fill']!.style.transform;
  expect(first).not.toBe(second); expect(dom.map['#hud-materials']!.textContent).toBe('1.2k');
  for (const phase of ['paused', 'upgrade', 'shop', 'endless-prompt', 'result'] as const) channel.publish(sample(1, phase));
  expect(dom.map['#hud-timer-fill']!.style.transform).toBe(second);
  channel.publish(sample(4.5)); expect(dom.map['#hud-timer-text']!.textContent).toBe('5'); expect(dom.classes.has('urgent')).toBe(true);
  painter.dispose(); disconnect(); channel.publish(sample(3));
  expect(dom.map['#hud-timer-text']!.textContent).toBe('5'); channel.dispose();
});
it('updates challenge label, visibility and style from the display sample and retains detached values', () => {
  const dom = nodes(), painter = createHudChromePainter(dom.root), channel = createHudDisplay(error => { throw error; });
  const input = sample(3.5, 'flandre'); input.chrome = { ...input.chrome!, timerLabel: 'Spell card', timerTotal: 10, flandre: true };
  channel.publish(input); (input.chrome as { secondsLeft: number }).secondsLeft = 9;
  channel.display.connect(painter.paint);
  expect(dom.map['#hud-timer-fill']!.style.transform).toBe('scaleX(0.35)');
  expect(dom.map['#hud-timer-label']!.textContent).toBe('Spell card'); expect(dom.classes.has('flandre')).toBe(true);
  channel.publish({ ...sample(30, 'vergil'), chrome: { ...sample(30).chrome!, timerVisible: false } });
  expect(dom.classes.has('hidden')).toBe(true); expect(dom.classes.has('flandre')).toBe(false);
  expect(dom.classes.has('urgent')).toBe(false); expect(dom.map['#hud-timer-label']!.style.display).toBe('none');
  painter.dispose(); channel.dispose();
});
