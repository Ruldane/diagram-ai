"use client";

import { Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useSession } from "@/features/auth/use-session";

import { useEditor, useEditorStore } from "../store/context";

/** Opens the share dialog. Only offered when accounts are on: in solo mode there is nobody to share with. */
export function ShareButton() {
  const store = useEditorStore();
  const { authRequired } = useSession();
  const role = useEditor((state) => state.role);
  // A viewer has nothing to manage and cannot see who else is on the diagram.
  if (!authRequired || role === "viewer") return null;
  return (
    <Button size="sm" className="ml-1 h-8 rounded-lg px-3" onClick={() => store.setState({ dialog: "share" })}>
      <Users className="size-3.5" />
      Share
    </Button>
  );
}
