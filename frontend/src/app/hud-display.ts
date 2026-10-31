import type { HudFrame, HudChromeFrame } from '../game';

export interface HudDisplaySample {
  timestampMs: number;
  combat: boolean;
  hud: Readonly<HudFrame> | null;
  chrome?: Readonly<HudChromeFrame> | null;
  /** Initialize a new display owner without advancing its retained history. */
  resetClock?: boolean;
}

/** A synchronous, single-owner display subscription; it never schedules work. */
export interface HudDisplay {
  connect(paint: (sample: HudDisplaySample) => void): () => void;
}

/** Joins the existing display clock to the HUD leaf without a React store. */
export function createHudDisplay(onError: (error: unknown) => void) {
  let retired = false, visible = true, resetPending = true;
  let latest: HudDisplaySample | undefined;
  let owner: { paint: (sample: HudDisplaySample) => void } | undefined;

  function deliver(sample: HudDisplaySample) {
    try { owner?.paint(sample); }
    catch (error) { onError(error); }
  }

  const display: HudDisplay = Object.freeze({
    connect(paint: (sample: HudDisplaySample) => void) {
      if (retired) return () => {};
      const connection = { paint };
      owner = connection;
      resetPending = true;
      if (visible && latest) { resetPending = false; deliver({ ...latest, resetClock: true }); }
      return () => { if (owner === connection) owner = undefined; };
    },
  });

  return {
    display,
    publish(sample: HudDisplaySample) {
      if (retired || !visible) return;
      const hud = sample.hud;
      // Copy exactly the public scalar values, never retain a frame/world/DOM.
      latest = Object.freeze({ timestampMs: sample.timestampMs, combat: sample.combat,
        hud: hud ? Object.freeze({ hp: hud.hp, maxHp: hud.maxHp, shield: hud.shield,
          xp: hud.xp, xpNeeded: hud.xpNeeded, level: hud.level }) : null,
        ...(sample.chrome === undefined ? {} : { chrome: sample.chrome ? Object.freeze({
          wave: sample.chrome.wave, materials: sample.chrome.materials, secondsLeft: sample.chrome.secondsLeft,
          timerTotal: sample.chrome.timerTotal, timerLabel: sample.chrome.timerLabel, timerVisible: sample.chrome.timerVisible,
          flandre: sample.chrome.flandre,
        }) : null }) });
      const resetClock = resetPending;
      resetPending = false;
      deliver(resetClock ? { ...latest, resetClock: true } : latest);
    },
    setVisible(value: boolean) {
      if (retired || visible === value) return;
      visible = value;
    },
    clearSample() { latest = undefined; },
    dispose() { retired = true; owner = undefined; latest = undefined; },
  };
}
