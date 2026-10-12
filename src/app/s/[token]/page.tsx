import type { Metadata } from "next";
import { Suspense } from "react";

import { OpenSharedDiagram } from "@/features/auth/OpenSharedDiagram";

export const metadata: Metadata = { title: "Shared diagram" };

/**
 * A share link. The token is resolved inside the Suspense boundary and
 * redeemed in the browser, which then opens the diagram.
 */
// Typed by hand: `PageProps<"/s/[token]">` only exists once Next has generated route types for this page.
export default function SharedPage({ params }: { params: Promise<{ token: string }> }) {
  return (
    <Suspense>
      {params.then(({ token }) => (
        <OpenSharedDiagram token={token} />
      ))}
    </Suspense>
  );
}
