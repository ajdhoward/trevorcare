"use client";

import { useMemo, useState } from "react";
import { Database, Send, Eye, EyeOff, ShieldCheck, Lock, Search, Server, FileJson } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

export interface ApiEndpoint {
  endpoint: string;
  verb: string;
  purpose: string;
  fields: string;
  rows: string;
  snapshot: string;
  shown_in: string[];
  sensitivity: string;
  write: string;
  status: string;
  note: string;
}

export interface ApiCatalogData {
  generated: string;
  verdict: {
    question: string;
    short_answer: string;
    detail: { endpoint: string; verb: string; body: string; classification: string }[];
    consequence: string;
  };
  sensitivity_classes: { k: string; label: string; desc: string }[];
  endpoint_groups: (
    | { group: string; endpoints: ApiEndpoint[] }
    | { group: string; services: { family: string; desc: string }[] }
  )[];
  coverage: {
    interface_datasets: { file: string; from: string; rows: string; tabs: string }[];
    not_exposed_to_family_role: string[];
    api_vs_ui: {
      summary: string;
      api_only_fields: string[];
      admin_audit_data: string;
    };
  };
}

const SENS_STYLE: Record<string, string> = {
  operational: "bg-teal-50 text-teal-800 border-teal-200 dark:bg-teal-950/40 dark:text-teal-200 dark:border-teal-800",
  health: "bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-800",
  personal: "bg-rose-50 text-rose-800 border-rose-200 dark:bg-rose-950/40 dark:text-rose-200 dark:border-rose-800",
  internal: "bg-zinc-100 text-zinc-700 border-zinc-300 dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-600",
};

function writeBadge(w: string) {
  const isWrite = /WRITE/.test(w);
  const readOnly = w.startsWith("No");
  return (
    <Badge
      variant="outline"
      className={
        isWrite
          ? "border-rose-300 bg-rose-100 text-rose-800 dark:bg-rose-950/50 dark:text-rose-200"
          : readOnly
            ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200"
            : ""
      }
    >
      {isWrite ? <Lock className="mr-1 h-3 w-3" /> : <ShieldCheck className="mr-1 h-3 w-3" />}
      {w}
    </Badge>
  );
}

