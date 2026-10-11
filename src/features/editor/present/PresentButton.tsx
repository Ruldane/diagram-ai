"use client";

import { Presentation } from "lucide-react";

import { IconButton } from "@/components/ui/button";

import { runCommand, shortcutOf } from "../commands/commands";
import { useEditor, useEditorStore } from "../store/context";
import { countFrames } from "./slides";

/** Top-bar button that starts the presentation. Its tooltip says what the slides will be. */
export function PresentButton() {
  const store = useEditorStore();
  const frames = useEditor((state) => countFrames(state.doc!.nodes));
  const nodes = useEditor((state) => state.doc!.nodes);
  const empty = Object.keys(nodes).length === 0;
  const label = empty
    ? "Present (draw something first)"
    : frames > 0
      ? `Present ${frames} slide${frames === 1 ? "" : "s"}`
      : "Present. Without frames the whole diagram is one slide";
  return (
    <IconButton label={label} shortcut={shortcutOf("view.present")} disabled={empty} onClick={() => runCommand(store, "view.present")}>
      <Presentation className="size-4" />
    </IconButton>
  );
}
