"use client";

import { useMemo } from "react";
import { CalendarDays, Ban, ClipboardList, Phone, Lock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  type CareRecord,
  StatusChip,
  fmtDate,
  fmtDateRange,
  fmtDateTime,
} from "@/lib/record";

const DAY_ORDER = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export default function Schedule({
  record,
  showContacts,
}: {
  record: CareRecord;
  showContacts: boolean;
  }) {
  const byDate = useMemo(() => {
    const m = new Map<string, typeof record.upcoming>();
    for (const v of record.upcoming) {
      if (!m.has(v.date)) m.set(v.date, []);
      m.get(v.date)!.push(v);
    }
    return Array.from(m.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [record]);

  const packageByDay = useMemo(() => {
    const m = new Map<string, typeof record.package>();
    for (const p of record.package) {
      if (!m.has(p.startDay)) m.set(p.startDay, []);
      m.get(p.startDay)!.push(p);
    }
    return DAY_ORDER.map((d) => [d, m.get(d) ?? []] as const).filter(([, v]) => v.length > 0);
  }, [record]);

  const absences = useMemo(
    () => record.absences.slice().sort((a, b) => b.from.localeCompare(a.from)),
    [record]
  );

  const c = record.client;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        {/* upcoming */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base text-teal-900">
              <CalendarDays className="h-4 w-4 text-teal-700" />
              Upcoming visits ({record.upcoming.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="max-h-80 space-y-3 overflow-y-auto">
            {byDate.map(([date, visits]) => (
              <div key={date}>
                <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {fmtDateRange(date)}
                </div>
                <div className="space-y-1">
                  {visits.map((v, i) => (
                    <div
                      key={i}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-sm"
                    >
                      <span className="font-medium">{v.times}</span>
                      <span className="text-muted-foreground">{v.carer}</span>
                      <StatusChip s={v.status} />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* care package */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base text-teal-900">
              <ClipboardList className="h-4 w-4 text-teal-700" />
              Commissioned care package (weekly)
            </CardTitle>
          </CardHeader>
          <CardContent className="max-h-80 space-y-3 overflow-y-auto">
            {packageByDay.map(([day, slots]) => (
              <div key={day}>
                <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {day}
                </div>
                <div className="space-y-1">
                  {slots.map((p, i) => (
                    <div key={i} className="rounded-md border px-2.5 py-1.5 text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium">{p.times}</span>
                        <Badge
                          variant="outline"
                          className={
                            p.tasks.includes("Medication")
                              ? "border-amber-200 bg-amber-50 text-amber-900"
                              : "border-teal-200 bg-teal-50 text-teal-900"
                          }
                        >
                          {p.duration} min
                        </Badge>
                      </div>
                      <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                        {p.tasks}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* absences */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base text-teal-900">
              <Ban className="h-4 w-4 text-teal-700" />
              Absences & cancellations ({absences.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="max-h-72 overflow-y-auto">
            <table className="w-full text-sm">
              <tbody className="divide-y">
                {absences.map((a, i) => (
                  <tr key={i}>
                    <td className="whitespace-nowrap px-1 py-1.5">{fmtDateTime(a.from)}</td>
                    <td className="whitespace-nowrap px-1 py-1.5 text-muted-foreground">
                      → {fmtDateTime(a.to)}
                    </td>
                    <td className="px-1 py-1.5 text-right">
                      <Badge variant="outline" className="border-zinc-200 bg-zinc-50 text-zinc-700">
                        {a.reason}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>

        {/* contacts */}
        {showContacts ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base text-teal-900">
              <Phone className="h-4 w-4 text-teal-700" />
              Contacts
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {c.contacts
              .filter((x) => x.name.trim())
              .map((x, i) => (
                <div key={i}>
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-medium">{x.name.trim()}</span>
                    <Badge variant="outline" className="border-teal-200 bg-teal-50 text-teal-900">
                      {x.contactType}
                    </Badge>
                    {x.relationship && (
                      <span className="text-xs text-muted-foreground">{x.relationship}</span>
                    )}
                  </div>
                  {x.telNo1 && (
                    <div className="text-xs text-muted-foreground">Tel: {x.telNo1}</div>
                  )}
                  <Separator className="my-1.5" />
                </div>
              ))}
          </CardContent>
        </Card>
        ) : (
          <Card className="border-dashed">
            <CardContent className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
              <Lock className="h-4 w-4 shrink-0" />
              Contacts are hidden for your role (data minimisation — managed in Access &amp; audit).
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
