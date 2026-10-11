"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import type { Id } from "@/core/model/types";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";

import { Canvas } from "./canvas/Canvas";
import { Scrollbars } from "./canvas/Scrollbars";
import { useShortcuts } from "./commands/use-shortcuts";
import { Dialogs } from "./dialogs/Dialogs";
import { usePacksSync } from "./packs/use-packs";
import { PresentMode } from "./present/PresentMode";
import { ShapePalette } from "./panels/ShapePalette";
import { SidePanel } from "./panels/SidePanel";
import { Toolbar } from "./panels/Toolbar";
import { Logo, TopBar } from "./panels/TopBar";
import { ZoomControls } from "./panels/ZoomControls";
import { EditorProvider, useEditor } from "./store/context";
import { createEditorStore } from "./store/editor-store";
import { connectSync } from "./sync/client";

/** Shown in the page shell while the route and the document load. */
export function EditorSkeleton() {
  return (
    <div className="flex h-dvh w-full items-center justify-center bg-bg" role="status" aria-label="Loading diagram">
      <div className="flex flex-col items-center gap-3 text-ink-3">
        <Logo className="size-7 animate-pulse text-ink-2" />
        <p className="font-mono text-[11px] tracking-wide uppercase">Opening diagram</p>
      </div>
    </div>
  );
}

function Message({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex h-dvh w-full flex-col items-center justify-center gap-4 bg-bg px-6 text-center">
      <Logo className="size-8 text-ink-2" />
      <h1 className="font-display text-[32px] leading-tight text-ink">{title}</h1>
      <p className="max-w-sm text-[14px] text-ink-3">{body}</p>
      <Link href="/">
        <Button variant="primary" size="lg">
          Back to all diagrams
        </Button>
      </Link>
    </div>
  );
}

/** Everything around the canvas that is not the diagram. Not rendered while presenting. */
function Chrome({ paletteOpen }: { paletteOpen: boolean }) {
  return (
    <>
      <Scrollbars />
      <TopBar />

      <div className="pointer-events-none absolute top-[68px] bottom-3 left-3 z-20 flex [&>*]:pointer-events-auto">{paletteOpen ? <ShapePalette /> : null}</div>
      <div className="pointer-events-none absolute top-[68px] right-3 bottom-3 z-20 flex [&>*]:pointer-events-auto">
        <SidePanel />
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-3 z-20 flex justify-center [&>*]:pointer-events-auto">
        <Toolbar />
      </div>
      <div className="pointer-events-none absolute bottom-3 z-20 [&>*]:pointer-events-auto" style={{ left: paletteOpen ? 256 : 12 }}>
        <ZoomControls />
      </div>

      <Dialogs />
    </>
  );
}

/** Floating chrome around the canvas. Only rendered once the document is loaded. */
function Workspace() {
  useShortcuts();
  const paletteOpen = useEditor((state) => state.paletteOpen);
  const presenting = useEditor((state) => state.presenting !== null);
  const name = useEditor((state) => state.doc!.name);

  // Keep the tab title in sync with the (editable, agent-renamable) diagram name.
  useEffect(() => {
    document.title = `${name} · Diagram AI`;
  }, [name]);

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-bg">
      <Canvas />
      {presenting ? null : <Chrome paletteOpen={paletteOpen} />}
      <PresentMode />
    </div>
  );
}

function Shell() {
  const status = useEditor((state) => state.status);
  if (status === "loading") return <EditorSkeleton />;
  if (status === "missing") return <Message title="This diagram is gone" body="It may have been deleted, or the link is wrong." />;
  if (status === "error") return <Message title="Could not open the diagram" body="The server did not respond. Check that the app is still running, then reload." />;
  return <Workspace />;
}

/**
 * One editor instance. The store is created per mount (not a module global),
 * so several diagrams can be open in the router's kept-alive routes without
 * sharing state, and the live connection is opened and closed by an effect.
 */
export function Editor({ diagramId }: { diagramId: Id }) {
  const [store] = useState(() => createEditorStore(diagramId));
  useEffect(() => connectSync(store), [store]);
  usePacksSync();
  return (
    <EditorProvider store={store}>
      <TooltipProvider>
        <Shell />
      </TooltipProvider>
    </EditorProvider>
  );
}
