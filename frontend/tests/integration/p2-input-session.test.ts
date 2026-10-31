import { describe, expect, it } from 'vitest';
import { createKeyboardInput } from '../../src/input/keyboard';
import { createGameSession, EMPTY_INPUT, type GameSession, type GameEvent } from '../../src/game';

const options = { characterId: 'yui', difficulty: 'normal', partySize: 2, seed: 69, pilot: false } as const;
function key(target: EventTarget, type: 'keydown' | 'keyup', code: string, repeat = false) {
  const event = new Event(type, { cancelable: true });
  Object.defineProperties(event, { code: { value: code }, repeat: { value: repeat } });
  target.dispatchEvent(event);
}
function actor(game: GameSession, slot: number) {
  const result = game.readFrame().actors.find(value => value.kind === 'player' && value.id === slot);
  if (!result) throw new Error(`Missing P${slot}`);
  return result;
}
function mateArmorWave(game: GameSession) { return game.exportSave()?.run.mates?.[0]?.armorWave; }
function mount(challenge = false) {
  const game = createGameSession();
  game.dispatch(challenge ? { type: 'start-challenge', challenge: 'flandre', options } : { type: 'start-run', options });
  const target = new EventTarget();
  const keyboard = createKeyboardInput(target as Window, () => {});
  return { game, target, keyboard, step: () => game.advance({ ...EMPTY_INPUT, ...keyboard.sample() }) };
}

describe('real keyboard frames driving the public two-player session', () => {
  it('moves P2 in each numpad direction without moving P1, and keyup returns P2 to real AI growth', () => {
    const { game, target, keyboard, step } = mount();
    try {
      for (const [code, axis, sign] of [['Numpad8', 'y', -1], ['Numpad2', 'y', 1], ['Numpad4', 'x', -1], ['Numpad6', 'x', 1]] as const) {
        const primary = actor(game, 1), before = actor(game, 2);
        key(target, 'keydown', code); step();
        const after = actor(game, 2);
        expect((after[axis] - before[axis]) * sign).toBeGreaterThan(0);
        expect(actor(game, 1).x).toBe(primary.x); expect(actor(game, 1).y).toBe(primary.y);
        expect(mateArmorWave(game)).toBeUndefined(); // Manual movement never ran the AI wave-growth branch.
        key(target, 'keyup', code);
      }
      const before = actor(game, 2); step();
      expect(mateArmorWave(game)).toBe(0); // Returning to AI applies its once-per-wave rule, through advance().
      for (let tick = 0; tick < 30; tick++) step();
      expect(Math.hypot(actor(game, 2).x - before.x, actor(game, 2).y - before.y)).toBeGreaterThan(0);
    } finally { keyboard.dispose(); }
  });

  it('P2 0 halves real Flandre movement and Decimal triggers the shared purge once without slowing P1', () => {
    const { game, target, keyboard, step } = mount(true);
    try {
      key(target, 'keydown', 'Numpad8'); key(target, 'keydown', 'KeyW');
      const p1 = actor(game, 1), p2 = actor(game, 2); step();
      const normal1 = p1.y - actor(game, 1).y, normal2 = p2.y - actor(game, 2).y;
      key(target, 'keydown', 'Numpad0');
      const full = actor(game, 1), slow = actor(game, 2); step();
      expect(full.y - actor(game, 1).y).toBeCloseTo(normal1);
      expect(slow.y - actor(game, 2).y).toBeCloseTo(normal2 / 2);
      key(target, 'keyup', 'Numpad0'); key(target, 'keyup', 'KeyW');
      // Preserve real prologue and its first-projectile teaching gate. No controller fields are changed.
      for (let tick = 0; tick < 900 && !game.readFrame().projectiles.some(shot => shot.hostile); tick++) step();
      expect(game.readFrame().projectiles.some(shot => shot.hostile)).toBe(true);
      const initial = game.readFrame().encounter;
      if (initial?.kind !== 'flandre') throw new Error('Expected real Flandre controller');
      expect(initial.purgeCooldown).toBeLessThanOrEqual(0);
      key(target, 'keydown', 'NumpadDecimal');
      const events = step().events;
      const purged = game.readFrame().encounter;
      if (purged?.kind !== 'flandre') throw new Error('Expected real Flandre controller');
      expect(purged.purgeCooldown).toBeGreaterThan(14);
      expect(events.filter(event => event.type === 'sound' && event.name === 'petPurge')).toHaveLength(1);
      key(target, 'keydown', 'NumpadDecimal', true);
      expect(step().events.filter(event => event.type === 'sound' && event.name === 'petPurge')).toHaveLength(0);
      const next = game.readFrame().encounter;
      if (next?.kind !== 'flandre') throw new Error('Expected real Flandre controller');
      expect(next.purgeCooldown).toBeLessThan(purged.purgeCooldown);
    } finally { keyboard.dispose(); }
  });

  it('blur stops held P1 movement, releases P2 back to AI and retires unconsumed skill presses', () => {
    const { game, target, keyboard, step } = mount();
    try {
      key(target, 'keydown', 'KeyW'); key(target, 'keydown', 'Numpad6'); step();
      expect(mateArmorWave(game)).toBeUndefined();
      const primary = actor(game, 1);
      key(target, 'keydown', 'Numpad0'); key(target, 'keydown', 'NumpadDecimal');
      target.dispatchEvent(new Event('blur')); step();
      expect(actor(game, 1).x).toBe(primary.x); expect(actor(game, 1).y).toBe(primary.y);
      expect(mateArmorWave(game)).toBe(0);
      game.dispatch({ type: 'start-challenge', challenge: 'flandre', options });
      const events: GameEvent[] = [];
      for (let tick = 0; tick < 560; tick++) events.push(...step().events);
      expect(events.some(event => event.type === 'sound' && event.name === 'petPurge')).toBe(false);
      keyboard.dispose();
      key(target, 'keydown', 'KeyW'); key(target, 'keydown', 'Numpad8');
      const before = actor(game, 1); step(); expect(actor(game, 1).y).toBe(before.y);
    } finally { keyboard.dispose(); }
  });
});
