"use client";

// Tracker card + exit-event log (Systems Review P1) — lives inside the
// Family circle (Life360) tab as the complementary location layer.

import { useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  BatteryLow, Check, Clock3, Info, MapPin, Plus, Watch, Trash2,
} from "lucide-react";
import {
  type TrackerExit, type TrackerStatus, type TrackerStore, FITTING_CHECKLIST,
} from "@/lib/tracker";
import type { SysAuditAction } from "@/lib/auditlog";

const STATUS_STYLES: Record<TrackerStatus, string> = {
  ordered: "border-amber-300 bg-amber-50 text-amber-900",
  fitting: "border-sky-300 bg-sky-50 text-sky-900",
  active: "border-emerald-300 bg-emerald-50 text-emerald-900",
  removed: "border-neutral-300 bg-neutral-50 text-neutral-700",
};

export interface TrackerPanelProps {
  store: TrackerStore;
  onChange: (next: TrackerStore) => void;
  exits: TrackerExit[];
  onExitsChange: (next: TrackerExit[]) => void;
  onAudit: (action: SysAuditAction, target: string, detail: string, severity?: "info" | "notice" | "warning") => void;
}

export function TrackerPanel({ store, onChange, exits, onExitsChange, onAudit }: TrackerPanelProps) {
  const [ts, setTs] = useState("");
  const [lastSeen, setLastSeen] = useState("");
  const [source, setSource] = useState<TrackerExit["source"]>("tracker");
  const [battery, setBattery] = useState("");
  const [note, setNote] = useState("");

  const doneSteps = useMemo(
    () => FITTING_CHECKLIST.filter((s) => store.checklist[s.id]).length,
    [store.checklist]
  );

  const patch = (p: Partial<TrackerStore>) => {
    onChange({ ...store, ...p, updatedBy: "you", updatedAt: new Date().toISOString() });
  };

  const toggleStep = (id: string) => {
    const checklist = { ...store.checklist, [id]: !store.checklist[id] };
    patch({ checklist });
    const label = FITTING_CHECKLIST.find((s) => s.id === id)?.label ?? id;
    onAudit("tracker.update", "tracker fitting checklist", checklist[id] ? `step ticked: ${label}` : `step unticked: ${label}`);
  };

  const setStatus = (status: TrackerStatus) => {
    patch({ status, lastChecked: new Date().toISOString().slice(0, 10) });
    onAudit("tracker.update", store.deviceName, `tracker status set to ${status}`, "notice");
  };

  const addExit = () => {
    if (!lastSeen.trim()) return;
    const entry: TrackerExit = {
      id: `x-${Date.now()}`,
      ts: ts ? new Date(ts).toISOString() : new Date().toISOString(),
      lastSeen: lastSeen.trim(),
      source,
      batteryPct: battery ? Math.min(100, Math.max(0, Number(battery))) : undefined,
      note: note.trim() || undefined,
      loggedBy: "you",
    };
    onExitsChange([entry, ...exits]);
    onAudit("tracker.exit.add", entry.lastSeen, `exit event logged (${entry.source}${entry.batteryPct != null ? `, battery ${entry.batteryPct}%` : ""})`, "notice");
    setTs("");
    setLastSeen("");
    setBattery("");
    setNote("");
  };

  const removeExit = (x: TrackerExit) => {
    onExitsChange(exits.filter((e) => e.id !== x.id));
    onAudit("tracker.exit.delete", x.lastSeen, "exit event removed from the log", "notice");
  };

  const exportExits = () => {
    const rows = [["timestamp", "lastSeen", "source", "batteryPct", "note", "loggedBy"]];
    for (const x of [...exits].sort((a, b) => a.ts.localeCompare(b.ts))) {
      rows.push([x.ts, x.lastSeen, x.source, x.batteryPct != null ? String(x.batteryPct) : "", (x.note ?? "").replace(/\s+/g, " "), x.loggedBy]);
    }
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "tracker_exit_log.csv";
    a.click();
    URL.revokeObjectURL(url);
    onAudit("export.file", "tracker_exit_log.csv", "tracker exit-event log exported (elopement evidence)", "notice");
  };

  return (
    <div className="space-y-4">
      {/* status card */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Watch className="h-4 w-4 text-teal-700" /> Bluetooth tracker — interim safety adjunct
          </CardTitle>
          <CardDescription>
            Crowd-sourced Bluetooth network · ~1-year battery · locked to the wrist like a watch.
            It logs location <em>after</em> an exit — it does not prevent one, cannot raise geofence
            alarms, and discharges no statutory duty. Life360 stays as the complementary phone layer.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className={`text-[11px] ${STATUS_STYLES[store.status]}`}>{store.status}</Badge>
            <span className="text-xs text-muted-foreground">{store.deviceName} · {store.network} · {store.wearing}</span>
            <div className="ml-auto flex gap-1.5">
              {(["ordered", "fitting", "active"] as TrackerStatus[]).map((s) => (
                <Button
                  key={s}
                  size="sm"
                  variant={store.status === s ? "default" : "outline"}
                  className={`h-7 px-2 text-[11px] ${store.status === s ? "bg-teal-800 hover:bg-teal-700" : ""}`}
                  onClick={() => setStatus(s)}
                >
                  {s}
                </Button>
              ))}
            </div>
          </div>

          <div className="rounded-lg border p-3">
            <p className="mb-2 flex items-center justify-between text-xs font-semibold">
              <span>Fitting &amp; daily-check checklist</span>
              <span className="text-muted-foreground">{doneSteps}/{FITTING_CHECKLIST.length} done</span>
            </p>
            <div className="space-y-1.5">
              {FITTING_CHECKLIST.map((s) => (
                <label key={s.id} className="flex cursor-pointer items-start gap-2 text-xs leading-relaxed">
                  <Checkbox
                    checked={!!store.checklist[s.id]}
                    onCheckedChange={() => toggleStep(s.id)}
                    className="mt-0.5"
                    aria-label={s.label}
                  />
                  <span className={store.checklist[s.id] ? "text-muted-foreground line-through" : ""}>{s.label}</span>
                </label>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* exit-event log */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center justify-between gap-2 text-base">
            <span className="flex items-center gap-2"><MapPin className="h-4 w-4 text-teal-700" /> Tracker exit-event log</span>
            <Button size="sm" variant="outline" onClick={exportExits}>Export CSV</Button>
          </CardTitle>
          <CardDescription>
            Structured record of exit events, last-seen locations and battery checks — feeding the
            elopement theme, the safeguarding pack and the composite confirmation of the call-spike alert.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2 rounded-xl border bg-teal-50/40 p-3 sm:grid-cols-2 dark:bg-teal-950/10">
            <div>
              <Label htmlFor="x-ts">When (leave blank for now)</Label>
              <Input id="x-ts" type="datetime-local" value={ts} onChange={(e) => setTs(e.target.value)} className="mt-1.5" />
            </div>
            <div>
              <Label htmlFor="x-src">Source</Label>
              <Select value={source} onValueChange={(v) => setSource(v as TrackerExit["source"])}>
                <SelectTrigger id="x-src" className="mt-1.5"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="tracker">tracker last-seen</SelectItem>
                  <SelectItem value="life360">Life360</SelectItem>
                  <SelectItem value="family">family sighting</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="x-seen">Last-seen location</Label>
              <Input id="x-seen" value={lastSeen} onChange={(e) => setLastSeen(e.target.value)} className="mt-1.5" placeholder="where he was found / last pinged" />
            </div>
            <div>
              <Label htmlFor="x-bat">Tracker battery (%)</Label>
              <Input id="x-bat" type="number" min={0} max={100} value={battery} onChange={(e) => setBattery(e.target.value)} className="mt-1.5" placeholder="e.g. 84" />
            </div>
            <div>
              <Label htmlFor="x-note">Note</Label>
              <Input id="x-note" value={note} onChange={(e) => setNote(e.target.value)} className="mt-1.5" placeholder="context, who found him, what followed" />
            </div>
            <div className="sm:col-span-2">
              <Button size="sm" className="bg-teal-800 hover:bg-teal-700" disabled={!lastSeen.trim()} onClick={addExit}>
                <Plus className="mr-1.5 h-3.5 w-3.5" /> Log exit event
              </Button>
            </div>
          </div>

          <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
            {exits.length === 0 && <p className="text-xs text-muted-foreground">No exit events logged yet.</p>}
            {exits.map((x) => (
              <div key={x.id} className="flex items-start gap-2.5 rounded-lg border p-2.5 text-sm">
                {x.batteryPct != null && x.batteryPct < 25 ? (
                  <BatteryLow className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
                ) : (
                  <Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-teal-700" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{x.lastSeen}</p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(x.ts).toLocaleString("en-GB")} · source: {x.source}
                    {x.batteryPct != null ? ` · battery ${x.batteryPct}%` : ""} · logged by {x.loggedBy}
                  </p>
                  {x.note && <p className="mt-0.5 text-xs text-foreground/80">{x.note}</p>}
                </div>
                <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" aria-label="Remove exit event" onClick={() => removeExit(x)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>

          <p className="flex items-start gap-1.5 rounded-lg border border-teal-200 bg-teal-50/60 p-2.5 text-xs text-muted-foreground dark:bg-teal-950/20">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-teal-700" />
            Provenance: family-logged. Exit events are first-class evidence — export the CSV into the
            safeguarding pack after every incident.
          </p>
          {exits.length > 0 && store.status === "active" && (
            <p className="flex items-center gap-1.5 text-xs text-emerald-700">
              <Check className="h-3.5 w-3.5" /> Tracker active — {exits.length} exit event(s) recorded.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
