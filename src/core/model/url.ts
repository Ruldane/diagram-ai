/** Schemes a diagram link may use. Anything else (javascript:, data:, vbscript:…) is rejected. */
const SAFE_SCHEME = /^(https?|mailto):/i;

/** Returns the trimmed URL when it is safe to put in an href, otherwise undefined. */
export function safeLink(value: string | undefined): string | undefined {
  const url = value?.trim();
  if (!url) return undefined;
  // Browsers ignore control characters and spaces inside a scheme ("java<TAB>script:"), so drop them before checking.
  const compact = [...url].filter((char) => char.charCodeAt(0) > 32).join("");
  if (SAFE_SCHEME.test(compact)) return url;
  // Relative links and in-page anchors carry no scheme.
  if (!/^[a-z][a-z0-9+.-]*:/i.test(compact)) return url;
  return undefined;
}
