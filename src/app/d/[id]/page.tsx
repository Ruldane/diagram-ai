import type { Metadata } from "next";
import { Suspense } from "react";

import { Editor, EditorSkeleton } from "@/features/editor/Editor";

export const metadata: Metadata = { title: "Diagram" };

/**
 * The editor route. The page itself is a static shell: the diagram id is
 * resolved inside the Suspense boundary and the document is loaded (and kept
 * live) by the client, so this route prerenders and navigations are instant.
 */
export default function DiagramPage({ params }: PageProps<"/d/[id]">) {
  return (
    <Suspense fallback={<EditorSkeleton />}>
      {params.then(({ id }) => (
        <Editor key={id} diagramId={id} />
      ))}
    </Suspense>
  );
}
