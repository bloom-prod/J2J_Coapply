// Shared URL safety helpers.
//
// User-supplied URLs are rendered directly into `<a href>` by several
// components, and React does NOT block `javascript:` hrefs, so a stored
// `javascript:...` value becomes stored XSS. We validate on write (server-side)
// AND guard at render time (client-side) so legacy rows can never execute.

const SAFE_PROTOCOLS = ["http:", "https:"];

export function isSafeHttpUrl(value: unknown): boolean {
  const s = String(value ?? "").trim();
  if (!s) return true; // empty is allowed (field left blank / cleared)
  try {
    const url = new URL(s);
    return SAFE_PROTOCOLS.includes(url.protocol);
  } catch {
    return false; // not even a parseable URL
  }
}

// Render-side guard: returns an empty href for anything that isn't http(s),
// so a malicious value degrades to a non-link instead of executing.
export function safeHttpUrl(value: string | null | undefined): string {
  const s = String(value || "").trim();
  return isSafeHttpUrl(s) ? s : "";
}