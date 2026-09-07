"use client";

// "About [name]" — the dedicated section that collects everything about the
// service user: identity, health snapshot, communication needs, preferences,
// people and practical access notes. Confirmed facts from the vault extraction
// queue are shown alongside, with their source quotes. Edits save to the
// server registry (Prisma), so the profile is true on every device.

import { useEffect, useState, type FormEvent } from "react";
import { Loader2, Save, Archive, ExternalLink, Quote, UserRound } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { type CareSubjectRecord, type SubjectProfile, SETTING_LABELS, initialsOf } from "@/lib/subjects";

interface FactRow {
  id: string;
  key: string;
  label: string;
  value: string;
  quote: string;
  confidence: number;
  status: string;
  source: string;
}

const FIELD_GROUPS: Array<{ title: string; note: string; rows: Array<{ key: keyof SubjectProfile; label: string; long?: boolean }> }> = [
  {
    title: "Personal",
    note: "How they like to be addressed and who they are.",
    rows: [
      { key: "preferredName", label: "Preferred name" },
      { key: "pronouns", label: "Pronouns" },
      { key: "languages", label: "Languages" },
      { key: "maritalStatus", label: "Marital / family status" },
      { key: "culture", label: "Culture, faith & end-of-life wishes", long: true },
    ],
  },
  {
    title: "Health & care",
    note: "The medical picture a professional would ask for first.",
    rows: [
      { key: "gpPractice", label: "GP practice" },
      { key: "pharmacy", label: "Pharmacy" },
      { key: "allergies", label: "Allergies" },
      { key: "conditions", label: "Conditions & diagnoses", long: true },
      { key: "medicationsSummary", label: "Medication summary", long: true },
      { key: "capacityNotes", label: "Capacity & decision-making notes (MCA)", long: true },
      { key: "mobility", label: "Mobility", long: true },
      { key: "sensory", label: "Hearing / sight / communication", long: true },
      { key: "nutrition", label: "Nutrition & hydration", long: true },
    ],
  },
  {
    title: "Preferences & voice",
    note: "What good support looks like to THEM.",
    rows: [
      { key: "likes", label: "Likes & comforts", long: true },
      { key: "dislikes", label: "Dislikes & things to avoid", long: true },
      { key: "routines", label: "Daily routines", long: true },
      { key: "goals", label: "What matters most / goals", long: true },
    ],
  },
  {
    title: "People & practical",
    note: "Who is involved and what carers need to know on day one.",
    rows: [
      { key: "nextOfKin", label: "Next of kin" },
      { key: "attorneys", label: "Attorneys / deputies" },
      { key: "professionals", label: "Professionals involved", long: true },
      { key: "keyContacts", label: "Other key contacts", long: true },
      { key: "keySafe", label: "Key safe / access" },
      { key: "accessNotes", label: "Practical access notes", long: true },
    ],
  },
];

