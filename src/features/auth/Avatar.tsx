import { initialsOf } from "@/core/auth";
import { cn } from "@/lib/cn";

/** A round badge with someone's initials. `color` is any CSS colour; the default is ink on paper. */
export function Avatar({ name, color, size = 28, className, ring }: { name: string; color?: string; size?: number; className?: string; ring?: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-semibold select-none",
        color ? "text-white" : "bg-ink text-bg",
        ring && "ring-2 ring-[var(--surface)]",
        className,
      )}
      style={{ width: size, height: size, fontSize: Math.max(9, Math.round(size * 0.4)), ...(color ? { background: color } : {}) }}
    >
      {initialsOf(name)}
    </span>
  );
}
