import { expect, it } from 'vitest';
import { createKeyboardInput } from '../../src/input/keyboard';

function key(type: 'keydown' | 'keyup', code: string, repeat = false) {
  const event = new Event(type, { cancelable: true });
  Object.defineProperties(event, { code: { value: code }, repeat: { value: repeat } });
  return event;
}

it('delivers E/Q actions once, normalizes movement and detaches all listeners', () => {
  const target = new EventTarget();
  const actions: string[] = [];
  const input = createKeyboardInput(target as Window, action => actions.push(action));
  target.dispatchEvent(key('keydown', 'KeyE'));
  target.dispatchEvent(key('keydown', 'KeyQ'));
  target.dispatchEvent(key('keydown', 'KeyQ', true));
  target.dispatchEvent(key('keydown', 'KeyW'));
  target.dispatchEvent(key('keydown', 'KeyD'));
  expect(actions).toEqual(['auto-upgrade', 'toggle-auto-upgrade']);
  const frame = input.sample();
  expect(Math.hypot(frame.moveX, frame.moveY)).toBeCloseTo(1);
  target.dispatchEvent(new Event('blur'));
  expect(input.sample().moveX).toBe(0);
  input.dispose();
  target.dispatchEvent(key('keydown', 'Escape'));
  expect(actions).toHaveLength(2);
});
