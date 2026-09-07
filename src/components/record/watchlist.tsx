"use client";

import { useMemo, useState } from "react";
import { Search, Eye, BarChart3, Layers, Clock, Zap, Link2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Cell,
} from "recharts";
import { type CareRecord, type FlagsAnalytics, FLAG_LABELS, fmtDateRange, fmtDate } from "@/lib/record";

const PAGE_SIZE = 30;

const THEME_COLORS: Record<string, string> = {
  prn_declines: "#0d9488",
  food_fluid: "#f59e0b",
  pain: "#ef4444",
  refusals: "#f97316",
  hearing: "#3b82f6",
  confusion: "#8b5cf6",
  falls: "#dc2626",
  sleep: "#6366f1",
  skin_stockings: "#14b8a6",
  hospital: "#64748b",
};

// client-side mirror of theme classifier in build_insights.py
const FOOD_WORDS = /\b(food|meal|snack|eat|lunch|breakfast|supper|toast|porridge|weetabix|pudding|biscuit|sandwich|dinner|anything to eat)\b/i;

function classify(f: { kw: string[]; notes: string }): Set<string> {
  const n = f.notes;
  const t = new Set<string>();
  const has = (p: string) => f.kw.some((k) => k.startsWith(p));
  const hasDeclin = has("declin") || /declin/i.test(n);
  const isPrn = /\bprn\b/i.test(n);
  if (has("pain") || /\bpain/i.test(n)) t.add("pain");
  if (has("refus") || /\brefus/i.test(n)) t.add("refusals");
  if (has("confus") || /confus/i.test(n)) t.add("confusion");
  if (has("fall") || has("fell") || /\bfalls?\b|\bfell\b|shower pole/i.test(n)) t.add("falls");
  if (f.kw.includes("hearing aid") || /hearing aid/i.test(n)) t.add("hearing");
  if (f.kw.includes("sleeping") || /didn.?t sleep|slept (badly|poorly)|up all night|sleep(ing)? issues/i.test(n)) t.add("sleep");
  if (f.kw.includes("hospital") || /\bhospital\b/i.test(n)) t.add("hospital");
  if (/\bcream\b|stocking|\bskin\b/i.test(n)) t.add("skin_stockings");
  if (hasDeclin) {
    if (isPrn) t.add("prn_declines");
    if (FOOD_WORDS.test(n)) t.add("food_fluid");
  }
  return t;
}

