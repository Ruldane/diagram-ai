"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";

import { errorText, safeNext, signIn } from "./api";
import { AuthField, AuthLayout } from "./AuthLayout";
import { setSignedIn, useSession } from "./use-session";

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const session = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Already signed in (another tab, or a stale bookmark): go where the person was headed.
  useEffect(() => {
    if (session.user) router.replace(next);
  }, [session.user, next, router]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const { user } = await signIn({ email, password });
      setSignedIn(user);
      router.replace(next);
    } catch (failure) {
      setError(errorText(failure));
      setPassword("");
      setBusy(false);
    }
  }

  if (!session.loading && !session.authRequired) {
    return (
      <AuthLayout
        title={
          <>
            Nothing to <em>sign in</em> to.
          </>
        }
        lead="Accounts are off on this server, so there is no login and every diagram is open to whoever can reach it. Set DIAGRAM_AI_AUTH=on with DATABASE_URL to enable accounts."
      >
        <Link href="/">
          <Button variant="primary" size="lg" className="w-full">
            Open your diagrams
          </Button>
        </Link>
      </AuthLayout>
    );
  }

  const signupHref = `/signup${next !== "/" ? `?next=${encodeURIComponent(next)}` : ""}`;
  return (
    <AuthLayout
      title={
        <>
          Welcome <em>back</em>.
        </>
      }
      lead="Sign in to open your diagrams and the ones shared with you."
      footer={
        session.signup === "closed" ? (
          <>Accounts on this server are created by an administrator.</>
        ) : (
          <>
            New here?{" "}
            <Link href={signupHref} className="font-semibold text-accent underline-offset-2 hover:underline">
              Create an account
            </Link>
          </>
        )
      }
    >
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <AuthField
          label="Email"
          type="email"
          name="email"
          autoComplete="username"
          inputMode="email"
          autoFocus
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <AuthField
          label="Password"
          name="password"
          autoComplete="current-password"
          reveal
          type="password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        {error ? (
          <p role="alert" className="rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-[13px] text-danger">
            {error}
          </p>
        ) : null}
        <Button type="submit" variant="primary" size="lg" disabled={busy || !email || !password} className="mt-1 w-full">
          {busy ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </AuthLayout>
  );
}
