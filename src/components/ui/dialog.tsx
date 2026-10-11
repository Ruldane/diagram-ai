"use client";

import { X } from "lucide-react";
import { Dialog as RadixDialog, Popover as RadixPopover } from "radix-ui";
import { useRef, type ReactNode } from "react";

import { cn } from "@/lib/cn";

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  /** Max width class, e.g. `max-w-2xl`. */
  width?: string;
  children: ReactNode;
  footer?: ReactNode;
}

/** Modal dialog with a title bar. Focus is trapped and restored by Radix. */
export function Dialog({ open, onOpenChange, title, description, width = "max-w-lg", children, footer }: DialogProps) {
  // These dialogs are opened from state (shortcuts, menus) rather than a Radix trigger,
  // so remember what had focus and give it back on close.
  const opener = useRef<HTMLElement | null>(null);
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-[60] bg-ink/25 backdrop-blur-[2px] dark:bg-black/55" />
        <RadixDialog.Content
          onOpenAutoFocus={() => {
            opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
          }}
          onCloseAutoFocus={(event) => {
            if (!opener.current?.isConnected) return;
            event.preventDefault();
            opener.current.focus();
          }}
          className={cn(
            "fixed top-1/2 left-1/2 z-[61] flex max-h-[min(86vh,820px)] w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 flex-col",
            "rounded-2xl border border-line bg-surface shadow-[var(--shadow-lg)] outline-none",
            width,
          )}
        >
          <header className="flex shrink-0 items-start gap-4 border-b border-line px-5 pt-4 pb-3.5">
            <div className="min-w-0 flex-1">
              <RadixDialog.Title className="font-display text-[22px] leading-tight text-ink">{title}</RadixDialog.Title>
              {description ? (
                <RadixDialog.Description className="mt-1 text-[13px] text-ink-3">{description}</RadixDialog.Description>
              ) : (
                <RadixDialog.Description className="sr-only">{title}</RadixDialog.Description>
              )}
            </div>
            <RadixDialog.Close
              aria-label="Close"
              className="-mr-1.5 flex size-8 shrink-0 items-center justify-center rounded-lg text-ink-3 hover:bg-sunken hover:text-ink"
            >
              <X className="size-4" />
            </RadixDialog.Close>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer ? <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-line px-5 py-3">{footer}</footer> : null}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

export interface PopoverProps {
  trigger: ReactNode;
  children: ReactNode;
  align?: "start" | "center" | "end";
  side?: "top" | "bottom" | "left" | "right";
  className?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function Popover({ trigger, children, align = "start", side = "bottom", className, open, onOpenChange }: PopoverProps) {
  return (
    <RadixPopover.Root open={open} onOpenChange={onOpenChange}>
      <RadixPopover.Trigger asChild>{trigger}</RadixPopover.Trigger>
      <RadixPopover.Portal>
        <RadixPopover.Content
          align={align}
          side={side}
          sideOffset={8}
          collisionPadding={10}
          className={cn("z-[70] rounded-xl border border-line bg-raised p-3 text-ink shadow-[var(--shadow-lg)] outline-none animate-pop", className)}
        >
          {children}
        </RadixPopover.Content>
      </RadixPopover.Portal>
    </RadixPopover.Root>
  );
}
