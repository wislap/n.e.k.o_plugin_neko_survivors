import { describe, expect, it, vi } from 'vitest';
import { bindPageLifecycle } from '../../src/app/browser-lifecycle';

function transition(type: 'pagehide' | 'pageshow', persisted = false) {
  const event = new Event(type);
  Object.defineProperty(event, 'persisted', { value: persisted });
  return event;
}

describe('browser page lifecycle binding', () => {
  it('ignores the initial ordinary pageshow and an unsolicited persisted pageshow', () => {
    const target = new EventTarget();
    const hide = vi.fn(), restore = vi.fn();
    const unbind = bindPageLifecycle(target, hide, restore);
    target.dispatchEvent(transition('pageshow'));
    target.dispatchEvent(transition('pageshow', true));
    expect(hide).not.toHaveBeenCalled();
    expect(restore).not.toHaveBeenCalled();
    unbind();
  });

  it('notifies only once for repeated pagehide events regardless of persisted', () => {
    const target = new EventTarget();
    const hide = vi.fn(), restore = vi.fn();
    const unbind = bindPageLifecycle(target, hide, restore);
    target.dispatchEvent(transition('pagehide'));
    target.dispatchEvent(transition('pagehide', true));
    target.dispatchEvent(transition('pagehide'));
    expect(hide).toHaveBeenCalledTimes(1);
    expect(restore).not.toHaveBeenCalled();
    unbind();
  });

  it('restores only after hide plus persisted pageshow, once per hidden cycle', () => {
    const target = new EventTarget();
    const calls: string[] = [];
    const unbind = bindPageLifecycle(target, () => calls.push('hide'), () => calls.push('restore'));
    target.dispatchEvent(transition('pagehide', true));
    target.dispatchEvent(transition('pageshow'));
    expect(calls).toEqual(['hide']);
    target.dispatchEvent(transition('pageshow', true));
    target.dispatchEvent(transition('pageshow', true));
    expect(calls).toEqual(['hide', 'restore']);
    target.dispatchEvent(transition('pagehide', true));
    target.dispatchEvent(transition('pageshow', true));
    expect(calls).toEqual(['hide', 'restore', 'hide', 'restore']);
    unbind();
  });

  it('unbinds both listeners idempotently and never calls either callback afterwards', () => {
    const target = new EventTarget();
    const hide = vi.fn(), restore = vi.fn();
    const unbind = bindPageLifecycle(target, hide, restore);
    target.dispatchEvent(transition('pagehide', true));
    unbind(); unbind();
    target.dispatchEvent(transition('pageshow', true));
    target.dispatchEvent(transition('pagehide'));
    expect(hide).toHaveBeenCalledTimes(1);
    expect(restore).not.toHaveBeenCalled();
  });

  it('sets transition state before callbacks, preventing reentrant duplicates', () => {
    const target = new EventTarget();
    const hide = vi.fn(() => target.dispatchEvent(transition('pagehide')));
    const restore = vi.fn(() => target.dispatchEvent(transition('pageshow', true)));
    const unbind = bindPageLifecycle(target, hide, restore);
    target.dispatchEvent(transition('pagehide'));
    target.dispatchEvent(transition('pageshow', true));
    expect(hide).toHaveBeenCalledTimes(1);
    expect(restore).toHaveBeenCalledTimes(1);
    unbind();
  });
});
