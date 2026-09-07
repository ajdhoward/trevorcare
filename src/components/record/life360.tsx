"use client";

// Life360 connector UI — location awareness for the family circle.
// Setup → circles → members with distance-from-home and radius alerts.
// Uses the unofficial Life360 endpoints via our server proxy (/api/life360).

import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Battery, BatteryCharging, Home, KeyRound, LocateFixed, MapPin, RefreshCw, ShieldAlert, TriangleAlert,
} from "lucide-react";
import {
  type Life360Settings, type Life360Circle, type Life360Member,
  loadLife360Settings, saveLife360Settings, decorateMember, memberInitials,
  life360Disclaimer,
} from "@/lib/life360";
import type { SysAuditAction } from "@/lib/auditlog";

export interface Life360Props {
  actorName: string;
  onAudit: (action: SysAuditAction, target: string, detail: string, severity?: "info" | "notice" | "warning") => void;
}

export default function Life360Panel({ actorName, onAudit }: Life360Props) {
  const [settings, setSettings] = useState<Life360Settings | null>(null);
  const [tab, setTab] = useState<"password" | "token">("password");
  const [circles, setCircles] = useState<Life360Circle[]>([]);
  const [members, setMembers] = useState<Life360Member[]>([]);
  const [activeCircle, setActiveCircle] = useState<string>("");
  const [status, setStatus] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setSettings(loadLife360Settings());
  }, []);

  if (!settings) return <p className="text-sm text-muted-foreground">Loading Life360 connector…</p>;

  const patch = (p: Partial<Life360Settings>) => {
    const next = { ...settings, ...p };
    setSettings(next);
    saveLife360Settings(next);
  };

  const call = async (body: Record<string, unknown>) => {
    const res = await fetch("/api/life360", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || `Life360 request failed (HTTP ${res.status}).`);
    return json;
  };

  const login = async () => {
    setBusy(true);
    setError(null);
    setStatus("Signing in to Life360…");
    try {
      const json = await call({ action: "login", email: settings.email, password: settings.password, clientId: settings.clientId, clientSecret: settings.clientSecret });
      patch({ token: json.token });
      setStatus("Signed in — token stored in this browser only. Loading circles…");
      onAudit("life360.sync", "Life360 login", `${actorName} signed in to Life360 (token stored device-local)`);
      await loadCircles(json.token);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("");
    } finally {
      setBusy(false);
    }
  };

  const useToken = async () => {
    setBusy(true);
    setError(null);
    setStatus("Using pasted token…");
    try {
      await loadCircles(settings.token);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("");
    } finally {
      setBusy(false);
    }
  };

  const loadCircles = async (token: string) => {
    const json = await call({ action: "circles", token });
    setCircles(json.circles ?? []);
    if (json.circles?.[0]) {
      setActiveCircle(json.circles[0].id);
      await loadMembers(token, json.circles[0].id);
    }
    setStatus("Connected.");
  };

  const loadMembers = async (token: string, circleId: string) => {
    setBusy(true);
    setError(null);
    try {
      const json = await call({ action: "members", token, circleId });
      const decorated = (json.members ?? []).map((m: Life360Member) => decorateMember(m, settings));
      setMembers(decorated);
      onAudit("life360.sync", "Life360 members", `${decorated.length} member location(s) fetched — radius alert at ${settings.radiusKm} km around home`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const outside = members.filter((m) => m.atHome === false);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base"><LocateFixed className="h-5 w-5 text-teal-700" /> Life360 — location awareness</CardTitle>
          <CardDescription>
            Connect your existing Life360 circle to see who is with Dad, when carers arrive and leave the home radius, and
            whether his phone battery is running low. {life360Disclaimer()}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Tabs value={tab} onValueChange={(v) => setTab(v as "password" | "token")}>
            <TabsList>
              <TabsTrigger value="password"><KeyRound className="mr-1 h-4 w-4" />Sign in</TabsTrigger>
              <TabsTrigger value="token">Paste token</TabsTrigger>
            </TabsList>
            <TabsContent value="password" className="space-y-3 pt-2">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="l360-email">Life360 email</Label>
                  <Input id="l360-email" type="email" value={settings.email} onChange={(e) => patch({ email: e.target.value })} className="mt-1.5" placeholder="you@example.com" />
                </div>
                <div>
                  <Label htmlFor="l360-pass">Life360 password</Label>
                  <Input id="l360-pass" type="password" value={settings.password} onChange={(e) => patch({ password: e.target.value })} className="mt-1.5" placeholder="••••••••" />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Credentials live in <em>this browser only</em>; they are forwarded per-request to our own <code>/api/life360</code> proxy,
                never stored server-side. If Life360&apos;s client keys have been rotated, use the token tab instead.
              </p>
              <Button onClick={login} disabled={busy || !settings.email || !settings.password} className="bg-teal-800 hover:bg-teal-700">
                <KeyRound className="mr-1.5 h-4 w-4" /> Sign in &amp; load circle
              </Button>
            </TabsContent>
            <TabsContent value="token" className="space-y-3 pt-2">
              <div>
                <Label htmlFor="l360-token">Access token</Label>
                <Input id="l360-token" value={settings.token} onChange={(e) => patch({ token: e.target.value })} className="mt-1.5 font-mono text-xs" placeholder="eyJ0eXAiOiJKV1QiLCJhbGciOi…" />
              </div>
              <Button onClick={useToken} disabled={busy || !settings.token} className="bg-teal-800 hover:bg-teal-700">Load circle with token</Button>
            </TabsContent>
          </Tabs>

          {/* home + radius */}
          <div className="grid gap-3 rounded-lg border p-3 sm:grid-cols-3">
            <div>
              <Label htmlFor="l360-lat">Home latitude (Dad&apos;s house)</Label>
              <Input id="l360-lat" type="number" step="0.0001" value={settings.homeLat ?? ""} onChange={(e) => patch({ homeLat: Number(e.target.value) })} className="mt-1.5" />
            </div>
            <div>
              <Label htmlFor="l360-lon">Home longitude</Label>
              <Input id="l360-lon" type="number" step="0.0001" value={settings.homeLon ?? ""} onChange={(e) => patch({ homeLon: Number(e.target.value) })} className="mt-1.5" />
            </div>
            <div>
              <Label htmlFor="l360-radius">Alert radius (km)</Label>
              <Input id="l360-radius" type="number" step="0.1" value={settings.radiusKm} onChange={(e) => patch({ radiusKm: Number(e.target.value) })} className="mt-1.5" />
            </div>
          </div>

          {status && <p className="text-xs text-teal-700 dark:text-teal-300">{status}</p>}
          {error && (
            <p className="flex items-start gap-1.5 text-sm text-rose-600"><TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" /> {error}</p>
          )}
        </CardContent>
      </Card>

      {circles.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center justify-between gap-2 text-sm">
              <span>Circles</span>
              <Button size="sm" variant="outline" disabled={busy || !settings.token} onClick={() => loadMembers(settings.token, activeCircle)}>
                <RefreshCw className={`mr-1 h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} /> Refresh
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {circles.map((c) => (
                <Button key={c.id} size="sm" variant={activeCircle === c.id ? "default" : "outline"}
                  className={activeCircle === c.id ? "bg-teal-800 hover:bg-teal-700" : ""}
                  onClick={() => { setActiveCircle(c.id); loadMembers(settings.token, c.id); }}>
                  {c.name}
                </Button>
              ))}
            </div>

            {outside.length > 0 && (
              <p className="flex items-start gap-1.5 rounded-lg border border-amber-300/60 bg-amber-50/60 p-2.5 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
                Outside the home radius right now: {outside.map((m) => m.name).join(", ")} — if that&apos;s a carer mid-visit, check the visit sheet; if it&apos;s Dad&apos;s phone, call him.
              </p>
            )}

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {members.map((m) => (
                <div key={m.id} className="rounded-xl border p-3">
                  <div className="flex items-center gap-2">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-teal-800 text-sm font-bold text-white">
                      {memberInitials(m.name)}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{m.name}</p>
                      <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
                        {m.atHome ? <><Home className="h-3 w-3" /> at home</> : <><MapPin className="h-3 w-3" /> {m.distanceFromHomeKm != null ? `${m.distanceFromHomeKm.toFixed(1)} km from home` : "location unknown"}</>}
                      </p>
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {m.lastCheckin && <Badge variant="outline" className="text-[10px]">seen {new Date(m.lastCheckin).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</Badge>}
                    {m.battery != null && (
                      <Badge variant="outline" className="text-[10px]">
                        {m.charging ? <BatteryCharging className="mr-0.5 inline h-3 w-3" /> : <Battery className="mr-0.5 inline h-3 w-3" />}
                        {Math.round(m.battery * 100)}%
                      </Badge>
                    )}
                    {m.speedKmh != null && m.speedKmh > 5 && <Badge variant="outline" className="text-[10px]">moving {m.speedKmh} km/h</Badge>}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
