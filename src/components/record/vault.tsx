"use client";

// Data vault — one secure place for the subject's documents: passports, birth
// certificates, LPA & court papers, care contracts, letters, AI chat exports,
// receipts. Upload → automatic text extraction → candidate facts land in the
// review queue. NOTHING enters the profile until a human confirms it, and
// every confirmed fact keeps its verbatim source quote.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Lock, Upload, FileText, Download, Trash2, Sparkles, Loader2,
  Check, X, Quote, DatabaseZap,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { type CareSubjectRecord, initialsOf } from "@/lib/subjects";
import { useWizardLauncher } from "@/components/record/wizard-engine";
import { WizardEngine } from "@/components/record/wizard-engine";

interface VaultDoc {
  id: string;
  subjectId: string;
  title: string;
  category: string;
  fileName: string;
  mimeType: string;
  size: number;
  sensitivity: string;
  uploadedBy: string;
  createdAt: string;
  hasText?: boolean;
}

interface FactRow {
  id: string;
  subjectId: string;
  documentId: string;
  key: string;
  label: string;
  value: string;
  quote: string;
  confidence: number;
  status: string;
  source: string;
}

const CATEGORIES = [
  "passport", "birth-certificate", "lpa", "court", "care-contract", "letter",
  "medical", "finance", "chat-export", "receipt", "other",
];

