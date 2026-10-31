/** Notify the owner about page exit and a later BFCache restoration.
 * The owner remains responsible for disposing and rebuilding its runtime.
 */
export function bindPageLifecycle(
  target: EventTarget,
  onHide: () => void,
  onRestore: () => void,
): () => void {
  let hidden = false;
  let bound = true;

  function hide() {
    if (!bound || hidden) return;
    hidden = true;
    onHide();
  }

  function show(event: Event) {
    if (!bound || !hidden || (event as PageTransitionEvent).persisted !== true) return;
    hidden = false;
    onRestore();
  }

  target.addEventListener('pagehide', hide);
  target.addEventListener('pageshow', show);
  return () => {
    if (!bound) return;
    bound = false;
    target.removeEventListener('pagehide', hide);
    target.removeEventListener('pageshow', show);
  };
}
