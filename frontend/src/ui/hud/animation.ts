import type { HudFrame } from '../../game';

export interface HudAnimationState {
  now: number;
  hp: number;
  shield: number;
  xp: number;
  level: number;
  bounce: number;
  swipe: { from: number; to: number; t: number } | null;
  /** The reference paints the terminal swipe once, after retiring its retained state. */
  swipeDraw: { from: number; to: number; t: number } | null;
}
export const hudRatio = (value: number, maximum: number) => Math.max(0, Math.min(1, maximum > 0 ? value / maximum : 0));

/** Renderer._drawHudBars recurrence, sampled by the existing display clock. */
export function advanceHud(previous: HudAnimationState | undefined, frame: Readonly<HudFrame>, timestampMs: number): HudAnimationState {
  const now = timestampMs / 1000, hp = hudRatio(frame.hp, frame.maxHp), shield = hudRatio(frame.shield, frame.maxHp), xp = hudRatio(frame.xp, frame.xpNeeded);
  if (!previous) return { now, hp, shield, xp, level: frame.level, bounce: 0, swipe: null, swipeDraw: null };
  const dt = Math.min(.1, Math.max(0, now - previous.now));
  const displayedHp = hp > previous.hp ? hp : Math.max(hp, previous.hp - dt / .5 * Math.max(.05, previous.hp - hp));
  let displayedShield = previous.shield + (shield - previous.shield) * (1 - Math.exp(-dt * 10));
  if (Math.abs(displayedShield - shield) < .001) displayedShield = shield;
  let bounce = previous.bounce, swipe = previous.swipe ? { ...previous.swipe } : null;
  if (xp > previous.xp + .0001) swipe = { from: previous.xp, to: xp, t: 0 };
  else if (frame.level > previous.level || xp < previous.xp - .2) {
    swipe = { from: Math.max(previous.xp, .9), to: 1, t: 0 }; bounce = .42;
  }
  if (swipe) swipe.t += dt / .28;
  return { now, hp: displayedHp, shield: displayedShield, xp, level: frame.level, bounce: Math.max(0, bounce - dt),
    swipe: swipe && swipe.t < 1 ? swipe : null, swipeDraw: swipe };
}

export function hudLevelSize(state: HudAnimationState): number {
  return Math.round(21 * (state.bounce > 0 ? 1 + .55 * Math.sin((1 - state.bounce / .42) * Math.PI) : 1));
}
export function hudSwipePosition(state: NonNullable<HudAnimationState['swipe']>, delay = 0): number {
  const time = delay > 0 ? Math.max(0, state.t - delay) : Math.min(1, state.t);
  return state.from + (state.to - state.from) * (1 - (1 - time) ** 3);
}
