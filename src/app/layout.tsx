import type { Metadata, Viewport } from "next";
import { Instrument_Serif } from "next/font/google";
import { Suspense } from "react";

import { Toaster } from "@/components/ui/toaster";
import { AuthGate } from "@/features/auth/AuthGate";

import "./globals.css";

const display = Instrument_Serif({ weight: "400", style: ["normal", "italic"], subsets: ["latin"], variable: "--font-display-serif" });

export const metadata: Metadata = {
  title: { default: "Diagram AI", template: "%s · Diagram AI" },
  description: "A live diagramming canvas for people and AI agents. Draw any technical diagram together with Claude Code or Codex.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f1e9" },
    { media: "(prefers-color-scheme: dark)", color: "#0e1014" },
  ],
};

/** Applies the saved (or system) theme before first paint to avoid a flash. */
const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem("theme");if(t!=="light"&&t!=="dark"){t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}document.documentElement.setAttribute("data-theme",t)}catch(e){}})()`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" data-theme="light" className={display.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        {children}
        <Suspense>
          <AuthGate />
        </Suspense>
        <Toaster />
      </body>
    </html>
  );
}
