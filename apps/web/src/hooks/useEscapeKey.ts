import { useEffect, useRef } from "react";

/**
 * Registers a keydown listener on `document` that calls `onEscape` when the
 * Escape key is pressed. The listener is only active while `active` is true.
 *
 * The `onEscape` callback is stabilized internally via a ref, so callers do
 * not need to memoize it.
 */
export function useEscapeKey(active: boolean, onEscape: () => void): void {
  const callbackRef = useRef(onEscape);
  callbackRef.current = onEscape;

  useEffect(() => {
    if (!active) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") callbackRef.current();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [active]);
}
