"use client";

import { useEffect, useLayoutEffect, useMemo } from "react";

import type { DialogId } from "../store/editor-store";
import { useEditor, useEditorStore } from "../store/context";
import { PacksDialog } from "../packs/PacksDialog";
import { ShareDialog } from "../share/ShareDialog";
import { AgentDialog } from "./AgentDialog";
import { CommandPalette } from "./CommandPalette";
import { ExportDialog } from "./ExportDialog";
import { HistoryDialog } from "./HistoryDialog";
import { ShortcutsDialog } from "./ShortcutsDialog";

/**
 * Gives focus back to whatever had it before a dialog opened. Radix only does
 * this for dialogs opened by a `Dialog.Trigger`; these are opened from the
 * store. Limited to keyboard dismissals, where losing the place matters.
 */
function useRestoreFocus(open: boolean) {
  // A layout effect runs before Radix moves focus into the dialog.
  useLayoutEffect(() => {
    if (!open) return;
    const opener = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
    let keyboard = false;
    const onKeyDown = () => (keyboard = true);
    const onPointerDown = () => (keyboard = false);
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("pointerdown", onPointerDown, true);
      if (!opener || !keyboard) return;
      // Deferred, and skipped when something else (text editing, another dialog) has claimed focus.
      window.setTimeout(() => {
        if (opener.isConnected && document.activeElement === document.body) opener.focus({ preventScroll: true });
      }, 0);
    };
  }, [open]);
}

/**
 * The editor's dialogs. Mounted once by the editor shell; shows whichever
 * dialog `state.dialog` names. Each dialog mounts when it opens, so it always
 * starts from fresh state.
 */
export function Dialogs() {
  const store = useEditorStore();
  const dialog = useEditor((state) => state.dialog);
  const ready = useEditor((state) => state.doc !== null);

  /** Closes one specific dialog, so a slow action finishing late cannot close a different one. */
  const close = useMemo(() => {
    const closer = (id: DialogId) => () => {
      if (store.getState().dialog === id) store.setState({ dialog: null });
    };
    return { export: closer("export"), shortcuts: closer("shortcuts"), agent: closer("agent"), history: closer("history"), command: closer("command"), packs: closer("packs"), share: closer("share") };
  }, [store]);

  // Dialogs are transient: when the route is hidden (kept alive by <Activity>) it must not come back with one open.
  useLayoutEffect(() => () => store.setState({ dialog: null }), [store]);

  // Nothing renders for "import" (it lives on the home page) or for a dialog that needs a document
  // before one is loaded. Clear those, because an open dialog suspends the canvas shortcuts.
  const orphan = dialog === "import" || (!ready && (dialog === "export" || dialog === "command"));
  useEffect(() => {
    if (orphan) store.setState({ dialog: null });
  }, [orphan, store]);

  useRestoreFocus(dialog !== null && !orphan);

  switch (dialog) {
    case "export":
      return ready ? <ExportDialog onClose={close.export} /> : null;
    case "command":
      return ready ? <CommandPalette onClose={close.command} /> : null;
    case "history":
      return <HistoryDialog onClose={close.history} />;
    case "agent":
      return <AgentDialog onClose={close.agent} />;
    case "shortcuts":
      return <ShortcutsDialog onClose={close.shortcuts} />;
    case "packs":
      return <PacksDialog onClose={close.packs} />;
    case "share":
      return ready ? <ShareDialog onClose={close.share} /> : null;
    default:
      return null;
  }
}
