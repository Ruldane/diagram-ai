import Link from "next/link";

import { AgentStatus } from "./AgentStatus";
import { ThemeToggle } from "./ThemeToggle";

/** A shape, an elbow connector and a node: the smallest possible diagram. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden className={className}>
      <rect x="2.75" y="3.25" width="10" height="7.5" rx="1.75" stroke="currentColor" strokeWidth="1.6" />
      <path d="M7.75 10.75v3.5a2.5 2.5 0 0 0 2.5 2.5h3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="17.75" cy="16.75" r="4" fill="var(--accent)" />
    </svg>
  );
}

export function HomeHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-bg">
      <div className="mx-auto flex h-14 w-full max-w-[1180px] items-center gap-2 px-4 sm:px-6 lg:px-8">
        <Link href="/" aria-label="Diagram AI, home" className="-ml-1 flex shrink-0 items-center gap-2 rounded-lg px-1 py-1 text-ink">
          <LogoMark className="size-6" />
          <span className="font-display text-[21px] leading-none tracking-[-0.01em]">
            Diagram <em>AI</em>
          </span>
        </Link>
        <div className="ml-auto flex min-w-0 items-center gap-1">
          <AgentStatus />
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
