"use client";

import { useEffect, useEffectEvent, useRef } from "react";

/**
 * Moves focus back to a control once a dialog opened from state has closed.
 * Radix only does this for a `Dialog.Trigger`; the shared `Dialog` has none,
 * so without this keyboard focus would be dropped on `<body>`.
 */
export function useReturnFocus(open: boolean, getTarget: () => HTMLElement | null): void {
  const wasOpen = useRef(false);
  const target = useEffectEvent(getTarget);

  useEffect(() => {
    if (wasOpen.current && !open) target()?.focus();
    wasOpen.current = open;
  }, [open]);

  // Hidden by a navigation: when the route is shown again, leave focus alone.
  useEffect(
    () => () => {
      wasOpen.current = false;
    },
    [],
  );
}
