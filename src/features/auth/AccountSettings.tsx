"use client";

import { ArrowLeft, Check, Copy, KeyRound, Trash2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useId, useState, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";

import { passwordProblem, type ApiTokenInfo } from "@/core/auth";
import { Button } from "@/components/ui/button";
import { Field, Select, TextInput } from "@/components/ui/fields";
import { TooltipProvider } from "@/components/ui/tooltip";
import { LogoMark } from "@/features/home/HomeHeader";
import { ThemeToggle } from "@/features/home/ThemeToggle";
import { timeAgo } from "@/lib/agents";

import { createToken, createUser, errorText, listTokens, listUsers, revokeToken, setUserDisabled, updateAccount, type AdminUser } from "./api";
import { AccountsOffNote } from "./AccountsOff";
import { Avatar } from "./Avatar";
import { useOrigin } from "./use-origin";
import { setSignedIn, useSession } from "./use-session";

function Section({ id, title, lead, children }: { id: string; title: string; lead?: string; children: ReactNode }) {
  const heading = useId();
  return (
    <section id={id} aria-labelledby={heading} className="scroll-mt-20 border-t border-line py-8 first:border-t-0 first:pt-0">
      <h2 id={heading} className="font-display text-[26px] leading-tight text-ink">
        {title}
      </h2>
      {lead ? <p className="mt-1.5 max-w-[60ch] text-[13px] leading-relaxed text-ink-3">{lead}</p> : null}
      <div className="mt-5">{children}</div>
    </section>
  );
}

function Status({ error, ok }: { error: string | null; ok?: string | null }) {
  if (error) return <p role="alert" className="text-[12.5px] text-danger">{error}</p>;
  if (ok) return <p role="status" className="text-[12.5px] text-success">{ok}</p>;
  return null;
}

function CopyBox({ label, text }: { label: string; text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="overflow-hidden rounded-xl bg-[#17150f] dark:bg-black/50">
      <div className="flex items-center justify-between border-b border-white/10 px-3 py-1.5">
        <span className="font-mono text-[10.5px] tracking-wide text-white/50 uppercase">{label}</span>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard.writeText(text).then(() => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1600);
            });
          }}
          className="flex h-6 items-center gap-1.5 rounded-md border border-white/15 bg-white/10 px-2 text-[11px] font-medium text-white/90 hover:bg-white/20"
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="overflow-x-auto p-3 font-mono text-[12px] leading-relaxed break-all whitespace-pre-wrap text-[#ece9e1]">
        <code>{text}</code>
      </pre>
    </div>
  );
}

/* ---------------------------------------------------------------- profile */

function Profile() {
  const { user } = useSession();
  const [name, setName] = useState(user?.name ?? "");
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  if (!user) return null;

  async function save(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setOk(null);
    try {
      const { user: updated } = await updateAccount({ name });
      setSignedIn(updated);
      setOk("Saved.");
    } catch (failure) {
      setError(errorText(failure));
    }
  }

  return (
    <Section id="profile" title="Profile" lead="Your name is what collaborators see on cursors, comments and the member list.">
      <form onSubmit={save} className="flex max-w-md flex-col gap-3">
        <Field label="Name">
          <TextInput value={name} maxLength={80} onChange={(event) => setName(event.target.value)} autoComplete="name" />
        </Field>
        <Field label="Email">
          <TextInput value={user.email} readOnly disabled />
        </Field>
        <div className="flex items-center gap-3">
          <Button type="submit" variant="primary" disabled={!name.trim() || name === user.name}>
            Save
          </Button>
          <Status error={error} ok={ok} />
        </div>
      </form>
    </Section>
  );
}

function Password() {
  const { user } = useSession();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  if (!user) return null;

  async function save(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setOk(null);
    const problem = passwordProblem(next, { email: user!.email, name: user!.name });
    if (problem) return setError(problem);
    try {
      await updateAccount({ currentPassword: current, newPassword: next });
      setCurrent("");
      setNext("");
      setOk("Password changed. Your other sessions were signed out.");
    } catch (failure) {
      setError(errorText(failure));
    }
  }

  return (
    <Section id="password" title="Password" lead="Changing it signs you out everywhere else. Personal access tokens keep working until you revoke them.">
      <form onSubmit={save} className="flex max-w-md flex-col gap-3">
        <Field label="Current password">
          <TextInput type="password" autoComplete="current-password" value={current} onChange={(event) => setCurrent(event.target.value)} />
        </Field>
        <Field label="New password (at least 10 characters)">
          <TextInput type="password" autoComplete="new-password" value={next} onChange={(event) => setNext(event.target.value)} />
        </Field>
        <div className="flex items-center gap-3">
          <Button type="submit" variant="primary" disabled={!current || !next}>
            Change password
          </Button>
          <Status error={error} ok={ok} />
        </div>
      </form>
    </Section>
  );
}

