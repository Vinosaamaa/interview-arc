type Actions = { toggle: () => void; skip: (seconds: number) => void; boost: (active: boolean) => void };

// Shared by the website and serialized ChatGPT widget. Pointer cancellation
// preserves vertical scrolling; a double tap never first toggles playback.
export function attachLectureGestures(element: HTMLElement, actions: Actions) {
  let hold: ReturnType<typeof setTimeout> | undefined, tap: ReturnType<typeof setTimeout> | undefined;
  let pointer: number | null = null, x = 0, y = 0, moved = false, boosted = false, lastSide = 0;
  function cancel() {
    clearTimeout(hold); clearTimeout(tap); hold = tap = undefined;
    pointer = null;
    if (boosted) { boosted = false; actions.boost(false); }
  }
  function down(event: PointerEvent) {
    if (!event.isPrimary || event.button !== 0) return;
    pointer = event.pointerId; x = event.clientX; y = event.clientY; moved = false;
    hold = setTimeout(() => { clearTimeout(tap); tap = undefined; boosted = true; actions.boost(true); }, 450);
  }
  function move(event: PointerEvent) {
    if (pointer !== event.pointerId) return;
    if (Math.hypot(event.clientX - x, event.clientY - y) > 12) { moved = true; cancel(); }
  }
  function up(event: PointerEvent) {
    if (pointer !== event.pointerId) return;
    clearTimeout(hold); pointer = null;
    if (boosted) { boosted = false; actions.boost(false); return; }
    if (moved) return;
    const bounds = element.getBoundingClientRect(), side = x < bounds.left + bounds.width / 2 ? -1 : 1;
    if (tap && side === lastSide) { clearTimeout(tap); tap = undefined; actions.skip(side * 5); }
    else { if (tap) { clearTimeout(tap); actions.toggle(); } lastSide = side; tap = setTimeout(() => { tap = undefined; actions.toggle(); }, 280); }
  }
  function click(event: MouseEvent) { if (event.detail === 0) actions.toggle(); }
  function key(event: KeyboardEvent) {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); actions.skip(event.key === "ArrowLeft" ? -5 : 5); }
  }
  function visibility() { if (document.hidden) cancel(); }
  element.addEventListener("pointerdown", down); window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up); window.addEventListener("pointercancel", cancel);
  window.addEventListener("blur", cancel); document.addEventListener("visibilitychange", visibility);
  element.addEventListener("click", click); element.addEventListener("keydown", key);
  return () => {
    cancel(); element.removeEventListener("pointerdown", down); window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", cancel);
    window.removeEventListener("blur", cancel); document.removeEventListener("visibilitychange", visibility);
    element.removeEventListener("click", click); element.removeEventListener("keydown", key);
  };
}
