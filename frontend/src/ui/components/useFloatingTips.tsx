import { useLayoutEffect, useRef, useState, type FocusEvent, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';

interface Tip { text: string; x: number; y: number }
function FloatingTip({ tip }: { tip: Tip }) {
  const node = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: tip.x + 14, top: tip.y + 14 });
  useLayoutEffect(() => {
    const element = node.current;
    if (!element) return;
    const width = element.offsetWidth, height = element.offsetHeight;
    setPosition({
      left: Math.max(8, tip.x + 14 + width > window.innerWidth - 8 ? tip.x - width - 14 : tip.x + 14),
      top: Math.max(8, tip.y + 14 + height > window.innerHeight - 8 ? tip.y - height - 14 : tip.y + 14),
    });
  }, [tip]);
  return <div ref={node} className="tip-float show" role="tooltip" style={position}>{tip.text}</div>;
}

/** The reference tooltip follows the pointer and flips at the viewport edge. */
export function useFloatingTips(owner?: unknown) {
  const [tip, setTip] = useState<Tip>();
  useLayoutEffect(() => setTip(undefined), [owner]);
  function hover(event: MouseEvent<HTMLElement> | FocusEvent<HTMLElement>) {
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-tip]') : null;
    const text = target?.dataset.tip;
    if (!target || !text) { setTip(undefined); return; }
    const box = target.getBoundingClientRect();
    setTip({ text, x: 'clientX' in event ? event.clientX : box.left, y: 'clientY' in event ? event.clientY : box.bottom });
  }
  function leave(event: MouseEvent<HTMLElement>) {
    const target = event.target instanceof Element ? event.target.closest('[data-tip]') : null;
    const next = event.relatedTarget instanceof Element ? event.relatedTarget.closest('[data-tip]') : null;
    if (target !== next) setTip(undefined);
  }
  return {
    clear: () => setTip(undefined),
    events: { onMouseOver: hover, onMouseMove: hover, onMouseOut: leave, onFocus: hover, onBlur: () => setTip(undefined) },
    layer: tip && typeof document !== 'undefined' ? createPortal(<FloatingTip tip={tip} />, document.body) : null,
  };
}
