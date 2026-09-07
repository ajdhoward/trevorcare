"use client";

import { useMemo, useState } from "react";
import {
  RadialBar,
  RadialBarChart,
  PolarAngleAxis,
  ResponsiveContainer,
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  Cell,
} from "recharts";
import { HeartPulse, TrendingDown, TrendingUp, Minus, Info, Quote, Gauge } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  type WellbeingData,
  type WellbeingBand,
  fmtDate,
  monthLabel,
  COMPONENT_LABELS,
} from "@/lib/record";

const BAND_COLORS: Record<string, string> = {
  good: "#059669",
  stable: "#0d9488",
  variable: "#d97706",
  concern: "#dc2626",
  urgent: "#991b1b",
};

function bandColor(b: WellbeingBand): string {
  return BAND_COLORS[b?.k ?? "stable"] ?? "#0d9488";
}

export default function Wellbeing({
  data,
  onNavigate,
}: {
  data: WellbeingData;
  onNavigate: (tab: string) => void;
}) {
  const cur = data.current;
  const [methodOpen, setMethodOpen] = useState(false);

  const dailyChart = useMemo(
    () =>
      data.daily.map((d) => ({
        date: d.date,
        label: fmtDate(d.date).slice(0, 6),
        score: d.score,
        roll7: d.roll7,
        band: d.band.k,
      })),
    [data]
  );

  const monthlyChart = useMemo(
    () => data.monthly.map((m) => ({ ...m, label: monthLabel(m.month) })),
    [data]
  );

  const components = Object.entries(cur.components).map(([k, v]) => ({
    key: k,
    name: COMPONENT_LABELS[k] ?? k,
    current: v,
    prev: cur.components_prev?.[k] ?? v,
    delta: v - (cur.components_prev?.[k] ?? v),
  }));

  const gaugeData = [
    {
      name: cur.band.label,
      value: cur.score,
      fill: bandColor(cur.band),
    },
  ];

  return (
    <div className="space-y-4">
      {/* top row: gauge + interpretation */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="border-teal-200 lg:col-span-1">
          <CardHeader className="pb-0">
            <CardTitle className="flex items-center gap-2 text-base text-teal-900">
              <Gauge className="h-4 w-4 text-teal-700" /> Well-being gauge
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            <div className="relative h-48">
              <ResponsiveContainer width="100%" height="100%">
                <RadialBarChart
                  data={gaugeData}
                  innerRadius="72%"
                  outerRadius="100%"
                  startAngle={220}
                  endAngle={-40}
                >
                  <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
                  <RadialBar dataKey="value" cornerRadius={12} background={{ fill: "#8882" }} />
                </RadialBarChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center pt-6">
                <span className="text-4xl font-bold text-teal-900">{cur.score}</span>
                <span className="text-xs text-muted-foreground">out of 100</span>
              </div>
            </div>
            <div className="flex items-center justify-center gap-2 pb-1">
              <span
                className="inline-flex items-center rounded-full px-3 py-1 text-sm font-semibold text-white"
                style={{ backgroundColor: bandColor(cur.band) }}
              >
                {cur.band.label}
              </span>
              {cur.trend === "up" && (
                <span className="flex items-center gap-1 text-xs font-medium text-emerald-700">
                  <TrendingUp className="h-3.5 w-3.5" /> up from {cur.prev7}
                </span>
              )}
              {cur.trend === "down" && (
                <span className="flex items-center gap-1 text-xs font-medium text-red-700">
                  <TrendingDown className="h-3.5 w-3.5" /> down from {cur.prev7}
                </span>
              )}
              {cur.trend === "flat" && (
                <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
                  <Minus className="h-3.5 w-3.5" /> steady vs {cur.prev7}
                </span>
              )}
            </div>
            <p className="text-center text-xs text-muted-foreground">
              Average of {cur.days_counted} complete days ({cur.window.replace(/-/g, "/")}). A score
              is computed per day from visits, tasks, medication and flagged notes.
            </p>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="pb-0">
            <CardTitle className="text-base text-teal-900">
              What the bands mean
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.bands.map((b, i) => {
              const isCurrent = b.k === cur.band.k;
              const range = i === 0 ? `${b.min}–100` : `${b.min}–${data.bands[i - 1].min - 1}`;
              return (
                <div
                  key={b.k}
                  className={`flex items-start gap-3 rounded-lg border p-2.5 ${
                    isCurrent ? "border-teal-300 bg-teal-50/70" : "border-border/60"
                  }`}
                >
                  <span
                    className="mt-0.5 h-3 w-3 shrink-0 rounded-full"
                    style={{ backgroundColor: BAND_COLORS[b.k] }}
                  />
                  <div className="min-w-0 text-sm">
                    <span className="font-semibold text-foreground">
                      {b.label}{" "}
                      <span className="font-normal text-muted-foreground">
                        (score {range})
                      </span>
                    </span>
                    <span className="ml-2 text-muted-foreground">{b.desc}</span>
                    {isCurrent && (
                      <Badge className="ml-2 border-teal-300 bg-white text-xs text-teal-900" variant="outline">
                        current
                      </Badge>
                    )}
                  </div>
                </div>
              );
            })}
            <p className="pt-1 text-xs leading-relaxed text-muted-foreground">
              This is a <strong>family analytics index</strong>, not a clinical measure. It makes
              trends visible so you can ask better questions of the agency and clinicians. A low
              week does not automatically mean something is wrong — check the drivers below and
              the underlying notes in Watch items.
            </p>
          </CardContent>
        </Card>
      </div>

      {/* daily trend */}
      <Card>
        <CardHeader className="pb-0">
          <CardTitle className="text-base text-teal-900">
            Daily well-being over the full record (Oct 2025 – Sep 2026)
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Faint line: raw daily score. Bold line: 7-day rolling average. The two dips (Jan 2026,
            Jun 2026) line up with illness entries and respite disruption.
          </p>
        </CardHeader>
        <CardContent className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={dailyChart} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
              <defs>
                <linearGradient id="wbRoll" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#0d9488" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#0d9488" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#8884" />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={54} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} />
              <Tooltip
                labelFormatter={(l) => `Around ${l}`}
                formatter={(v: number, n: string) => [v, n === "score" ? "Day score" : "7-day average"]}
                contentStyle={{ fontSize: 12 }}
              />
              <ReferenceLine y={65} stroke="#d97706" strokeDasharray="4 4" label={{ value: "Stable threshold", fontSize: 10, position: "insideBottomRight" }} />
              <Area type="monotone" dataKey="score" stroke="#94a3b8" strokeWidth={1} fill="none" opacity={0.55} />
              <Area type="monotone" dataKey="roll7" stroke="#0f766e" strokeWidth={2.5} fill="url(#wbRoll)" />
            </AreaChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* monthly + components */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-0">
            <CardTitle className="text-base text-teal-900">Monthly average</CardTitle>
            <p className="text-xs text-muted-foreground">Average daily score per calendar month</p>
          </CardHeader>
          <CardContent className="h-60">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthlyChart} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#8884" />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} />
                <Tooltip
                  formatter={(v: number, _n, p) => [
                    v,
                    `Avg (range ${p?.payload?.min}–${p?.payload?.max})`,
                  ]}
                  contentStyle={{ fontSize: 12 }}
                />
                <Bar dataKey="score" radius={[4, 4, 0, 0]}>
                  {monthlyChart.map((m) => (
                    <Cell key={m.month} fill={bandColor({ k: m.score >= 80 ? "good" : m.score >= 65 ? "stable" : m.score >= 50 ? "variable" : "concern", label: "" })} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-0">
            <CardTitle className="text-base text-teal-900">
              Components (trailing 30 days vs previous 30)
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Where the score comes from — food &amp; fluids is the long-standing weak spot
            </p>
          </CardHeader>
          <CardContent className="h-60">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={components} layout="vertical" margin={{ top: 4, right: 22, bottom: 0, left: 30 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#8884" horizontal={false} />
                <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 10 }} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={110} />
                <Tooltip formatter={(v: number) => [v, "Score"]} contentStyle={{ fontSize: 12 }} />
                <Bar dataKey="prev" fill="#cbd5e1" radius={[0, 4, 4, 0]} barSize={9} name="Prev 30d" />
                <Bar dataKey="current" fill="#0d9488" radius={[0, 4, 4, 0]} barSize={9} name="Last 30d" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* drivers */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base text-teal-900">
            <HeartPulse className="h-4 w-4 text-teal-700" /> What is driving well-being right now
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Flagged notes from the last 30 days, grouped by theme with a recent example
          </p>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          {data.drivers.map((d) => (
            <div key={d.theme} className="rounded-lg border border-border/70 p-3">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-foreground">{d.label}</span>
                <Badge variant="outline" className="border-red-200 bg-red-50 text-[11px] text-red-800">
                  {d.count} in 30 days
                </Badge>
                <span className="ml-auto text-[11px] uppercase tracking-wide text-muted-foreground">
                  {d.area}
                </span>
              </div>
              <div className="mt-2 flex gap-2 rounded-md bg-teal-50/60 p-2 text-xs leading-relaxed text-foreground/85">
                <Quote className="mt-0.5 h-3 w-3 shrink-0 text-teal-600" />
                <span>
                  <strong>{fmtDate(d.example.date)}:</strong> {d.example.notes}…
                </span>
              </div>
              <button
                className="mt-2 text-xs font-medium text-teal-700 hover:underline"
                onClick={() => onNavigate("watchlist")}
              >
                Inspect these notes in Watch items →
              </button>
            </div>
          ))}
          {data.drivers.length === 0 && (
            <p className="text-sm text-muted-foreground">No flagged notes in the last 30 days.</p>
          )}
        </CardContent>
      </Card>

      {/* method */}
      <Card>
        <CardContent className="py-3">
          <button
            className="flex w-full items-center gap-2 text-sm font-medium text-teal-900"
            onClick={() => setMethodOpen(!methodOpen)}
          >
            <Info className="h-4 w-4 text-teal-700" />
            How the well-being index is calculated
            <span className="ml-auto text-xs text-muted-foreground">{methodOpen ? "hide" : "show"}</span>
          </button>
          {methodOpen && (
            <p className="mt-2 rounded-lg bg-muted/50 p-3 text-xs leading-relaxed text-foreground/85">
              {data.method}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
