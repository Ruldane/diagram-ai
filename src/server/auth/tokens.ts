import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** SHA-256 of a token, hex. Tokens are 192 to 256 bits of randomness, so a fast hash is the right tool. */
export const hashToken = (token: string): string => createHash("sha256").update(token).digest("hex");

/** A random secret, URL-safe: `prefix` followed by `bytes` bytes of entropy. */
export const randomToken = (prefix: string, bytes: number): string => `${prefix}${randomBytes(bytes).toString("base64url")}`;

/** Opaque cookie value for a browser session: 256 bits. */
export const newSessionToken = (): string => randomToken("", 32);
/** Personal access token. The `dai_` prefix makes it recognisable to secret scanners. */
export const newApiToken = (): string => randomToken("dai_", 32);
/** Share-link token: 192 bits, well above the 128-bit floor. */
export const newShareToken = (): string => randomToken("", 24);

export const API_TOKEN_PATTERN = /^dai_[A-Za-z0-9_-]{43}$/;

/** Constant-time string comparison. Unequal lengths return early; the length of a secret is not secret here. */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
