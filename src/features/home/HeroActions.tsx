"use client";

import { Plus, Upload } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";

import { ImportDialog } from "./ImportDialog";
import { jumpTo, SECTION, TYPE_SEARCH_ID } from "./sections";
import { useReturnFocus } from "./use-return-focus";

/** The two primary actions: jump to the type picker, or open the import dialog. */
export function HeroActions() {
  const [importing, setImporting] = useState(false);
  const importButton = useRef<HTMLButtonElement>(null);
  useReturnFocus(importing, () => importButton.current);

  // A dialog is transient: do not come back to it open after navigating away.
  useLayoutEffect(() => () => setImporting(false), []);

  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <Button variant="primary" size="lg" onClick={() => jumpTo(SECTION.create, TYPE_SEARCH_ID)}>
        <Plus aria-hidden className="size-4" />
        New diagram
      </Button>
      <Button ref={importButton} size="lg" onClick={() => setImporting(true)}>
        <Upload aria-hidden className="size-4" />
        Import
      </Button>
      {importing ? <ImportDialog onClose={() => setImporting(false)} /> : null}
    </div>
  );
}
