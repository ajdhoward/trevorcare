"use client";

import { useMemo, useState } from "react";
import {
  Stethoscope,
  AlertTriangle,
  HandHeart,
  HeartHandshake,
  Pill,
  FileText,
  ExternalLink,
  Scale,
  Search,
  Info,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { type ConditionItem, type SectionsData } from "@/lib/record";

const CATEGORIES = ["All", "Mental health", "Sensory", "Musculoskeletal", "Nutrition & immunity", "Cardiovascular & blood", "Urinary & renal", "Skin & circulation"];

function Section({
  icon: Icon,
  title,
  tone,
  items,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  tone: string;
  items: string[];
}) {
  return (
    <div className={`rounded-lg border p-3 ${tone}`}>
      <div className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold">
        <Icon className="h-4 w-4" />
        {title}
      </div>
      <ul className="space-y-1.5">
        {items.map((t, i) => (
          <li key={i} className="flex gap-2 text-[13px] leading-relaxed text-foreground/90">
            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-40" />
            <span>{t}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function Conditions({
  conditions,
  sections,
  onNavigate,
}: {
  conditions: ConditionItem[];
  sections: SectionsData;
  onNavigate: (tab: string, kw?: string) => void;
}) {
  const [cat, setCat] = useState("All");
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState<string | null>(conditions[0]?.id ?? null);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return conditions.filter((c) => {
      if (cat !== "All" && c.category !== cat) return false;
      if (!needle) return true;
      const hay = [c.name, c.desc, c.source_note, ...c.meds, ...c.triggers, ...c.staff].join(" ").toLowerCase();
      return hay.includes(needle);
    });
  }, [conditions, cat, q]);

  const recorded = conditions.filter((c) => c.source === "recorded").length;

  return (
    <div className="space-y-4">
      {/* header strip */}
      <Card className="border-teal-200 bg-gradient-to-r from-teal-50 to-emerald-50/50">
        <CardContent className="flex flex-wrap items-center gap-3 py-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-teal-800">
            <Stethoscope className="h-5 w-5 text-white" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-bold text-teal-900">
              Conditions — what they are, what to watch for, what helps
            </h2>
            <p className="text-xs text-muted-foreground">
              {conditions.length} conditions ({recorded} recorded in the portal&apos;s medical history,{" "}
              {conditions.length - recorded} inferred from prescribed medications and care tasks) — each
              cross-referenced with the visits, notes, medications and documents in this interface.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* filters */}
      <Card className="py-3">
        <CardContent className="flex flex-wrap items-center gap-2 px-3">
          <div className="relative min-w-52 flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search conditions, medicines, triggers…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="pl-8"
            />
          </div>
          <div className="flex flex-wrap gap-1">
            {CATEGORIES.map((c) => (
              <button
                key={c}
                onClick={() => setCat(c)}
                className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                  cat === c
                    ? "border-teal-700 bg-teal-800 text-white"
                    : "border-border bg-white text-muted-foreground hover:border-teal-300 hover:text-teal-800"
                }`}
              >
                {c}
                {c !== "All" && (
                  <span className="ml-1 opacity-60">
                    {conditions.filter((x) => x.category === c).length}
                  </span>
                )}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* condition cards */}
      <div className="space-y-3">
        {filtered.map((c) => {
          const open = openId === c.id;
          return (
            <Card key={c.id} className={open ? "border-teal-300" : ""}>
              <CardContent className="px-0 py-0">
                <button
                  className="flex w-full flex-wrap items-center gap-2 px-4 py-3 text-left"
                  onClick={() => setOpenId(open ? null : c.id)}
                >
                  <span className="text-[15px] font-bold text-teal-900">{c.name}</span>
                  <Badge
                    variant="outline"
                    className={
                      c.source === "recorded"
                        ? "border-emerald-200 bg-emerald-50 text-[11px] text-emerald-800"
                        : "border-amber-200 bg-amber-50 text-[11px] text-amber-800"
                    }
                  >
                    {c.source === "recorded" ? "Recorded diagnosis" : "Inferred from meds/tasks"}
                  </Badge>
                  <Badge variant="outline" className="border-border text-[11px] text-muted-foreground">
                    {c.category}
                  </Badge>
                  {c.meds.length > 0 && (
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Pill className="h-3.5 w-3.5 text-teal-700" /> {c.meds.length} linked med
                      {c.meds.length > 1 ? "s" : ""}
                    </span>
                  )}
                  <span className="ml-auto text-xs font-medium text-teal-700">
                    {open ? "Collapse" : "Expand"}
                  </span>
                </button>

                {open && (
                  <div className="space-y-3 border-t px-4 pb-4 pt-3">
                    <p className="text-sm leading-relaxed text-foreground/90">{c.desc}</p>
                    <p className="rounded-md bg-muted/50 p-2.5 text-xs leading-relaxed text-muted-foreground">
                      <Info className="mr-1 inline h-3.5 w-3.5 align-[-2px] text-teal-700" />
                      {c.source_note}
                    </p>

                    {/* evidence cross-reference */}
                    <div className="rounded-lg border border-teal-200 bg-teal-50/50 p-3">
                      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-teal-800">
                        Evidence in this record
                      </div>
                      <p className="mb-2 text-[13px] leading-relaxed text-foreground/85">{c.evidence.summary}</p>
                      <div className="flex flex-wrap gap-2">
                        {c.evidence.stats.map((s, i) => (
                          <span
                            key={i}
                            className="rounded-md border border-teal-200 bg-white px-2.5 py-1 text-xs"
                          >
                            <strong className="text-teal-900">{s.value}</strong>{" "}
                            <span className="text-muted-foreground">{s.label}</span>
                          </span>
                        ))}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {c.links.map((l, i) => (
                          <button
                            key={i}
                            onClick={() => onNavigate(l.tab, l.kw)}
                            className="inline-flex items-center gap-1 rounded-md border border-teal-300 bg-white px-2 py-1 text-xs font-medium text-teal-800 hover:bg-teal-50"
                          >
                            <ExternalLink className="h-3 w-3" />
                            {l.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {c.meds.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {c.meds.map((m, i) => (
                          <Badge key={i} variant="outline" className="border-teal-200 bg-white text-xs font-normal text-teal-900">
                            <Pill className="mr-1 h-3 w-3 text-teal-700" />
                            {m}
                          </Badge>
                        ))}
                      </div>
                    )}

                    <div className="grid gap-3 lg:grid-cols-3">
                      <Section
                        icon={AlertTriangle}
                        title="Triggers for concern"
                        tone="border-amber-200 bg-amber-50/70 text-amber-900"
                        items={c.triggers}
                      />
                      <Section
                        icon={HandHeart}
                        title="What care staff can do"
                        tone="border-teal-200 bg-teal-50/70 text-teal-900"
                        items={c.staff}
                      />
                      <Section
                        icon={HeartHandshake}
                        title="Comfort & well-being"
                        tone="border-violet-200 bg-violet-50/70 text-violet-900"
                        items={c.comfort}
                      />
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      <FileText className="h-3.5 w-3.5 text-teal-700" />
                      Sources:
                      {c.docs.map((d, i) => (
                        <Badge key={i} variant="outline" className="bg-white text-[11px] font-normal">
                          {d}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
        {filtered.length === 0 && (
          <Card className="py-10">
            <CardContent className="text-center text-muted-foreground">
              No conditions match this filter.
            </CardContent>
          </Card>
        )}
      </div>

      {/* MHA s17/s117 cross-reference */}
      <Card className="border-violet-200">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base text-violet-900">
            <Scale className="h-4 w-4 text-violet-700" />
            {sections.headline}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="rounded-lg border border-violet-200 bg-violet-50/70 p-3">
            <div className="text-sm font-semibold text-violet-900">{sections.verdict_label}</div>
            <p className="mt-1 text-[13px] leading-relaxed text-foreground/85">{sections.search_evidence}</p>
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            {[sections.s17, sections.s117].map((s) => (
              <div key={s.title} className="rounded-lg border border-border/70 p-3">
                <div className="text-sm font-bold text-foreground">{s.title}</div>
                <p className="mt-1.5 text-[13px] leading-relaxed text-foreground/85">{s.what}</p>
                <p className="mt-2 rounded-md bg-violet-50/70 p-2 text-[13px] leading-relaxed text-violet-950">
                  <strong>For Dad: </strong>
                  {s.relevance}
                </p>
                <div className="mt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  If circumstances change — watch for
                </div>
                <ul className="mt-1 space-y-1">
                  {s.watch_for.map((w, i) => (
                    <li key={i} className="flex gap-2 text-[13px] leading-relaxed text-foreground/90">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-violet-400" />
                      {w}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          {sections.related_law.map((l) => (
            <div key={l.title} className="rounded-lg bg-muted/50 p-3">
              <div className="text-sm font-semibold text-foreground">{l.title}</div>
              <p className="mt-1 text-[13px] leading-relaxed text-foreground/85">{l.text}</p>
            </div>
          ))}
          <p className="rounded-lg border border-teal-200 bg-teal-50/60 p-3 text-[13px] leading-relaxed text-foreground/90">
            <strong>Bottom line: </strong>
            {sections.bottom_line}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
