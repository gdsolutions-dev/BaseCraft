// Whether Shift is held, followed from the window's own events (no native key-state query: no native module, R4).
// ponytail: an opening from the system relies on Shift's key repeat or a mouse move reaching the window within the grace;
// add a native query if owners report missed bypasses.

/** How long an opening waits for Shift to show before its startup runs (only when there is something to bypass). */
export const SHIFT_GRACE_MS = 300;

let held = false;
const CAPTURE = { capture: true }; // an object: Node's EventTarget (unit tests) does not remove a listener added with a bare `true`

const EVENTS = ['keydown', 'keyup', 'mousedown', 'mouseup', 'mousemove', 'click', 'pointerdown', 'pointermove', 'pointerup'];

function follow(e: Event): void {
  const { key, shiftKey } = e as Partial<KeyboardEvent>;
  if (key === 'Shift') held = e.type === 'keydown';   // Shift's own keyup may still carry the flag on some platforms
  else if (typeof shiftKey === 'boolean') held = shiftKey;
}
/** The window losing the focus (not an element of it: their blur reaches the window's capture too). */
function forget(e: Event): void { if (e.target === e.currentTarget) held = false; }

/** Follows Shift on `target` (capture): keydown/keyup of 'Shift', the shiftKey of every KeyboardEvent, MouseEvent and PointerEvent; false on blur. */
export function trackShift(target: EventTarget): () => void {
  for (const type of EVENTS) target.addEventListener(type, follow, CAPTURE);
  target.addEventListener('blur', forget, CAPTURE);
  return () => {
    for (const type of EVENTS) target.removeEventListener(type, follow, CAPTURE);
    target.removeEventListener('blur', forget, CAPTURE);
  };
}

export function shiftHeld(): boolean { return held; }
