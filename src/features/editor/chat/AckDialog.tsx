"use client";

import { BRIDGE_TERMS } from "@/core/chat-terms";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import type { LocalChatEngineId } from "@/core/protocol";

/**
 * The first use of a local CLI engine asks for an explicit yes. The wording
 * lives in `core/chat-terms.ts`, which the server also reads to require the
 * matching acknowledgement.
 */
export function AckDialog({ engine, onAccept, onCancel }: { engine: LocalChatEngineId | null; onAccept(): void; onCancel(): void }) {
  const terms = engine ? BRIDGE_TERMS[engine] : null;
  return (
    <Dialog
      open={terms !== null}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
      title={terms?.title ?? ""}
      description="Please read this once before the first request."
      width="max-w-md"
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="primary" onClick={onAccept}>
            {terms?.confirm}
          </Button>
        </>
      }
    >
      <ul className="flex list-disc flex-col gap-2 pl-5 text-[13px] leading-relaxed text-ink-2">
        {terms?.points.map((point) => (
          <li key={point}>{point}</li>
        ))}
      </ul>
    </Dialog>
  );
}
