/**
 * Accounts and sharing: the vocabulary shared by the server, the browser and
 * tests. Pure TypeScript; nothing here talks to a database or a request.
 */

/** What a person may do with one diagram. Higher includes everything below it. */
export const ROLES = ["viewer", "editor", "owner"] as const;
export type Role = (typeof ROLES)[number];

/** Roles a share link or an invitation can grant. Ownership is never handed out by a link. */
export const SHARE_ROLES = ["viewer", "editor"] as const;
export type ShareRole = (typeof SHARE_ROLES)[number];

const RANK: Record<Role, number> = { viewer: 1, editor: 2, owner: 3 };

export const isRole = (value: unknown): value is Role => typeof value === "string" && value in RANK;

/** `true` when `role` is `needed` or stronger. */
export const atLeast = (role: Role | null | undefined, needed: Role): boolean => Boolean(role) && RANK[role as Role] >= RANK[needed];

/** The stronger of two roles; `null` means no access. */
export function maxRole(a: Role | null | undefined, b: Role | null | undefined): Role | null {
  if (!a) return b ?? null;
  if (!b) return a;
  return RANK[a] >= RANK[b] ? a : b;
}

/** The weaker of two roles; `null` (no access) wins. */
export function minRole(a: Role | null | undefined, b: Role): Role | null {
  if (!a) return null;
  return RANK[a] <= RANK[b] ? a : b;
}

export const ROLE_LABEL: Record<Role, string> = { viewer: "Can view", editor: "Can edit", owner: "Owner" };

/** How a deployment accepts new accounts (`DIAGRAM_AI_SIGNUP`). */
export type SignupMode = "open" | "invite" | "closed";

/** Signed-in person as the browser sees them. Never carries a hash. */
export interface PublicUser {
  id: string;
  name: string;
  email: string;
  isAdmin: boolean;
}

/** `GET /api/auth/session`: everything the shell needs to decide between the app and the sign-in page. */
export interface SessionInfo {
  /** Accounts are on. `false` is solo mode: nobody signs in. */
  authRequired: boolean;
  user: PublicUser | null;
  /** The sign-up form should be offered (the first account, or open sign-up). */
  signup: "open" | "first" | "invite" | "closed";
}

/** The caller's relationship to one diagram, as listed on the home page. */
export interface DiagramAccess {
  role: Role;
  /** Name of the owner, when it is somebody else. */
  ownerName?: string;
  /** Anyone besides the owner can open it. */
  shared: boolean;
}

export interface MemberInfo {
  userId: string;
  name: string;
  email: string;
  role: Role;
}

export interface ShareLinkInfo {
  id: string;
  role: ShareRole;
  createdAt: string;
  expiresAt: string | null;
  /** The tail of the token, enough to tell links apart in a list. */
  hint: string;
  /** Only present in the response that created the link: the token is not stored in clear. */
  token?: string;
}

export interface ApiTokenInfo {
  id: string;
  name: string;
  /** Start of the token, to recognise it. */
  prefix: string;
  scope: "read" | "write";
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  /** Only present in the response that created the token. */
  token?: string;
}

/** What the editor needs to know about the caller on one diagram. */
export interface DiagramViewer {
  role: Role;
  user: PublicUser | null;
}

/** `POST /api/share/redeem`. */
export interface RedeemResponse {
  diagramId: string;
  /** What this visitor can do now. */
  role: Role;
  /** What the link itself grants; `editor` with a `viewer` role means "sign in to edit". */
  linkRole: ShareRole;
  name: string;
}

/* ----------------------------------------------------------- input rules */

export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 200;
export const NAME_MAX = 80;

const EMAIL = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/;

/** Lower-cased and trimmed, which is how addresses are stored and compared. */
export const normalizeEmail = (email: string): string => email.trim().toLowerCase();

export const isValidEmail = (email: string): boolean => email.length <= 254 && EMAIL.test(email);

/** Passwords that would be guessed first. Not a full breach list, only the embarrassing end of one. */
const COMMON = new Set([
  "password",
  "password1",
  "password12",
  "password123",
  "1234567890",
  "12345678910",
  "123456789012",
  "qwertyuiop",
  "qwerty12345",
  "qwertyuiop1",
  "iloveyou123",
  "letmein1234",
  "welcome1234",
  "changeme123",
  "admin12345",
  "administrator",
  "diagramai",
  "diagram-ai",
  "diagram_ai",
  "abcdefghij",
  "0123456789",
]);

/** A message for the person when the password is not acceptable, or `null`. Length, not composition rules. */
export function passwordProblem(password: string, context: { email?: string; name?: string } = {}): string | null {
  if (password.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters.`;
  if (password.length > PASSWORD_MAX) return `Use at most ${PASSWORD_MAX} characters.`;
  const folded = password.toLowerCase();
  if (COMMON.has(folded) || /^(.)\1+$/.test(password)) return "That password is too easy to guess.";
  const email = context.email ? normalizeEmail(context.email) : "";
  if (email && (folded === email || folded === email.split("@")[0])) return "The password must not be your email address.";
  if (context.name && folded === context.name.trim().toLowerCase()) return "The password must not be your name.";
  return null;
}

/** Initials for avatars: "Ada Lovelace" → "AL". */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts[parts.length - 1][0] ?? "") : "")).toUpperCase() || "?";
}
