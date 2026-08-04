export const USER_COLORS = ["#E07BA0", "#7BB87B", "#78AEDE", "#DDB060", "#A87BD4", "#5FC5C5", "#E8895A"];
export const NAME_COLOR_OVERRIDES: Record<string, string> = { Shruti: "#FF69B4" };

/** Deterministic hash of a uid into the palette — stable regardless of snapshot order. */
function hashColor(uid: string): string {
  let h = 0;
  for (let i = 0; i < uid.length; i++) h = (h * 31 + uid.charCodeAt(i)) | 0;
  return USER_COLORS[Math.abs(h) % USER_COLORS.length];
}

/** Pick a color for a brand-new profile, preferring one no existing user shows.
 *  `takenColors` should be each existing user's *resolved* color (via
 *  resolveUserColor), so hash-derived colors of legacy profiles count as taken. */
export function pickColorForNewUser(uid: string, takenColors: string[]): string {
  const used = new Set(takenColors);
  const free = USER_COLORS.find((c) => !used.has(c));
  return free || hashColor(uid);
}

/** Resolve a user's display color: stored color wins, name override wins over that,
 *  and a uid-hash fallback covers profiles written before colors were persisted. */
export function resolveUserColor(uid: string, name: string, storedColor?: string): string {
  return NAME_COLOR_OVERRIDES[name] || storedColor || hashColor(uid);
}
