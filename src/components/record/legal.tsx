"use client";

// Legal & LPA hub — the legal layer of the subject's affairs, with the LPA
// things grouped UNDER the LPA subsection: registered instruments (donor,
// attorneys, OPG reference, status), the attorney readiness checklist
// (MCA-cited), and the wider legal picture: advance decisions, wills, Court
// of Protection, s117 aftercare. Legal documents cross-link to the Data vault.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Gavel, FileBadge, Scale, BookLock, Heart, Landmark, Loader2, Plus, ShieldCheck, RefreshCw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { LPA_ITEMS, type LpaItem } from "@/lib/lpa";
import { type CareSubjectRecord } from "@/lib/subjects";
import { WizardEngine, useWizardLauncher } from "@/components/record/wizard-engine";

interface LpaInstrument {
  subjectId?: string;
  area?: string;
  status?: string;
  opgReference?: string;
  registrationDate?: string;
  attorneys?: string;
  replacementAttorneys?: string;
  certificateProvider?: string;
  decisions?: string;
  createdAt?: string;
}

interface OtherLegalItem {
  id: string;
  title: string;
  desc: string;
  ref: string;
  statusKey: string;
}

const OTHER_LEGAL: OtherLegalItem[] = [
  {
    id: "advance-decision",
    title: "Advance decision (living will)",
    desc: "Refusals of specific treatment, binding under MCA 2005 ss.24–26 when valid and applicable. Keep a copy with the GP and in the vault.",
    ref: "MCA 2005 s.24–26",
    statusKey: "legal-advance-decision",
  },
  {
    id: "advance-statement",
    title: "Advance statement (wishes & preferences)",
    desc: "Not legally binding but heavily weighted in best-interests decisions — how and where they would want to be cared for.",
    ref: "MCA 2005 s.4 best-interests checklist",
    statusKey: "legal-advance-statement",
  },
  {
    id: "will",
    title: "Will & estate",
    desc: "Where the current will is held, the executor's details, and whether it reflects the present position.",
    ref: "Wills Act 1837",
    statusKey: "legal-will",
  },
  {
    id: "cop-deputyship",
    title: "Court of Protection deputyship",
    desc: "If no LPA exists and decisions are needed, the CoP can appoint a deputy (property & affairs or personal welfare).",
    ref: "MCA 2005 s.16–19",
    statusKey: "legal-cop",
  },
  {
    id: "s117",
    title: "Section 117 aftercare",
    desc: "Free aftercare following a s.3 Mental Health Act detention — a duty on health and social care jointly, chargeable-to-nobody.",
    ref: "MHA 1983 s.117",
    statusKey: "legal-s117",
  },
];

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  signed: "Signed, not registered",
  registered: "Registered with OPG",
  active: "Registered & in use",
};

