"use client";

import { useMemo, useState } from "react";
import { Search, Pill } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { type CareRecord, StatusChip, fmtDate } from "@/lib/record";

const PAGE_SIZE = 30;

export default function Medication({ record }: { record: CareRecord }) {
  const [q, setQ] = useState("");
  const [med, setMed] = useState("all");
  const [kind, setKind] = useState("all");
  const [page, setPage] = useState(0);
  const [openMed, setOpenMed] = useState<string | null>(null);

  const medNames = useMemo(
    () => Array.from(new Set(record.med_events.map((e) => e.med).filter(Boolean))).sort(),
    [record]
  );

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return record.med_events.filter((e) => {
      if (med !== "all" && e.med !== med) return false;
      if (kind !== "all") {
        const c = (e.comments || "").toLowerCase();
        if (kind === "declined" && !c.includes("declin") && !c.includes("refus")) return false;
        if (kind === "actioned" && !e.action) return false;
      }
      if (needle) {
        const hay = `${e.med} ${e.comments} ${e.carer} ${e.action} ${e.actionBy} ${e.slot}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [record, q, med, kind]);

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const clampedPage = Math.min(page, pages - 1);
  const rows = filtered
    .slice()
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(clampedPage * PAGE_SIZE, (clampedPage + 1) * PAGE_SIZE);

  const totals = useMemo(() => {
    const given = record.med_daily.reduce((a, d) => a + d.given, 0);
    const total = record.med_daily.reduce((a, d) => a + d.total, 0);
    return { given, total };
  }, [record]);

  const activeMed = record.meds.find((m) => m.name === openMed);

  return (
    <div className="space-y-4">
      {/* current meds */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base text-teal-900">
            <Pill className="h-4 w-4 text-teal-700" />
            Current medications ({record.meds.length}) — click one for full directions & risks
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {record.meds.map((m, idx) => (
            <button key={`${m.name}-${idx}`} onClick={() => setOpenMed(m.name)} className="text-left">
              <Badge
                variant="outline"
                className={`max-w-72 cursor-pointer truncate px-2.5 py-1 text-xs hover:bg-teal-50 ${
                  m.prn
                    ? "border-amber-200 bg-amber-50 text-amber-900"
                    : "border-teal-200 bg-teal-50 text-teal-900"
                }`}
              >
                {m.name} · {m.dose}
                {m.prn ? " · PRN" : ""}
              </Badge>
            </button>
          ))}
        </CardContent>
      </Card>

      {/* selected med detail */}
      {activeMed && (
        <Card className="border-teal-200 bg-teal-50/50">
          <CardHeader className="pb-1">
            <CardTitle className="text-base text-teal-900">
              {activeMed.name}{" "}
              <span className="font-normal text-muted-foreground">— {activeMed.dose}</span>
              {activeMed.prn && (
                <Badge variant="outline" className="ml-2 border-amber-300 bg-amber-100 text-amber-900">
                  PRN
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {activeMed.freq && (
              <div>
                <span className="font-medium">Frequency: </span>
                <span className="text-muted-foreground">{activeMed.freq}</span>
              </div>
            )}
            <div>
              <span className="font-medium">Directions: </span>
              <span className="text-muted-foreground">{activeMed.directions || "—"}</span>
            </div>
            <div>
              <span className="font-medium">Form: </span>
              <span className="text-muted-foreground">{activeMed.form || "—"}</span>
            </div>
            <div className="rounded-md border border-red-100 bg-red-50 p-2.5 text-xs leading-relaxed text-red-900">
              <span className="font-semibold">Recorded risks / side effects: </span>
              {activeMed.risks || "—"}
            </div>
          </CardContent>
        </Card>
      )}

      {/* exceptions table */}
      <Card className="py-3">
        <CardContent className="flex flex-wrap items-center gap-2 px-3">
          <div className="relative min-w-52 flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search dose exceptions…"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(0);
              }}
              className="pl-8"
            />
          </div>
          <Select
            value={med}
            onValueChange={(v) => {
              setMed(v);
              setPage(0);
            }}
          >
            <SelectTrigger className="w-48">
              <SelectValue placeholder="Medication" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All medications</SelectItem>
              {medNames.map((m) => (
                <SelectItem key={m} value={m}>
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={kind}
            onValueChange={(v) => {
              setKind(v);
              setPage(0);
            }}
          >
            <SelectTrigger className="w-44">
              <SelectValue placeholder="Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All exceptions</SelectItem>
              <SelectItem value="declined">Declined / refused</SelectItem>
              <SelectItem value="actioned">Office actioned</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <div className="text-xs text-muted-foreground">
        {filtered.length.toLocaleString()} dose exceptions — every scheduled dose that was not
        given as planned ({totals.given.toLocaleString()} of {totals.total.toLocaleString()}{" "}
        scheduled doses were given).
      </div>

      <div className="overflow-hidden rounded-lg border">
        <div className="max-h-[55vh] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-teal-800 text-left text-white">
              <tr>
                <th className="px-3 py-2 font-medium">Date</th>
                <th className="px-3 py-2 font-medium">Slot</th>
                <th className="px-3 py-2 font-medium">Medication</th>
                <th className="px-3 py-2 font-medium">Carer</th>
                <th className="px-3 py-2 font-medium">Comment</th>
                <th className="px-3 py-2 font-medium">Office action</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((e, i) => (
                <tr key={i} className="hover:bg-teal-50/60">
                  <td className="whitespace-nowrap px-3 py-2">{fmtDate(e.date)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{e.slot}</td>
                  <td className="px-3 py-2 font-medium">{e.med}</td>
                  <td className="whitespace-nowrap px-3 py-2">{e.carer || "—"}</td>
                  <td className="max-w-72 px-3 py-2">
                    <div className="truncate" title={e.comments}>
                      {e.comments || "—"}
                    </div>
                  </td>
                  <td className="max-w-56 px-3 py-2">
                    <div className="truncate text-muted-foreground" title={`${e.action} ${e.actionBy}`}>
                      {e.action ? `${e.action}${e.actionBy ? ` — ${e.actionBy}` : ""}` : "—"}
                    </div>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-10 text-center text-muted-foreground">
                    No dose exceptions match these filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

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
