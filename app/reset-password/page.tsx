"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Stage = "email" | "reset" | "done";

export default function ResetPasswordPage() {
  const [stage, setStage] = useState<Stage>("email");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function requestCode() {
    setError("");
    if (!email.trim()) { setError("Enter your email."); return; }
    setBusy(true);
    try {
      const res = await fetch("/api/auth/forgot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.ok) throw new Error(d.error || "Couldn't send a code.");
      setStage("reset");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  async function resetPassword() {
    setError("");
    if (!otp.trim() || password.length < 6) {
      setError("Enter the 6-digit code and a password of at least 6 characters.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/auth/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, otp, newPassword: password }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.ok) throw new Error(d.error || "Reset failed.");
      setStage("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  const shell = (children: React.ReactNode) => (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--cream)" }}>
      <div className="auth-card" style={{ width: 360 }}>
        <div className="auth-logo">
          <div className="auth-icon">🌿</div>
          <div>
            <div className="auth-logo-text">bloom tracker</div>
            <div className="auth-logo-sub">reset your password</div>
          </div>
        </div>
        {children}
      </div>
    </div>
  );

  if (stage === "done") {
    return shell(
      <div style={{ textAlign: "center", paddingTop: 8 }}>
        <p style={{ fontSize: 15, marginBottom: 18 }}>Password updated — you can log in now.</p>
        <Link href="/">
          <Button className="w-full">Go to log in</Button>
        </Link>
      </div>
    );
  }

  return shell(
    <div className="flex flex-col gap-3">
      {stage === "email" && (
        <>
          <p style={{ fontSize: 13, color: "var(--text-light)", marginBottom: 4 }}>
            Enter your email and we&apos;ll send a 6-digit reset code.
          </p>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="rp-email">Email</Label>
            <Input id="rp-email" type="email" placeholder="you@example.com" value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && requestCode()} />
          </div>
          <Button className="w-full" onClick={requestCode} disabled={busy}>
            {busy ? "…" : "Send code"}
          </Button>
        </>
      )}

      {stage === "reset" && (
        <>
          <div className="flex flex-col gap-1.5">
            <Label>Reset code</Label>
            <Input inputMode="numeric" maxLength={6} placeholder="123456" value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="rp-pass">New password</Label>
            <Input id="rp-pass" type="password" placeholder="••••••••" value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && resetPassword()} />
          </div>
          <Button className="w-full" onClick={resetPassword} disabled={busy}>
            {busy ? "…" : "Set new password"}
          </Button>
          <button type="button" onClick={() => { setStage("email"); setError(""); }}
            style={{ background: "none", border: "none", cursor: "pointer", fontSize: 13, color: "var(--text-light)", textDecoration: "underline", padding: 0 }}>
            Send a new code
          </button>
        </>
      )}

      {error && <div className="auth-error">{error}</div>}
      {stage === "email" && (
        <Link href="/" style={{ fontSize: 13, color: "var(--text-light)", textDecoration: "underline", textAlign: "center" }}>
          Back to log in
        </Link>
      )}
    </div>
  );
}