export function createPointerInput(container: HTMLElement) {
  let x = 0;
  let y = 0;
  let down = false;
  function move(event: PointerEvent) {
    const bounds = container.getBoundingClientRect();
    x = event.clientX - bounds.left;
    y = event.clientY - bounds.top;
  }
  function press(event: PointerEvent) {
    if (event.button !== 0 || (event.target as HTMLElement).closest('button,input,select,[role="dialog"]')) return;
    move(event); down = true;
  }
  function release() { down = false; }
  container.addEventListener('pointermove', move);
  container.addEventListener('pointerdown', press);
  window.addEventListener('pointerup', release);
  window.addEventListener('blur', release);
  return {
    sample: () => ({ x, y, down }),
    dispose() {
      container.removeEventListener('pointermove', move);
      container.removeEventListener('pointerdown', press);
      window.removeEventListener('pointerup', release);
      window.removeEventListener('blur', release);
      down = false;
    },
  };
}
