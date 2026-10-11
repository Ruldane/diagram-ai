/**
 * Structural equality for document elements.
 *
 * An `undefined` property counts as absent: the same element is `{ …, parent:
 * undefined }` in the browser and has no `parent` key once it has travelled
 * through JSON (storage, the review baseline), and that must not read as a change.
 */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, index) => sameValue(item, b[index]));
  }

  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  for (const key of Object.keys(left)) {
    if (left[key] !== undefined && !sameValue(left[key], right[key])) return false;
  }
  for (const key of Object.keys(right)) {
    if (right[key] !== undefined && left[key] === undefined) return false;
  }
  return true;
}
