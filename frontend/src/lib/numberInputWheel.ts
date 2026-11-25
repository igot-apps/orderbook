/** Keep a focused number input editable without letting the mouse wheel step it. */
export function preventNumberInputWheel(event: WheelEvent) {
  const input = event.target;
  if (!(input instanceof HTMLInputElement) || input.type !== 'number' || document.activeElement !== input) return;

  event.preventDefault();

  // The browser's default wheel action is cancelled above, so scroll the
  // nearest scrollable area ourselves (such as the invoice dialog).
  const delta = event.deltaY * (event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? window.innerHeight : 1);
  for (let parent = input.parentElement; parent; parent = parent.parentElement) {
    const overflow = window.getComputedStyle(parent).overflowY;
    if (!['auto', 'scroll'].includes(overflow) || parent.scrollHeight <= parent.clientHeight) continue;
    const next = Math.max(0, Math.min(parent.scrollTop + delta, parent.scrollHeight - parent.clientHeight));
    if (next !== parent.scrollTop) {
      parent.scrollTop = next;
      return;
    }
  }
  window.scrollBy({ top: delta, behavior: 'instant' });
}

export function installNumberInputWheelGuard() {
  document.addEventListener('wheel', preventNumberInputWheel, { capture: true, passive: false });
}
