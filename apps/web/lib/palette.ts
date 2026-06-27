/**
 * Tiny global event bus so any component (e.g. the Masthead search pill) can
 * open the command palette without prop-drilling. The CommandPalette subscribes
 * on mount; callers fire {@link openPalette}.
 */
type Listener = () => void;

const listeners = new Set<Listener>();

/** Open the global command palette. */
export function openPalette(): void {
  for (const l of listeners) l();
}

/** Subscribe to open requests. Returns an unsubscribe function. */
export function onOpenPalette(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
