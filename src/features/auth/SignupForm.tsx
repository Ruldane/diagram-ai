"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";

import { PASSWORD_MIN, passwordProblem } from "@/core/auth";
import { Button } from "@/components/ui/button";

import { errorText, safeNext, signUp } from "./api";
import { AuthField, AuthLayout } from "./AuthLayout";
import { setSignedIn, useSession } from "./use-session";

/** The invitation is the share link the person came from: `?invite=<token>` or `?next=/s/<token>`. */
function inviteFrom(params: URLSearchParams, next: string): string | undefined {
  const explicit = params.get("invite");
  if (explicit) return explicit;
  const match = /^\/s\/([A-Za-z0-9_-]+)/.exec(next);
  return match?.[1];
}

export function SignupForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const invite = inviteFrom(params, next);
  const session = useSession();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (session.user) router.replace(next);
  }, [session.user, next, router]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const problem = passwordProblem(password, { email, name });
    if (problem) return setError(problem);
    setBusy(true);
    setError(null);
    try {
      const { user } = await signUp({ name, email, password, ...(invite ? { invite } : {}) });
      setSignedIn(user);
      router.replace(next);
    } catch (failure) {
      setError(errorText(failure));
      setBusy(false);
    }
  }

  const loginHref = `/login${next !== "/" ? `?next=${encodeURIComponent(next)}` : ""}`;
  const footer = (
    <>
      Already have an account?{" "}
      <Link href={loginHref} className="font-semibold text-accent underline-offset-2 hover:underline">
        Sign in
      </Link>
    </>
  );

  if (!session.loading && !session.authRequired) {
    return (
      <AuthLayout
        title={
          <>
            No accounts <em>here</em>.
          </>
        }
        lead="Accounts are off. Set DIAGRAM_AI_AUTH=on with DATABASE_URL to enable them."
      >
        <Link href="/">
          <Button variant="primary" size="lg" className="w-full">
            Open your diagrams
          </Button>
        </Link>
      </AuthLayout>
    );
  }

  // Sign-up is not offered: closed, or by invitation and this visit carries none.
  const refused = session.signup === "closed" || (session.signup === "invite" && !invite);
  if (!session.loading && refused) {
    return (
      <AuthLayout
        title={
          <>
            By <em>invitation</em> only.
          </>
        }
        lead={
          session.signup === "closed"
            ? "New accounts on this server are created by an administrator. Ask them to add you, then sign in."
            : "Open the share link someone sent you, then create your account from there. The link is your invitation."
        }
        footer={footer}
      >
        <Link href={loginHref}>
          <Button variant="primary" size="lg" className="w-full">
            Sign in
          </Button>
        </Link>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title={
        session.signup === "first" ? (
          <>
            Set up your <em>table</em>.
          </>
        ) : (
          <>
            Pull up a <em>chair</em>.
          </>
        )
      }
      lead={
        session.signup === "first"
          ? "You are the first person here, so this account becomes the administrator."
          : invite
            ? "You were invited to a diagram. Create an account and it will be waiting for you."
            : "Create an account to keep your diagrams and share them with others."
      }
      footer={footer}
    >
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <AuthField label="Your name" name="name" autoComplete="name" autoFocus required maxLength={80} value={name} onChange={(event) => setName(event.target.value)} />
        <AuthField
          label="Email"
          type="email"
          name="email"
          autoComplete="username"
          inputMode="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <AuthField
          label="Password"
          name="new-password"
          type="password"
          autoComplete="new-password"
          reveal
          required
          hint={`At least ${PASSWORD_MIN} characters. A few unrelated words works well.`}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        {error ? (
          <p role="alert" className="rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-[13px] text-danger">
            {error}
          </p>
        ) : null}
        <Button type="submit" variant="primary" size="lg" disabled={busy || !name || !email || !password} className="mt-1 w-full">
          {busy ? "Creating account…" : "Create account"}
        </Button>
      </form>
    </AuthLayout>
  );
}
