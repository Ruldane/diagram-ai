"use client";

import { Check, ChevronRight } from "lucide-react";
import { ContextMenu, DropdownMenu } from "radix-ui";
import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

import { Kbd } from "./kbd";

/**
 * Dropdown and context menus share one look. Both are thin wrappers over
 * Radix, which provides keyboard navigation, focus management and typeahead.
 */

const CONTENT =
  "z-[70] min-w-[200px] rounded-xl border border-line bg-raised p-1 text-[13px] text-ink shadow-[var(--shadow-lg)] animate-pop";
const ITEM =
  "relative flex h-8 cursor-default items-center gap-2.5 rounded-md px-2 outline-none select-none data-[highlighted]:bg-sunken data-[disabled]:opacity-40 data-[disabled]:pointer-events-none";

export interface MenuItemProps {
  icon?: ReactNode;
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  checked?: boolean;
  onSelect?: () => void;
  children: ReactNode;
}

function ItemBody({ icon, shortcut, danger, checked, children }: MenuItemProps) {
  return (
    <>
      <span className={cn("flex size-4 shrink-0 items-center justify-center [&>svg]:size-4", danger ? "text-danger" : "text-ink-3")}>
        {checked ? <Check /> : icon}
      </span>
      <span className={cn("flex-1 truncate", danger && "text-danger")}>{children}</span>
      {shortcut ? <Kbd>{shortcut}</Kbd> : null}
    </>
  );
}

/* --------------------------------------------------------------- dropdown */

export function Menu({ trigger, children, align = "start", side = "bottom" }: {
  trigger: ReactNode;
  children: ReactNode;
  align?: "start" | "center" | "end";
  side?: "top" | "bottom" | "left" | "right";
}) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align={align} side={side} sideOffset={6} collisionPadding={8} className={CONTENT}>
          {children}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

export function MenuItem(props: MenuItemProps) {
  return (
    <DropdownMenu.Item className={ITEM} disabled={props.disabled} onSelect={props.onSelect}>
      <ItemBody {...props} />
    </DropdownMenu.Item>
  );
}

export function MenuSub({ label, icon, children }: { label: string; icon?: ReactNode; children: ReactNode }) {
  return (
    <DropdownMenu.Sub>
      <DropdownMenu.SubTrigger className={ITEM}>
        <span className="flex size-4 shrink-0 items-center justify-center text-ink-3 [&>svg]:size-4">{icon}</span>
        <span className="flex-1 truncate">{label}</span>
        <ChevronRight className="size-3.5 text-ink-3" />
      </DropdownMenu.SubTrigger>
      <DropdownMenu.Portal>
        <DropdownMenu.SubContent sideOffset={4} collisionPadding={8} className={CONTENT}>
          {children}
        </DropdownMenu.SubContent>
      </DropdownMenu.Portal>
    </DropdownMenu.Sub>
  );
}

export const MenuSeparator = () => <DropdownMenu.Separator className="mx-1 my-1 h-px bg-line" />;
export const MenuLabel = ({ children }: { children: ReactNode }) => (
  <DropdownMenu.Label className="px-2 pt-1.5 pb-1 text-[11px] font-semibold tracking-wide text-ink-3 uppercase">{children}</DropdownMenu.Label>
);

/* ---------------------------------------------------------------- context */

export function ContextArea({ children, menu, onOpenChange }: { children: ReactNode; menu: ReactNode; onOpenChange?: (open: boolean) => void }) {
  return (
    <ContextMenu.Root onOpenChange={onOpenChange}>
      <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content collisionPadding={8} className={CONTENT}>
          {menu}
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

export function ContextItem(props: MenuItemProps) {
  return (
    <ContextMenu.Item className={ITEM} disabled={props.disabled} onSelect={props.onSelect}>
      <ItemBody {...props} />
    </ContextMenu.Item>
  );
}

export const ContextSeparator = () => <ContextMenu.Separator className="mx-1 my-1 h-px bg-line" />;
