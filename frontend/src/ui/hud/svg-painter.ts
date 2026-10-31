import type { HudFrame } from '../../game';
import type { HudDisplaySample } from '../../app/hud-display';
import { advanceHud, hudLevelSize, hudRatio, hudSwipePosition, type HudAnimationState } from './animation';

export interface HudGeometry {
  width: number; height: number;
  hp: { x: number; y: number; w: number; h: number; textX: number; textY: number };
}
interface HudRect { left: number; top: number; width: number; height: number }
/** Use the canvas-sized layout owner even while the DOM chrome is display:none. */
export function measureHudGeometry(previous: HudGeometry | undefined,
  viewport: HudRect & { clientWidth: number; clientHeight: number }, bar: HudRect, ghost: HudRect, hidden: boolean): HudGeometry | undefined {
  const width = viewport.clientWidth, height = viewport.clientHeight;
  if (!width || !height) return previous;
  // Renderer caches its HP shell by viewport W/H. Hiding alone never invalidates it.
  if (hidden && previous?.width === width && previous.height === height) return previous;
  const scale = viewport.width / (width || viewport.width) || 1;
  const hp = { x: (bar.left - viewport.left) / scale, y: (bar.top - viewport.top) / scale, w: bar.width / scale, h: bar.height / scale,
    textX: (ghost.left - viewport.left) / scale, textY: (ghost.top + ghost.height / 2 - viewport.top) / scale };
  return previous && previous.width === width && previous.height === height
    && Object.keys(hp).every(key => hp[key as keyof typeof hp] === previous.hp[key as keyof typeof hp]) ? previous : { width, height, hp };
}

export interface HudSvgNodes {
  root: SVGSVGElement; hpGroup: SVGGElement; xpGroup: SVGGElement;
  damage: SVGRectElement; hpFill: SVGRectElement; hpHighlight: SVGRectElement;
  shield: SVGGElement; shieldFill: SVGRectElement; shieldHighlight: SVGRectElement; streaks: readonly SVGRectElement[];
  hpTexts: readonly SVGTextElement[]; xpFill: SVGGElement; xpRect: SVGRectElement; xpHighlight: SVGRectElement;
  xpShadow: SVGFEDropShadowElement; swipe: SVGGElement; swipeCircles: readonly SVGCircleElement[];
  levelTexts: readonly SVGTextElement[]; levelGradient: SVGLinearGradientElement;
}

