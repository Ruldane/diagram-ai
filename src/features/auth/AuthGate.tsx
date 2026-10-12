"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

import { useSession } from "./use-session";

/** Pages anybody may open. The editor (`/d/…`) decides for itself: a share link can be enough. */
const OPEN = ["/login", "/signup", "/s/", "/d/"];

/**
 * Sends a signed-out visitor to the sign-in page when accounts are on. Renders
 * nothing; the pages stay static shells and this runs in the browser. (The
 * `proxy.ts` redirect covers the common case before any of this loads.)
 */
export function AuthGate() {
  const { loading, authRequired, user } = useSession();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (loading || !authRequired || user) return;
    if (OPEN.some((prefix) => pathname === prefix.replace(/\/$/, "") || pathname.startsWith(prefix))) return;
    router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [loading, authRequired, user, pathname, router]);

  return null;
}