export default function Legal({
  subjects,
  canManage,
  onLaunchWizard,
}: {
  subjects: CareSubjectRecord[];
  canManage: boolean;
  onLaunchWizard?: (key: string) => void;
}) {
  const [instruments, setInstruments] = useState<LpaInstrument[]>([]);
  const [loadingReg, setLoadingReg] = useState(true);
  const [checkState, setCheckState] = useState<Record<string, boolean>>({});
  const [otherState, setOtherState] = useState<Record<string, boolean>>({});

  const loadRegistry = useCallback(async () => {
    setLoadingReg(true);
    try {
      const res = await fetch("/api/wizards");
      const json = (await res.json()) as { wizards?: Array<{ key: string; steps: string | LpaInstrument[] }> };
      const reg = json.wizards?.find((w) => w.key === "lpa-registry");
      if (reg) {
        const parsed =
          typeof reg.steps === "string" ? (JSON.parse(reg.steps) as LpaInstrument[]) : reg.steps;
        setInstruments(Array.isArray(parsed) ? parsed : []);
      }
    } catch {
      setInstruments([]);
    } finally {
      setLoadingReg(false);
    }
  }, []);

  useEffect(() => {
    void loadRegistry();
    try {
      setCheckState(JSON.parse(localStorage.getItem("legal-lpa-checklist") || "{}") as Record<string, boolean>);
      setOtherState(JSON.parse(localStorage.getItem("legal-other-items") || "{}") as Record<string, boolean>);
    } catch {
      /* fresh device */
    }
  }, [loadRegistry]);

  const toggleCheck = (id: string) => {
    setCheckState((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      try {
        localStorage.setItem("legal-lpa-checklist", JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  };
  const toggleOther = (id: string) => {
    setOtherState((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      try {
        localStorage.setItem("legal-other-items", JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  const subjectName = (id?: string) =>
    id ? subjects.find((s) => s.id === id)?.displayName ?? "Unknown person" : "—";
  const areaLabel = (a?: string) => (a === "health" ? "Health & welfare" : "Property & financial affairs");
  const byArea = useMemo(
    () => ({
      financial: instruments.filter((i) => i.area !== "health"),
      health: instruments.filter((i) => i.area === "health"),
    }),
    [instruments]
  );

  const wizard = useWizardLauncher();

  const doneCount = LPA_ITEMS.filter((i) => checkState[i.id]).length;

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-wrap items-center gap-3">
          <Gavel className="h-5 w-5 text-teal-300" />
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-bold">Legal & LPA hub</h2>
            <p className="text-xs text-muted-foreground">
              Every legal instrument for the people you care for, with the LPA things under the LPA section. Practical
              family guidance — not legal advice.
            </p>
          </div>
          {canManage && (
            <Button
              size="sm"
              className="bg-teal-700 text-white hover:bg-teal-600"
              onClick={() => (onLaunchWizard ? onLaunchWizard("lpa-setup") : wizard.launch("lpa-setup"))}
            >
              <Plus className="mr-2 h-4 w-4" /> Register an LPA
            </Button>
          )}
        </CardContent>
      </Card>

      {/* ---------- LPA section ---------- */}
      <Card className="border-teal-800/60">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <FileBadge className="h-4 w-4 text-teal-300" /> LPA — Lasting Powers of Attorney
            <Badge variant="outline" className="text-[10px] text-muted-foreground">MCA 2005 s.9–11 · OPG</Badge>
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            One row per instrument. Donor = the person the LPA is about; attorneys act for them once registered.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          {loadingReg ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading the LPA register…
            </p>
          ) : instruments.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No instruments registered yet — use “Register an LPA” above. Don&apos;t have LPAs? See Court of Protection
              deputyship below.
            </p>
          ) : (
            <div className="space-y-2">
              {[...byArea.financial, ...byArea.health].map((inst, i) => (
                <div key={i} className="rounded-lg border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="text-[11px]">
                      {areaLabel(inst.area)}
                    </Badge>
                    <Badge
                      variant="outline"
                      className={
                        inst.status === "active" || inst.status === "registered"
                          ? "border-emerald-500/40 bg-emerald-950/30 text-[11px] text-emerald-300"
                          : "border-amber-500/40 bg-amber-950/30 text-[11px] text-amber-300"
                      }
                    >
                      {STATUS_LABELS[inst.status ?? "draft"] ?? inst.status}
                    </Badge>
                    <span className="text-sm font-semibold">{subjectName(inst.subjectId)}</span>
                    {inst.opgReference && (
                      <span className="ml-auto text-xs text-muted-foreground">OPG ref: {inst.opgReference}</span>
                    )}
                  </div>
                  <div className="mt-2 grid gap-x-4 gap-y-1 text-xs text-muted-foreground sm:grid-cols-2">
                    <span>Attorneys: <span className="text-foreground">{inst.attorneys || "—"}</span></span>
                    <span>Replacement: <span className="text-foreground">{inst.replacementAttorneys || "—"}</span></span>
                    <span>Certificate provider: <span className="text-foreground">{inst.certificateProvider || "—"}</span></span>
                    <span>Registered: <span className="text-foreground">{inst.registrationDate || "—"}</span></span>
                  </div>
                  {inst.decisions && (
                    <p className="mt-2 rounded-md bg-muted/40 p-2 text-xs leading-relaxed">{inst.decisions}</p>
                  )}
                </div>
              ))}
            </div>
          )}

          <Separator />

          {/* LPA checklist under the LPA section */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold">Attorney readiness checklist</h3>
              <Badge variant="outline" className="text-[11px]">
                {doneCount}/{LPA_ITEMS.length} done
              </Badge>
            </div>
            <p className="mb-3 text-xs text-muted-foreground">
              The things an attorney should have in place, grouped by the LPA area they belong to. Ticked items persist
              on this device.
            </p>
            <div className="space-y-4">
              {(["financial", "health"] as const).map((area) => (
                <div key={area}>
                  <h4 className="mb-1.5 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                    {area === "financial" ? "Property & financial affairs" : "Health & welfare"}
                  </h4>
                  <ul className="space-y-1.5">
                    {LPA_ITEMS.filter((it) => it.area === area).map((it: LpaItem) => (
                      <li key={it.id} className="flex items-start gap-2 rounded-lg border p-2.5">
                        <Checkbox
                          id={`lpachk-${it.id}`}
                          className="mt-0.5"
                          checked={!!checkState[it.id]}
                          onCheckedChange={() => toggleCheck(it.id)}
                        />
                        <div className="min-w-0">
                          <Label htmlFor={`lpachk-${it.id}`} className="cursor-pointer text-sm font-normal leading-snug">
                            {it.text}
                          </Label>
                          <p className="mt-0.5 text-xs text-muted-foreground">{it.why}</p>
                          <p className="mt-0.5 text-[11px] italic text-muted-foreground/80">{it.ref}</p>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ---------- wider legal picture ---------- */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Scale className="h-4 w-4 text-teal-300" /> The wider legal picture
          </CardTitle>
          <p className="text-xs text-muted-foreground">The other instruments that matter alongside the LPAs.</p>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          {OTHER_LEGAL.map((item) => {
            const Icon =
              item.id === "advance-decision" ? Heart : item.id === "s117" ? Landmark : item.id === "cop-deputyship" ? ShieldCheck : BookLock;
            return (
              <div key={item.id} className="rounded-lg border p-3">
                <div className="flex items-center gap-2">
                  <Icon className="h-4 w-4 text-teal-300" />
                  <span className="text-sm font-semibold">{item.title}</span>
                  <div className="ml-auto flex items-center gap-2">
                    <span className="text-[11px] text-muted-foreground">In place?</span>
                    <Checkbox checked={!!otherState[item.id]} onCheckedChange={() => toggleOther(item.id)} disabled={!canManage} />
                  </div>
                </div>
                <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{item.desc}</p>
                <p className="mt-1 text-[11px] italic text-muted-foreground/80">{item.ref}</p>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <RefreshCw className="h-3.5 w-3.5" />
          Certified copies: each organisation (bank, DWP, care home) usually wants its own certified copy of a registered
          LPA — keep a note of who holds which. Originals stay with the attorneys.
          <Button variant="outline" size="sm" className="ml-auto" onClick={() => void loadRegistry()} disabled={loadingReg}>
            Refresh register
          </Button>
        </CardContent>
      </Card>

      {/* wizard dialog (fallback when the page-level launcher isn't wired) */}
      {wizard.def && wizard.open && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={() => wizard.setOpen(false)}>
          <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">{wizard.def.title}</CardTitle>
                <p className="text-xs text-muted-foreground">{wizard.def.description}</p>
              </CardHeader>
              <CardContent>
                <WizardEngine
                  def={wizard.def}
                  subjects={wizard.subjects}
                  onDone={() => {
                    wizard.setOpen(false);
                    void loadRegistry();
                  }}
                />
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
