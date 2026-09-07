"use client";

// Shared views — time-boxed, revocable read-only links for advisers.
// Primary use case: send the family's social worker a WhatsApp link she can
// open to see what's happening with both parents, no login needed.

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Copy, ExternalLink, Link2, MessageCircle, ShieldCheck, Trash2 } from "lucide-react";
import type { SysAuditAction } from "@/lib/auditlog";

export interface ShareProps {
  actorName: string;
  onAudit: (action: SysAuditAction, target: string, detail: string, severity?: "info" | "notice" | "warning") => void;
}

interface ShareRow {
  id: string;
  token: string;
  subject: string;
  scope: string;
  createdAt: string;
  expiresAt: string;
  revoked: boolean;
  views: number;
  lastViewedAt?: string | null;
}

export default function Share({ actorName, onAudit }: ShareProps) {
  const [links, setLinks] = useState<ShareRow[]>([]);
  const [subject, setSubject] = useState("the family's social worker");
  const [scope, setScope] = useState("summary");
  const [days, setDays] = useState("14");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justMade, setJustMade] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/share");
      const json = await res.json();
      setLinks(json.links ?? []);
    } catch {
      /* offline — keep current */
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject, scope, days: Number(days) }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not create the link.");
      setJustMade(json.link.token);
      onAudit("share.create", subject, `Time-boxed shared view (${scope}) created for ${subject}, expires ${new Date(json.link.expiresAt).toLocaleDateString("en-GB")}`, "notice");
      refresh();
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (row: ShareRow) => {
    await fetch("/api/share", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: row.id, revoked: true }),
    });
    onAudit("share.revoke", row.subject, `Shared view for ${row.subject} revoked — link stops working immediately`, "notice");
    refresh();
  };

  const urlFor = (token: string) =>
    `${typeof window !== "undefined" ? window.location.origin : ""}/share/${token}`;

  const waText = (token: string) =>
    encodeURIComponent(
      `Hi — Alex here. Here's a time-boxed read-only view of what's happening with my dad and Mum's care: ${urlFor(token)}\n\nIt expires automatically and I can revoke it any time. Your advice on anything — care reviews, LPA duties, safeguarding — would really help.`
    );

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base"><Link2 className="h-5 w-5 text-teal-700" /> Share a view with an adviser</CardTitle>
          <CardDescription>
            Give the social worker (or any adviser) a read-only window on both parents&apos; care. Links are <strong>time-boxed</strong>,{" "}
            <strong>revocable in one tap</strong>, view-counted, and never allow edits. On the deployed Cloudflare build these
            views sit behind Turnstile and Zero-Trust policies (see the Deploy tab).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto_auto]">
            <div>
              <Label htmlFor="sh-subject">Who is the link for?</Label>
              <Input id="sh-subject" value={subject} onChange={(e) => setSubject(e.target.value)} className="mt-1.5" />
            </div>
            <div>
              <Label>Scope</Label>
              <Select value={scope} onValueChange={setScope}>
                <SelectTrigger className="mt-1.5 w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="summary">Summary brief</SelectItem>
                  <SelectItem value="detailed">Detailed brief</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Expires after</Label>
              <Select value={days} onValueChange={setDays}>
                <SelectTrigger className="mt-1.5 w-28"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="7">7 days</SelectItem>
                  <SelectItem value="14">14 days</SelectItem>
                  <SelectItem value="30">30 days</SelectItem>
                  <SelectItem value="90">90 days</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <Button onClick={create} disabled={busy || !subject.trim()} className="bg-teal-800 hover:bg-teal-700">
                Create link
              </Button>
            </div>
          </div>
          {error && <p className="text-sm text-rose-600">{error}</p>}
        </CardContent>
      </Card>

      {justMade && (
        <Card className="border-teal-300 dark:border-teal-700">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm text-teal-800 dark:text-teal-300"><MessageCircle className="h-4 w-4" /> Link ready — send it on WhatsApp</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <code className="block break-all rounded-lg bg-muted p-2 text-xs">{urlFor(justMade)}</code>
            <div className="flex flex-wrap gap-2">
              <a
                href={`https://wa.me/?text=${waText(justMade)}`}
                target="_blank"
                rel="noreferrer"
                onClick={() => onAudit("share.create", "WhatsApp handoff", "Share link handed to WhatsApp for sending to the social worker (the family's town)")}
              >
                <Button size="sm" className="bg-[#25D366] text-white hover:bg-[#1fb757]"><MessageCircle className="mr-1.5 h-4 w-4" /> Open in WhatsApp</Button>
              </a>
              <Button size="sm" variant="outline" onClick={() => copy(urlFor(justMade))}><Copy className="mr-1.5 h-4 w-4" /> Copy link</Button>
              <a href={`/share/${justMade}`} target="_blank" rel="noreferrer">
                <Button size="sm" variant="outline"><ExternalLink className="mr-1.5 h-4 w-4" /> Preview what the social worker sees</Button>
              </a>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Shared views</CardTitle>
          <CardDescription>View counts update each time the recipient opens the link.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {links.length === 0 && <p className="text-xs text-muted-foreground">No shared views yet.</p>}
          {links.map((l) => {
            const expired = new Date(l.expiresAt) < new Date();
            const dead = l.revoked || expired;
            return (
              <div key={l.id} className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{l.subject}</p>
                  <p className="text-xs text-muted-foreground">
                    {l.scope} · created {new Date(l.createdAt).toLocaleDateString("en-GB")} · expires {new Date(l.expiresAt).toLocaleDateString("en-GB")} · {l.views} view{l.views === 1 ? "" : "s"}
                    {l.lastViewedAt ? ` · last ${new Date(l.lastViewedAt).toLocaleString("en-GB")}` : ""}
                  </p>
                </div>
                <Badge variant="outline" className={dead ? "border-rose-300 text-rose-700" : "border-emerald-300 text-emerald-700"}>
                  {l.revoked ? "revoked" : expired ? "expired" : "active"}
                </Badge>
                {!dead && (
                  <>
                    <Button size="sm" variant="outline" onClick={() => copy(urlFor(l.token))}><Copy className="mr-1 h-3.5 w-3.5" /> Copy</Button>
                    <a href={`https://wa.me/?text=${waText(l.token)}`} target="_blank" rel="noreferrer">
                      <Button size="sm" variant="outline"><MessageCircle className="mr-1 h-3.5 w-3.5" /> WhatsApp</Button>
                    </a>
                    <Button size="sm" variant="outline" className="text-rose-600" onClick={() => revoke(l)}><Trash2 className="mr-1 h-3.5 w-3.5" /> Revoke</Button>
                  </>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex items-start gap-2 pt-4">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-teal-700" />
          <p className="text-xs text-muted-foreground">
            Security model: the link contains a random 128-bit token; the shared page renders a <strong>read-only brief</strong> and
            never exposes editing, contacts beyond the care team, or the full visit-level record. Created by {actorName} — every
            create/revoke lands in the audit trail.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
