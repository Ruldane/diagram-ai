"use client";

import { useEffect, useState } from "react";

import type { PeerInfo } from "@/core/protocol";

import { useEditor } from "../store/context";
import type { useDisplay } from "../canvas/World";

type Display = ReturnType<typeof useDisplay>;

/** Children are positioned in world units but keep a constant on-screen size (the overlay is scaled by `--zoom`). */
const UNSCALED = { transform: "scale(calc(1 / var(--zoom)))", transformOrigin: "0 0" } as const;

/** Peers that are not stale: the server drops them after two minutes, the tab may keep one a little longer. */
const FRESH_MS = 2 * 60_000;

function Cursor({ peer }: { peer: PeerInfo }) {
  if (!peer.cursor) return null;
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute z-[15] transition-[left,top] duration-100 ease-linear"
      style={{ left: peer.cursor.x, top: peer.cursor.y, ...UNSCALED }}
    >
      <svg width="18" height="20" viewBox="0 0 18 20" className="drop-shadow-sm">
        <path d="M1.5 1.5 16 9.2 9.4 11.1 6.6 18z" fill={peer.color} stroke="#fff" strokeWidth="1.5" strokeLinejoin="round" />
      </svg>
      <span
        className="absolute top-4 left-3.5 max-w-[160px] truncate rounded-md px-1.5 py-0.5 text-[11px] font-semibold whitespace-nowrap text-white shadow-[var(--shadow-md)]"
        style={{ background: peer.color }}
      >
        {peer.name}
      </span>
    </div>
  );
}

/** What another person has selected: an outline in their colour, labelled with their name at one corner. */
function Selection({ peer, display }: { peer: PeerInfo; display: Display }) {
  const boxes = peer.selection.map((id) => display.nodes[id]).filter(Boolean);
  if (!boxes.length) return null;
  return (
    <>
      {boxes.slice(0, 40).map((node, index) => (
        <div
          key={node.id}
          aria-hidden
          className="pointer-events-none absolute z-[5] rounded-[3px]"
          style={{
            left: node.x,
            top: node.y,
            width: node.w,
            height: node.h,
            outline: `calc(2px / var(--zoom)) solid ${peer.color}`,
            outlineOffset: "calc(3px / var(--zoom))",
          }}
        >
          {index === 0 ? (
            <span
              className="absolute left-0 rounded-sm px-1 py-px text-[10px] leading-4 font-semibold whitespace-nowrap text-white"
              style={{ background: peer.color, bottom: "100%", marginBottom: "calc(5px / var(--zoom))", ...UNSCALED }}
            >
              {peer.name}
            </span>
          ) : null}
        </div>
      ))}
    </>
  );
}

/** Other people on this diagram: their pointers and selections, in their own colours. */
export function PeerLayer({ display }: { display: Display }) {
  const peers = useEditor((state) => state.peers);
  // A tab that went quiet (asleep, or the connection dropped without a goodbye) fades out instead of lingering.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, []);
  const live = peers.filter((peer) => now - Date.parse(peer.at) < FRESH_MS);
  return (
    <>
      {live.map((peer) => (
        <Selection key={`s-${peer.id}`} peer={peer} display={display} />
      ))}
      {live.map((peer) => (
        <Cursor key={`c-${peer.id}`} peer={peer} />
      ))}
    </>
  );
}
