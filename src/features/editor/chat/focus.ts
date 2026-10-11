/**
 * Lets the `assistant.open` command focus the composer. The command usually
 * runs before the Ask panel is on screen, so the request waits until the
 * composer mounts and takes it.
 */
let pending = false;
const listeners = new Set<() => void>();

export function requestComposerFocus(): void {
  pending = true;
  for (const listener of listeners) listener();
}

/** True once per request; the composer calls it when it is ready to take focus. */
export function takeComposerFocusRequest(): boolean {
  const requested = pending;
  pending = false;
  return requested;
}

export function onComposerFocusRequest(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
