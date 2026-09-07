"use client";

// Wizard RUNTIME — renders any WizardDef from the framework (steps → fields →
// summary → submit). The wizard definition is data; this engine never needs to
// change when a wizard is edited in the Wizard Studio. Field type "@subjects"
// options are resolved from the service-user registry.

import { useEffect, useMemo, useState } from "react";
import { Loader2, ArrowRight, ArrowLeft, Check, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import type { WizardDefData, WizardField } from "@/lib/wizards";
import { type CareSubjectRecord } from "@/lib/subjects";

export interface SubjectOption {
  id: string;
  displayName: string;
}

function FieldInput({
  field, value, onChange, subjects,
}: {
  field: WizardField;
  value: string | boolean;
  onChange: (v: string | boolean) => void;
  subjects: SubjectOption[];
}) {
  if (field.type === "checkbox") {
    return (
      <div className="flex items-center gap-2">
        <Checkbox id={`wf-${field.id}`} checked={value === true} onCheckedChange={(v) => onChange(v === true)} />
        <Label htmlFor={`wf-${field.id}`} className="cursor-pointer text-sm font-normal">{field.label}</Label>
      </div>
    );
  }
  return (
    <div className="space-y-1.5">
      <Label htmlFor={`wf-${field.id}`} className="text-sm">
        {field.label}
        {field.required && <span className="ml-1 text-rose-500">*</span>}
      </Label>
      {field.type === "textarea" && (
        <Textarea
          id={`wf-${field.id}`}
          rows={3}
          value={String(value ?? "")}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      {field.type === "select" && (
        <Select value={String(value ?? "")} onValueChange={(v) => onChange(v)}>
          <SelectTrigger id={`wf-${field.id}`}>
            <SelectValue placeholder="Choose…" />
          </SelectTrigger>
          <SelectContent>
            {(field.options ?? []).map((opt) =>
              opt === "@subjects" ? (
                subjects.length === 0 ? (
                  <SelectItem key="none" value="" disabled>
                    No service users yet — add one first
                  </SelectItem>
                ) : (
                  subjects.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.displayName}
                    </SelectItem>
                  ))
                )
              ) : (
                <SelectItem key={opt} value={opt}>
                  {opt.replace(/-/g, " ")}
                </SelectItem>
              )
            )}
          </SelectContent>
        </Select>
      )}
      {(field.type === "text" || field.type === "number" || field.type === "date") && (
        <Input
          id={`wf-${field.id}`}
          type={field.type === "number" ? "number" : field.type === "date" ? "date" : "text"}
          value={String(value ?? "")}
          placeholder={field.placeholder}
          step={field.type === "number" ? "0.01" : undefined}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      {field.help && (
        <p className="flex items-start gap-1 text-xs text-muted-foreground">
          <Info className="mt-0.5 h-3 w-3 shrink-0" /> {field.help}
        </p>
      )}
    </div>
  );
}

export function WizardEngine({
  def,
  subjects,
  onDone,
  onCancel,
}: {
  def: WizardDefData;
  subjects: SubjectOption[];
  onDone: (result: { ok: boolean; message: string; data?: Record<string, unknown> }) => void;
  onCancel?: () => void;
}) {
  const [stepIdx, setStepIdx] = useState(0);
  const [values, setValues] = useState<Record<string, string | boolean>>(() => {
    const init: Record<string, string | boolean> = {};
    for (const s of def.steps) {
      for (const f of s.fields) {
        if (f.prefill !== undefined) init[f.id] = f.prefill;
        else if (f.type === "checkbox") init[f.id] = false;
        else init[f.id] = "";
      }
    }
    return init;
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const step = def.steps[stepIdx];
  const pct = Math.round(((stepIdx + 1) / def.steps.length) * 100);

  const missing = useMemo(
    () => step.fields.filter((f) => f.required && (values[f.id] === "" || values[f.id] === undefined)),
    [step, values]
  );

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/wizard-runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wizardKey: def.key, values }),
      });
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok || json.ok !== true) {
        setError(String(json.error || `Wizard failed (HTTP ${res.status}).`));
        setBusy(false);
        return;
      }
      onDone({ ok: true, message: describeResult(def.key, json), data: json });
    } catch {
      setError("Network error — the wizard run did not reach the server.");
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            Step {stepIdx + 1} of {def.steps.length}
          </span>
          <span>{pct}%</span>
        </div>
        <Progress value={pct} className="h-1.5" />
      </div>

      <h3 className="text-base font-bold">{step.title}</h3>
      <div className="space-y-4">
        {step.fields.map((f) => (
          <FieldInput
            key={f.id}
            field={f}
            value={values[f.id] ?? ""}
            subjects={subjects}
            onChange={(v) => setValues((prev) => ({ ...prev, [f.id]: v }))}
          />
        ))}
      </div>

      {error && (
        <p className="rounded-lg border border-rose-500/40 bg-rose-950/30 p-2.5 text-sm text-rose-200" role="alert">
          {error}
        </p>
      )}

      <div className="flex items-center justify-between gap-2 pt-2">
        <div className="flex gap-2">
          {stepIdx > 0 && (
            <Button variant="outline" size="sm" onClick={() => setStepIdx((i) => i - 1)} disabled={busy}>
              <ArrowLeft className="mr-1 h-4 w-4" /> Back
            </Button>
          )}
          {onCancel && (
            <Button variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
              Cancel
            </Button>
          )}
        </div>
        {stepIdx < def.steps.length - 1 ? (
          <Button
            size="sm"
            className="bg-teal-700 text-white hover:bg-teal-600"
            disabled={missing.length > 0}
            onClick={() => setStepIdx((i) => i + 1)}
          >
            Next <ArrowRight className="ml-1 h-4 w-4" />
          </Button>
        ) : (
          <Button
            size="sm"
            className="bg-teal-700 text-white hover:bg-teal-600"
            disabled={busy || missing.length > 0}
            onClick={submit}
          >
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
            Finish
          </Button>
        )}
      </div>
      {missing.length > 0 && stepIdx === def.steps.length - 1 && (
        <p className="text-xs text-muted-foreground">Required: {missing.map((f) => f.label).join(", ")}</p>
      )}
    </div>
  );
}

