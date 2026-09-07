"use client";

// Medication reconciliation view (Systems Review P2) — replaces free-text
// discovery with structured governance: duplicate-pack tracker, structured
// exception flags ("no medication in blister", "duplicate pack found",
// "tablet-splitting requested", "PRN withheld"), a reconciliation-cycle card
// for the pharmacist-led single-NOMAD regime, and a monthly audit export.

import { useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import {
  ClipboardCheck, PackageCheck, PackageX, Pill, Plus, Scissors, Trash2, TriangleAlert,
} from "lucide-react";
import type { SysAuditAction } from "@/lib/auditlog";

export type MedExceptionType =
  | "no medication in blister"
  | "duplicate pack found"
  | "tablet-splitting requested"
  | "PRN withheld (window)"
  | "other";

export interface MedException {
  id: string;
  date: string; // ISO date
  type: MedExceptionType;
  med?: string;
  actionTaken: string;
  resolved: boolean;
  loggedBy: string;
}

export interface MedReconStore {
  activeCycles: number; // NOMAD cycles in the house right now
  lastReconciled?: string; // ISO date of last weekly reconciliation
  noSplitDirective: boolean; // no-splitting directive recorded in the support plan
  prnProtocol: boolean; // PRN protocol with window authority in place
}

const K_EXC = "care-medrecon-exceptions-v1";
const K_STORE = "care-medrecon-store-v1";

function load<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
function save<T>(key: string, v: T) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* ignore */
  }
}

export function defaultMedRecon(): MedReconStore {
  return { activeCycles: 2, noSplitDirective: false, prnProtocol: false };
}
export function loadMedRecon(): MedReconStore {
  return load<MedReconStore>(K_STORE, defaultMedRecon());
}
export function saveMedRecon(s: MedReconStore) {
  save(K_STORE, s);
}
export function loadMedExceptions(): MedException[] {
  return load<MedException[]>(K_EXC, seedExceptions());
}
export function saveMedExceptions(list: MedException[]) {
  save(K_EXC, list);
}
export function seedExceptions(): MedException[] {
  return [
    {
      id: "me-seed-1",
      date: "2026-07-11",
      type: "no medication in blister",
      med: "evening dose",
      actionTaken: "On-call advice sought; GP informed; family verified supply.",
      resolved: true,
      loggedBy: "Carer A (sample)",
    },
    {
      id: "me-seed-2",
      date: "2026-06-13",
      type: "duplicate pack found",
      med: "morning Nomad",
      actionTaken: "Second cycle found in the hall cupboard; returned to pharmacy for destruction.",
      resolved: false,
      loggedBy: "Carer B (sample)",
    },
  ];
}

const TYPE_META: Record<MedExceptionType, { icon: typeof PackageX; tone: string }> = {
  "no medication in blister": { icon: PackageX, tone: "border-rose-300 bg-rose-50/60" },
  "duplicate pack found": { icon: TriangleAlert, tone: "border-amber-300 bg-amber-50/60" },
  "tablet-splitting requested": { icon: Scissors, tone: "border-rose-300 bg-rose-50/60" },
  "PRN withheld (window)": { icon: Pill, tone: "border-amber-300 bg-amber-50/60" },
  other: { icon: PackageCheck, tone: "border-neutral-300 bg-neutral-50/60" },
};

export interface MedReconProps {
  store: MedReconStore;
  onStoreChange: (next: MedReconStore) => void;
  exceptions: MedException[];
  onExceptionsChange: (next: MedException[]) => void;
  freeTextHits: { date: string; comments: string }[];
  onAudit: (action: SysAuditAction, target: string, detail: string, severity?: "info" | "notice" | "warning") => void;
}

