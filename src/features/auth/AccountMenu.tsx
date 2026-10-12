"use client";

import { ChevronDown, KeyRound, LogOut, Settings } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Menu, MenuItem, MenuLabel, MenuSeparator } from "@/components/ui/menu";

import { Avatar } from "./Avatar";
import { useSession } from "./use-session";

/**
 * Who is signed in, with account settings and sign out. Shows nothing in
 * solo mode (there are no accounts) and "Sign in" when a visitor is not.
 */
export function AccountMenu() {
  const router = useRouter();
  const { loading, authRequired, user, signOut } = useSession();
  if (loading || !authRequired) return null;
  if (!user) {
    return (
      <Link href="/login">
        <Button size="sm" variant="secondary">
          Sign in
        </Button>
      </Link>
    );
  }
  return (
    <Menu
      align="end"
      trigger={
        <button
          type="button"
          aria-label={`Account menu for ${user.name}`}
          className="flex h-8 items-center gap-2 rounded-lg pr-1.5 pl-1 text-ink hover:bg-sunken data-[state=open]:bg-sunken"
        >
          <Avatar name={user.name} size={24} />
          <span className="hidden max-w-[150px] truncate text-[12.5px] font-medium sm:inline">{user.name}</span>
          <ChevronDown aria-hidden className="size-3.5 text-ink-3" />
        </button>
      }
    >
      <div className="px-2 pt-1.5 pb-1">
        <p className="truncate text-[13px] font-semibold text-ink">{user.name}</p>
        <p className="truncate text-[12px] text-ink-3">{user.email}</p>
        {user.isAdmin ? <p className="mt-1 font-mono text-[10px] tracking-wide text-ink-3 uppercase">Administrator</p> : null}
      </div>
      <MenuSeparator />
      <MenuItem icon={<Settings />} onSelect={() => router.push("/account")}>
        Account settings
      </MenuItem>
      <MenuItem icon={<KeyRound />} onSelect={() => router.push("/account#tokens")}>
        Access tokens
      </MenuItem>
      <MenuSeparator />
      <MenuLabel>Session</MenuLabel>
      <MenuItem icon={<LogOut />} onSelect={() => void signOut()}>
        Sign out
      </MenuItem>
    </Menu>
  );
}