export default function SubjectProfilePanel({
  subject,
  canManage,
  onArchived,
  actorName,
}: {
  subject: CareSubjectRecord;
  canManage: boolean;
  onArchived?: () => void;
  actorName?: string;
}) {
  const [profile, setProfile] = useState<SubjectProfile>(subject.profile ?? {});
  const [details, setDetails] = useState({
    displayName: subject.displayName,
    relationship: subject.relationship,
    setting: subject.setting,
    dateOfBirth: subject.dateOfBirth,
    nhsNumber: subject.nhsNumber,
    address: subject.address,
    phone: subject.phone,
  });
  const [facts, setFacts] = useState<FactRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [prevSubjectId, setPrevSubjectId] = useState(subject.id);
  if (prevSubjectId !== subject.id) {
    // React-recommended "adjust state during render" reset when the subject
    // changes — avoids a cascading effect render.
    setPrevSubjectId(subject.id);
    setProfile(subject.profile ?? {});
    setDetails({
      displayName: subject.displayName,
      relationship: subject.relationship,
      setting: subject.setting,
      dateOfBirth: subject.dateOfBirth,
      nhsNumber: subject.nhsNumber,
      address: subject.address,
      phone: subject.phone,
    });
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/facts?subjectId=${encodeURIComponent(subject.id)}&status=confirmed`);
        const json = (await res.json()) as { facts?: FactRow[] };
        if (!cancelled) setFacts(json.facts ?? []);
      } catch {
        /* non-fatal */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [subject.id]);

  const save = async (e?: FormEvent) => {
    e?.preventDefault();
    setBusy(true);
    setSaved(null);
    setError(null);
    try {
      const res = await fetch(`/api/subjects/${subject.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...details, profile }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) {
        setError(json.error || `Save failed (HTTP ${res.status}).`);
      } else {
        setSaved(`Saved at ${new Date().toLocaleTimeString()}${actorName ? ` by ${actorName}` : ""} — this profile is now the same on every device signed into the hub.`);
      }
    } catch {
      setError("Network error — changes were not saved.");
    } finally {
      setBusy(false);
    }
  };

  const archive = async () => {
    if (!confirm(`Archive ${subject.displayName}? Their tabs stay out of the navigation but the data is kept.`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/subjects/${subject.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived: true }),
      });
      if (res.ok) onArchived?.();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4" onSubmit={save}>
      {/* header card */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-teal-800 text-xl font-bold text-white">
            {initialsOf(subject.displayName)}
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="flex flex-wrap items-center gap-2 text-lg font-bold">
              {subject.displayName}
              <Badge variant="outline" className="text-[11px]">{SETTING_LABELS[subject.setting] ?? subject.setting}</Badge>
              {subject.relationship && <Badge variant="outline" className="text-[11px] text-muted-foreground">{subject.relationship}</Badge>}
            </h2>
            <p className="text-xs text-muted-foreground">
              {subject.dateOfBirth ? `Born ${subject.dateOfBirth}` : "Date of birth not recorded"}
              {subject.nhsNumber ? ` · NHS ${subject.nhsNumber}` : ""}
              {subject.phone ? ` · ${subject.phone}` : ""}
              {subject.address ? ` · ${subject.address}` : ""}
            </p>
          </div>
          {canManage && (
            <div className="flex gap-2">
              <Button type="submit" size="sm" className="bg-teal-700 text-white hover:bg-teal-600" disabled={busy} onClick={save}>
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                Save profile
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={archive} disabled={busy}>
                <Archive className="mr-2 h-4 w-4" /> Archive
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {saved && <p className="rounded-lg border border-emerald-500/40 bg-emerald-950/30 p-2.5 text-sm text-emerald-200">{saved}</p>}
      {error && <p className="rounded-lg border border-rose-500/40 bg-rose-950/30 p-2.5 text-sm text-rose-200" role="alert">{error}</p>}

      {/* registry details */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Registry details</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {canManage ? (
            <>
              <div className="space-y-1">
                <Label className="text-xs">Name</Label>
                <Input value={details.displayName} onChange={(e) => setDetails({ ...details, displayName: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Relationship to you</Label>
                <Input value={details.relationship} onChange={(e) => setDetails({ ...details, relationship: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Living situation</Label>
                <Select value={details.setting} onValueChange={(v) => setDetails({ ...details, setting: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(SETTING_LABELS).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Date of birth</Label>
                <Input type="date" value={details.dateOfBirth} onChange={(e) => setDetails({ ...details, dateOfBirth: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">NHS number</Label>
                <Input value={details.nhsNumber} onChange={(e) => setDetails({ ...details, nhsNumber: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Phone</Label>
                <Input value={details.phone} onChange={(e) => setDetails({ ...details, phone: e.target.value })} />
              </div>
              <div className="space-y-1 sm:col-span-2 lg:col-span-3">
                <Label className="text-xs">Address</Label>
                <Textarea rows={2} value={details.address} onChange={(e) => setDetails({ ...details, address: e.target.value })} />
              </div>
            </>
          ) : (
            <div className="text-sm text-muted-foreground">
              <UserRound className="mr-2 inline h-4 w-4" />
              Profile details are read-only for your role — ask the family administrators to make changes.
            </div>
          )}
        </CardContent>
      </Card>

      {/* profile groups */}
      {FIELD_GROUPS.map((group) => (
        <Card key={group.title}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">{group.title}</CardTitle>
            <p className="text-xs text-muted-foreground">{group.note}</p>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            {group.rows.map((row) => (
              <div key={String(row.key)} className={row.long ? "space-y-1 sm:col-span-2" : "space-y-1"}>
                <Label className="text-xs">{row.label}</Label>
                {row.long ? (
                  <Textarea
                    rows={2}
                    disabled={!canManage}
                    value={String(profile[row.key] ?? "")}
                    onChange={(e) => setProfile({ ...profile, [row.key]: e.target.value })}
                  />
                ) : (
                  <Input
                    disabled={!canManage}
                    value={String(profile[row.key] ?? "")}
                    onChange={(e) => setProfile({ ...profile, [row.key]: e.target.value })}
                  />
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      ))}

      {/* confirmed facts from the vault */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Confirmed facts (from the data vault)</CardTitle>
          <p className="text-xs text-muted-foreground">
            Facts extracted from uploaded documents and confirmed by a human — each keeps its verbatim source quote.
          </p>
        </CardHeader>
        <CardContent>
          {facts.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing confirmed yet. Upload a passport, birth certificate or letter in the Data vault and confirm the
              extracted facts — they will appear here.
            </p>
          ) : (
            <ul className="space-y-2">
              {facts.map((f) => (
                <li key={f.id} className="rounded-lg border p-2.5 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="text-[11px]">{f.label}</Badge>
                    <span className="font-semibold">{f.value}</span>
                    <Badge variant="outline" className="ml-auto text-[10px] text-muted-foreground">
                      {f.source} · {Math.round(f.confidence * 100)}%
                    </Badge>
                  </div>
                  {f.quote && (
                    <p className="mt-1 flex items-start gap-1 text-xs italic text-muted-foreground">
                      <Quote className="mt-0.5 h-3 w-3 shrink-0" /> “{f.quote}”
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {canManage && (
        <>
          <Separator />
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            <ExternalLink className="h-3 w-3" /> Tip: keep the profile current before reviews — assessors read this section first.
          </p>
        </>
      )}
    </div>
  );
}
