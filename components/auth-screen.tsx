"use client";

import { useState } from "react";
import {
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  updateProfile,
} from "firebase/auth";
import { auth } from "@/lib/firebase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

function prettyAuthError(e: unknown): string {
  const c = (e as { code?: string })?.code || "";
  if (c.includes("invalid-credential") || c.includes("wrong-password") || c.includes("user-not-found"))
    return "Email or password is incorrect.";
  if (c.includes("email-already-in-use")) return "That email already has an account — try logging in.";
  if (c.includes("invalid-email")) return "That doesn't look like a valid email.";
  if (c.includes("weak-password")) return "Password should be at least 6 characters.";
  if (c.includes("operation-not-allowed")) return "Email/Password sign-in isn't enabled in Firebase.";
  if (c.includes("network")) return "Network error — check your connection.";
  if (c.includes("api-key") || c.includes("configuration"))
    return "Firebase isn't configured yet — check the NEXT_PUBLIC_FIREBASE_* env vars.";
  return (e as Error)?.message || "Something went wrong.";
}

export function AuthScreen() {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState(false);

  async function forgotPassword() {
    setError(""); setInfo("");
    if (!email) { setError("Enter your email above first."); return; }
    setBusy(true);
    try {
      await sendPasswordResetEmail(auth, email);
      setInfo("Password reset email sent — check your inbox.");
    } catch (e) {
      setError(prettyAuthError(e));
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    setError(""); setInfo("");
    if (!email || !password) {
      setError("Email and password are required.");
      return;
    }
    setBusy(true);
    try {
      if (mode === "signup") {
        if (!name.trim()) {
          setError("Please add a display name.");
          setBusy(false);
          return;
        }
        const cred = await createUserWithEmailAndPassword(auth, email, password);
        await updateProfile(cred.user, { displayName: name.trim() });
        await cred.user.reload();
        await cred.user.getIdToken(true); // refresh so the API sees the name claim
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
      // onAuthStateChanged in useBloom swaps to the app.
    } catch (e) {
      setError(prettyAuthError(e));
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--cream)",
      }}
    >
      <div className="auth-card">
        <div className="auth-logo">
          <div className="auth-icon">🌿</div>
          <div>
            <div className="auth-logo-text">bloom tracker</div>
            <div className="auth-logo-sub">your job search garden</div>
          </div>
        </div>

        <Tabs
          value={mode}
          onValueChange={(v) => {
            setMode(v as "login" | "signup");
            setError("");
          }}
        >
          <TabsList className="mb-5 flex gap-1.5 rounded-xl bg-[var(--pink-50)] p-1">
            <TabsTrigger
              value="login"
              className="flex-1 rounded-[9px] py-2 text-sm font-semibold text-[var(--text-mid)] data-[state=active]:bg-white data-[state=active]:text-[var(--pink-600)] data-[state=active]:shadow-sm"
            >
              Log in
            </TabsTrigger>
            <TabsTrigger
              value="signup"
              className="flex-1 rounded-[9px] py-2 text-sm font-semibold text-[var(--text-mid)] data-[state=active]:bg-white data-[state=active]:text-[var(--pink-600)] data-[state=active]:shadow-sm"
            >
              Sign up
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="flex flex-col gap-3">
          {mode === "signup" && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="au-name">Display name</Label>
              <Input
                id="au-name"
                placeholder="e.g. Alex"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="au-email">Email</Label>
            <Input
              id="au-email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="au-pass">Password</Label>
            <Input
              id="au-pass"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
            />
          </div>
        </div>

        {error && <div className="auth-error">{error}</div>}
        {info && <div style={{ fontSize: 13, color: "var(--success)", textAlign: "center", marginTop: 4 }}>{info}</div>}

        <Button className="w-full" onClick={submit} disabled={busy}>
          {busy ? "…" : mode === "signup" ? "Create account" : "Log in"}
        </Button>

        {mode === "login" && (
          <button
            type="button"
            onClick={forgotPassword}
            disabled={busy}
            style={{ background: "none", border: "none", cursor: "pointer", fontSize: 13, color: "var(--text-light)", textDecoration: "underline", padding: 0, marginTop: 4 }}
          >
            Forgot password?
          </button>
        )}

        <div className="auth-hint">
          Your applications sync instantly and join the community garden 🌿
        </div>
      </div>
    </div>
  );
}