const SENSITIVITY_STYLE: Record<string, string> = {
  standard: "border-teal-500/40 bg-teal-950/30 text-teal-300",
  sensitive: "border-amber-500/40 bg-amber-950/30 text-amber-300",
  restricted: "border-rose-500/40 bg-rose-950/30 text-rose-300",
};

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1048576).toFixed(2)} MB`;
}

export default function Vault({ subjects, canManage }: { subjects: CareSubjectRecord[]; canManage: boolean }) {
  const [docs, setDocs] = useState<VaultDoc[]>([]);
  const [facts, setFacts] = useState<FactRow[]>([]);
  const [subjectFilter, setSubjectFilter] = useState<string>("all");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pasteTitle, setPasteTitle] = useState("");
  const [pasteCategory, setPasteCategory] = useState("chat-export");
  const [pasteText, setPasteText] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const wizard = useWizardLauncher();

  const load = useCallback(async () => {
    try {
      const [vRes, fRes] = await Promise.all([fetch("/api/vault"), fetch("/api/facts?status=pending")]);
      const vJson = (await vRes.json()) as { documents?: VaultDoc[] };
      const fJson = (await fRes.json()) as { facts?: FactRow[] };
      setDocs(vJson.documents ?? []);
      setFacts(fJson.facts ?? []);
    } catch {
      /* surfaced on upload errors */
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const uploadFile = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const fd = new FormData();
      fd.set("file", file);
      fd.set("title", file.name);
      fd.set("category", "other");
      fd.set("sensitivity", "standard");
      if (subjectFilter !== "all") fd.set("subjectId", subjectFilter);
      const res = await fetch("/api/vault", { method: "POST", body: fd });
      const json = (await res.json()) as { ok?: boolean; error?: string; document?: VaultDoc; hasText?: boolean; factsQueued?: number };
      if (!res.ok || !json.ok) {
        setError(json.error || `Upload failed (HTTP ${res.status}).`);
        return;
      }
      // auto-extract right away
      let extractNote = "";
      if (json.document && json.hasText) {
        const exRes = await fetch(`/api/vault/${json.document.id}/extract`, { method: "POST" });
        const exJson = (await exRes.json()) as { ok?: boolean; created?: number; error?: string };
        extractNote = exJson.ok ? ` ${exJson.created} fact(s) queued for review.` : ` Extraction: ${exJson.error ?? "no text found"}`;
      } else if (json.document) {
        extractNote = " No extractable text (scan/photo?) — use OCR then 'Paste text' tab.";
      }
      setNotice(`“${file.name}” stored in the vault.${extractNote}`);
      if (fileRef.current) fileRef.current.value = "";
      await load();
    } finally {
      setBusy(false);
    }
  };

  const uploadPasted = async () => {
    if (!pasteText.trim()) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/vault", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: pasteTitle || "Pasted text",
          category: pasteCategory,
          sensitivity: "sensitive",
          subjectId: subjectFilter === "all" ? "" : subjectFilter,
          pastedText: pasteText,
        }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string; document?: VaultDoc };
      if (!res.ok || !json.ok || !json.document) {
        setError(json.error || `Upload failed (HTTP ${res.status}).`);
        return;
      }
      const exRes = await fetch(`/api/vault/${json.document.id}/extract`, { method: "POST" });
      const exJson = (await exRes.json()) as { ok?: boolean; created?: number };
      setNotice(
        exJson.ok
          ? `Stored & extracted — ${exJson.created ?? 0} fact(s) queued for review below.`
          : "Stored, but extraction found no facts."
      );
      setPasteText("");
      setPasteTitle("");
      await load();
    } finally {
      setBusy(false);
    }
  };

  const extract = async (doc: VaultDoc) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/vault/${doc.id}/extract`, { method: "POST" });
      const json = (await res.json()) as { ok?: boolean; created?: number; error?: string };
      setNotice(
        json.ok
          ? `“${doc.title}”: ${json.created ?? 0} new fact(s) queued for review.`
          : (json.error ?? "Extraction failed.")
      );
      await load();
    } finally {
      setBusy(false);
    }
  };

  const decide = async (fact: FactRow, status: "confirmed" | "rejected") => {
    await fetch("/api/facts", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: fact.id, status }),
    });
    await load();
  };

  const removeDoc = async (doc: VaultDoc) => {
    if (!confirm(`Delete “${doc.title}” from the vault? Its queued facts are removed too.`)) return;
    await fetch(`/api/vault/${doc.id}`, { method: "DELETE" });
    await load();
  };

  const download = async (doc: VaultDoc) => {
    // audited download: go through fetch so failures are visible in-page
    const res = await fetch(`/api/vault/${doc.id}`);
    if (!res.ok) {
      setError("Download failed — the stored file may have been removed.");
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = doc.fileName || doc.title;
    a.click();
    URL.revokeObjectURL(url);
  };

  const visibleDocs = subjectFilter === "all" ? docs : docs.filter((d) => d.subjectId === subjectFilter);
  const visibleFacts = subjectFilter === "all" ? facts : facts.filter((f) => f.subjectId === subjectFilter);
  const subjectName = (id: string) => subjects.find((s) => s.id === id)?.displayName ?? "—";

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-wrap items-center gap-3">
          <Lock className="h-5 w-5 text-teal-300" />
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-bold">Data vault</h2>
            <p className="text-xs text-muted-foreground">
              Passports, birth certificates, LPA &amp; court papers, AI chat exports, receipts. Stored server-side,
              access-logged, and gated behind the sign-in. Extraction is deterministic (MRZ checksums, field parsers) —
              every fact keeps its source quote and waits for human confirmation.
            </p>
          </div>
          <Select value={subjectFilter} onValueChange={setSubjectFilter}>
            <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All service users</SelectItem>
              {subjects.map((s) => (
                <SelectItem key={s.id} value={s.id}>{s.displayName}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {canManage && (
            <Button
              size="sm"
              className="bg-teal-700 text-white hover:bg-teal-600"
              onClick={() => wizard.launch("document-intake")}
            >
              <DatabaseZap className="mr-2 h-4 w-4" /> Guided intake
            </Button>
          )}
        </CardContent>
      </Card>

      {notice && <p className="rounded-lg border border-emerald-500/40 bg-emerald-950/30 p-2.5 text-sm text-emerald-200">{notice}</p>}
      {error && <p className="rounded-lg border border-rose-500/40 bg-rose-950/30 p-2.5 text-sm text-rose-200" role="alert">{error}</p>}

      {canManage && (
        <Tabs defaultValue="file">
          <TabsList>
            <TabsTrigger value="file">Upload a file</TabsTrigger>
            <TabsTrigger value="paste">Paste text / chat</TabsTrigger>
          </TabsList>
          <TabsContent value="file">
            <Card>
              <CardContent className="flex flex-wrap items-end gap-3">
                <div className="min-w-64 flex-1 space-y-1.5">
                  <Label className="text-xs">Choose a file (up to 8 MB)</Label>
                  <Input ref={fileRef} type="file" />
                  <p className="text-[11px] text-muted-foreground">
                    Text-ish files extract automatically. Scans and photos need OCR first — run OCR on your device, then
                    use “Paste text”.
                  </p>
                </div>
                <Button className="bg-teal-700 text-white hover:bg-teal-600" onClick={() => void uploadFile()} disabled={busy}>
                  {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                  Upload to vault
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="paste">
            <Card>
              <CardContent className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Title</Label>
                    <Input value={pasteTitle} onChange={(e) => setPasteTitle(e.target.value)} placeholder="e.g. Chat with AI about CHC funding" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Category</Label>
                    <Select value={pasteCategory} onValueChange={setPasteCategory}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {CATEGORIES.map((c) => (
                          <SelectItem key={c} value={c}>{c.replace(/-/g, " ")}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Paste the text (AI chat transcript, letter, assessment…)</Label>
                  <Textarea rows={7} value={pasteText} onChange={(e) => setPasteText(e.target.value)} placeholder={"user: What is CHC funding?\nassistant: NHS Continuing Healthcare is…"} />
                  <p className="text-[11px] text-muted-foreground">
                    Chat exports (user:/assistant: lines, ChatGPT JSON) are parsed into a conversation; dates, contacts,
                    NHS numbers, medications and decisions are queued as facts.
                  </p>
                </div>
                <Button className="bg-teal-700 text-white hover:bg-teal-600" onClick={() => void uploadPasted()} disabled={busy || !pasteText.trim()}>
                  {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                  Store &amp; extract
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}

      {/* fact review queue */}
      <Card className="border-amber-800/50">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Quote className="h-4 w-4 text-amber-300" /> Fact review queue
            <Badge variant="outline" className="text-[10px] text-muted-foreground">{visibleFacts.length} pending</Badge>
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Confirm to add the fact to the subject&apos;s profile (with its quote) — reject to discard. Nothing is
            auto-applied.
          </p>
        </CardHeader>
        <CardContent>
          {visibleFacts.length === 0 ? (
            <p className="text-sm text-muted-foreground">Queue is clear.</p>
          ) : (
            <ul className="space-y-2">
              {visibleFacts.map((f) => (
                <li key={f.id} className="rounded-lg border p-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="text-[11px]">{f.label}</Badge>
                    <span className="text-sm font-semibold">{f.value}</span>
                    <Badge variant="outline" className="text-[10px] text-muted-foreground">
                      {f.source} · {Math.round(f.confidence * 100)}%
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {subjectName(f.subjectId)} · {docs.find((d) => d.id === f.documentId)?.title ?? "deleted doc"}
                    </span>
                    {canManage && (
                      <span className="ml-auto flex gap-1.5">
                        <Button size="sm" variant="outline" className="h-7 border-emerald-600/50 px-2 text-emerald-300 hover:bg-emerald-950/40" onClick={() => void decide(f, "confirmed")}>
                          <Check className="mr-1 h-3.5 w-3.5" /> Confirm
                        </Button>
                        <Button size="sm" variant="outline" className="h-7 border-rose-600/50 px-2 text-rose-300 hover:bg-rose-950/40" onClick={() => void decide(f, "rejected")}>
                          <X className="mr-1 h-3.5 w-3.5" /> Reject
                        </Button>
                      </span>
                    )}
                  </div>
                  {f.quote && (
                    <p className="mt-1.5 flex items-start gap-1 text-xs italic text-muted-foreground">
                      <Quote className="mt-0.5 h-3 w-3 shrink-0" /> “{f.quote}”
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* document list */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <FileText className="h-4 w-4 text-teal-300" /> Vault contents
            <Badge variant="outline" className="text-[10px] text-muted-foreground">{visibleDocs.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {visibleDocs.length === 0 ? (
            <p className="text-sm text-muted-foreground">Empty — upload the first document above.</p>
          ) : (
            <ul className="space-y-2">
              {visibleDocs.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center gap-2 rounded-lg border p-2.5">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-teal-900 text-xs font-bold text-teal-200">
                    {initialsOf(d.title)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{d.title}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {subjectName(d.subjectId)} · {d.category.replace(/-/g, " ")} · {fmtBytes(d.size)} · uploaded by{" "}
                      {d.uploadedBy || "family"} · {new Date(d.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                  <Badge variant="outline" className={`text-[10px] capitalize ${SENSITIVITY_STYLE[d.sensitivity] ?? ""}`}>
                    {d.sensitivity}
                  </Badge>
                  {canManage && (
                    <>
                      <Button size="sm" variant="outline" className="h-7 px-2" title="Re-run extraction" onClick={() => void extract(d)} disabled={busy}>
                        <Sparkles className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="sm" variant="outline" className="h-7 px-2" title="Download" onClick={() => void download(d)}>
                        <Download className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="sm" variant="outline" className="h-7 px-2 text-rose-300 hover:bg-rose-950/40" title="Delete" onClick={() => void removeDoc(d)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

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
                  onDone={(r) => {
                    wizard.setOpen(false);
                    setNotice(r.message);
                    void load();
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