/* ----------------------------------------------------------------- tokens */

function Tokens() {
  const [tokens, setTokens] = useState<ApiTokenInfo[] | null>(null);
  const [name, setName] = useState("");
  const [scope, setScope] = useState<"write" | "read">("write");
  const [days, setDays] = useState("90");
  const [fresh, setFresh] = useState<ApiTokenInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const origin = useOrigin();

  const load = useCallback(() => {
    listTokens().then(setTokens, (failure) => setError(errorText(failure)));
  }, []);
  useEffect(load, [load]);

  async function create(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const created = await createToken({ name, scope, ...(days === "never" ? {} : { expiresInDays: Number(days) }) });
      setFresh(created);
      setName("");
      load();
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  }

  async function revoke(token: ApiTokenInfo) {
    try {
      await revokeToken(token.id);
      if (fresh?.id === token.id) setFresh(null);
      toast.success(`Revoked “${token.name}”.`);
      load();
    } catch (failure) {
      toast.error(errorText(failure));
    }
  }

  return (
    <Section
      id="tokens"
      title="Personal access tokens"
      lead="An agent (Claude Code, Codex, a script) signs in with a token instead of your password. It can open and change exactly the diagrams you can, and its edits are credited to it on your behalf."
    >
      {fresh?.token ? (
        <div className="mb-6 flex flex-col gap-3 rounded-xl border border-accent/40 bg-accent-soft p-4" role="status">
          <p className="text-[13px] font-semibold text-ink">
            Copy “{fresh.name}” now: it is shown once and only a hash is kept.
          </p>
          <CopyBox label="Token" text={fresh.token} />
          <CopyBox label="Claude Code" text={`claude mcp add --transport http diagram-ai ${origin}/api/mcp --header "Authorization: Bearer ${fresh.token}"`} />
          <div>
            <Button size="sm" variant="ghost" onClick={() => setFresh(null)}>
              I have copied it
            </Button>
          </div>
        </div>
      ) : null}

      <form onSubmit={create} className="grid max-w-2xl gap-3 sm:grid-cols-[minmax(0,1fr)_150px_130px_auto] sm:items-end">
        <Field label="Name">
          <TextInput value={name} placeholder="Claude Code on my laptop" maxLength={60} onChange={(event) => setName(event.target.value)} />
        </Field>
        <Field label="Access">
          <Select value={scope} onChange={(event) => setScope(event.target.value as "read" | "write")}>
            <option value="write">Read and write</option>
            <option value="read">Read only</option>
          </Select>
        </Field>
        <Field label="Expires">
          <Select value={days} onChange={(event) => setDays(event.target.value)}>
            <option value="30">In 30 days</option>
            <option value="90">In 90 days</option>
            <option value="365">In a year</option>
            <option value="never">Never</option>
          </Select>
        </Field>
        <Button type="submit" variant="primary" disabled={busy || !name.trim()}>
          <KeyRound className="size-3.5" />
          Create token
        </Button>
      </form>
      <div className="mt-2">
        <Status error={error} />
      </div>

      <ul className="mt-6 divide-y divide-line rounded-xl border border-line bg-surface">
        {tokens === null ? <li className="px-4 py-3 text-[13px] text-ink-3">Loading…</li> : null}
        {tokens?.length === 0 ? <li className="px-4 py-3 text-[13px] text-ink-3">No tokens yet.</li> : null}
        {tokens?.map((token) => (
          <li key={token.id} className="flex items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium text-ink">{token.name}</p>
              <p className="truncate font-mono text-[11.5px] text-ink-3">
                {token.prefix}… · {token.scope === "read" ? "read only" : "read and write"} · {token.lastUsedAt ? `used ${timeAgo(token.lastUsedAt)}` : "never used"}
                {token.expiresAt ? ` · expires ${new Date(token.expiresAt).toLocaleDateString()}` : ""}
              </p>
            </div>
            <Button size="sm" variant="ghost" onClick={() => void revoke(token)} aria-label={`Revoke ${token.name}`}>
              <Trash2 className="size-3.5" />
              Revoke
            </Button>
          </li>
        ))}
      </ul>
    </Section>
  );
}

