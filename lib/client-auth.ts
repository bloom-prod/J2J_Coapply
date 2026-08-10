"use client";

// JWT-based client auth (replaces Firebase Auth). The token lives in memory +
// localStorage; every server call attaches `Authorization: Bearer <jwt>`.

export interface ClientUser {
  id: string;
  name: string;
  email: string;
  isAdmin: boolean;
}

const TOKEN_KEY = "bloom.jwt";
const USER_KEY = "bloom.user";
const COMMUNITY_KEY = "bloom.communityId";

let token: string | null = null;
let user: ClientUser | null = null;
let activeCommunityId: string | null = null;
const listeners = new Set<(u: ClientUser | null) => void>();

if (typeof window !== "undefined") {
  token = localStorage.getItem(TOKEN_KEY);
  activeCommunityId = localStorage.getItem(COMMUNITY_KEY);
  try {
    const raw = localStorage.getItem(USER_KEY);
    user = raw ? (JSON.parse(raw) as ClientUser) : null;
  } catch {
    user = null;
  }
}

function emit() {
  for (const l of listeners) l(user);
}

export function getToken(): string | null {
  return token;
}

export function getCurrentUser(): ClientUser | null {
  return user;
}

export function onAuthChange(cb: (u: ClientUser | null) => void): () => void {
  listeners.add(cb);
  // Fire immediately with the current state (mirrors Firebase's
  // onAuthStateChanged) so `authReady` flips true on page load with a stored
  // session instead of waiting for a future sign-in/out event.
  cb(user);
  return () => {
    listeners.delete(cb);
  };
}

interface AuthResponse {
  ok: boolean;
  token?: string;
  user?: ClientUser;
  error?: string;
}

async function authRequest(path: string, body: Record<string, string>): Promise<ClientUser> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const d = (await res.json().catch(() => ({}))) as AuthResponse;
  if (!res.ok || !d.ok || !d.token || !d.user) {
    throw new Error(d.error || "Authentication failed.");
  }
  token = d.token;
  user = d.user;
  if (typeof window !== "undefined") {
    localStorage.setItem(TOKEN_KEY, d.token);
    localStorage.setItem(USER_KEY, JSON.stringify(d.user));
  }
  emit();
  return d.user;
}

export async function signIn(email: string, password: string): Promise<ClientUser> {
  return authRequest("/api/auth/login", { email, password });
}

/**
 * Sign up. Returns `"pending"` when the account requires admin approval
 * (no token issued yet); otherwise returns the signed-in user.
 */
export async function signUp(name: string, email: string, password: string): Promise<ClientUser | "pending"> {
  const res = await fetch("/api/auth/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, email, password }),
  });
  const d = (await res.json().catch(() => ({}))) as AuthResponse & { pendingApproval?: boolean };
  if (d.pendingApproval) return "pending";
  if (!res.ok || !d.ok || !d.token || !d.user) {
    throw new Error(d.error || "Signup failed.");
  }
  token = d.token;
  user = d.user;
  if (typeof window !== "undefined") {
    localStorage.setItem(TOKEN_KEY, d.token);
    localStorage.setItem(USER_KEY, JSON.stringify(d.user));
  }
  emit();
  return d.user;
}

export function signOut() {
  token = null;
  user = null;
  if (typeof window !== "undefined") {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  }
  emit();
}

export function getActiveCommunityId(): string | null {
  return activeCommunityId;
}

export function setActiveCommunityId(id: string | null) {
  activeCommunityId = id;
  if (typeof window !== "undefined") {
    if (id) localStorage.setItem(COMMUNITY_KEY, id);
    else localStorage.removeItem(COMMUNITY_KEY);
  }
}

export function authHeaders(extra?: Record<string, string>): Record<string, string> {
  const h: Record<string, string> = {};
  if (token) h["Authorization"] = `Bearer ${token}`;
  if (activeCommunityId) h["X-Community-Id"] = activeCommunityId;
  if (extra) Object.assign(h, extra);
  return h;
}