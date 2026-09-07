"use client";

import { useMemo, useState } from "react";
import { Search, ChevronDown, Clock3 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  type CareRecord,
  type Visit,
  StatusChip,
  fmtDateRange,
  TONE_CLASSES,
  statusTone,
} from "@/lib/record";

const PAGE_SIZE = 25;

function VisitDetail({ visit }: { visit: Visit }) {
  const tasksByCat = useMemo(() => {
    const map = new Map<string, typeof visit.tasks>();
    for (const t of visit.tasks) {
      const k = t.c || "General";
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(t);
    }
    return Array.from(map.entries());
  }, [visit]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Planned</div>
          <div className="font-medium">
            {visit.sin || "—"} – {visit.sout || "—"}
          </div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Actual</div>
          <div className="font-medium">
            {visit.ain || "—"} – {visit.aout || "—"}
          </div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Carer</div>
          <div className="font-medium">{visit.carer || "—"}</div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Status</div>
          <StatusChip s={visit.status} />
        </div>
      </div>

      {visit.notes && (
        <div className="rounded-lg border border-teal-100 bg-teal-50/60 p-3 text-sm leading-relaxed">
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-teal-800">
            Carer notes
          </div>
          {visit.notes}
        </div>
      )}

      <Separator />

      <div>
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Tasks ({visit.tasks.length})
        </div>
        <div className="space-y-3">
          {tasksByCat.map(([cat, items]) => (
            <div key={cat}>
              {cat !== "General" && (
                <div className="mb-1 text-xs font-medium text-teal-800">{cat}</div>
              )}
              <div className="space-y-1">
                {items.map((t, i) => (
                  <div
                    key={i}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-sm"
                  >
                    <span>{t.n}</span>
                    <div className="flex items-center gap-2">
                      {t.no && (
                        <span className="max-w-56 truncate text-xs text-muted-foreground" title={t.no}>
                          {t.no}
                        </span>
                      )}
                      <StatusChip s={t.s} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {visit.meds.length > 0 && (
        <>
          <Separator />
          <div>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Medication ({visit.meds.length})
            </div>
            <div className="space-y-1">
              {visit.meds.map((m, i) => (
                <div
                  key={i}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-sm"
                >
                  <div className="min-w-0">
                    <span className="font-medium">
                      {m.n}
                      {m.p && (
                        <Badge variant="outline" className="ml-1.5 border-amber-200 bg-amber-50 text-amber-800">
                          PRN
                        </Badge>
                      )}
                    </span>
                    <span className="ml-2 text-xs text-muted-foreground">{m.d}</span>
                    {m.no && (
                      <div className="text-xs text-muted-foreground">{m.no}</div>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {m.tk && <span className="text-xs text-muted-foreground">{m.tk.slice(11, 16)}</span>}
                    <StatusChip s={m.s} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default function Visits({ record }: { record: CareRecord }) {
  const [q, setQ] = useState("");
  const [carer, setCarer] = useState("all");
  const [status, setStatus] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(0);

  const carers = useMemo(
    () =>
      Array.from(new Set(record.hist.map((v) => v.carer).filter(Boolean))).sort((a, b) =>
        a.localeCompare(b)
      ),
    [record]
  );

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return record.hist.filter((v) => {
      if (carer !== "all" && v.carer !== carer) return false;
      if (status !== "all" && v.status !== status) return false;
      if (from && v.date < from) return false;
      if (to && v.date > to) return false;
      if (needle) {
        const hay = (v.notes + " " + v.tlist + " " + v.carer).toLowerCase();
        const inNotes = hay.includes(needle);
        const inTasks = v.tasks.some(
          (t) =>
            t.n.toLowerCase().includes(needle) || (t.no || "").toLowerCase().includes(needle)
        );
        const inMeds = v.meds.some(
          (m) => m.n.toLowerCase().includes(needle) || (m.no || "").toLowerCase().includes(needle)
        );
        if (!inNotes && !inTasks && !inMeds) return false;
      }
      return true;
    });
  }, [record, q, carer, status, from, to]);

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const clampedPage = Math.min(page, pages - 1);
  const rows = filtered.slice(clampedPage * PAGE_SIZE, (clampedPage + 1) * PAGE_SIZE);

  return (
    <div className="space-y-3">
      {/* filters */}
      <Card className="py-3">
        <CardContent className="flex flex-wrap items-center gap-2 px-3">
          <div className="relative min-w-52 flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search notes, tasks, carer, medication…"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(0);
              }}
              className="pl-8"
            />
          </div>
          <Select
            value={carer}
            onValueChange={(v) => {
              setCarer(v);
              setPage(0);
            }}
          >
            <SelectTrigger className="w-44">
              <SelectValue placeholder="Carer" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All carers</SelectItem>
              {carers.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={status}
            onValueChange={(v) => {
              setStatus(v);
              setPage(0);
            }}
          >
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="Completed">Completed</SelectItem>
              <SelectItem value="Cancelled">Cancelled</SelectItem>
              <SelectItem value="Penalty">Penalty</SelectItem>
              <SelectItem value="Aborted">Aborted</SelectItem>
              <SelectItem value="Waiting">Waiting</SelectItem>
            </SelectContent>
          </Select>
          <div className="flex items-center gap-1.5">
            <Input
              type="date"
              value={from}
              onChange={(e) => {
                setFrom(e.target.value);
                setPage(0);
              }}
              className="w-36"
            />
            <span className="text-xs text-muted-foreground">to</span>
            <Input
              type="date"
              value={to}
              onChange={(e) => {
                setTo(e.target.value);
                setPage(0);
              }}
              className="w-36"
            />
          </div>
        </CardContent>
      </Card>

      <div className="text-xs text-muted-foreground">
        {filtered.length.toLocaleString()} visits
      </div>

      {/* table */}
      <div className="overflow-hidden rounded-lg border">
        <div className="max-h-[62vh] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-teal-800 text-left text-white">
              <tr>
                <th className="px-3 py-2 font-medium">Date</th>
                <th className="px-3 py-2 font-medium">Planned</th>
                <th className="px-3 py-2 font-medium">Actual</th>
                <th className="px-3 py-2 font-medium">Carer</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Notes</th>
                <th className="w-10 px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((v, i) => (
                <Dialog key={`${v.date}-${v.times}-${i}`}>
                  <DialogTrigger asChild>
                    <tr className="cursor-pointer hover:bg-teal-50/60">
                      <td className="whitespace-nowrap px-3 py-2">{fmtDateRange(v.date)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                        {v.sin}–{v.sout}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                        {v.ain ? `${v.ain}–${v.aout}` : "—"}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2">{v.carer || "—"}</td>
                      <td className="px-3 py-2">
                        <StatusChip s={v.status} />
                      </td>
                      <td className="max-w-96 px-3 py-2">
                        <div className="truncate text-muted-foreground">{v.notes || "—"}</div>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        <ChevronDown className="h-4 w-4" />
                      </td>
                    </tr>
                  </DialogTrigger>
                  <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto" aria-describedby={undefined}>
                    <DialogHeader>
                      <DialogTitle className="flex items-center gap-2 text-teal-900">
                        <Clock3 className="h-4 w-4 text-teal-700" />
                        {fmtDateRange(v.date)} · {v.sin}–{v.sout}
                        <StatusChip s={v.status} />
                      </DialogTitle>
                    </DialogHeader>
                    <VisitDetail visit={v} />
                  </DialogContent>
                </Dialog>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-10 text-center text-muted-foreground">
                    No visits match these filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* pagination */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          Page {clampedPage + 1} of {pages}
        </span>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={clampedPage === 0}
            onClick={() => setPage(clampedPage - 1)}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={clampedPage >= pages - 1}
            onClick={() => setPage(clampedPage + 1)}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}