function describeResult(key: string, json: Record<string, unknown>): string {
  if (key === "add-service-user") {
    const s = json.subject as { displayName?: string } | undefined;
    return `${s?.displayName ?? "The new person"} has been added — their section now appears in the navigation.`;
  }
  if (key === "opg-receipt") {
    return "Ledger entry recorded and flagged as OPG-reportable. Attach the receipt below if you have it.";
  }
  if (key === "lpa-setup") {
    return "LPA instrument registered — you can see it in the Legal & LPA hub.";
  }
  if (key === "document-intake") {
    return `Document stored in the vault. ${Number(json.factsQueued ?? 0)} fact(s) queued for review.`;
  }
  return "Wizard completed.";
}

/** Hook: fetches wizard definitions + subjects, launches the engine in a Dialog. */
export function useWizardLauncher() {
  const [open, setOpen] = useState(false);
  const [wizards, setWizards] = useState<WizardDefData[]>([]);
  const [subjects, setSubjects] = useState<SubjectOption[]>([]);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [wRes, sRes] = await Promise.all([fetch("/api/wizards"), fetch("/api/subjects")]);
      const wJson = (await wRes.json()) as { wizards?: WizardDefData[] };
      const sJson = (await sRes.json()) as { subjects?: CareSubjectRecord[] };
      setWizards(wJson.wizards ?? []);
      setSubjects((sJson.subjects ?? []).map((s) => ({ id: s.id, displayName: s.displayName })));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) void load();
  }, [open]);

  const launch = async (key: string) => {
    if (wizards.length === 0) await load();
    setActiveKey(key);
    setOpen(true);
  };

  const def = wizards.find((w) => w.key === activeKey) ?? null;

  return { open, setOpen, launch, def, subjects, loading, reloadDefs: load, wizards };
}