/** Only this owner writes dynamic SVG attributes. It never schedules work. */
export function createHudSvgPainter(nodes: HudSvgNodes, initialGeometry: HudGeometry, options: { mobile: boolean; referenceDpr: number }) {
  let owned: HudSvgNodes | undefined = nodes, geometry = initialGeometry;
  let state: HudAnimationState | undefined, frame: Readonly<HudFrame> | undefined, gradientY: number | undefined;
  const attributes = new WeakMap<Element, Map<string, string>>();
  function set(node: Element, name: string, value: string | number) {
    let cache = attributes.get(node);
    if (!cache) { cache = new Map(); attributes.set(node, cache); }
    const text = String(value);
    if (cache.get(name) !== text) { node.setAttribute(name, text); cache.set(name, text); }
  }
  function shown(node: Element, value: boolean) { set(node, 'display', value ? 'inline' : 'none'); }
  function rectangle(node: Element, x: number, y: number, width: number, height: number) {
    set(node, 'x', x); set(node, 'y', y); set(node, 'width', width); set(node, 'height', height);
  }
  function write() {
    const n = owned;
    if (!n || !frame || !state) return;
    const { width: W, height: H, hp: shell } = geometry;
    const x = shell.x + 2, y = shell.y + 2, width = Math.max(0, shell.w - 4), height = Math.max(0, shell.h - 4), xpY = H - 12;
    const hp = hudRatio(frame.hp, frame.maxHp), xp = hudRatio(frame.xp, frame.xpNeeded), shield = Math.min(1, state.shield);
    set(n.root, 'visibility', 'visible'); shown(n.damage, state.hp > hp + .001);
    rectangle(n.damage, x + width * hp, y, width * Math.max(0, state.hp - hp), height);
    shown(n.hpFill, hp > 0); shown(n.hpHighlight, hp > 0);
    rectangle(n.hpFill, x, y, width * hp, height); rectangle(n.hpHighlight, x, y, width * hp, 2);
    shown(n.shield, state.shield > .003);
    rectangle(n.shieldFill, x, y, width * shield, height); rectangle(n.shieldHighlight, x, y, width * shield, 1.5);
    n.streaks.forEach((node, index) => rectangle(node, x + state!.now * 46 % 192 + (index - 2) * 96, y, 96, height));
    const hpText = `${Math.ceil(frame.hp)} / ${Math.round(frame.maxHp)}`;
    for (const node of n.hpTexts) {
      set(node, 'x', shell.textX); set(node, 'y', shell.textY);
      if (node.textContent !== hpText) node.textContent = hpText;
    }
    set(n.hpGroup, 'aria-label', hpText); set(n.hpGroup, 'aria-valuenow', frame.hp); set(n.hpGroup, 'aria-valuemax', frame.maxHp);
    set(n.xpGroup, 'aria-label', `经验 ${Math.floor(frame.xp)} / ${frame.xpNeeded}`); set(n.xpGroup, 'aria-valuenow', frame.xp); set(n.xpGroup, 'aria-valuemax', frame.xpNeeded);
    shown(n.xpFill, xp > 0);
    const nearFull = xp > .9, pulse = nearFull ? .5 + .5 * Math.sin(state.now * 5.2) : 0;
    set(n.xpFill, 'opacity', nearFull ? .82 + .18 * pulse : 1);
    rectangle(n.xpRect, 0, xpY + 1, W * xp, 10); rectangle(n.xpHighlight, 0, xpY + 1, W * xp, 1.5);
    set(n.xpShadow, 'flood-color', nearFull ? '#ff8cdc' : '#d873ef');
    set(n.xpShadow, 'flood-opacity', options.mobile ? 0 : nearFull ? .5 + .5 * pulse : .4);
    set(n.xpShadow, 'stdDeviation', options.mobile ? 0 : (nearFull ? 8 + 12 * pulse : 5) / (2 * options.referenceDpr));
    shown(n.swipe, !!state.swipeDraw);
    if (state.swipeDraw) n.swipeCircles.forEach((node, index) => {
      set(node, 'cx', hudSwipePosition(state!.swipeDraw!, index === 3 ? 0 : (index + 1) * .07) * W); set(node, 'cy', xpY + 6);
    });
    const levelSize = hudLevelSize(state), levelY = H - 19, levelText = `Lv.${frame.level}`;
    // The original gradient is cached by baseline, not recomputed during a bounce.
    if (gradientY !== levelY) {
      gradientY = levelY; set(n.levelGradient, 'y1', levelY - levelSize); set(n.levelGradient, 'y2', levelY);
    }
    for (const node of n.levelTexts) {
      set(node, 'x', W - 14); set(node, 'y', levelY); set(node, 'font-size', levelSize);
      if (node.textContent !== levelText) node.textContent = levelText;
    }
  }
  set(nodes.root, 'visibility', 'hidden');
  return {
    paint(sample: HudDisplaySample) {
      if (!owned) return;
      if (sample.resetClock) { state = undefined; gradientY = undefined; }
      if (!sample.hud) { frame = undefined; set(owned.root, 'visibility', 'hidden'); return; }
      frame = sample.hud; state = advanceHud(state, frame, sample.timestampMs); write();
    },
    relayout(next: HudGeometry) { geometry = next; write(); },
    dispose() { owned = undefined; frame = undefined; state = undefined; },
  };
}
