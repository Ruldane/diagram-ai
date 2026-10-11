"use client";

import { useRouter } from "next/navigation";
import { createContext, useContext, useRef, useState, useTransition, type ReactNode } from "react";
import { toast } from "sonner";

import { TooltipProvider } from "@/components/ui/tooltip";

import { createDiagram, diagramHref, errorMessage } from "./api";

export interface PendingCreate {
  typeId: string;
  template: boolean;
}

interface CreateContextValue {
  /** The creation in flight, if any. Every "create" control is disabled meanwhile. */
  pending: PendingCreate | null;
  /** Creates a diagram of the given type and opens it. Ignored while another is pending. */
  create: (typeId: string, template: boolean) => void;
}

const CreateContext = createContext<CreateContextValue | null>(null);

export function useCreateDiagram(): CreateContextValue {
  const value = useContext(CreateContext);
  if (!value) throw new Error("useCreateDiagram must be used inside <HomeProviders>");
  return value;
}

/** Client-side context for the home page: tooltips and the shared "create diagram" action. */
export function HomeProviders({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [pending, setPending] = useState<PendingCreate | null>(null);
  const [, startNavigation] = useTransition();
  // Guards the gap between the click and the re-render that disables the controls.
  const busy = useRef(false);

  const create = (typeId: string, template: boolean) => {
    if (busy.current || pending) return;
    busy.current = true;
    setPending({ typeId, template });
    void (async () => {
      try {
        const diagram = await createDiagram({ type: typeId, template });
        // Clearing inside the transition keeps the pending state on screen until
        // the editor has replaced this page, and leaves it clean for the way back.
        startNavigation(() => {
          router.push(diagramHref(diagram.id));
          setPending(null);
        });
      } catch (error) {
        toast.error(errorMessage(error));
        setPending(null);
      } finally {
        busy.current = false;
      }
    })();
  };

  return (
    <TooltipProvider>
      <CreateContext.Provider value={{ pending, create }}>{children}</CreateContext.Provider>
    </TooltipProvider>
  );
}
