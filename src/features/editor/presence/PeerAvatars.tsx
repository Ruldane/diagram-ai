"use client";

import { Eye } from "lucide-react";

import { Tip } from "@/components/ui/tooltip";
import { Avatar } from "@/features/auth/Avatar";

import { useEditor } from "../store/context";

const MAX_SHOWN = 4;

/**
 * The people on this diagram right now, as overlapping avatars in their cursor
 * colours. Several tabs of one account count once. "View only" is shown to
 * somebody who cannot edit, so a locked canvas is never a mystery.
 */
export function PeerAvatars() {
  const peers = useEditor((state) => state.peers);
  const readOnly = useEditor((state) => state.readOnly);

  // One avatar per person: tabs of the same account merge, anonymous or local tabs stay separate.
  const people = new Map<string, { name: string; color: string; tabs: number }>();
  for (const peer of peers) {
    const key = peer.userId ?? `tab:${peer.id}`;
    const known = people.get(key);
    if (known) known.tabs += 1;
    else people.set(key, { name: peer.name, color: peer.color, tabs: 1 });
  }
  const list = [...people.values()];
  const shown = list.slice(0, MAX_SHOWN);
  const more = list.length - shown.length;

  if (!list.length && !readOnly) return null;
  return (
    <div className="flex items-center gap-2">
      {readOnly ? (
        <Tip label="You can look but not change this diagram. Ask the owner for edit access.">
          <span className="flex h-7 items-center gap-1.5 rounded-md bg-sunken px-2 text-[11.5px] font-medium text-ink-2">
            <Eye className="size-3.5" aria-hidden />
            View only
          </span>
        </Tip>
      ) : null}
      {list.length ? (
        <ul className="flex -space-x-1.5" aria-label={`${list.length} other ${list.length === 1 ? "person" : "people"} here`}>
          {shown.map((person) => (
            <li key={person.name + person.color}>
              <Tip label={person.tabs > 1 ? `${person.name} (${person.tabs} tabs)` : person.name}>
                <span>
                  <Avatar name={person.name} color={person.color} size={26} ring />
                  <span className="sr-only">{person.name}</span>
                </span>
              </Tip>
            </li>
          ))}
          {more > 0 ? (
            <li className="flex size-[26px] items-center justify-center rounded-full bg-sunken font-mono text-[10px] text-ink-2 ring-2 ring-[var(--surface)]">+{more}</li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}
