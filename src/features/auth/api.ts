import type { ApiTokenInfo, MemberInfo, PublicUser, RedeemResponse, ShareLinkInfo, ShareRole } from "@/core/auth";

/** An API failure with the server's own message (written for the person to read) and its HTTP status. */
export class ApiFailure extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function call<T>(path: string, init?: { method?: string; json?: unknown; signal?: AbortSignal }): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: init?.method ?? (init?.json === undefined ? "GET" : "POST"),
      cache: "no-store",
      signal: init?.signal,
      ...(init?.json === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(init.json) }),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiFailure("Could not reach the server. Is it still running?", 0);
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = body && typeof body === "object" && "error" in body ? (body as { error: unknown }).error : null;
    throw new ApiFailure(typeof message === "string" && message ? message : `Request failed (${response.status}).`, response.status);
  }
  return body as T;
}

export const errorText = (error: unknown): string => (error instanceof Error && error.message ? error.message : "Something went wrong.");

export const signIn = (input: { email: string; password: string }) => call<{ user: PublicUser }>("/api/auth/login", { json: input });
export const signUp = (input: { email: string; name: string; password: string; invite?: string }) =>
  call<{ user: PublicUser; first: boolean }>("/api/auth/register", { json: input });
export const signOut = () => call<{ ok: true }>("/api/auth/logout", { method: "POST" });

export const updateAccount = (input: { name?: string; currentPassword?: string; newPassword?: string }) =>
  call<{ user: PublicUser }>("/api/auth/account", { method: "PATCH", json: input });

export const listTokens = () => call<{ tokens: ApiTokenInfo[] }>("/api/auth/tokens").then((r) => r.tokens);
export const createToken = (input: { name: string; scope: "read" | "write"; expiresInDays?: number }) =>
  call<{ token: ApiTokenInfo }>("/api/auth/tokens", { json: input }).then((r) => r.token);
export const revokeToken = (id: string) => call<{ ok: true }>(`/api/auth/tokens/${encodeURIComponent(id)}`, { method: "DELETE" });

export interface AdminUser extends PublicUser {
  createdAt: string;
  lastLoginAt: string | null;
  disabled: boolean;
}
export const listUsers = () => call<{ users: AdminUser[] }>("/api/admin/users").then((r) => r.users);
export const createUser = (input: { email: string; name: string; password: string }) => call<{ user: PublicUser }>("/api/admin/users", { json: input });
export const setUserDisabled = (id: string, disabled: boolean) =>
  call<{ ok: true }>(`/api/admin/users/${encodeURIComponent(id)}`, { method: "PATCH", json: { disabled } });

const diagram = (id: string) => `/api/diagrams/${encodeURIComponent(id)}`;

export const listMembers = (id: string) => call<{ members: MemberInfo[]; role: string }>(`${diagram(id)}/members`);
export const addMember = (id: string, input: { email: string; role: ShareRole }) => call<{ member: MemberInfo }>(`${diagram(id)}/members`, { json: input });
export const setMemberRole = (id: string, userId: string, role: ShareRole) =>
  call<{ ok: true }>(`${diagram(id)}/members/${encodeURIComponent(userId)}`, { method: "PATCH", json: { role } });
export const removeMember = (id: string, userId: string) => call<{ ok: true }>(`${diagram(id)}/members/${encodeURIComponent(userId)}`, { method: "DELETE" });

export const listLinks = (id: string) => call<{ links: ShareLinkInfo[] }>(`${diagram(id)}/share`).then((r) => r.links);
export const createLink = (id: string, input: { role: ShareRole; expiresInDays?: number }) =>
  call<{ link: ShareLinkInfo }>(`${diagram(id)}/share`, { json: input }).then((r) => r.link);
export const revokeLink = (id: string, linkId: string) => call<{ ok: true }>(`${diagram(id)}/share/${encodeURIComponent(linkId)}`, { method: "DELETE" });

export const redeemLink = (token: string) => call<RedeemResponse>("/api/share/redeem", { json: { token } });

/** `next` is a path inside this app; anything else (an absolute URL, `//host`) falls back to the home page. */
export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return "/";
  return next;
}
