import type { InputFrame } from '../game';

/** Input capture is scoped to a mount and can be completely detached. */
export function createKeyboardInput(target: Window, onAction: (action: 'pause' | 'mute' | 'auto-upgrade' | 'toggle-auto-upgrade') => void) {
  const held = new Set<string>();
  const pressed = new Set<string>();
  const captured = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
  function keydown(event: KeyboardEvent) {
    const element = event.target as HTMLElement | null;
    if (element?.closest?.('input,select,textarea,[contenteditable="true"]')) return;
    if (captured.has(event.code)) event.preventDefault();
    if (!held.has(event.code)) pressed.add(event.code);
    held.add(event.code);
    if (!event.repeat && event.code === 'Escape') onAction('pause');
    if (!event.repeat && event.code === 'KeyM') onAction('mute');
    if (!event.repeat && event.code === 'KeyE') onAction('auto-upgrade');
    if (!event.repeat && event.code === 'KeyQ') onAction('toggle-auto-upgrade');
  }
  function keyup(event: KeyboardEvent) { held.delete(event.code); }
  function clear() { held.clear(); pressed.clear(); }
  target.addEventListener('keydown', keydown);
  target.addEventListener('keyup', keyup);
  target.addEventListener('blur', clear);
  function axis(negative: string[], positive: string[]) {
    return Number(positive.some(key => held.has(key))) - Number(negative.some(key => held.has(key)));
  }
  function normalize(x: number, y: number) {
    const length = Math.hypot(x, y) || 1;
    return { x: x / length, y: y / length };
  }
  return {
    sample(): Pick<InputFrame, 'moveX' | 'moveY' | 'slow' | 'clear' | 'ultimate' | 'p2MoveX' | 'p2MoveY' | 'p2Slow' | 'p2Clear'> {
      const p1 = normalize(axis(['KeyA', 'ArrowLeft'], ['KeyD', 'ArrowRight']), axis(['KeyW', 'ArrowUp'], ['KeyS', 'ArrowDown']));
      const p2 = normalize(axis(['Numpad4'], ['Numpad6']), axis(['Numpad8'], ['Numpad2']));
      const result = {
        moveX: p1.x, moveY: p1.y, slow: held.has('ShiftLeft') || held.has('ShiftRight'),
        clear: pressed.has('Space'), ultimate: pressed.has('KeyR'),
        p2MoveX: p2.x, p2MoveY: p2.y, p2Slow: held.has('Numpad0'), p2Clear: pressed.has('NumpadDecimal'),
      };
      pressed.clear();
      return result;
    },
    clear,
    dispose() {
      target.removeEventListener('keydown', keydown);
      target.removeEventListener('keyup', keyup);
      target.removeEventListener('blur', clear);
      clear();
    },
  };
}
