import { customAlphabet } from "nanoid";

import type { ElementKind, Id } from "./types";

const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";
const short = customAlphabet(alphabet, 8);
const long = customAlphabet(alphabet, 12);

const PREFIX: Record<ElementKind, string> = { node: "n", edge: "e", comment: "c" };

/** Ids are prefixed by kind so a bare id is enough to know what it refers to. */
export function newId(kind: ElementKind): Id {
  return `${PREFIX[kind]}_${short()}`;
}

/** Short random id with an arbitrary prefix (activity entries, snapshots…). */
export function randomId(prefix: string): Id {
  return `${prefix}_${short()}`;
}

export function newDiagramId(): Id {
  return long();
}

export function newClientId(): Id {
  return `client_${short()}`;
}

/** Turns arbitrary text into a readable id fragment (`Auth Service` → `auth-service`). */
export function slugify(text: string, maxLength = 32): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength);
}

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/;

/** Ids chosen by agents or imported files must be short and path-safe. */
export function isSafeId(id: string): boolean {
  return SAFE_ID.test(id);
}
