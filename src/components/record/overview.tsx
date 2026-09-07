"use client";

import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Area,
  AreaChart,
} from "recharts";
import {
  CalendarCheck,
  CheckCircle2,
  Pill,
  Users,
  AlertTriangle,
  Clock,
  MapPin,
  HeartPulse,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  type CareRecord,
  fmtDate,
  monthKey,
  monthLabel,
} from "@/lib/record";

function Kpi({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <Card className="gap-2 py-4">
      <CardContent className="px-4">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-teal-700" />
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {label}
          </span>
        </div>
        <div className="mt-1 text-2xl font-bold text-teal-900">{value}</div>
        <div className="text-xs text-muted-foreground">{sub}</div>
      </CardContent>
    </Card>
  );
}

export default function Overview({ record }: { record: CareRecord }) {
  const stats = useMemo(() => {
    const visits = record.hist;
    const done = visits.filter((v) => v.status === "Completed").length;
    const cancelled = visits.filter((v) =>
      ["Cancelled", "Penalty", "Aborted"].includes(v.status)
    ).length;

    const totalDoses = record.med_daily.reduce((a, d) => a + d.total, 0);
    const givenDoses = record.med_daily.reduce((a, d) => a + d.given, 0);
    const prnGiven = record.med_daily.reduce((a, d) => a + d.prn_given, 0);
    const prnNot = record.med_daily.reduce((a, d) => a + d.prn_not, 0);

    const taskDone = visits.reduce(
      (a, v) => a + v.tasks.filter((t) => t.s === "Complete").length,
      0
    );
    const taskTotal = visits.reduce((a, v) => a + v.tasks.length, 0);

    const months = new Map<string, { complete: number; missed: number; flags: number }>();
    for (const v of visits) {
      const k = monthKey(v.date);
      const m = months.get(k) ?? { complete: 0, missed: 0, flags: 0 };
      if (v.status === "Completed") m.complete += 1;
      else if (v.status !== "Waiting") m.missed += 1;
      months.set(k, m);
    }
    for (const f of record.flags) {
      const k = monthKey(f.date);
      const m = months.get(k) ?? { complete: 0, missed: 0, flags: 0 };
      m.flags += 1;
      months.set(k, m);
    }
    const monthly = Array.from(months.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => ({ month: monthLabel(k), ...v }));

    const adherence = record.med_daily
      .filter((d) => d.total > 0 && d.cancelled === 0)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((d) => ({
        date: d.date.slice(5),
        pct: Math.round((d.given / d.total) * 100),
      }));

    const medExceptions = record.med_events.length;
    const flagKinds = new Map<string, number>();
    for (const f of record.flags)
      for (const k of f.kw) flagKinds.set(k, (flagKinds.get(k) ?? 0) + 1);

    return {
      total: visits.length,
      done,
      cancelled,
      pct: Math.round((done / Math.max(visits.length, 1)) * 100),
      totalDoses,
      givenDoses,
      dosePct: Math.round((givenDoses / Math.max(totalDoses, 1)) * 100),
      prnGiven,
      prnNot,
      taskDone,
      taskTotal,
      taskPct: Math.round((taskDone / Math.max(taskTotal, 1)) * 100),
      monthly,
      adherence,
      medExceptions,
      flagKinds: Array.from(flagKinds.entries()).sort((a, b) => b[1] - a[1]),
    };
  }, [record]);

  const c = record.client;
  const dob = new Date(c.dob + "T00:00:00");
  const age = Math.floor((Date.now() - dob.getTime()) / 3.15576e10);

  return (
    <div className="space-y-4">
      {/* client + coverage */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="md:col-span-1">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-lg text-teal-900">
              <HeartPulse className="h-5 w-5 text-teal-700" />
              {c.name.replace("(T2) ", "")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Clock className="h-3.5 w-3.5 shrink-0" />
              Born {fmtDate(c.dob)} (age {age})
            </div>
            <div className="flex items-start gap-2 text-muted-foreground">
              <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {c.address}
            </div>
            <Separator />
            <div>
              <span className="font-medium">GP:</span>{" "}
              <span className="text-muted-foreground">{c.gp}</span>
            </div>
            <div>
              <span className="font-medium">Pharmacy:</span>{" "}
              <span className="text-muted-foreground">{c.pharmacy}</span>
            </div>
            <div>
              <span className="font-medium">Allergies:</span>{" "}
              <span className="text-muted-foreground">{c.allergies}</span>
            </div>
            <Separator />
            <div className="text-xs text-muted-foreground">
              Next of kin:{" "}
              {c.contacts
                .filter((x) => x.contactType.startsWith("Next of Kin"))
                .map((x) => `${x.name.replace(/^ /, "")} (${x.relationship || x.contactType})`)
                .join(" · ")}
            </div>
            <p className="rounded-md border border-amber-200 bg-amber-50 p-2 text-[11.5px] leading-relaxed text-amber-800">
              ⚠ Family advises this next-of-kin line is wrong (Contact A is not next of kin; son Alex
              Family is missing). Correction in progress — see the Records audit tab.
            </p>
          </CardContent>
        </Card>

        <div className="grid grid-cols-2 gap-4 md:col-span-2 md:grid-cols-3">
          <Kpi
            icon={CalendarCheck}
            label="Visits"
            value={stats.total.toLocaleString()}
            sub={`${stats.pct}% completed · ${stats.cancelled} cancelled`}
          />
          <Kpi
            icon={Pill}
            label="Doses given"
            value={`${stats.dosePct}%`}
            sub={`${stats.givenDoses.toLocaleString()} of ${stats.totalDoses.toLocaleString()} scheduled`}
          />
          <Kpi
            icon={CheckCircle2}
            label="Tasks complete"
            value={`${stats.taskPct}%`}
            sub={`${stats.taskDone.toLocaleString()} of ${stats.taskTotal.toLocaleString()} outcomes`}
          />
          <Kpi
            icon={AlertTriangle}
            label="Watch items"
            value={record.flags.length.toLocaleString()}
            sub="flagged notes needing a look"
          />
          <Kpi
            icon={Pill}
            label="Dose exceptions"
            value={stats.medExceptions.toLocaleString()}
            sub="declined / missed / not taken"
          />
          <Kpi
            icon={Users}
            label="Carers"
            value={record.carers.length.toLocaleString()}
            sub="regular carers across the year"
          />
        </div>
      </div>

      {/* charts */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-0">
            <CardTitle className="text-base text-teal-900">
              Visits & watch items by month
            </CardTitle>
          </CardHeader>
          <CardContent className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stats.monthly} margin={{ top: 12, right: 8, left: -18, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#8884" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} tickLine={false} />
                <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                <Tooltip
                  contentStyle={{ borderRadius: 8, fontSize: 12, borderColor: "#ccfbf1" }}
                />
                <Bar dataKey="complete" name="Completed visits" fill="#0f766e" radius={[3, 3, 0, 0]} />
                <Bar dataKey="missed" name="Not delivered" fill="#f59e0b" radius={[3, 3, 0, 0]} />
                <Bar dataKey="flags" name="Watch items" fill="#dc2626" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-0">
            <CardTitle className="text-base text-teal-900">
              Daily medication adherence (% of scheduled doses given)
            </CardTitle>
          </CardHeader>
          <CardContent className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={stats.adherence} margin={{ top: 12, right: 8, left: -18, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#8884" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} tickLine={false} interval={29} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                <Tooltip
                  contentStyle={{ borderRadius: 8, fontSize: 12, borderColor: "#ccfbf1" }}
                  formatter={(v: number) => [`${v}%`, "Given"]}
                />
                <Area
                  type="monotone"
                  dataKey="pct"
                  stroke="#0f766e"
                  fill="#99f6e4"
                  fillOpacity={0.6}
                  strokeWidth={1.5}
                />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* flags summary */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base text-teal-900">
            What the notes are flagging
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {stats.flagKinds.map(([k, n]) => (
            <Badge key={k} variant="outline" className="border-teal-200 bg-teal-50 text-teal-900">
              {k} · {n}
            </Badge>
          ))}
          <span className="w-full pt-1 text-xs text-muted-foreground">
            Keyword scan across all carer notes — declin/refus = declined an item, confus =
            possible confusion, hearing aid = aids not charged/fitted, nomad = medication pack
            issues. PRN doses: {stats.prnGiven.toLocaleString()} given,{" "}
            {stats.prnNot.toLocaleString()} not taken.
          </span>
        </CardContent>
      </Card>
    </div>
  );
}