export default function ApiCatalog({ catalog }: { catalog: ApiCatalogData | null }) {
  const [q, setQ] = useState("");
  const [showFields, setShowFields] = useState(true);

  const filtered = useMemo(() => {
    if (!catalog) return [];
    const needle = q.toLowerCase();
    return catalog.endpoint_groups
      .map((g) => {
        if ("endpoints" in g) {
          return {
            ...g,
            endpoints: g.endpoints.filter(
              (e) =>
                !needle ||
                e.endpoint.toLowerCase().includes(needle) ||
                e.purpose.toLowerCase().includes(needle) ||
                e.fields.toLowerCase().includes(needle)
            ),
          };
        }
        return {
          ...g,
          services: g.services.filter(
            (s) =>
              !needle ||
              s.family.toLowerCase().includes(needle) ||
              s.desc.toLowerCase().includes(needle)
          ),
        };
      })
      .filter((g) => ("endpoints" in g ? g.endpoints.length : g.services.length) > 0);
  }, [catalog, q]);

  if (!catalog) {
    return <p className="text-sm text-muted-foreground">Loading API catalog…</p>;
  }

  const usableCount = catalog.endpoint_groups.reduce(
    (a, g) => a + ("endpoints" in g ? g.endpoints.length : 0),
    0
  );

  return (
    <div className="space-y-4">
      {/* verdict */}
      <Card className="border-emerald-200 bg-emerald-50/60 dark:border-emerald-900 dark:bg-emerald-950/30">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base text-emerald-900 dark:text-emerald-200">
            <ShieldCheck className="h-5 w-5" />
            Write capability verdict — {catalog.verdict.question}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="font-medium leading-relaxed text-emerald-900 dark:text-emerald-100">
            {catalog.verdict.short_answer}
          </p>
          <div className="overflow-x-auto rounded-lg border border-emerald-200 dark:border-emerald-900">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>POST route</TableHead>
                  <TableHead>Body</TableHead>
                  <TableHead>Classification</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {catalog.verdict.detail.map((d) => (
                  <TableRow key={d.endpoint}>
                    <TableCell className="whitespace-nowrap font-mono text-xs">{d.endpoint}</TableCell>
                    <TableCell className="text-xs">{d.body}</TableCell>
                    <TableCell className="text-xs">{d.classification}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <p className="leading-relaxed text-muted-foreground">{catalog.verdict.consequence}</p>
        </CardContent>
      </Card>

      {/* api vs ui */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Eye className="h-5 w-5 text-teal-700" />
            API vs. what the interface shows
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p className="leading-relaxed">{catalog.coverage.api_vs_ui.summary}</p>
          <div className="grid gap-2 md:grid-cols-2">
            <div className="rounded-lg border p-3">
              <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <FileJson className="h-3.5 w-3.5" /> API-only fields (you see them here, not in the portal UI)
              </p>
              <ul className="list-disc space-y-1 pl-4 text-xs">
                {catalog.coverage.api_vs_ui.api_only_fields.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            </div>
            <div className="rounded-lg border p-3">
              <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <EyeOff className="h-3.5 w-3.5" /> Not exposed to the family role at all
              </p>
              <ul className="list-disc space-y-1 pl-4 text-xs">
                {catalog.coverage.not_exposed_to_family_role.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
              <p className="mt-2 border-t pt-2 text-xs text-muted-foreground">
                {catalog.coverage.api_vs_ui.admin_audit_data}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* endpoint inventory */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Server className="h-5 w-5 text-teal-700" />
              Endpoint inventory — {usableCount} verified routes (live-checked 05/09/2026)
            </CardTitle>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Filter endpoints…"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  className="w-56 pl-8"
                />
              </div>
              <Button variant="outline" size="sm" onClick={() => setShowFields((s) => !s)}>
                {showFields ? "Hide fields" : "Show fields"}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {filtered.map((g) => (
            <div key={g.group} className="space-y-2">
              <h3 className="text-sm font-semibold text-teal-900 dark:text-teal-200">{g.group}</h3>
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="min-w-[220px]">Endpoint</TableHead>
                      <TableHead>Purpose &amp; data</TableHead>
                      <TableHead>Sensitivity</TableHead>
                      <TableHead>Write?</TableHead>
                      <TableHead>Shown in</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {"endpoints" in g &&
                      g.endpoints.map((e) => (
                        <TableRow key={e.endpoint + e.verb} className="align-top">
                          <TableCell>
                            <div className="font-mono text-xs font-medium break-all">{e.endpoint}</div>
                            <div className="mt-1 flex flex-wrap items-center gap-1">
                              <Badge variant="outline" className="font-mono text-[10px]">{e.verb}</Badge>
                              <span className="text-[11px] text-muted-foreground">{e.snapshot}</span>
                            </div>
                            {e.note && (
                              <div className="mt-1 max-w-xs text-[11px] text-amber-700 dark:text-amber-300">{e.note}</div>
                            )}
                          </TableCell>
                          <TableCell>
                            <div className="text-xs font-medium">{e.purpose}</div>
                            {showFields && (
                              <div className="mt-1 max-w-xl text-[11px] leading-relaxed text-muted-foreground">
                                <span className="font-semibold">Fields: </span>
                                {e.fields}
                              </div>
                            )}
                            <div className="mt-1 text-[11px] text-muted-foreground">{e.rows}</div>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className={SENS_STYLE[e.sensitivity] || ""}>
                              {e.sensitivity}
                            </Badge>
                          </TableCell>
                          <TableCell>{writeBadge(e.write)}</TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-1">
                              {e.shown_in.map((t) => (
                                <Badge key={t} variant="outline" className="text-[10px]">{t}</Badge>
                              ))}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    {"services" in g &&
                      g.services.map((s) => (
                        <TableRow key={s.family} className="align-top">
                          <TableCell className="font-mono text-xs font-medium">{s.family}</TableCell>
                          <TableCell colSpan={4} className="text-xs">{s.desc}</TableCell>
                        </TableRow>
                      ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* datasets + sensitivity legend */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Database className="h-5 w-5 text-teal-700" />
              Datasets this interface is built on
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {catalog.coverage.interface_datasets.map((d) => (
                <div key={d.file} className="rounded-lg border p-2.5 text-xs">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono font-semibold">{d.file}</span>
                    <span className="text-muted-foreground">← {d.from}</span>
                  </div>
                  <div className="mt-1 text-muted-foreground">
                    {d.rows} · shown in: {d.tabs}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Send className="h-5 w-5 text-teal-700" />
              Sensitivity classes (drive the permissions matrix)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {catalog.sensitivity_classes.map((s) => (
              <div key={s.k} className="flex items-start gap-2 rounded-lg border p-2.5 text-xs">
                <Badge variant="outline" className={SENS_STYLE[s.k] || ""}>{s.label}</Badge>
                <span className="leading-relaxed text-muted-foreground">{s.desc}</span>
              </div>
            ))}
            <p className="pt-1 text-[11px] leading-relaxed text-muted-foreground">
              Every user role in Access &amp; audit maps to these classes: the care-worker role, for
              example, sees operational + health data needed on shift but is denied personal/sensitive
              material (contacts, flag analytics, documents). Export the catalog for an AI review with
              the bundle — it is included as insights material.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
