import { HeroActions } from "./HeroActions";
import { QuickStart } from "./QuickStart";
import { Reveal } from "./Reveal";

export function Hero() {
  return (
    <section aria-labelledby="hero-title" className="relative border-b border-line">
      {/* Drafting paper: a dot grid that fades out towards the content below. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage: "radial-gradient(var(--grid-dot) 1px, transparent 1px)",
          backgroundSize: "20px 20px",
          maskImage: "linear-gradient(to bottom, #000 25%, transparent)",
          WebkitMaskImage: "linear-gradient(to bottom, #000 25%, transparent)",
        }}
      />
      <div className="relative mx-auto grid w-full max-w-[1180px] grid-cols-1 items-center gap-10 px-4 py-12 sm:px-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:gap-16 lg:px-8 lg:py-16">
        <div className="flex flex-col items-start">
          <Reveal>
            <p className="font-mono text-[11px] tracking-[0.1em] text-ink-3 uppercase">A live canvas for people and agents</p>
          </Reveal>
          <Reveal delay={70}>
            <h1 id="hero-title" className="mt-4 font-display text-[46px] leading-[0.96] tracking-[-0.02em] text-balance text-ink sm:text-[62px] lg:text-[74px]">
              Diagrams, drawn <em className="text-accent">together</em>.
            </h1>
          </Reveal>
          <Reveal delay={140}>
            <p className="mt-5 max-w-[46ch] text-[15px] leading-relaxed text-pretty text-ink-2">
              Sketch a system, a process or a schema on the canvas while Claude Code, Codex or any other MCP agent draws alongside you.
            </p>
          </Reveal>
          <Reveal delay={210} className="mt-7">
            <HeroActions />
          </Reveal>
        </div>
        <Reveal delay={280}>
          <QuickStart />
        </Reveal>
      </div>
    </section>
  );
}
