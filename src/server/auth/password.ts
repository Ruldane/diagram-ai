import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

/**
 * Password hashing with scrypt from `node:crypto`: a per-password random salt,
 * the cost parameters stored beside the hash (so they can be raised later and
 * old hashes still verify), and a constant-time comparison.
 *
 * Stored form: `scrypt$<logN>$<r>$<p>$<salt>$<hash>` (base64url).
 */
export interface ScryptCost {
  /** log2 of the CPU/memory cost N. */
  logN: number;
  r: number;
  p: number;
}

/** N = 2^16 uses 64 MiB per hash and takes roughly 150 ms; the OWASP-recommended minimum shape. */
export const DEFAULT_COST: ScryptCost = { logN: 16, r: 8, p: 1 };

const KEY_LENGTH = 64;
const SALT_LENGTH = 16;
const PREFIX = "scrypt";

function derive(password: string, salt: Buffer, cost: ScryptCost): Promise<Buffer> {
  const N = 2 ** cost.logN;
  const options: ScryptOptions = { N, r: cost.r, p: cost.p, maxmem: 256 * N * cost.r + 1024 * 1024 };
  // NFKC so that the same characters typed on different systems give the same key.
  return new Promise((resolve, reject) => {
    scrypt(password.normalize("NFKC"), salt, KEY_LENGTH, options, (error, key) => (error ? reject(error) : resolve(key)));
  });
}

export async function hashPassword(password: string, cost: ScryptCost = DEFAULT_COST): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const key = await derive(password, salt, cost);
  return [PREFIX, cost.logN, cost.r, cost.p, salt.toString("base64url"), key.toString("base64url")].join("$");
}

interface Parsed {
  cost: ScryptCost;
  salt: Buffer;
  key: Buffer;
}

function parse(stored: string): Parsed | null {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== PREFIX) return null;
  const [logN, r, p] = parts.slice(1, 4).map(Number);
  if (![logN, r, p].every((value) => Number.isInteger(value) && value > 0) || logN > 22 || r > 32 || p > 16) return null;
  const salt = Buffer.from(parts[4], "base64url");
  const key = Buffer.from(parts[5], "base64url");
  if (salt.length < 8 || key.length !== KEY_LENGTH) return null;
  return { cost: { logN, r, p }, salt, key };
}

export interface PasswordCheck {
  ok: boolean;
  /** The hash is valid but uses weaker parameters than the current default; store a new one. */
  needsRehash: boolean;
}

export async function verifyPassword(password: string, stored: string, current: ScryptCost = DEFAULT_COST): Promise<PasswordCheck> {
  const parsed = parse(stored);
  if (!parsed) return { ok: false, needsRehash: false };
  const key = await derive(password, parsed.salt, parsed.cost);
  const ok = key.length === parsed.key.length && timingSafeEqual(key, parsed.key);
  const weaker = parsed.cost.logN < current.logN || parsed.cost.r < current.r || parsed.cost.p < current.p;
  return { ok, needsRehash: ok && weaker };
}

/**
 * A hash nobody knows the password of. Checked when the email is unknown, so
 * "no such account" costs the same time as "wrong password" and the response
 * time does not reveal which accounts exist.
 */
let dummy: Promise<string> | null = null;
export function dummyHash(cost: ScryptCost = DEFAULT_COST): Promise<string> {
  dummy ??= hashPassword(randomBytes(24).toString("base64url"), cost);
  return dummy;
}