/* ------------------------------------------------------------------ admin */

function People() {
  const { user } = useSession();
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    listUsers().then(setUsers, (failure) => setError(errorText(failure)));
  }, []);
  useEffect(load, [load]);

  async function add(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await createUser(form);
      setForm({ name: "", email: "", password: "" });
      toast.success("Account created. Share the password with them; they can change it after signing in.");
      load();
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section id="people" title="People" lead="Everyone with an account on this server. Disabling someone signs them out and keeps their diagrams.">
      <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
        {users?.map((person) => (
          <li key={person.id} className="flex items-center gap-3 px-4 py-3">
            <Avatar name={person.name} size={28} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium text-ink">
                {person.name}
                {person.isAdmin ? <span className="ml-2 font-mono text-[10px] tracking-wide text-ink-3 uppercase">admin</span> : null}
                {person.disabled ? <span className="ml-2 font-mono text-[10px] tracking-wide text-danger uppercase">disabled</span> : null}
              </p>
              <p className="truncate font-mono text-[11.5px] text-ink-3">
                {person.email} · {person.lastLoginAt ? `signed in ${timeAgo(person.lastLoginAt)}` : "never signed in"}
              </p>
            </div>
            {person.id !== user?.id ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void setUserDisabled(person.id, !person.disabled).then(load, (failure) => toast.error(errorText(failure)))}
              >
                {person.disabled ? "Enable" : "Disable"}
              </Button>
            ) : null}
          </li>
        ))}
      </ul>

      <form onSubmit={add} className="mt-6 grid max-w-2xl gap-3 sm:grid-cols-3">
        <Field label="Name">
          <TextInput value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
        </Field>
        <Field label="Email">
          <TextInput type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} />
        </Field>
        <Field label="Temporary password">
          <TextInput type="password" autoComplete="new-password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} />
        </Field>
        <div className="flex items-center gap-3 sm:col-span-3">
          <Button type="submit" variant="primary" disabled={busy || !form.name || !form.email || !form.password}>
            Add person
          </Button>
          <Status error={error} />
        </div>
      </form>
    </Section>
  );
}

/* ------------------------------------------------------------------- page */

export function AccountSettings() {
  return (
    <TooltipProvider>
      <AccountSettingsBody />
    </TooltipProvider>
  );
}

function AccountSettingsBody() {
  const { loading, authRequired, user, signOut } = useSession();

  let body: ReactNode;
  if (loading) body = <p className="text-[13px] text-ink-3">Loading…</p>;
  else if (!authRequired)
    body = <AccountsOffNote className="max-w-[56ch] text-[14px] leading-relaxed text-ink-2" />;
  else if (!user)
    body = (
      <p className="text-[14px] text-ink-2">
        <Link href="/login?next=/account" className="font-semibold text-accent hover:underline">
          Sign in
        </Link>{" "}
        to manage your account.
      </p>
    );
  else
    body = (
      <>
        <Profile />
        <Password />
        <Tokens />
        {user.isAdmin ? <People /> : null}
        <Section id="session" title="Session">
          <Button onClick={() => void signOut()}>Sign out</Button>
        </Section>
      </>
    );

  return (
    <div className="min-h-dvh bg-bg">
      <header className="sticky top-0 z-40 border-b border-line bg-bg">
        <div className="mx-auto flex h-14 w-full max-w-[860px] items-center gap-2 px-4 sm:px-6">
          <Link href="/" className="-ml-1 flex items-center gap-2 rounded-lg px-1 py-1 text-ink" aria-label="Diagram AI, all diagrams">
            <LogoMark className="size-6" />
            <span className="font-display text-[21px] leading-none tracking-[-0.01em]">
              Diagram <em>AI</em>
            </span>
          </Link>
          <div className="ml-auto flex items-center gap-1">
            <Link href="/">
              <Button size="sm" variant="ghost">
                <ArrowLeft className="size-3.5" />
                All diagrams
              </Button>
            </Link>
            <ThemeToggle />
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-[860px] px-4 py-10 sm:px-6">
        <div className="mb-8 flex items-center gap-4">
          {user ? <Avatar name={user.name} size={52} /> : null}
          <div className="min-w-0">
            <p className="font-mono text-[11px] tracking-[0.1em] text-ink-3 uppercase">Account</p>
            <h1 className="truncate font-display text-[40px] leading-[1.05] tracking-[-0.02em] text-ink">{user ? user.name : "Account"}</h1>
          </div>
        </div>
        {body}
      </main>
    </div>
  );
}
