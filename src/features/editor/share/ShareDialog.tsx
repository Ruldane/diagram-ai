"use client";

import { Check, Copy, Link2, Trash2, UserPlus } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { ROLE_LABEL, type MemberInfo, type ShareLinkInfo, type ShareRole } from "@/core/auth";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Select, TextInput } from "@/components/ui/fields";
import { addMember, createLink, errorText, listLinks, listMembers, removeMember, revokeLink, setMemberRole } from "@/features/auth/api";
import { AccountsOffNote } from "@/features/auth/AccountsOff";
import { Avatar } from "@/features/auth/Avatar";
import { useOrigin } from "@/features/auth/use-origin";
import { useSession } from "@/features/auth/use-session";

import { useEditor } from "../store/context";

const ROLE_OPTIONS = (
  <>
    <option value="editor">Can edit</option>
    <option value="viewer">Can view</option>
  </>
);

function expiresText(link: ShareLinkInfo): string {
  return link.expiresAt ? `expires ${new Date(link.expiresAt).toLocaleDateString()}` : "never expires";
}

function CopyButton({ text, label = "Copy link" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      size="sm"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1600);
        });
      }}
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      {copied ? "Copied" : label}
    </Button>
  );
}

/** People with access: owner first, then by role. Owners edit roles and remove people; others only look. */
function People({ diagramId, owner, selfId }: { diagramId: string; owner: boolean; selfId: string | undefined }) {
  const [members, setMembers] = useState<MemberInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<ShareRole>("editor");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    listMembers(diagramId).then(
      (response) => setMembers(response.members),
      (failure) => setError(errorText(failure)),
    );
  }, [diagramId]);
  useEffect(load, [load]);

  async function invite(event: FormEvent) {
    event.preventDefault();
    if (busy || !email.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const { member } = await addMember(diagramId, { email, role });
      toast.success(`${member.name} can now ${role === "editor" ? "edit" : "view"} this diagram.`);
      setEmail("");
      load();
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  }

  const change = (member: MemberInfo, next: ShareRole) =>
    void setMemberRole(diagramId, member.userId, next).then(load, (failure) => toast.error(errorText(failure)));
  const remove = (member: MemberInfo) =>
    void removeMember(diagramId, member.userId).then(
      () => {
        toast.success(`${member.name} no longer has access.`);
        load();
      },
      (failure) => toast.error(errorText(failure)),
    );

  return (
    <section aria-labelledby="share-people" className="flex flex-col gap-3">
      <h3 id="share-people" className="text-[11px] font-semibold tracking-wide text-ink-3 uppercase">
        People with access
      </h3>
      {owner ? (
        <form onSubmit={invite} className="flex gap-2">
          <div className="min-w-0 flex-1">
            <TextInput
              type="email"
              aria-label="Email address of an existing account"
              placeholder="Add by email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="off"
            />
          </div>
          <div className="w-[116px] shrink-0">
            <Select aria-label="Role" value={role} onChange={(event) => setRole(event.target.value as ShareRole)}>
              {ROLE_OPTIONS}
            </Select>
          </div>
          <Button type="submit" variant="primary" disabled={busy || !email.trim()}>
            <UserPlus className="size-3.5" />
            Add
          </Button>
        </form>
      ) : null}
      {error ? (
        <p role="alert" className="text-[12.5px] text-danger">
          {error}
        </p>
      ) : null}
      <ul className="divide-y divide-line rounded-xl border border-line bg-raised">
        {members === null && !error ? <li className="px-3 py-2.5 text-[13px] text-ink-3">Loading…</li> : null}
        {members?.map((member) => (
          <li key={member.userId} className="flex items-center gap-3 px-3 py-2">
            <Avatar name={member.name} size={28} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium text-ink">
                {member.name}
                {member.userId === selfId ? <span className="ml-1.5 text-ink-3">(you)</span> : null}
              </p>
              {member.email ? <p className="truncate font-mono text-[11.5px] text-ink-3">{member.email}</p> : null}
            </div>
            {member.role === "owner" ? (
              <span className="px-2 text-[12px] text-ink-3">Owner</span>
            ) : owner ? (
              <>
                <div className="w-[116px] shrink-0">
                  <Select aria-label={`Role of ${member.name}`} value={member.role} onChange={(event) => change(member, event.target.value as ShareRole)}>
                    {ROLE_OPTIONS}
                  </Select>
                </div>
                <Button size="sm" variant="ghost" aria-label={`Remove ${member.name}`} onClick={() => remove(member)}>
                  <Trash2 className="size-3.5" />
                </Button>
              </>
            ) : (
              <span className="px-2 text-[12px] text-ink-3">{ROLE_LABEL[member.role]}</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Links({ diagramId }: { diagramId: string }) {
  const [links, setLinks] = useState<ShareLinkInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [role, setRole] = useState<ShareRole>("viewer");
  const [days, setDays] = useState("never");
  const [busy, setBusy] = useState(false);
  /** Tokens of links created in this dialog: they are shown once and never stored in clear on the server. */
  const [fresh, setFresh] = useState<Record<string, string>>({});
  const origin = useOrigin();

  const load = useCallback(() => {
    listLinks(diagramId).then(setLinks, (failure) => setError(errorText(failure)));
  }, [diagramId]);
  useEffect(load, [load]);

  async function create() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const link = await createLink(diagramId, { role, ...(days === "never" ? {} : { expiresInDays: Number(days) }) });
      if (link.token) setFresh((previous) => ({ ...previous, [link.id]: link.token as string }));
      load();
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  }

  async function revoke(link: ShareLinkInfo) {
    try {
      await revokeLink(diagramId, link.id);
      toast.success("Link revoked. It no longer opens the diagram.");
      load();
    } catch (failure) {
      toast.error(errorText(failure));
    }
  }

  return (
    <section aria-labelledby="share-links" className="flex flex-col gap-3">
      <h3 id="share-links" className="text-[11px] font-semibold tracking-wide text-ink-3 uppercase">
        Links
      </h3>
      <p className="text-[12.5px] leading-relaxed text-ink-3">
        Anyone with a link opens the diagram. A viewing link works without an account; an editing link asks people to sign in first, so they can be told apart.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <div className="w-[170px]">
          <Select aria-label="What the link allows" value={role} onChange={(event) => setRole(event.target.value as ShareRole)}>
            <option value="viewer">Can view</option>
            <option value="editor">Can edit (signed in)</option>
          </Select>
        </div>
        <div className="w-[150px]">
          <Select aria-label="When the link stops working" value={days} onChange={(event) => setDays(event.target.value)}>
            <option value="never">Never expires</option>
            <option value="1">Expires in a day</option>
            <option value="7">Expires in a week</option>
            <option value="30">Expires in 30 days</option>
          </Select>
        </div>
        <Button variant="primary" onClick={() => void create()} disabled={busy}>
          <Link2 className="size-3.5" />
          Create link
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-[12.5px] text-danger">
          {error}
        </p>
      ) : null}
      <ul className="divide-y divide-line rounded-xl border border-line bg-raised">
        {links?.length === 0 ? <li className="px-3 py-2.5 text-[13px] text-ink-3">No links yet.</li> : null}
        {links?.map((link) => {
          const token = fresh[link.id];
          return (
            <li key={link.id} className="flex flex-col gap-2 px-3 py-2.5">
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium text-ink">{link.role === "editor" ? "Can edit (signed in)" : "Can view"}</p>
                  <p className="truncate font-mono text-[11.5px] text-ink-3">
                    …{link.hint} · {expiresText(link)}
                  </p>
                </div>
                {token ? <CopyButton text={`${origin}/s/${token}`} /> : null}
                <Button size="sm" variant="ghost" aria-label={`Revoke the link ending ${link.hint}`} onClick={() => void revoke(link)}>
                  <Trash2 className="size-3.5" />
                  Revoke
                </Button>
              </div>
              {token ? (
                <p className="rounded-md bg-sunken px-2 py-1.5 font-mono text-[11.5px] break-all text-ink-2" role="status">
                  {origin}/s/{token}
                  <span className="mt-1 block font-sans text-[11.5px] text-ink-3">Copy it now: for safety the full link is not kept, only a hash of it.</span>
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * Who can open this diagram: people by account, and links. Owners manage
 * both; everyone else sees who is on it. Not available in solo mode, where
 * there are no accounts to share with.
 */
export function ShareDialog({ onClose }: { onClose: () => void }) {
  const diagramId = useEditor((state) => state.diagramId);
  const name = useEditor((state) => state.doc?.name ?? "diagram");
  const role = useEditor((state) => state.role);
  const session = useSession();
  const owner = role === "owner";

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={`Share “${name}”`}
      description={owner ? "Choose who can open it and what they can do." : `You ${role === "editor" ? "can edit" : "can view"} this diagram.`}
      width="max-w-xl"
    >
      {!session.loading && !session.authRequired ? (
        <AccountsOffNote className="text-[13px] leading-relaxed text-ink-2" />
      ) : (
        <div className="flex flex-col gap-6">
          <People diagramId={diagramId} owner={owner} selfId={session.user?.id} />
          {owner ? <Links diagramId={diagramId} /> : null}
        </div>
      )}
    </Dialog>
  );
}
