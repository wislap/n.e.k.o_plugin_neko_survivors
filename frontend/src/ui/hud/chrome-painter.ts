import type { HudDisplaySample } from '../../app/hud-display';
import { hudRatio } from './animation';

import { formatMaterials } from '../formatters';

/** Owns only live top-bar attributes, using the existing HUD display subscription. */
export function createHudChromePainter(root: HTMLElement) {
  const find = (id: string) => {
    const node = root.querySelector<HTMLElement>(`#${id}`);
    if (!node) throw new Error(`Missing HUD top-bar node: ${id}`);
    return node;
  };
  const wave = find('hud-wave-num'), amount = find('hud-materials'), timer = find('hud-timer-text');
  const fill = find('hud-timer-fill'), label = find('hud-timer-label'), box = fill.parentElement!.parentElement!;
  let retired = false;
  function text(node: HTMLElement, value: string) { if (node.textContent !== value) node.textContent = value; }
  return {
    paint(sample: HudDisplaySample) {
      const chrome = sample.chrome;
      if (retired || !chrome || !sample.combat) return;
      const seconds = Math.max(0, Math.ceil(chrome.secondsLeft));
      text(wave, String(chrome.wave)); text(amount, formatMaterials(chrome.materials)); text(timer, String(seconds));
      text(label, chrome.timerLabel); label.style.display = chrome.timerLabel ? '' : 'none';
      fill.style.transform = `scaleX(${hudRatio(chrome.secondsLeft, chrome.timerTotal)})`;
      box.classList.toggle('urgent', seconds > 0 && seconds <= 5);
      box.classList.toggle('hidden', !chrome.timerVisible);
      box.classList.toggle('flandre', chrome.flandre);
    },
    dispose() { retired = true; },
  };
}
