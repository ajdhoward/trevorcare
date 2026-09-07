"use client";

// Wizard studio — the framework's editor. Every wizard in the hub (including
// the system ones powering add-service-user, OPG receipts, LPA registration
// and document intake) is DATA. Here you can reshape steps, add/remove/reorder
// fields, change types and hints, and create brand-new wizards. A preview
// renders exactly what users will see. Saving bumps the definition version —
// no code changes, no redeploy.

import { useCallback, useEffect, useState } from "react";
import { Wand2, Loader2, Plus, Trash2, ArrowUp, ArrowDown, Eye, EyeOff, Save } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { type WizardDefData, type WizardStep, type WizardField, type WizardFieldType } from "@/lib/wizards";
import { WizardEngine, type SubjectOption } from "@/components/record/wizard-engine";
import { type CareSubjectRecord } from "@/lib/subjects";

const FIELD_TYPES: WizardFieldType[] = ["text", "textarea", "number", "date", "select", "checkbox", "password"];

export default function WizardStudio({ subjects, canManage }: { subjects: CareSubjectRecord[]; canManage: boolean }) {
  const [wizards, setWizards] = useState<WizardDefData[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<WizardDefData | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  const [newWizard, setNewWizard] = useState({ key: "", title: "" });

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/wizards");
      const json = (await res.json()) as { wizards?: WizardDefData[] };
      setWizards(json.wizards ?? []);
      if (json.wizards?.length && !selectedId) {
        setSelectedId(json.wizards[0].id);
        setDraft(structuredClone(json.wizards[0]));
      }
    } catch {
      /* surfaced on save */
    }
  }, [selectedId]);

  useEffect(() => {
    void load();
  }, [load]);

  const select = (id: string) => {
    const w = wizards.find((x) => x.id === id);
    setSelectedId(id);
    setDraft(w ? structuredClone(w) : null);
    setDirty(false);
    setError(null);
  };

  const patchStep = (idx: number, patch: Partial<WizardStep>) => {
    if (!draft) return;
    const steps = draft.steps.map((s, i) => (i === idx ? { ...s, ...patch } : s));
    setDraft({ ...draft, steps });
    setDirty(true);
  };
  const patchField = (stepIdx: number, fieldIdx: number, patch: Partial<WizardField>) => {
    if (!draft) return;
    const steps = draft.steps.map((s, si) =>
      si === stepIdx ? { ...s, fields: s.fields.map((f, fi) => (fi === fieldIdx ? { ...f, ...patch } : f)) } : s
    );
    setDraft({ ...draft, steps });
    setDirty(true);
  };
  const addStep = () => {
    if (!draft) return;
    setDraft({ ...draft, steps: [...draft.steps, { id: `step-${draft.steps.length + 1}`, title: "New step", fields: [{ id: "field1", label: "Question", type: "text" }] }] });
    setDirty(true);
  };
  const removeStep = (idx: number) => {
    if (!draft || draft.steps.length <= 1) return;
    setDraft({ ...draft, steps: draft.steps.filter((_, i) => i !== idx) });
    setDirty(true);
  };
  const moveStep = (idx: number, dir: -1 | 1) => {
    if (!draft) return;
    const j = idx + dir;
    if (j < 0 || j >= draft.steps.length) return;
    const steps = [...draft.steps];
    [steps[idx], steps[j]] = [steps[j], steps[idx]];
    setDraft({ ...draft, steps });
    setDirty(true);
  };
  const addField = (stepIdx: number) => {
    if (!draft) return;
    const step = draft.steps[stepIdx];
    patchStep(stepIdx, { fields: [...step.fields, { id: `field-${step.fields.length + 1}`, label: "New question", type: "text" }] });
  };
  const removeField = (stepIdx: number, fieldIdx: number) => {
    if (!draft) return;
    const step = draft.steps[stepIdx];
    if (step.fields.length <= 1) return;
    patchStep(stepIdx, { fields: step.fields.filter((_, i) => i !== fieldIdx) });
  };

  const save = async () => {
    if (!draft) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/wizards/${draft.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: draft.title, description: draft.description, steps: draft.steps }),
      });
      const json = (await res.json()) as { ok?: boolean; wizard?: WizardDefData; error?: string };
      if (!res.ok || !json.ok || !json.wizard) {
        setError(json.error ?? `Save failed (HTTP ${res.status}).`);
        return;
      }
      setDraft(structuredClone(json.wizard));
      setDirty(false);
      setNotice(`Saved — “${json.wizard.title}” is now v${json.wizard.version}. Every user of the hub gets the new flow immediately.`);
      await load();
      setSelectedId(json.wizard.id);
    } finally {
      setBusy(false);
    }
  };

  const createWizard = async () => {
    const key = newWizard.key.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-");
    if (!key || !newWizard.title.trim()) {
      setError("A new wizard needs a key and a title.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/wizards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key,
          title: newWizard.title,
          description: "Created in the wizard studio.",
          steps: [{ id: "step-1", title: "First step", fields: [{ id: "field-1", label: "First question", type: "text" }] }],
        }),
      });
      const json = (await res.json()) as { ok?: boolean; wizard?: WizardDefData; error?: string };
      if (!json.ok || !json.wizard) {
        setError(json.error ?? "Could not create the wizard.");
        return;
      }
      setNewWizard({ key: "", title: "" });
      await load();
      select(json.wizard.id);
      setNotice(`Wizard “${json.wizard.title}” created.`);
    } finally {
      setBusy(false);
    }
  };

  const subjectOptions: SubjectOption[] = subjects.map((s) => ({ id: s.id, displayName: s.displayName }));

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-wrap items-center gap-3">
          <Wand2 className="h-5 w-5 text-teal-300" />
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-bold">Wizard studio</h2>
            <p className="text-xs text-muted-foreground">
              Wizards are data, not code: reshape any flow, reorder steps, add fields, or create new wizards. Changes
              apply hub-wide the moment they save.
            </p>
          </div>
          {draft && (
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setPreview(!preview)}>
                {preview ? <EyeOff className="mr-2 h-4 w-4" /> : <Eye className="mr-2 h-4 w-4" />}
                {preview ? "Edit" : "Preview"}
              </Button>
              <Button size="sm" className="bg-teal-700 text-white hover:bg-teal-600" onClick={() => void save()} disabled={busy || !dirty || !canManage}>
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                Save {dirty ? "changes" : ""}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {notice && <p className="rounded-lg border border-emerald-500/40 bg-emerald-950/30 p-2.5 text-sm text-emerald-200">{notice}</p>}
      {error && <p className="rounded-lg border border-rose-500/40 bg-rose-950/30 p-2.5 text-sm text-rose-200" role="alert">{error}</p>}

      {!canManage ? (
        <Card>
          <CardContent className="py-6 text-sm text-muted-foreground">
            The studio is administrator-only. You can preview definitions but not change them.
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardContent className="flex flex-wrap items-center gap-2">
              {wizards.map((w) => (
                <Button
                  key={w.id}
                  size="sm"
                  variant={selectedId === w.id ? "default" : "outline"}
                  className={selectedId === w.id ? "bg-teal-700 text-white" : ""}
                  onClick={() => select(w.id)}
                >
                  {w.title}
                  {w.system && <Badge variant="outline" className="ml-2 text-[9px] text-muted-foreground">system</Badge>}
                  <span className="ml-1 text-[10px] text-muted-foreground">v{w.version}</span>
                </Button>
              ))}
            </CardContent>
          </Card>

          {draft && (
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="space-y-3">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Definition</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2.5">
                    <div className="space-y-1">
                      <Label className="text-xs">Title</Label>
                      <Input value={draft.title} onChange={(e) => { setDraft({ ...draft, title: e.target.value }); setDirty(true); }} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Description</Label>
                      <Textarea rows={2} value={draft.description} onChange={(e) => { setDraft({ ...draft, description: e.target.value }); setDirty(true); }} />
                    </div>
                    <p className="text-[11px] text-muted-foreground">Key: <code>{draft.key}</code></p>
                  </CardContent>
                </Card>

                {draft.steps.map((step, si) => (
                  <Card key={si}>
                    <CardHeader className="pb-2">
                      <CardTitle className="flex items-center gap-2 text-sm">
                        Step {si + 1}
                        <span className="ml-auto flex gap-1">
                          <Button size="sm" variant="outline" className="h-6 w-6 p-0" onClick={() => moveStep(si, -1)}><ArrowUp className="h-3 w-3" /></Button>
                          <Button size="sm" variant="outline" className="h-6 w-6 p-0" onClick={() => moveStep(si, 1)}><ArrowDown className="h-3 w-3" /></Button>
                          <Button size="sm" variant="outline" className="h-6 w-6 p-0" onClick={() => removeStep(si)}><Trash2 className="h-3 w-3" /></Button>
                        </span>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2.5">
                      <Input value={step.title} onChange={(e) => patchStep(si, { title: e.target.value })} placeholder="Step title" />
                      {step.fields.map((f, fi) => (
                        <div key={fi} className="grid gap-2 rounded-lg border p-2.5 sm:grid-cols-2">
                          <Input value={f.label} onChange={(e) => patchField(si, fi, { label: e.target.value })} placeholder="Field label" />
                          <Select value={f.type} onValueChange={(v) => patchField(si, fi, { type: v as WizardFieldType })}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {FIELD_TYPES.map((t) => (
                                <SelectItem key={t} value={t}>{t}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Input value={(f.options ?? []).join(",")} onChange={(e) => patchField(si, fi, { options: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })} placeholder="options, comma, separated (@subjects = people)" />
                          <Input value={f.help ?? ""} onChange={(e) => patchField(si, fi, { help: e.target.value })} placeholder="help text (optional)" />
                          <div className="flex items-center gap-2 sm:col-span-2">
                            <Switch checked={!!f.required} onCheckedChange={(v) => patchField(si, fi, { required: v })} id={`req-${si}-${fi}`} />
                            <Label htmlFor={`req-${si}-${fi}`} className="text-xs font-normal">Required</Label>
                            <Button size="sm" variant="outline" className="ml-auto h-7 px-2 text-rose-300 hover:bg-rose-950/40" onClick={() => removeField(si, fi)}>
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                      ))}
                      <Button size="sm" variant="outline" onClick={() => addField(si)}>
                        <Plus className="mr-1 h-3.5 w-3.5" /> Add field
                      </Button>
                    </CardContent>
                  </Card>
                ))}
                <Button size="sm" variant="outline" onClick={addStep}>
                  <Plus className="mr-2 h-4 w-4" /> Add step
                </Button>
              </div>

              <div>
                {preview ? (
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">Live preview — {draft.title}</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <WizardEngine
                        key={`${draft.id}-preview`}
                        def={draft}
                        subjects={subjectOptions}
                        onDone={() => setNotice("Preview only — the preview run does not submit.")}
                      />
                    </CardContent>
                  </Card>
                ) : (
                  <Card>
                    <CardContent className="pt-6 text-xs leading-relaxed text-muted-foreground">
                      <p className="mb-2 font-semibold text-foreground">How the framework works</p>
                      <ul className="list-disc space-y-1.5 pl-4">
                        <li>The runtime renders ANY definition: steps in order, fields by type, required checks, then a submit mapped to the wizard&apos;s bound action.</li>
                        <li>System wizards are bound to actions: <code>add-service-user</code> creates a person, <code>opg-receipt</code> writes a ledger entry, <code>lpa-setup</code> registers an instrument, <code>document-intake</code> stores &amp; extracts, and <code>connect-ai-gateway</code> routes the AI assistant through your Cloudflare AI Gateway (client-side — secrets stay in the browser).</li>
                        <li>New wizards (custom keys) complete as recorded runs — bind an action when you&apos;re ready, or use them as structured checklists today.</li>
                        <li>Option lists containing <code>@subjects</code> automatically render the live service-user registry.</li>
                        <li>Saving bumps the version — nothing is destructively overwritten, and the previous shape stays in your git history.</li>
                      </ul>
                    </CardContent>
                  </Card>
                )}
                <Card className="mt-3">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Create a new wizard</CardTitle>
                  </CardHeader>
                  <CardContent className="grid gap-2 sm:grid-cols-3">
                    <Input value={newWizard.key} onChange={(e) => setNewWizard({ ...newWizard, key: e.target.value })} placeholder="key e.g. dwp-appeal" />
                    <Input value={newWizard.title} onChange={(e) => setNewWizard({ ...newWizard, title: e.target.value })} placeholder="Title" />
                    <Button size="sm" variant="outline" onClick={() => void createWizard()} disabled={busy}>
                      <Plus className="mr-2 h-4 w-4" /> Create
                    </Button>
                  </CardContent>
                </Card>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
