"use client";

import { Toaster as SonnerToaster } from "sonner";

/** App-wide toast outlet, styled with the design tokens. */
export function Toaster() {
  return (
    <SonnerToaster
      position="bottom-center"
      offset={72}
      toastOptions={{
        style: {
          background: "var(--ink)",
          color: "var(--bg)",
          border: "none",
          borderRadius: 10,
          fontFamily: "var(--font-sans)",
          fontSize: 13,
          boxShadow: "var(--shadow-lg)",
        },
      }}
    />
  );
}
