"use client";

// PIM integrations — connect the hub to Google, Apple and Microsoft personal
// information (calendar & contacts). Two sync paths:
//   1. Feed (works today): paste an iCloud/ICS share URL or import .ics/.vcf
//      exports — parsed into events/contacts.
//   2. Native OAuth (activates with deployment credentials): consent flow and
//      token exchange are fully wired; set the provider's client id/secret as
//      deployment secrets and the Connect button comes alive.

import { useCallback, useEffect, useState } from "react";
import { CalendarCog, Loader2, RefreshCw, PlugZap, Unplug, Upload, Info } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { type CareSubjectRecord } from "@/lib/subjects";

interface IntegrationRow {
  id: string;
  provider: string;
  kind: string;
  status: string;
  account: string;
  config: string;
  hasToken: boolean;
  lastSyncAt: string | null;
  lastResult: string;
}

interface ProviderInfo {
  id: string;
  label: string;
  blurb: string;
  color: string;
  setupNotes: string;
  oauthReady: boolean;
}

interface IcsEvent {
  uid: string;
  summary: string;
  start: string;
  end: string;
  location: string;
}

export default function Integrations({ subjects }: { subjects: CareSubjectRecord[] }) {
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [integrations, setIntegrations] = useState<IntegrationRow[]>([]);
  const [feedUrls, setFeedUrls] = useState<Record<string, string>>({});
  const [accounts, setAccounts] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importText, setImportText] = useState("");
  const [events, setEvents] = useState<IcsEvent[]>([]);
  const [contacts, setContacts] = useState<Array<{ fullName: string; phones: string[]; emails: string[] }>>([]);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/integrations");
      const json = (await res.json()) as { providers?: ProviderInfo[]; integrations?: IntegrationRow[] };
      setProviders(json.providers ?? []);
      setIntegrations(json.integrations ?? []);
      const cfg: Record<string, string> = {};
      const acc: Record<string, string> = {};
      for (const row of json.integrations ?? []) {
        try {
          const parsed = JSON.parse(row.config || "{}") as { feedUrl?: string };
          if (parsed.feedUrl) cfg[row.provider] = parsed.feedUrl;
        } catch {
          /* ignore */
        }
        if (row.account) acc[row.provider] = row.account;
      }
      setFeedUrls(cfg);
      setAccounts(acc);
    } catch {
      /* surfaced via actions */
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const saveConnection = async (provider: string) => {
    setBusyId(provider);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/integrations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, feedUrl: feedUrls[provider] ?? "", account: accounts[provider] ?? "" }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) setError(json.error ?? "Save failed.");
      else setNotice(`${provider} connection details saved.`);
      await load();
    } finally {
      setBusyId(null);
    }
  };

  const connectOauth = async (provider: string) => {
    setBusyId(provider);
    setError(null);
    try {
      const res = await fetch(`/api/integrations/oauth/start?provider=${provider}`);
      const json = (await res.json()) as { ok?: boolean; consentUrl?: string; error?: string };
      if (json.ok && json.consentUrl) {
        window.location.assign(json.consentUrl);
        return;
      }
      setError(json.error ?? "OAuth could not start.");
    } finally {
      setBusyId(null);
    }
  };

  const sync = async (id: string, provider: string) => {
    setBusyId(id);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/integrations/${id}`, { method: "POST" });
      const json = (await res.json()) as { ok?: boolean; error?: string; events?: IcsEvent[]; source?: string };
      if (!res.ok || !json.ok) {
        setError(json.error ?? "Sync failed.");
      } else {
        if (json.events) setEvents(json.events);
        setNotice(`Synced from ${json.source}: ${json.events?.length ?? 0} event(s). See the imported list below.`);
      }
      await load();
    } finally {
      setBusyId(null);
    }
  };

  const disconnect = async (id: string, provider: string) => {
    setBusyId(id);
    try {
      await fetch(`/api/integrations/${id}`, { method: "DELETE" });
      setNotice(`${provider} disconnected.`);
      await load();
    } finally {
      setBusyId(null);
    }
  };

  const importPasted = async () => {
    setBusyId("import");
    setError(null);
    try {
      const res = await fetch("/api/integrations/ics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: importText }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string; format?: string; events?: IcsEvent[]; contacts?: Array<{ fullName: string; phones: string[]; emails: string[] }> };
      if (!json.ok) setError(json.error ?? "Import failed.");
      else {
        setEvents(json.events ?? []);
        setContacts(json.contacts ?? []);
        setNotice(`${json.format === "vcard" ? `${json.contacts?.length ?? 0} contact(s)` : `${json.events?.length ?? 0} event(s)`} imported.`);
      }
    } finally {
      setBusyId(null);
    }
  };

  const forProvider = (pid: string) => integrations.find((i) => i.provider === pid && i.kind === "calendar");

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-wrap items-center gap-3">
          <CalendarCog className="h-5 w-5 text-teal-300" />
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-bold">PIM integrations — calendar &amp; contacts</h2>
            <p className="text-xs text-muted-foreground">
              Bring the outside world in: appointments from Google, Apple and Microsoft calendars; contacts from your
              accounts. Feed-based sync works immediately; native OAuth activates the moment its deployment credentials
              are set — no code changes needed.
            </p>
          </div>
        </CardContent>
      </Card>

      {notice && <p className="rounded-lg border border-emerald-500/40 bg-emerald-950/30 p-2.5 text-sm text-emerald-200">{notice}</p>}
      {error && <p className="rounded-lg border border-rose-500/40 bg-rose-950/30 p-2.5 text-sm text-rose-200" role="alert">{error}</p>}

      <div className="grid gap-3 lg:grid-cols-3">
        {providers.map((p) => {
          const row = forProvider(p.id);
          const connected = row?.status === "connected";
          return (
            <Card key={p.id}>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <span className={`inline-flex h-2.5 w-2.5 rounded-full ${p.color}`} />
                  {p.label}
                  <Badge variant="outline" className={`ml-auto text-[10px] ${connected ? "border-emerald-500/40 text-emerald-300" : "text-muted-foreground"}`}>
                    {row?.status ?? "disconnected"}
                  </Badge>
                </CardTitle>
                <p className="text-xs text-muted-foreground">{p.blurb}</p>
              </CardHeader>
              <CardContent className="space-y-2.5">
                <div className="space-y-1.5">
                  <Label className="text-xs">Account label (optional)</Label>
                  <Input
                    value={accounts[p.id] ?? ""}
                    onChange={(e) => setAccounts({ ...accounts, [p.id]: e.target.value })}
                    placeholder="e.g. family/calendar@…"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">ICS / feed URL (works today)</Label>
                  <Input
                    value={feedUrls[p.id] ?? ""}
                    onChange={(e) => setFeedUrls({ ...feedUrls, [p.id]: e.target.value })}
                    placeholder="https://…/basic.ics"
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => void saveConnection(p.id)} disabled={busyId === p.id}>
                    {busyId === p.id ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <PlugZap className="mr-2 h-3.5 w-3.5" />}
                    Save
                  </Button>
                  {row && (
                    <>
                      <Button size="sm" variant="outline" onClick={() => void sync(row.id, p.id)} disabled={busyId === row.id}>
                        {busyId === row.id ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-2 h-3.5 w-3.5" />}
                        Sync now
                      </Button>
                      <Button size="sm" variant="outline" className="text-rose-300 hover:bg-rose-950/40" onClick={() => void disconnect(row.id, p.id)} disabled={busyId === row.id}>
                        <Unplug className="mr-2 h-3.5 w-3.5" /> Disconnect
                      </Button>
                    </>
                  )}
                  {p.oauthReady ? (
                    <Button size="sm" className="bg-teal-700 text-white hover:bg-teal-600" onClick={() => void connectOauth(p.id)} disabled={busyId === p.id}>
                      Connect with {p.id}
                    </Button>
                  ) : (
                    <span className="inline-flex items-start gap-1 text-[11px] text-muted-foreground">
                      <Info className="mt-0.5 h-3 w-3 shrink-0" /> Native OAuth: not configured on this deployment.
                    </span>
                  )}
                </div>
                {row?.lastSyncAt && (
                  <p className="text-[11px] text-muted-foreground">
                    Last sync {new Date(row.lastSyncAt).toLocaleString()} — {row.lastResult}
                  </p>
                )}
                <details className="text-[11px] text-muted-foreground">
                  <summary className="cursor-pointer">Setup notes for native sync</summary>
                  <p className="mt-1 leading-relaxed">{p.setupNotes}</p>
                </details>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Upload className="h-4 w-4 text-teal-300" /> Import an export (.ics calendar / .vcf contacts)
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Google Takeout, iCloud (Calendar → export) and Outlook all produce these files.
          </p>
        </CardHeader>
        <CardContent className="space-y-2.5">
          <Textarea rows={5} value={importText} onChange={(e) => setImportText(e.target.value)} placeholder="BEGIN:VCALENDAR … or BEGIN:VCARD …" />
          <Button size="sm" className="bg-teal-700 text-white hover:bg-teal-600" onClick={() => void importPasted()} disabled={busyId === "import" || !importText.trim()}>
            {busyId === "import" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
            Parse import
          </Button>
          {contacts.length > 0 && (
            <ul className="space-y-1.5">
              {contacts.slice(0, 12).map((c, i) => (
                <li key={i} className="rounded-lg border p-2 text-sm">
                  <span className="font-semibold">{c.fullName || "(unnamed)"}</span>
                  {c.phones.length > 0 && <span className="ml-2 text-xs text-muted-foreground">{c.phones.join(" · ")}</span>}
                  {c.emails.length > 0 && <span className="ml-2 text-xs text-muted-foreground">{c.emails.join(" · ")}</span>}
                </li>
              ))}
            </ul>
          )}
          {events.length > 0 && (
            <ul className="space-y-1.5">
              {events.slice(0, 12).map((ev, i) => (
                <li key={ev.uid || i} className="rounded-lg border p-2 text-sm">
                  <span className="font-semibold">{ev.summary}</span>
                  <span className="ml-2 text-xs text-muted-foreground">{ev.start}{ev.location ? ` · ${ev.location}` : ""}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="text-[11px] text-muted-foreground">
            Imported items are shown here and can be copied into the family calendar and visit sheets
            (Family hub → Calendar). Service-user scoping follows the hub&apos;s active person:{" "}
            {subjects.map((s) => s.displayName).join(", ") || "none added yet"}.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
