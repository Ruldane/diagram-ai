"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import type { RedeemResponse } from "@/core/auth";
import { Button } from "@/components/ui/button";
import { LogoMark } from "@/features/home/HomeHeader";

import { errorText, redeemLink } from "./api";
import { useSession } from "./use-session";

function Frame({ title, children, body }: { title: React.ReactNode; body?: string; children?: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-bg px-6 text-center">
      <LogoMark className="size-8 text-ink-2" />
      <h1 className="font-display text-[32px] leading-tight text-ink">{title}</h1>
      {body ? <p className="max-w-sm text-[14px] text-ink-3">{body}</p> : null}
      {children}
    </div>
  );
}

/**
 * `/s/<token>`: exchanges the link for access, then opens the diagram. Signed
 * in, the person becomes a member (and finds it under "Shared with me");
 * signed out, they read it through a cookie that lives only as long as the
 * link does.
 */
export function OpenSharedDiagram({ token }: { token: string }) {
  const router = useRouter();
  const session = useSession();
  const started = useRef(false);
  const [result, setResult] = useState<RedeemResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (session.loading || started.current) return;
    started.current = true;
    if (!session.authRequired) return; // solo mode: nothing to redeem, see below
    redeemLink(token)
      .then((redeemed) => {
        // An editing link opened without an account is read-only: say so instead of silently downgrading.
        if (redeemed.linkRole === "editor" && redeemed.role === "viewer" && session.authRequired && !session.user) setResult(redeemed);
        else router.replace(`/d/${encodeURIComponent(redeemed.diagramId)}`);
      })
      .catch((failure: unknown) => setError(errorText(failure)));
  }, [session.loading, session.authRequired, session.user, token, router]);

  if (!session.loading && !session.authRequired) {
    return (
      <Frame title="Share links are not used here" body="Accounts are off on this server, so every diagram is open to whoever can reach it. Set DIAGRAM_AI_AUTH=on with DATABASE_URL to enable accounts.">
        <Link href="/">
          <Button variant="primary" size="lg">
            Go to your diagrams
          </Button>
        </Link>
      </Frame>
    );
  }

  if (error) {
    return (
      <Frame title="This link doesn’t open" body={error}>
        <Link href="/">
          <Button variant="primary" size="lg">
            Go to your diagrams
          </Button>
        </Link>
      </Frame>
    );
  }

  if (result) {
    const next = `/s/${token}`;
    return (
      <Frame title={<>“{result.name}” is open for <em>editing</em></>} body="Sign in to edit it with the others. Without an account you can look, but not change anything.">
        <div className="flex flex-wrap justify-center gap-2">
          <Link href={`/login?next=${encodeURIComponent(next)}`}>
            <Button variant="primary" size="lg">
              Sign in to edit
            </Button>
          </Link>
          <Link href={`/signup?next=${encodeURIComponent(next)}`}>
            <Button size="lg">Create an account</Button>
          </Link>
          <Button size="lg" variant="ghost" onClick={() => router.replace(`/d/${encodeURIComponent(result.diagramId)}`)}>
            Just view it
          </Button>
        </div>
      </Frame>
    );
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-bg" role="status" aria-label="Opening shared diagram">
      <div className="flex flex-col items-center gap-3 text-ink-3">
        <LogoMark className="size-7 animate-pulse text-ink-2" />
        <p className="font-mono text-[11px] tracking-wide uppercase">Opening shared diagram</p>
      </div>
    </div>
  );
}