export default function Watchlist({
  record,
  analytics,
  initialKw,
}: {
  record: CareRecord;
  analytics: FlagsAnalytics;
  initialKw?: string;
}) {
  const [q, setQ] = useState("");
  const [kw, setKw] = useState(initialKw ?? "all");
  const [theme, setTheme] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [lastKw, setLastKw] = useState(initialKw);

  // sync filter when deep-linked from another tab (React docs: adjusting state on prop change)
  if (initialKw !== lastKw) {
    setLastKw(initialKw);
    setKw(initialKw ?? "all");
    setPage(0);
  }

  const kinds = useMemo(() => {
    const m = new Map<string, number>();
    for (const f of record.flags) for (const k of f.kw) m.set(k, (m.get(k) ?? 0) + 1);
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  }, [record]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return record.flags
      .filter((f) => {
        if (kw !== "all" && !f.kw.includes(kw)) return false;
        if (theme && !classify(f).has(theme)) return false;
        if (needle && !f.notes.toLowerCase().includes(needle)) return false;
        return true;
      })
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [record, q, kw, theme]);

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const clampedPage = Math.min(page, pages - 1);
  const rows = filtered.slice(clampedPage * PAGE_SIZE, (clampedPage + 1) * PAGE_SIZE);

  const themeBars = analytics.theme_order
    .map((t) => ({
      id: t,
      name: analytics.themes[t].label,
      count: analytics.themes[t].count,
      last30: analytics.themes[t].last30,
      trend: analytics.themes[t].trend,
    }))
    .sort((a, b) => b.count - a.count);

  const maxCell = Math.max(1, ...analytics.months.map((m) => Math.max(...analytics.theme_order.map((t) => analytics.matrix[m]?.[t] ?? 0))));

  const heat = (v: number): string => {
    if (v === 0) return "bg-muted/40";
    const r = v / maxCell;
    if (r > 0.66) return "bg-teal-700 text-white";
    if (r > 0.33) return "bg-teal-500/70 text-white";
    if (r > 0.15) return "bg-teal-400/60";
    return "bg-teal-200/70";
  };

  const selTheme = theme ? analytics.themes[theme] : null;

  return (
    <div className="space-y-4">
      {/* ------------------------------------------------ analytics header */}
      <Card className="border-teal-200 bg-gradient-to-r from-teal-50 to-emerald-50/50">
        <CardContent className="flex flex-wrap items-center gap-3 py-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-teal-800">
            <BarChart3 className="h-5 w-5 text-white" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-bold text-teal-900">Flag analytics — {analytics.total} flagged notes grouped into themes</h2>
            <p className="text-xs text-muted-foreground">
              Every flagged note classified into up to 10 themes, then grouped by month, call time
              and carer — so patterns like the hearing-aid cycle or meal declines become visible.
              Click a theme to filter the notes below.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* theme chips */}
      <div className="flex flex-wrap gap-1.5">
        <button
          onClick={() => { setTheme(null); setPage(0); }}
          className={`rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors ${
            theme === null
              ? "border-teal-700 bg-teal-800 text-white"
              : "border-border bg-white text-muted-foreground hover:border-teal-300 hover:text-teal-800"
          }`}
        >
          All themes ({analytics.total})
        </button>
        {themeBars.map((t) => (
          <button
            key={t.id}
            onClick={() => { setTheme(theme === t.id ? null : t.id); setPage(0); }}
            className={`rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors ${
              theme === t.id
                ? "border-teal-700 bg-teal-800 text-white"
                : "border-border bg-white text-muted-foreground hover:border-teal-300 hover:text-teal-800"
            }`}
          >
            {t.name} ({t.count})
            {t.trend === "up" && <span className="ml-1 text-red-600" title={`rising: ${t.last30} in last 30 days vs ${t.count - t.last30} before`}>▲</span>}
            {t.trend === "down" && <span className="ml-1 text-emerald-600" title="falling">▼</span>}
          </button>
        ))}
      </div>

      {/* selected theme detail */}
      {selTheme && (
        <Card className="border-teal-300 bg-teal-50/40">
          <CardContent className="grid gap-3 py-3 md:grid-cols-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-teal-800">Snapshot</div>
              <div className="mt-1 space-y-1 text-sm">
                <div><strong>{selTheme.count}</strong> notes total · <strong>{selTheme.last30}</strong> in last 30 days (prev 30: {selTheme.prev30})</div>
                <div><Zap className="mr-1 inline h-3.5 w-3.5 text-amber-600" />{selTheme.rapid_repeats} rapid repeats (re-occurred within 3 days)</div>
                <div className="flex flex-wrap items-center gap-1 pt-1">
                  <Clock className="h-3.5 w-3.5 text-teal-700" />
                  {Object.entries(selTheme.by_call).filter(([, v]) => v > 0).map(([k, v]) => (
                    <Badge key={k} variant="outline" className="bg-white text-[11px]">{k} {v}</Badge>
                  ))}
                </div>
              </div>
            </div>
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-teal-800">Most involved carers</div>
              <div className="mt-1 space-y-0.5 text-sm">
                {selTheme.top_carers.map((c) => (
                  <div key={c.name} className="flex justify-between gap-2">
                    <span className="truncate">{c.name}</span>
                    <span className="font-semibold text-teal-900">{c.n}</span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-teal-800">Latest examples</div>
              <div className="mt-1 space-y-1.5">
                {selTheme.examples.slice(0, 2).map((e, i) => (
                  <div key={i} className="rounded-md bg-white p-2 text-xs leading-relaxed text-foreground/85">
                    <strong>{fmtDate(e.date)}:</strong> {e.notes}…
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* theme bar chart */}
        <Card>
          <CardHeader className="pb-0">
            <CardTitle className="text-base text-teal-900">Notes per theme</CardTitle>
          </CardHeader>
          <CardContent className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={themeBars} layout="vertical" margin={{ top: 4, right: 24, bottom: 0, left: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#8884" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 10 }} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 10.5 }} width={150} />
                <Tooltip formatter={(v: number) => [v, "Flagged notes"]} contentStyle={{ fontSize: 12 }} />
                <Bar
                  dataKey="count"
                  radius={[0, 4, 4, 0]}
                  barSize={12}
                  onClick={(d: { id?: string }) => d?.id && setTheme(d.id)}
                  className="cursor-pointer"
                >
                  {themeBars.map((t) => (
                    <Cell key={t.id} fill={THEME_COLORS[t.id] ?? "#0d9488"} opacity={theme === null || theme === t.id ? 1 : 0.35} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* heatmap month × theme */}
        <Card>
          <CardHeader className="pb-0">
            <CardTitle className="text-base text-teal-900">When each theme happens (month × theme)</CardTitle>
            <p className="text-xs text-muted-foreground">Darker = more flagged notes that month</p>
          </CardHeader>
          <CardContent className="overflow-x-auto pb-3">
            <div className="min-w-[560px]">
              <div className="mb-1 grid gap-px text-[10px] text-muted-foreground" style={{ gridTemplateColumns: "110px repeat(" + analytics.months.length + ", minmax(0, 1fr))" }}>
                <span />
                {analytics.months.map((m) => (
                  <span key={m} className="text-center" style={{ writingMode: "vertical-rl", transform: "rotate(180deg)", height: 34 }}>
                    {m.replace("2025", "'25").replace("2026", "'26")}
                  </span>
                ))}
              </div>
              {analytics.theme_order.map((t) => (
                <div key={t} className="grid gap-px" style={{ gridTemplateColumns: "110px repeat(" + analytics.months.length + ", minmax(0, 1fr))" }}>
                  <span className="truncate pr-1 text-[10.5px] leading-[18px] text-muted-foreground" title={analytics.themes[t].label}>
                    {analytics.themes[t].label}
                  </span>
                  {analytics.months.map((m) => {
                    const v = analytics.matrix[m]?.[t] ?? 0;
                    return (
                      <span
                        key={m + t}
                        title={`${analytics.themes[t].label} · ${m}: ${v}`}
                        className={`h-[18px] text-center text-[9px] leading-[18px] ${heat(v)}`}
                      >
                        {v || ""}
                      </span>
                    );
                  })}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* clusters */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base text-teal-900">
              <Layers className="h-4 w-4 text-teal-700" /> Dense episodes (4+ notes in 7 days)
            </CardTitle>
            <p className="text-xs text-muted-foreground">Periods where a theme flared up, day after day</p>
          </CardHeader>
          <CardContent className="max-h-56 space-y-1.5 overflow-y-auto">
            {analytics.clusters.slice(0, 10).map((c, i) => (
              <div key={i} className="flex items-center gap-2 rounded-md border border-border/60 px-2.5 py-1.5 text-[13px]">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: THEME_COLORS[c.theme] }} />
                <span className="font-medium">{c.label}</span>
                <span className="text-muted-foreground">
                  {fmtDate(c.start)} – {fmtDate(c.end)}
                </span>
                <Badge variant="outline" className="ml-auto border-red-200 bg-red-50 text-[11px] text-red-800">
                  {c.n} notes
                </Badge>
              </div>
            ))}
            {analytics.clusters.length === 0 && (
              <p className="text-sm text-muted-foreground">No dense episodes found.</p>
            )}
          </CardContent>
        </Card>

        {/* co-occurrence + call time */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base text-teal-900">
              <Link2 className="h-4 w-4 text-teal-700" /> What appears together
            </CardTitle>
            <p className="text-xs text-muted-foreground">Theme pairs in the same note, plus when flags happen</p>
          </CardHeader>
          <CardContent className="space-y-2">
            {analytics.cooccur.slice(0, 5).map((p, i) => (
              <div key={i} className="flex items-center gap-2 text-[13px]">
                <span className="rounded bg-muted px-1.5 py-0.5">{analytics.themes[p.a]?.label ?? p.a}</span>
                <span className="text-muted-foreground">+</span>
                <span className="rounded bg-muted px-1.5 py-0.5">{analytics.themes[p.b]?.label ?? p.b}</span>
                <Badge variant="outline" className="ml-auto text-[11px]">{p.n} notes</Badge>
              </div>
            ))}
            <div className="pt-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">By call time</div>
            <div className="grid grid-cols-4 gap-1.5">
              {["Morning", "Lunch", "Tea", "Bed"].map((k) => (
                <div key={k} className="rounded-md border border-teal-200 bg-teal-50/60 p-2 text-center">
                  <div className="text-lg font-bold text-teal-900">{analytics.by_call[k] ?? 0}</div>
                  <div className="text-[11px] text-muted-foreground">{k}</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ------------------------------------------------- note list */}
      <Card className="py-3">
        <CardContent className="flex flex-wrap items-center gap-2 px-3">
          <div className="relative min-w-52 flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search flagged notes…"
              value={q}
              onChange={(e) => { setQ(e.target.value); setPage(0); }}
              className="pl-8"
            />
          </div>
          <Select
            value={kw}
            onValueChange={(v) => { setKw(v); setPage(0); }}
          >
            <SelectTrigger className="w-52">
              <SelectValue placeholder="Flag type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All flags ({record.flags.length})</SelectItem>
              {kinds.map(([k, n]) => (
                <SelectItem key={k} value={k}>
                  {FLAG_LABELS[k] ?? k} ({n})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {(theme || kw !== "all" || q) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { setTheme(null); setKw("all"); setQ(""); setPage(0); }}
            >
              Clear filters
            </Button>
          )}
        </CardContent>
      </Card>

      <div className="space-y-2">
        {rows.map((f, i) => (
          <Card key={i} className="py-3">
            <CardContent className="px-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-teal-900">{fmtDateRange(f.date)}</span>
                <span className="text-xs text-muted-foreground">
                  {f.times} · {f.carer || "carer not recorded"}
                </span>
                <span className="ml-auto flex flex-wrap gap-1">
                  {Array.from(classify(f)).map((t) => (
                    <Badge key={t} variant="outline" className="border-teal-200 bg-teal-50 px-1.5 text-[11px] text-teal-800">
                      {analytics.themes[t]?.label ?? t}
                    </Badge>
                  ))}
                  {f.kw.map((k) => (
                    <Badge
                      key={k}
                      variant="outline"
                      className="border-red-200 bg-red-50 px-1.5 text-[11px] text-red-800"
                    >
                      {FLAG_LABELS[k] ?? k}
                    </Badge>
                  ))}
                </span>
              </div>
              <p className="mt-1.5 text-sm leading-relaxed text-foreground/90">{f.notes}</p>
            </CardContent>
          </Card>
        ))}
        {rows.length === 0 && (
          <Card className="py-10">
            <CardContent className="text-center text-muted-foreground">
              <Eye className="mx-auto mb-2 h-5 w-5" />
              No flagged notes match these filters.
            </CardContent>
          </Card>
        )}
      </div>

      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          Page {clampedPage + 1} of {pages} · {filtered.length.toLocaleString()} flagged notes
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
