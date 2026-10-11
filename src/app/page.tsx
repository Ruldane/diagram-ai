import type { Metadata } from "next";

import { AgentSection } from "@/features/home/AgentSection";
import { DiagramsSection } from "@/features/home/DiagramsSection";
import { Hero } from "@/features/home/Hero";
import { HomeHeader } from "@/features/home/HomeHeader";
import { HomeProviders } from "@/features/home/HomeProviders";
import { Reveal } from "@/features/home/Reveal";
import { SECTION } from "@/features/home/sections";
import { TypePicker } from "@/features/home/TypePicker";

export const metadata: Metadata = {
  title: { absolute: "Diagram AI" },
  description: "Your diagrams, every diagram type, and the instructions to connect Claude Code, Codex or any MCP agent to the canvas.",
};

/**
 * Home. A static shell: nothing is read on the server, so it prerenders as is.
 * The diagram list and the agent status load in the browser from the REST API.
 */
export default function HomePage() {
  return (
    <HomeProviders>
      <div className="flex min-h-full flex-col">
        <a
          href={`#${SECTION.diagrams}`}
          className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-lg focus:bg-ink focus:px-3 focus:py-2 focus:text-[13px] focus:font-medium focus:text-bg"
        >
          Skip to your diagrams
        </a>
        <HomeHeader />
        <main className="flex-1">
          <Hero />
          <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-16 px-4 pt-12 pb-20 sm:px-6 lg:px-8 lg:pt-14">
            <Reveal delay={350}>
              <DiagramsSection />
            </Reveal>
            <TypePicker />
            <AgentSection />
          </div>
        </main>
        <footer className="border-t border-line">
          <div className="mx-auto flex w-full max-w-[1180px] flex-wrap items-center justify-between gap-x-6 gap-y-1 px-4 py-5 font-mono text-[11px] text-ink-3 sm:px-6 lg:px-8">
            <span>Diagram AI</span>
            <span>MCP endpoint: /api/mcp</span>
          </div>
        </footer>
      </div>
    </HomeProviders>
  );
}
