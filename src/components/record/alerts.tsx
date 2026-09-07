"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BellRing, Check, Mail, Play, RotateCcw, Siren, Trash2, ChevronDown, ChevronUp,
  Plus, Clock,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import type { CareRecord, WellbeingData } from "@/lib/record";
import { fmtDate } from "@/lib/record";
import type { SystemUser } from "@/lib/access";
import { can } from "@/lib/access";
import {
  type AlertRule, type AlertState, type FiringAlert, type MetricId, type AlertExtra,
  METRICS, FLAG_THEME_KEYS, defaultRules, evaluateAlerts, buildAlertEmail,
} from "@/lib/alerts";
import { logEvent, ACTION_LABELS } from "@/lib/auditlog";
import { ROLES } from "@/lib/access";

const SEV_BADGE: Record<string, string> = {
  critical: "border-rose-300 bg-rose-100 text-rose-800 dark:border-rose-800 dark:bg-rose-950/50 dark:text-rose-200",
  warning: "border-amber-300 bg-amber-100 text-amber-800 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200",
  info: "border-teal-200 bg-teal-50 text-teal-800 dark:border-teal-800 dark:bg-teal-950/40 dark:text-teal-200",
};

export default function Alerts({
  record,
  wellbeing,
  actor,
  onNavigate,
  rules,
  onRulesChange,
  alertState,
  onAlertStateChange,
  alertExtra,
}: {
  record: CareRecord;
  wellbeing: WellbeingData | null;
  actor: SystemUser;
  onNavigate: (tab: string) => void;
  rules: AlertRule[];
  onRulesChange: (rules: AlertRule[]) => void;
  alertState: AlertState;
  onAlertStateChange: (state: AlertState) => void;
  alertExtra?: AlertExtra;
}) {
  const canManage = can(actor, "action.alerts_manage");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [draft, setDraft] = useState<{ key: string; subject: string; body: string } | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<{ metric: MetricId; threshold: string; days: string; theme: string; severity: "critical" | "warning" | "info"; email: boolean }>({
    metric: "flag_theme", threshold: "3", days: "7", theme: "confus", severity: "warning", email: false,
  });

  const log = (action: Parameters<typeof logEvent>[0]["action"], target: string, detail: string, severity: "info" | "notice" | "warning" = "info") =>
    logEvent({ actor: actor.name, actorRole: ROLES[actor.role].label, action, target, detail, severity });

  // evaluation is pure — derive firing alerts directly from the current inputs
  const firing = useMemo(
    () => evaluateAlerts(record, wellbeing, rules, alertState, alertExtra),
    [record, wellbeing, rules, alertState, alertExtra, tick]
  );

  const persistRules = (next: AlertRule[]) => onRulesChange(next);
  const persistState = (next: AlertState) => onAlertStateChange(next);

  const ack = (a: FiringAlert) => {
    log("alert.ack", a.label, `acknowledged by ${actor.name}`, "notice");
    persistState({
      ...alertState,
      [a.key]: { status: "ack", firstTs: alertState[a.key]?.firstTs ?? new Date().toISOString(), lastTs: new Date().toISOString() },
    });
  };
  const resolve = (a: FiringAlert) => {
    log("alert.resolve", a.label, `resolved by ${actor.name}`, "notice");
    persistState({
      ...alertState,
      [a.key]: { status: "resolved", firstTs: alertState[a.key]?.firstTs ?? new Date().toISOString(), lastTs: new Date().toISOString() },
    });
  };

  const makeEmail = (a: FiringAlert) => {
    const em = buildAlertEmail(a, record, `${actor.name} (family oversight)`);
    setDraft({ key: a.key, subject: em.subject, body: em.body });
    log("alert.email_draft", a.label, "pre-drafted alert email opened (recipient: chosen by sender)", "info");
  };

  const counts = useMemo(() => {
    const live = firing.filter((f) => f.status !== "resolved");
    return {
      critical: live.filter((f) => f.severity === "critical").length,
      warning: live.filter((f) => f.severity === "warning").length,
      info: live.filter((f) => f.severity === "info").length,
    };
  }, [firing]);

  const addRule = () => {
    const m = METRICS[form.metric];
    const th = Number(form.threshold);
    if (!isFinite(th)) return;
    const themeKey = FLAG_THEME_KEYS.find((t) => t.k === form.theme)?.label || form.theme;
    const label =
      form.metric === "flag_theme"
        ? `${themeKey} notes ${m.dir === "above" ? `${th}+` : `below ${th}`} in ${form.days} days`
        : `${m.label} ${m.dir === "above" ? "above" : "below"} ${th}${m.unit ? " " + m.unit : ""}${m.window ? ` (${form.days}d)` : ""}`;
    const rule: AlertRule = {
      id: `r-${Date.now().toString(36)}`,
      label,
      metric: form.metric,
      threshold: th,
      days: Number(form.days) || 0,
      theme: form.metric === "flag_theme" ? form.theme : undefined,
      severity: form.severity,
      enabled: true,
      email: form.email,
      created: new Date().toISOString().slice(0, 10),
    };
    log("alert.rule.add", label, `metric=${form.metric} threshold=${th} days=${form.days} severity=${form.severity}`, "notice");
    persistRules([...rules, rule]);
    setAdding(false);
  };

  const updateRule = (id: string, patch: Partial<AlertRule>) => {
    const next = rules.map((r) => (r.id === id ? { ...r, ...patch } : r));
    const r = rules.find((x) => x.id === id);
    log("alert.rule.update", r?.label || id, `changed: ${Object.keys(patch).join(", ")}`, "notice");
    persistRules(next);
  };
  const deleteRule = (r: AlertRule) => {
    log("alert.rule.delete", r.label, `rule deleted (was ${r.severity})`, "warning");
    persistRules(rules.filter((x) => x.id !== r.id));
  };

  return (
    <div className="space-y-4">
      {/* header strip */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Siren className={`h-5 w-5 ${counts.critical ? "text-rose-600" : "text-teal-700"}`} />
          <span className="text-sm font-semibold">
            {counts.critical + counts.warning + counts.info} live alerts
          </span>
          {(["critical", "warning", "info"] as const).map((s) =>
            counts[s] > 0 ? (
              <Badge key={s} variant="outline" className={SEV_BADGE[s]}>
                {counts[s]} {s}
              </Badge>
            ) : null
          )}
        </div>
        <div className="ml-auto flex items-center gap-2">
          {record.generated && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="h-3.5 w-3.5" />
              live — re-evaluated on every change
            </span>
          )}
          <Button size="sm" variant="outline" onClick={() => { setTick((t) => t + 1); log("alert.evaluate", "all rules", `${rules.filter((r) => r.enabled).length} enabled rules evaluated`); }}>
            <Play className="mr-1 h-3.5 w-3.5" /> Re-evaluate
          </Button>
          {canManage && (
            <Button size="sm" variant="ghost" onClick={() => { log("alert.rule.add", "defaults restored", `${defaultRules().length} default rules restored`, "notice"); persistRules(defaultRules()); }}>
              <RotateCcw className="mr-1 h-3.5 w-3.5" /> Restore defaults
            </Button>
          )}        </div>
      </div>

      {/* firing alerts */}
      <div className="space-y-2">
        {firing.filter((f) => f.status !== "resolved").length === 0 && firing.length === 0 && (
          <Card className="border-emerald-200 bg-emerald-50/60 dark:border-emerald-900 dark:bg-emerald-950/30">
            <CardContent className="flex items-center gap-3 py-4 text-sm text-emerald-900 dark:text-emerald-200">
              <Check className="h-5 w-5" />
              All {rules.filter((r) => r.enabled).length} enabled rules are quiet — nothing needs your attention right now.
            </CardContent>
          </Card>
        )}
        {firing.map((a) => {
          const isOpen = expanded === a.key;
          const resolved = a.status === "resolved";
          if (resolved) return null;
          return (
            <Card key={a.key} className={a.severity === "critical" ? "border-rose-300" : ""}>
              <CardContent className="py-3">
                <div className="flex flex-wrap items-start gap-2">
                  <Badge variant="outline" className={SEV_BADGE[a.severity]}>{a.severity}</Badge>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{a.label}</p>
                    <p className="text-xs text-muted-foreground">{a.message}</p>
                    {a.firstTs && (
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        first fired {a.firstTs.replace("T", " ").slice(0, 16)}
                        {a.status === "ack" ? " · acknowledged" : ""}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Button size="sm" variant="outline" onClick={() => setExpanded(isOpen ? null : a.key)}>
                      {isOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                      Evidence ({a.evidence.length})
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => onNavigate(a.linkTab)}>Open</Button>
                    {rules.find((r) => r.id === a.ruleId)?.email && (
                      <Button size="sm" variant="outline" onClick={() => makeEmail(a)}>
                        <Mail className="mr-1 h-3.5 w-3.5" /> Draft email
                      </Button>
                    )}
                    {canManage && a.status !== "ack" && (
                      <Button size="sm" variant="outline" onClick={() => ack(a)}><Check className="mr-1 h-3.5 w-3.5" /> Acknowledge</Button>
                    )}
                    {canManage && (
                      <Button size="sm" variant="ghost" className="text-emerald-700" onClick={() => resolve(a)}>Resolve</Button>
                    )}
                  </div>
                </div>
                {isOpen && (
                  <ul className="mt-2 space-y-1 rounded-lg bg-muted/40 p-3 text-xs leading-relaxed">
                    {a.evidence.map((e, i) => (
                      <li key={i} className="break-words">• {e}</li>
                    ))}
                  </ul>
                )}
                {draft?.key === a.key && (
                  <div className="mt-3 rounded-lg border bg-background p-3">
                    <p className="mb-1 text-xs font-semibold"><Mail className="mr-1 inline h-3.5 w-3.5" />{draft.subject}</p>
                    <pre className="max-h-56 overflow-auto whitespace-pre-wrap text-[11px] leading-relaxed text-muted-foreground">{draft.body}</pre>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        className="bg-teal-800 hover:bg-teal-700"
                        onClick={() => {
                          const to = record.client.contacts.find((c) => /son|daughter|family|kin/i.test(c.relationship))?.telNo1
                            ? ""
                            : "";
                          window.location.href = `mailto:?subject=${encodeURIComponent(draft.subject)}&body=${encodeURIComponent(draft.body)}${to}`;
                        }}
                      >
                        <Mail className="mr-1 h-3.5 w-3.5" /> Open in email app
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => navigator.clipboard.writeText(`${draft.subject}\n\n${draft.body}`)}>
                        Copy
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>Close</Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* rules table */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <BellRing className="h-5 w-5 text-teal-700" /> Watch rules ({rules.length})
            </CardTitle>
            {canManage && (
              <Button size="sm" variant="outline" onClick={() => setAdding((v) => !v)}>
                <Plus className="mr-1 h-3.5 w-3.5" /> {adding ? "Cancel" : "Add rule"}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {adding && canManage && (
            <div className="grid gap-2 rounded-lg border bg-muted/30 p-3 sm:grid-cols-2 lg:grid-cols-6">
              <div className="space-y-1">
                <Label className="text-xs">Signal</Label>
                <Select value={form.metric} onValueChange={(v) => setForm({ ...form, metric: v as MetricId })}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(METRICS) as MetricId[]).map((m) => (
                      <SelectItem key={m} value={m}>{METRICS[m].label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">{METRICS[form.metric].dir === "above" ? "Fires above" : "Fires below"}</Label>
                <Input value={form.threshold} onChange={(e) => setForm({ ...form, threshold: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Window (days)</Label>
                <Input value={form.days} onChange={(e) => setForm({ ...form, days: e.target.value })} disabled={!METRICS[form.metric].window} />
              </div>
              {form.metric === "flag_theme" ? (
                <div className="space-y-1">
                  <Label className="text-xs">Theme</Label>
                  <Select value={form.theme} onValueChange={(v) => setForm({ ...form, theme: v })}>
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {FLAG_THEME_KEYS.map((t) => (
                        <SelectItem key={t.k} value={t.k}>{t.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : (
                <div className="space-y-1">
                  <Label className="text-xs">Severity</Label>
                  <Select value={form.severity} onValueChange={(v) => setForm({ ...form, severity: v as typeof form.severity })}>
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="critical">critical</SelectItem>
                      <SelectItem value="warning">warning</SelectItem>
                      <SelectItem value="info">info</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
              {form.metric === "flag_theme" && (
                <div className="space-y-1">
                  <Label className="text-xs">Severity</Label>
                  <Select value={form.severity} onValueChange={(v) => setForm({ ...form, severity: v as typeof form.severity })}>
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="critical">critical</SelectItem>
                      <SelectItem value="warning">warning</SelectItem>
                      <SelectItem value="info">info</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="flex items-end gap-2">
                <div className="flex items-center gap-1.5 pb-2">
                  <Checkbox id="r-email" checked={form.email} onCheckedChange={(v) => setForm({ ...form, email: v === true })} />
                  <Label htmlFor="r-email" className="text-xs">Email draft</Label>
                </div>
                <Button size="sm" className="ml-auto bg-teal-800 hover:bg-teal-700" onClick={addRule}>Add</Button>
              </div>
              <p className="text-[11px] text-muted-foreground lg:col-span-6">{METRICS[form.metric].help}</p>
            </div>
          )}

          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Rule</TableHead>
                  <TableHead>Signal</TableHead>
                  <TableHead>Severity</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>On</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rules.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="max-w-[280px] text-xs font-medium">{r.label}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {METRICS[r.metric].label}
                      {r.theme ? ` · ${FLAG_THEME_KEYS.find((t) => t.k === r.theme)?.label || r.theme}` : ""}
                    </TableCell>
                    <TableCell>
                      {canManage ? (
                        <Select value={r.severity} onValueChange={(v) => updateRule(r.id, { severity: v as AlertRule["severity"] })}>
                          <SelectTrigger className="h-7 w-28 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="critical">critical</SelectItem>
                            <SelectItem value="warning">warning</SelectItem>
                            <SelectItem value="info">info</SelectItem>
                          </SelectContent>
                        </Select>
                      ) : (
                        <Badge variant="outline" className={SEV_BADGE[r.severity]}>{r.severity}</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <Checkbox
                        checked={r.email}
                        disabled={!canManage}
                        onCheckedChange={(v) => updateRule(r.id, { email: v === true })}
                        aria-label={`Email draft for ${r.label}`}
                      />
                    </TableCell>
                    <TableCell>
                      <Switch checked={r.enabled} disabled={!canManage} onCheckedChange={(v) => updateRule(r.id, { enabled: v })} />
                    </TableCell>
                    <TableCell>
                      {canManage && (
                        <Button variant="ghost" size="icon" onClick={() => deleteRule(r)} aria-label={`Delete ${r.label}`}>
                          <Trash2 className="h-4 w-4 text-rose-600" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Rules are evaluated against the exported record each time the interface loads and whenever
            you press Re-evaluate — the same engine runs on the Cloudflare Worker for scheduled
            checks (see cron trigger in the worker kit). Alerts are deduplicated per window: a rule
            firing on the same 7-day window won&apos;t re-notify until the window moves. {ACTION_LABELS["alert.rule.add"]}, acknowledgement and resolution are all written to the audit trail.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
