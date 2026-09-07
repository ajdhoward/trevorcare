"use client";

// Finances — the money ledger for each service user's affairs: income &
// expenditure with categories, OPG receipt uploads (linked to the data vault)
// and a printable deputyship/LPA reporting period summary. Every entry flagged
// OPG-reportable rolls up into the OPG evidence totals.

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Banknote, ReceiptText, Loader2, Plus, Trash2, Printer, Download } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { type CareSubjectRecord } from "@/lib/subjects";
import { useWizardLauncher } from "@/components/record/wizard-engine";
import { WizardEngine } from "@/components/record/wizard-engine";

interface FinanceEntryRow {
  id: string;
  subjectId: string;
  date: string;
  type: string;
  category: string;
  description: string;
  amount: number;
  receiptId: string;
  opgReportable: boolean;
  notes: string;
  createdBy: string;
}

const EXPENSE_CATEGORIES = ["care-fees", "household", "utilities", "council-tax", "medical", "transport", "clothing", "personal", "insurance", "other"];
const INCOME_CATEGORIES = ["pension", "attendance-allowance", "benefits", "savings-interest", "rental", "other"];
const gbp = (n: number) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);

export default function Finances({ subjects, canManage, actorName }: { subjects: CareSubjectRecord[]; canManage: boolean; actorName?: string }) {
  const [entries, setEntries] = useState<FinanceEntryRow[]>([]);
  const [subjectId, setSubjectId] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ date: new Date().toISOString().slice(0, 10), type: "expense", category: "care-fees", description: "", amount: "", notes: "", opgReportable: true });
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const wizard = useWizardLauncher();

  const load = useCallback(async (sid: string) => {
    try {
      const res = await fetch(`/api/finance${sid ? `?subjectId=${encodeURIComponent(sid)}` : ""}`);
      const json = (await res.json()) as { entries?: FinanceEntryRow[] };
      setEntries(json.entries ?? []);
    } catch {
      /* surfaced on save */
    }
  }, []);

  useEffect(() => {
    if (!subjectId && subjects.length) setSubjectId(subjects[0].id);
  }, [subjects, subjectId]);

  useEffect(() => {
    void load(subjectId);
  }, [subjectId, load]);

  const totals = useMemo(() => {
    return entries.reduce(
      (acc, e) => {
        if (e.type === "income") acc.income += e.amount;
        else acc.expenses += e.amount;
        if (e.opgReportable) acc.opg += e.type === "expense" ? e.amount : -e.amount;
        acc.withReceipts += e.receiptId ? 1 : 0;
        return acc;
      },
      { income: 0, expenses: 0, opg: 0, withReceipts: 0 }
    );
  }, [entries]);

  const byCategory = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of entries) {
      if (e.type !== "expense") continue;
      map.set(e.category, (map.get(e.category) ?? 0) + e.amount);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [entries]);

  const add = async (ev?: FormEvent) => {
    ev?.preventDefault();
    if (!form.description.trim() || !Number(form.amount) || !subjectId) {
      setError("Description, amount and a service user are required.");
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/finance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, amount: Number(form.amount), subjectId }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string; entry?: FinanceEntryRow };
      if (!res.ok || !json.ok || !json.entry) {
        setError(json.error || `Save failed (HTTP ${res.status}).`);
        return;
      }
      // attach the receipt as a vault document, linked to the entry
      if (receiptFile) {
        const fd = new FormData();
        fd.set("file", receiptFile);
        fd.set("title", `Receipt — ${form.description.slice(0, 60)}`);
        fd.set("category", "receipt");
        fd.set("sensitivity", "standard");
        fd.set("subjectId", subjectId);
        const vRes = await fetch("/api/vault", { method: "POST", body: fd });
        const vJson = (await vRes.json()) as { ok?: boolean; document?: { id: string } };
        if (vJson.ok && vJson.document) {
          await fetch(`/api/finance/${json.entry.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ receiptId: vJson.document.id }),
          });
          setNotice(`Entry saved and receipt “${receiptFile.name}” linked in the vault (OPG evidence).`);
        } else {
          setNotice("Entry saved, but the receipt upload failed — you can attach it later from the vault.");
        }
      } else {
        setNotice("Entry saved to the ledger.");
      }
      setForm({ ...form, description: "", amount: "", notes: "" });
      setReceiptFile(null);
      await load(subjectId);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (e: FinanceEntryRow) => {
    if (!confirm(`Delete “${e.description}” (${gbp(e.amount)}) from the ledger?`)) return;
    await fetch(`/api/finance/${e.id}`, { method: "DELETE" });
    await load(subjectId);
  };

  const exportCsv = () => {
    const rows = [["date", "type", "category", "description", "amount", "opgReportable", "hasReceipt", "notes", "recordedBy"]];
    for (const e of entries) {
      rows.push([e.date, e.type, e.category, e.description, String(e.amount), e.opgReportable ? "yes" : "no", e.receiptId ? "yes" : "no", e.notes.replace(/"/g, "'"), e.createdBy]);
    }
    const csv = rows.map((r) => r.map((c) => `"${c}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `opg-money-report-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const subject = subjects.find((s) => s.id === subjectId);

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-wrap items-center gap-3">
          <Banknote className="h-5 w-5 text-teal-300" />
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-bold">Finances &amp; OPG receipts</h2>
            <p className="text-xs text-muted-foreground">
              The affairs ledger per service user: income, expenditure and the receipt trail the Office of the Public
              Guardian expects to see from attorneys and deputies.
            </p>
          </div>
          <Select value={subjectId} onValueChange={setSubjectId}>
            <SelectTrigger className="w-56"><SelectValue placeholder="Whose finances" /></SelectTrigger>
            <SelectContent>
              {subjects.map((s) => (
                <SelectItem key={s.id} value={s.id}>{s.displayName}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {canManage && (
            <Button size="sm" variant="outline" onClick={() => wizard.launch("opg-receipt")}>
              <ReceiptText className="mr-2 h-4 w-4" /> Receipt wizard
            </Button>
          )}
        </CardContent>
      </Card>

      {/* totals */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card><CardContent className="py-4"><p className="text-xs text-muted-foreground">Income (period shown)</p><p className="text-xl font-bold text-emerald-400">{gbp(totals.income)}</p></CardContent></Card>
        <Card><CardContent className="py-4"><p className="text-xs text-muted-foreground">Expenditure</p><p className="text-xl font-bold text-rose-400">{gbp(totals.expenses)}</p></CardContent></Card>
        <Card><CardContent className="py-4"><p className="text-xs text-muted-foreground">Net</p><p className={`text-xl font-bold ${totals.income - totals.expenses >= 0 ? "text-emerald-400" : "text-amber-400"}`}>{gbp(totals.income - totals.expenses)}</p></CardContent></Card>
        <Card><CardContent className="py-4"><p className="text-xs text-muted-foreground">OPG-reportable spend · receipts linked</p><p className="text-xl font-bold">{gbp(Math.abs(totals.opg))} · {totals.withReceipts}/{entries.filter((e) => e.opgReportable).length}</p></CardContent></Card>
      </div>

      {notice && <p className="rounded-lg border border-emerald-500/40 bg-emerald-950/30 p-2.5 text-sm text-emerald-200">{notice}</p>}
      {error && <p className="rounded-lg border border-rose-500/40 bg-rose-950/30 p-2.5 text-sm text-rose-200" role="alert">{error}</p>}

      {canManage && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Add a ledger entry {subject ? `for ${subject.displayName}` : ""}</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={add} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Date</Label>
                <Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Type</Label>
                <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v, category: v === "income" ? "pension" : "care-fees" })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="expense">Money out (expense)</SelectItem>
                    <SelectItem value="income">Money in (income)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Category</Label>
                <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(form.type === "income" ? INCOME_CATEGORIES : EXPENSE_CATEGORIES).map((c) => (
                      <SelectItem key={c} value={c}>{c.replace(/-/g, " ")}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label className="text-xs">Description</Label>
                <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="e.g. Care fees — sample invoice" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Amount (£)</Label>
                <Input type="number" step="0.01" min="0" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label className="text-xs">Notes (optional)</Label>
                <Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              </div>
              <div className="space-y-2.5">
                <Label className="text-xs">Receipt (stored in the vault, linked to this entry)</Label>
                <Input type="file" accept="image/*,.pdf" onChange={(e) => setReceiptFile(e.target.files?.[0] ?? null)} />
                <div className="flex items-center gap-2">
                  <Checkbox id="fin-opg" checked={form.opgReportable} onCheckedChange={(v) => setForm({ ...form, opgReportable: v === true })} />
                  <Label htmlFor="fin-opg" className="text-xs font-normal">OPG-reportable</Label>
                </div>
              </div>
              <div className="sm:col-span-2 lg:col-span-3">
                <Button type="submit" size="sm" className="bg-teal-700 text-white hover:bg-teal-600" disabled={busy}>
                  {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                  Record entry
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* ledger */}
      <Tabs defaultValue="ledger">
        <TabsList>
          <TabsTrigger value="ledger">Ledger</TabsTrigger>
          <TabsTrigger value="bycategory">By category</TabsTrigger>
          <TabsTrigger value="opg">OPG evidence pack</TabsTrigger>
        </TabsList>
        <TabsContent value="ledger">
          <Card>
            <CardContent>
              {entries.length === 0 ? (
                <p className="text-sm text-muted-foreground">No entries for this person yet.</p>
              ) : (
                <ul className="space-y-1.5">
                  {entries.map((e) => (
                    <li key={e.id} className="flex flex-wrap items-center gap-2 rounded-lg border p-2.5 text-sm">
                      <span className="w-24 text-xs text-muted-foreground">{e.date}</span>
                      <Badge variant="outline" className={`text-[10px] ${e.type === "income" ? "border-emerald-500/40 text-emerald-300" : "border-rose-500/40 text-rose-300"}`}>
                        {e.type}
                      </Badge>
                      <span className="min-w-0 flex-1 truncate">
                        {e.description}
                        <span className="ml-2 text-[11px] text-muted-foreground">{e.category.replace(/-/g, " ")}{e.receiptId ? " · 📎 receipt" : ""}{e.notes ? ` · ${e.notes}` : ""}</span>
                      </span>
                      <span className={`font-semibold ${e.type === "income" ? "text-emerald-400" : "text-rose-400"}`}>
                        {e.type === "income" ? "+" : "−"}
                        {gbp(e.amount)}
                      </span>
                      {canManage && (
                        <Button size="sm" variant="outline" className="h-7 px-2 text-rose-300 hover:bg-rose-950/40" onClick={() => void remove(e)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="bycategory">
          <Card>
            <CardContent className="space-y-1.5">
              {byCategory.length === 0 ? (
                <p className="text-sm text-muted-foreground">No expenditure recorded yet.</p>
              ) : (
                byCategory.map(([cat, amount]) => (
                  <div key={cat} className="flex items-center gap-3 text-sm">
                    <span className="w-40 capitalize">{cat.replace(/-/g, " ")}</span>
                    <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-teal-600" style={{ width: `${Math.round((amount / (byCategory[0]?.[1] || 1)) * 100)}%` }} />
                    </div>
                    <span className="w-24 text-right font-semibold">{gbp(amount)}</span>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="opg">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Deputyship / LPA reporting period — {subject?.displayName ?? ""}</CardTitle>
              <p className="text-xs text-muted-foreground">
                A print-ready summary of the period&apos;s affairs. OPG supervision asks for decisions made and money
                handled on the person&apos;s behalf — this pack plus the linked receipts is the core of the answer.
              </p>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="rounded-lg border p-3 text-sm">
                <p><strong>Money in:</strong> {gbp(totals.income)}</p>
                <p><strong>Money out:</strong> {gbp(totals.expenses)}</p>
                <p><strong>OPG-reportable net spend:</strong> {gbp(Math.abs(totals.opg))}</p>
                <p><strong>Receipts held in the vault:</strong> {totals.withReceipts}</p>
                <p className="mt-1 text-xs text-muted-foreground">Period: all recorded entries ({entries.length}). Filter per person above.</p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => window.print()}>
                  <Printer className="mr-2 h-4 w-4" /> Print / save as PDF
                </Button>
                <Button size="sm" variant="outline" onClick={exportCsv}>
                  <Download className="mr-2 h-4 w-4" /> Export CSV
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

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
                    void load(subjectId);
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
