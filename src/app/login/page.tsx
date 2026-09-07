"use client";

// Sign-in gate for the portal. Matches the hub's dark-teal identity.
// On success the signed session cookie is set and the user continues to
// ?next=… (or the home dashboard). Sessions last 30 days.
// The form renders client-side only: password-manager extensions inject DOM
// into password fields before hydration, which would otherwise break the gate.

import { Suspense, useEffect, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { HeartPulse, Loader2, Lock, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function LoginForm() {
  const params = useSearchParams();
  const next = params.get("next") || "/";
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, secure: window.location.protocol === "https:" }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        usingFallbackPassword?: boolean;
      };
      if (!res.ok || !json.ok) {
        setError(json.error || `Sign-in failed (HTTP ${res.status}).`);
        setBusy(false);
        return;
      }
      if (json.usingFallbackPassword) {
        setHint("Signed in with the demo fallback password — set PORTAL_PASSWORD as a deployment secret before real use.");
      }
      // hard navigation guarantees the middleware sees the new cookie
      window.location.assign(next.startsWith("/") ? next : "/");
    } catch {
      setError("Network error — check your connection and try again.");
      setBusy(false);
    }
  };

  return (
    <div className="w-full max-w-md space-y-4 rounded-2xl border border-teal-800/60 bg-[#071a16]/90 p-7 shadow-2xl backdrop-blur">
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-teal-800">
          <HeartPulse className="h-6 w-6 text-white" />
        </div>
        <div>
          <h1 className="text-lg font-bold text-teal-100">Family Care Hub</h1>
          <p className="text-xs text-teal-300/80">Private family portal — sign in to continue</p>
        </div>
      </div>

      <form onSubmit={submit} className="space-y-3">
        <div>
          <Label htmlFor="portal-password" className="text-teal-200">Portal password</Label>
          <Input
            id="portal-password"
            type="password"
            autoFocus
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1.5 border-teal-800 bg-[#0a241e] text-teal-50 placeholder:text-teal-700"
            placeholder="••••••••••"
          />
        </div>
        {error && (
          <p className="rounded-lg border border-rose-500/40 bg-rose-950/40 p-2.5 text-sm text-rose-200" role="alert">
            {error}
          </p>
        )}
        {hint && (
          <p className="flex items-start gap-1.5 rounded-lg border border-amber-500/40 bg-amber-950/30 p-2.5 text-xs text-amber-200">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {hint}
          </p>
        )}
        <Button
          type="submit"
          disabled={busy || password.length === 0}
          className="w-full bg-teal-700 text-white hover:bg-teal-600"
        >
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Lock className="mr-2 h-4 w-4" />}
          Sign in
        </Button>
      </form>

      <div className="space-y-1.5 border-t border-teal-900 pt-3 text-[11px] leading-relaxed text-teal-400/80">
        <p>
          Sessions last 30 days on this device. Failed attempts are throttled. If you are viewing
          this inside an embedded preview pane and it bounces back after signing in, open the portal
          in its own browser tab.
        </p>
        <p>
          Deployment: set <code className="rounded bg-teal-950 px-1">PORTAL_PASSWORD</code> and{" "}
          <code className="rounded bg-teal-950 px-1">SESSION_SECRET</code> as secrets — the demo
          fallback password is <code className="rounded bg-teal-950 px-1">demo-password</code>.
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  // client-only rendering — see the header note about password managers
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-br from-[#04120f] via-[#071a16] to-[#0B1B26] px-4 py-10">
      {!mounted ? (
        <div className="flex items-center gap-2 text-sm text-teal-300">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading sign-in…
        </div>
      ) : (
        <Suspense
          fallback={
            <div className="flex items-center gap-2 text-sm text-teal-300">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading sign-in…
            </div>
          }
        >
          <LoginForm />
        </Suspense>
      )}
    </main>
  );
}
