"use client";

import Link from "next/link";
import { useId, useState, type InputHTMLAttributes, type ReactNode } from "react";
import { Eye, EyeOff } from "lucide-react";

import { TooltipProvider } from "@/components/ui/tooltip";
import { LogoMark } from "@/features/home/HomeHeader";
import { ThemeToggle } from "@/features/home/ThemeToggle";
import { cn } from "@/lib/cn";

/**
 * A drafting-table board behind the sign-in form: three shapes, two elbow
 * connectors, and the two kinds of collaborator the product is about, a
 * person and an agent, each with a labelled cursor.
 */
function Board() {
  return (
    <svg viewBox="0 0 520 380" role="img" aria-label="A small diagram being drawn by a person and an agent" className="h-auto w-full max-w-[520px]">
      <defs>
        <marker id="auth-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M1 1.5 8.5 5 1 8.5z" fill="var(--ink-2)" />
        </marker>
      </defs>
      <g fill="none" stroke="var(--ink-2)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" markerEnd="url(#auth-arrow)">
        <path d="M190 112h62a14 14 0 0 1 14 14v38" />
        <path d="M266 232v26a14 14 0 0 0 14 14h56" />
      </g>
      <g fontFamily="var(--font-mono)" fontSize="12" fill="var(--ink)">
        <rect x="40" y="82" width="150" height="60" rx="10" fill="var(--raised)" stroke="var(--ink)" strokeWidth="1.6" />
        <text x="115" y="117" textAnchor="middle">Client</text>
        <rect x="191" y="164" width="150" height="68" rx="10" fill="var(--raised)" stroke="var(--ink)" strokeWidth="1.6" />
        <text x="266" y="203" textAnchor="middle">API · sessions</text>
        <rect x="336" y="244" width="150" height="56" rx="28" fill="var(--accent-soft)" stroke="var(--accent)" strokeWidth="1.6" />
        <text x="411" y="277" textAnchor="middle">PostgreSQL</text>
      </g>
      <g transform="translate(150 52)">
        <path d="M0 0v15.5l4.2-3.6 2.9 6.6 2.6-1.1-2.9-6.5h5.9z" fill="var(--ink)" stroke="var(--bg)" strokeWidth="1.3" strokeLinejoin="round" />
        <g transform="translate(11 17)">
          <rect width="34" height="19" rx="5" fill="var(--ink)" />
          <text x="17" y="13" textAnchor="middle" fontFamily="var(--font-sans)" fontSize="11" fontWeight="600" fill="var(--bg)">Ana</text>
        </g>
      </g>
      <g transform="translate(402 116)">
        <path d="M0 0v15.5l4.2-3.6 2.9 6.6 2.6-1.1-2.9-6.5h5.9z" fill="var(--agent-claude)" stroke="var(--bg)" strokeWidth="1.3" strokeLinejoin="round" />
        <g transform="translate(11 17)">
          <rect width="84" height="19" rx="5" fill="var(--agent-claude)" />
          <text x="42" y="13" textAnchor="middle" fontFamily="var(--font-sans)" fontSize="11" fontWeight="600" fill="#fff">Claude Code</text>
        </g>
      </g>
    </svg>
  );
}

function AuthFrame({ title, lead, children, footer }: { title: ReactNode; lead?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      <header className="flex h-14 shrink-0 items-center justify-between px-4 sm:px-6 lg:px-8">
        <Link href="/" aria-label="Diagram AI, home" className="-ml-1 flex items-center gap-2 rounded-lg px-1 py-1 text-ink">
          <LogoMark className="size-6" />
          <span className="font-display text-[21px] leading-none tracking-[-0.01em]">
            Diagram <em>AI</em>
          </span>
        </Link>
        <ThemeToggle />
      </header>

      <main className="grid flex-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <section className="flex items-start justify-center px-4 pt-10 pb-16 sm:px-6 lg:items-center lg:pt-0">
          <div className="w-full max-w-[380px] animate-fade-up">
            <p className="font-mono text-[11px] tracking-[0.1em] text-ink-3 uppercase">Your table</p>
            <h1 className="mt-3 font-display text-[44px] leading-[1] tracking-[-0.02em] text-balance text-ink sm:text-[52px]">{title}</h1>
            {lead ? <p className="mt-4 text-[14px] leading-relaxed text-pretty text-ink-2">{lead}</p> : null}
            <div className="mt-8">{children}</div>
            {footer ? <div className="mt-6 border-t border-line pt-5 text-[13px] text-ink-2">{footer}</div> : null}
          </div>
        </section>

        <aside aria-hidden className="relative hidden flex-col items-center justify-center gap-8 overflow-hidden border-l border-line bg-surface p-10 lg:flex">
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              backgroundImage: "radial-gradient(var(--grid-dot) 1px, transparent 1px)",
              backgroundSize: "20px 20px",
              maskImage: "radial-gradient(ellipse at center, #000 35%, transparent 80%)",
              WebkitMaskImage: "radial-gradient(ellipse at center, #000 35%, transparent 80%)",
            }}
          />
          <div className="relative w-full max-w-[520px]">
            <Board />
          </div>
          <p className="relative max-w-[34ch] text-center font-display text-[26px] leading-tight text-ink-2">
            Everyone at the <em className="text-accent">table</em>, human or not.
          </p>
        </aside>
      </main>
    </div>
  );
}

/** Full-page frame for sign-in and sign-up. */
export function AuthLayout(props: { title: ReactNode; lead?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <TooltipProvider>
      <AuthFrame {...props} />
    </TooltipProvider>
  );
}

interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "className"> {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  /** Adds a show/hide control. */
  reveal?: boolean;
}

/** Labelled input, larger than the editor's compact fields. */
export function AuthField({ label, hint, error, reveal, type = "text", ...props }: FieldProps) {
  const id = useId();
  const [shown, setShown] = useState(false);
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[12px] font-semibold text-ink-2">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type={reveal && shown ? "text" : type}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(
            "h-11 w-full rounded-lg border bg-raised px-3 text-[14px] text-ink outline-none transition-colors placeholder:text-ink-4",
            "hover:border-ink-3 focus:border-accent focus:ring-2 focus:ring-accent/20",
            error ? "border-danger" : "border-line-strong",
            reveal && "pr-11",
          )}
          {...props}
        />
        {reveal ? (
          <button
            type="button"
            aria-label={shown ? "Hide password" : "Show password"}
            aria-pressed={shown}
            onClick={() => setShown((value) => !value)}
            className="absolute top-1/2 right-1 flex size-9 -translate-y-1/2 items-center justify-center rounded-md text-ink-3 hover:bg-sunken hover:text-ink"
          >
            {shown ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        ) : null}
      </div>
      {hint ? (
        <p id={`${id}-hint`} className="text-[12px] text-ink-3">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-[12px] text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
