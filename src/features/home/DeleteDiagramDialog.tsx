"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import type { DiagramSummary } from "@/core/model/types";

import { deleteDiagram, errorMessage } from "./api";

export interface DeleteDiagramDialogProps {
  diagram: DiagramSummary;
  onClose: () => void;
  /** Called once the server confirmed the deletion. */
  onDeleted: (id: string) => void;
}

/** Destructive confirmation. Mount it to open it. */
export function DeleteDiagramDialog({ diagram, onClose, onDeleted }: DeleteDiagramDialogProps) {
  const [deleting, setDeleting] = useState(false);
  const name = diagram.name || "Untitled";

  async function confirm() {
    if (deleting) return;
    setDeleting(true);
    try {
      await deleteDiagram(diagram.id);
      onDeleted(diagram.id);
      toast.success(`Deleted “${name}”.`);
      onClose();
    } catch (error) {
      toast.error(errorMessage(error));
      setDeleting(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(next) => !next && !deleting && onClose()}
      title="Delete this diagram?"
      width="max-w-md"
      footer={
        <>
          <Button variant="ghost" disabled={deleting} onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" disabled={deleting} aria-busy={deleting} onClick={() => void confirm()}>
            {deleting ? "Deleting…" : "Delete diagram"}
          </Button>
        </>
      }
    >
      <p className="text-[13px] leading-relaxed text-ink-2">
        <strong className="font-semibold break-words text-ink">“{name}”</strong> will be removed for you and for every connected agent, along with its comments. This cannot be undone.
      </p>
    </Dialog>
  );
}