export function MedRecon({ store, onStoreChange, exceptions, onExceptionsChange, freeTextHits, onAudit }: MedReconProps) {
  const [type, setType] = useState<MedExceptionType>("no medication in blister");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [med, setMed] = useState("");
  const [action, setAction] = useState("");

  const open = exceptions.filter((e) => !e.resolved);
  const duplicateRisk = store.activeCycles > 1;

  const addException = () => {
    if (!action.trim()) return;
    const e: MedException = {
      id: `me-${Date.now()}`,
      date,
      type,
      med: med.trim() || undefined,
      actionTaken: action.trim(),
      resolved: false,
      loggedBy: "you",
    };
    onExceptionsChange([e, ...exceptions]);
    onAudit("medrecon.flag.add", `${e.type}${e.med ? ` — ${e.med}` : ""}`, "structured medication exception logged", "notice");
    setMed("");
    setAction("");
  };

  const resolve = (e: MedException) => {
    onExceptionsChange(exceptions.map((x) => (x.id === e.id ? { ...x, resolved: !x.resolved } : x)));
    onAudit("medrecon.flag.resolve", `${e.type}${e.med ? ` — ${e.med}` : ""}`, e.resolved ? "exception re-opened" : "exception marked resolved", "info");
  };

  const remove = (e: MedException) => {
    onExceptionsChange(exceptions.filter((x) => x.id !== e.id));
    onAudit("medrecon.flag.resolve", `${e.type}`, "exception removed", "notice");
  };

  const exportAudit = () => {
    const rows = [["date", "type", "med", "actionTaken", "resolved", "loggedBy"]];
    for (const e of [...exceptions].sort((a, b) => a.date.localeCompare(b.date))) {
      rows.push([e.date, e.type, e.med ?? "", e.actionTaken, e.resolved ? "yes" : "no", e.loggedBy]);
    }
    rows.push([]);
    rows.push(["reconciliation audit", `active NOMAD cycles: ${store.activeCycles}`, `last reconciled: ${store.lastReconciled ?? "—"}`, `no-splitting directive: ${store.noSplitDirective ? "recorded" : "NOT recorded"}`, `PRN window protocol: ${store.prnProtocol ? "in place" : "NOT in place"}`, `free-text eMAR hits needing conversion: ${freeTextHits.length}`]);
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `medication_reconciliation_audit_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    onAudit("medrecon.export", "monthly medication reconciliation audit", "audit CSV exported for the pharmacist-led cycle", "notice");
  };

  const cycleTone = duplicateRisk
    ? "border-rose-300 bg-rose-50/60 text-rose-900"
    : "border-emerald-300 bg-emerald-50/60 text-emerald-900";

  return (
    <div className="space-y-4">
      {/* governance status */}
      <div className="grid gap-3 sm:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <ClipboardCheck className="h-4 w-4 text-teal-700" /> Reconciliation cycle (pharmacist-led)
            </CardTitle>
            <CardDescription>
              Single NOMAD cycle in the house at a time, weekly reconciliation, superseded packs
              formally returned or destroyed — eliminating the duplicate-pack failure mode at source.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className={`rounded-lg border p-3 text-sm ${cycleTone}`}>
              <p className="flex items-center gap-2 font-semibold">
                <PackageCheck className="h-4 w-4" />
                {duplicateRisk ? `${store.activeCycles} cycles in the house — duplicate-pack risk` : "Single cycle — correct state"}
              </p>
              {duplicateRisk && (
                <p className="mt-1 text-xs">
                  Duplicate visits intersected with duplicate blister packs to create direct medication
                  risk. Return the superseded cycle to the pharmacy and set the count to 1.
                </p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label htmlFor="mr-cycles">Active cycles in house</Label>
                <Input
                  id="mr-cycles" type="number" min={0} max={5} value={store.activeCycles}
                  onChange={(e) => {
                    const next = { ...store, activeCycles: Math.max(0, Number(e.target.value)) };
                    onStoreChange(next);
                    saveMedRecon(next);
                  }}
                  className="mt-1.5"
                />
              </div>
              <div>
                <Label htmlFor="mr-last">Last reconciled</Label>
                <Input
                  id="mr-last" type="date" value={store.lastReconciled ?? ""}
                  onChange={(e) => {
                    const next = { ...store, lastReconciled: e.target.value };
                    onStoreChange(next);
                    saveMedRecon(next);
                  }}
                  className="mt-1.5"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Directives to request from the prescriber</CardTitle>
            <CardDescription>
              Record these in the support plan, then audit monthly. Tick once confirmed in writing.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <label className="flex items-start gap-2">
              <Checkbox
                checked={store.noSplitDirective}
                onCheckedChange={(v) => {
                  const next = { ...store, noSplitDirective: v === true };
                  onStoreChange(next);
                  saveMedRecon(next);
                }}
                className="mt-0.5"
              />
              <span>
                <span className="font-semibold">No-splitting directive:</span> any dose form that cannot
                be administered as dispensed is escalated to the prescriber for re-issue — never divided
                at the kitchen counter.
              </span>
            </label>
            <label className="flex items-start gap-2">
              <Checkbox
                checked={store.prnProtocol}
                onCheckedChange={(v) => {
                  const next = { ...store, prnProtocol: v === true };
                  onStoreChange(next);
                  saveMedRecon(next);
                }}
                className="mt-0.5"
              />
              <span>
                <span className="font-semibold">PRN protocol with window authority:</span> carers
                empowered (and required) to offer PRN analgesia against defined criteria within any
                visit; GP pain review triggered when PRN use crosses a threshold.
              </span>
            </label>
            <Button size="sm" variant="outline" onClick={exportAudit} className="mt-1">
              Export monthly audit (CSV)
            </Button>
            <p className="text-xs text-muted-foreground">
              The PRN-declined metric in Alerts already provides the trigger data for the GP pain review.
            </p>
          </CardContent>
        </Card>
      </div>

      {/* structured exceptions */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center justify-between gap-2 text-base">
            <span>Structured eMAR exception flags</span>
            <Badge variant={open.length ? "destructive" : "outline"} className="text-[10px]">
              {open.length} open
            </Badge>
          </CardTitle>
          <CardDescription>
            “No medication in blister” and “duplicate pack found” become structured flags here rather
            than free-text discoveries — so the pattern surfaces on day two, not month eleven.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2 rounded-xl border bg-teal-50/40 p-3 sm:grid-cols-2 dark:bg-teal-950/10">
            <div>
              <Label>Exception type</Label>
              <Select value={type} onValueChange={(v) => setType(v as MedExceptionType)}>
                <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(TYPE_META) as MedExceptionType[]).map((t) => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="mr-date">Date</Label>
              <Input id="mr-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mt-1.5" />
            </div>
            <div>
              <Label htmlFor="mr-med">Medication / dose (optional)</Label>
              <Input id="mr-med" value={med} onChange={(e) => setMed(e.target.value)} className="mt-1.5" placeholder="e.g. evening Nomad" />
            </div>
            <div>
              <Label htmlFor="mr-action">Action taken</Label>
              <Input id="mr-action" value={action} onChange={(e) => setAction(e.target.value)} className="mt-1.5" placeholder="what was done, who was informed" />
            </div>
            <div className="sm:col-span-2">
              <Button size="sm" className="bg-teal-800 hover:bg-teal-700" disabled={!action.trim()} onClick={addException}>
                <Plus className="mr-1.5 h-3.5 w-3.5" /> Log exception
              </Button>
            </div>
          </div>

          <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
            {exceptions.map((e) => {
              const meta = TYPE_META[e.type];
              const Icon = meta.icon;
              return (
                <div key={e.id} className={`flex items-start gap-2.5 rounded-lg border p-2.5 text-sm ${meta.tone} ${e.resolved ? "opacity-70" : ""}`}>
                  <Icon className="mt-0.5 h-4 w-4 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">
                      {e.type}
                      {e.med ? ` — ${e.med}` : ""}
                      {e.resolved && <Badge variant="outline" className="ml-2 border-emerald-300 text-[10px] text-emerald-800">resolved</Badge>}
                    </p>
                    <p className="text-xs text-muted-foreground">{e.date} · logged by {e.loggedBy}</p>
                    <p className="mt-0.5 text-xs text-foreground/85">{e.actionTaken}</p>
                  </div>
                  <div className="flex shrink-0 flex-col gap-1">
                    <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]" onClick={() => resolve(e)}>
                      {e.resolved ? "re-open" : "resolve"}
                    </Button>
                    <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={() => remove(e)}>
                      <Trash2 className="mr-1 h-3 w-3" /> remove
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>

          {freeTextHits.length > 0 && (
            <div className="rounded-lg border border-amber-300/70 bg-amber-50/50 p-2.5 text-xs dark:bg-amber-950/10">
              <p className="font-semibold text-amber-900">
                {freeTextHits.length} free-text eMAR entr{freeTextHits.length === 1 ? "y" : "ies"} look like unconverted exceptions:
              </p>
              <ul className="ml-4 mt-1 list-disc space-y-0.5 text-amber-900/90">
                {freeTextHits.slice(0, 5).map((h, i) => (
                  <li key={i}>{h.date}: “{h.comments}”</li>
                ))}
                {freeTextHits.length > 5 && <li>…and {freeTextHits.length - 5} more (see the eMAR list above)</li>}
              </ul>
              <p className="mt-1 text-muted-foreground">Convert recurring patterns into structured flags above.</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
