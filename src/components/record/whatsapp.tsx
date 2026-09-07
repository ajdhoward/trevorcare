"use client";

// WhatsApp hub — connects the family's existing group (Dad) and the new group
// (Mum + Mum's care home) through a Whapi.Cloud gateway:
//   · Settings: token + group binding (token stays in this browser only)
//   · Groups: fetched through the server proxy (GET /groups)
//   · Inbox: polls the webhook receiver (/api/whapi/webhook GET) and mirrors
//     messages into the flows — shopping list, tasks, calendar, review flags
//   · Send: test messages to either bound group
//   · Sample loader so every flow is testable before a real token exists

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CircleCheck, ListChecks, Loader2, Mail, MessageSquareText, Plus, RefreshCw, Send,
  Settings2, ShoppingBasket, Siren, Trash2, CalendarPlus,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import type { SystemUser } from "@/lib/access";
import { can } from "@/lib/access";
import type { SysAuditAction } from "@/lib/auditlog";
import { fmtDate } from "@/lib/record";
import {
  type WaSettings, type WaMessage, type ShoppingItem, type MyTask, type TaskFor,
  type EmailRouteSettings, type InboxMessage,
  analyzeWaMessage, WA_SAMPLE_MESSAGES, uid, todayStr, addDays, TASK_FOR_LABELS,
} from "@/lib/family";

export default function WhatsApp({
  actor, settings, onSettingsChange, messages, onMessagesChange, waProcessed, onWaProcessedChange,
  shopping, onShoppingChange, tasks, onTasksChange, onEventsAdd, onAudit,
  emailRoute, onEmailRouteChange,
}: {
  actor: SystemUser;
  settings: WaSettings;
  onSettingsChange: (s: WaSettings) => void;
  messages: WaMessage[];
  onMessagesChange: (m: WaMessage[]) => void;
  waProcessed: Record<string, boolean>;
  onWaProcessedChange: (p: Record<string, boolean>) => void;
  shopping: ShoppingItem[];
  onShoppingChange: (items: ShoppingItem[]) => void;
  tasks: MyTask[];
  onTasksChange: (t: MyTask[]) => void;
  onEventsAdd: (e: { id: string; date: string; time?: string; title: string; source: "whatsapp"; who: TaskFor; details?: string }) => void;
  onAudit: (action: SysAuditAction, target: string, detail: string, severity?: "info" | "notice" | "warning") => void;
  emailRoute: EmailRouteSettings;
  onEmailRouteChange: (s: EmailRouteSettings) => void;
}) {
  const canSend = can(actor, "action.wa_send");
  const canTasks = can(actor, "action.task_manage");
  const [groups, setGroups] = useState<{ id: string; name: string; participants: number | null }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [tokenInput, setTokenInput] = useState(settings.token);
  const [sendTo, setSendTo] = useState<string>(settings.dadGroupId);
  const [sendBody, setSendBody] = useState("");

  const poll = useCallback(async () => {
    try {
      const res = await fetch("/api/whapi/webhook?limit=100");
      const data = (await res.json()) as { ok?: boolean; messages?: WaMessage[] };
      if (data.ok && data.messages && data.messages.length > 0) {
        onMessagesChange(data.messages);
        const known = new Set(messages.map((m) => m.id));
        const fresh = data.messages.filter((m) => !known.has(m.id));
        if (fresh.length > 0) {
          onAudit("wa.ingest", "webhook poll", `${fresh.length} new message(s) mirrored into the portal`, "notice");
        }
      }
    } catch { /* offline — ignore */ }
  }, [messages, onMessagesChange, onAudit]);

  useEffect(() => {
    void poll();
    if (!settings.autoPoll) return;
    const t = setInterval(() => void poll(), 30000);
    return () => clearInterval(t);
  }, [settings.autoPoll, poll]);

  const fetchGroups = async () => {
    if (!tokenInput.trim()) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/whapi/groups", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: tokenInput.trim() }),
      });
      const data = (await res.json()) as { ok?: boolean; groups?: { id: string; name: string; participants: number | null }[]; error?: string };
      if (!res.ok || !data.ok) setMsg(data.error || "Could not list groups.");
      else {
        setGroups(data.groups ?? []);
        setMsg(`Found ${data.groups?.length ?? 0} group(s) on the linked number.`);
      }
    } catch (e) {
      setMsg(String(e));
    } finally {
      setBusy(false);
    }
  };

  const saveSettings = (patch: Partial<WaSettings>) => {
    const next = { ...settings, ...patch };
    next.configured = !!(next.token && (next.dadGroupId || next.mumGroupId));
    onSettingsChange(next);
  };
  const persistToken = () => {
    saveSettings({ token: tokenInput.trim() });
    onAudit("wa.settings", "Whapi token", `token ${tokenInput.trim() ? "set" : "cleared"} by ${actor.name}`, "notice");
  };

  const send = async () => {
    if (!canSend || !sendBody.trim() || !sendTo) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/whapi/send", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: settings.token, to: sendTo, body: sendBody.trim() }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) setMsg(data.error || "Send failed.");
      else {
        setMsg("Message sent to the group.");
        onAudit("wa.send", sendTo === settings.dadGroupId ? "Dad's group" : "Mum's group", sendBody.trim().slice(0, 100), "notice");
        setSendBody("");
      }
    } catch (e) {
      setMsg(String(e));
    } finally {
      setBusy(false);
    }
  };

  const loadSample = () => {
    onMessagesChange([...WA_SAMPLE_MESSAGES, ...messages.filter((m) => !m.id.startsWith("sample-"))]);
    onAudit("wa.sample_load", "sample messages", `${WA_SAMPLE_MESSAGES.length} sample messages loaded for flow testing`, "notice");
  };

  const unprocessed = messages.filter((m) => !waProcessed[m.id]);
  const markDone = (m: WaMessage) => {
    onWaProcessedChange({ ...waProcessed, [m.id]: true });
  };

  // ---- flow actions from a message's analysis
  const addShopping = (name: string, m: WaMessage) => {
    if (!canTasks) return;
    onShoppingChange([
      { id: uid("s"), name, addedBy: m.sender, addedVia: "whatsapp", needed: true, created: todayStr(), forWhom: "dad" },
      ...shopping,
    ]);
    markDone(m);
  };

  return (
    <div className="space-y-4">
      <Card className="border-emerald-200 dark:border-emerald-900">
        <CardContent className="space-y-2 py-4 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <MessageSquareText className="h-4 w-4 text-emerald-600" />
            <p className="font-bold text-teal-900 dark:text-teal-200">WhatsApp group integration (Whapi.Cloud)</p>
            <Badge variant="outline" className="ml-auto">
              {settings.configured ? "connected" : "not configured"}
            </Badge>
          </div>
          <p className="text-muted-foreground">
            Messages posted in the bound groups are pushed to this portal&apos;s webhook and flow into the shopping
            list, tasks, calendar and review flags — e.g. when Dad&apos;s niece-in-law notes he needs bleach, it
            lands on the list automatically. Your token lives only in this browser; requests are proxied by the
            server so it never sits in page history.
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        {/* settings */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base text-teal-900 dark:text-teal-200">
              <Settings2 className="h-4 w-4 text-teal-700 dark:text-teal-300" />
              Gateway setup
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <ol className="list-decimal space-y-0.5 pl-4 text-xs text-muted-foreground">
              <li>Create a Whapi.Cloud account and link your WhatsApp number (scan the QR in their dashboard).</li>
              <li>Paste the API token below and fetch your groups — ids end in <code>@g.us</code>.</li>
              <li>Bind Dad&apos;s existing group (and Mum&apos;s new one once created with Mum's care home).</li>
              <li>In Whapi, set the webhook URL to <code>https://&lt;your-domain&gt;/api/whapi/webhook</code> (events: <em>messages</em>) so replies flow in automatically.</li>
            </ol>
            <div className="space-y-1">
              <Label htmlFor="wa-token">Whapi.Cloud API token</Label>
              <div className="flex gap-2">
                <Input id="wa-token" type="password" placeholder="paste token…" value={tokenInput} onChange={(e) => setTokenInput(e.target.value)} />
                <Button size="sm" variant="outline" onClick={persistToken}>Save</Button>
                <Button size="sm" variant="outline" disabled={busy || !tokenInput.trim()} onClick={fetchGroups}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Fetch groups
                </Button>
              </div>
            </div>
            {msg && <p className="text-xs font-medium text-teal-800 dark:text-teal-300">{msg}</p>}
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="space-y-1">
                <Label>Dad&apos;s group (existing)</Label>
                <GroupPicker
                  value={settings.dadGroupId} label={settings.dadGroupName}
                  groups={groups} placeholder="— bind after fetch —"
                  onPick={(id, name) => saveSettings({ dadGroupId: id, dadGroupName: name })}
                  onAudit={onAudit} actorName={actor.name}
                />
              </div>
              <div className="space-y-1">
                <Label>Mum&apos;s group (new, with the home)</Label>
                <GroupPicker
                  value={settings.mumGroupId} label={settings.mumGroupName}
                  groups={groups} placeholder="— bind after fetch —"
                  onPick={(id, name) => saveSettings({ mumGroupId: id, mumGroupName: name })}
                  onAudit={onAudit} actorName={actor.name}
                />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={settings.autoPoll} onCheckedChange={(v) => saveSettings({ autoPoll: v })} />
              Auto-check for new messages every 30s
            </label>
          </CardContent>
        </Card>

        {/* send */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base text-teal-900 dark:text-teal-200">
              <Send className="h-4 w-4 text-teal-700 dark:text-teal-300" />
              Send to a bound group
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <Label>Group</Label>
              <Select value={sendTo || undefined} onValueChange={setSendTo}>
                <SelectTrigger><SelectValue placeholder="— choose group —" /></SelectTrigger>
                <SelectContent>
                  {settings.dadGroupId && <SelectItem value={settings.dadGroupId}>{settings.dadGroupName}</SelectItem>}
                  {settings.mumGroupId && <SelectItem value={settings.mumGroupId}>{settings.mumGroupName}</SelectItem>}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="wa-body">Message</Label>
              <Textarea id="wa-body" rows={4} value={sendBody} placeholder="e.g. Reminder — the GP review is tomorrow at 10:30." onChange={(e) => setSendBody(e.target.value)} />
            </div>
            <Button size="sm" className="bg-teal-800 hover:bg-teal-700" disabled={!canSend || busy || !sendBody.trim() || !sendTo} onClick={send}>
              <Send className="mr-1 h-3.5 w-3.5" /> Send
            </Button>
            {!canSend && <p className="text-xs text-muted-foreground">Your role cannot send WhatsApp messages (managed in Access &amp; audit).</p>}
            <div className="rounded-md border bg-teal-50/50 p-2.5 text-xs dark:bg-teal-950/20">
              <p className="font-semibold">Proposals use this too</p>
              <p className="mt-0.5 text-muted-foreground">
                Joint-slot proposals in the LPA tab generate a ready-to-send message — paste it here to send to
                Pat&apos;s group, or just WhatsApp it from your phone.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* inbox */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base text-teal-900 dark:text-teal-200">
            <ListChecks className="h-4 w-4 text-teal-700 dark:text-teal-300" />
            Group inbox → portal flows
            {unprocessed.length > 0 && (
              <Badge variant="outline" className="ml-auto border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200">
                {unprocessed.length} new
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => void poll()}>
              <RefreshCw className="mr-1 h-3.5 w-3.5" /> Check now
            </Button>
            <Button size="sm" variant="outline" onClick={loadSample}>
              Load sample messages
            </Button>
          </div>
          {messages.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No messages yet. Once the webhook is set up in Whapi, group messages appear here — or load the
              samples to see how the flows work.
            </p>
          ) : (
            <div className="max-h-[30rem] space-y-2 overflow-y-auto">
              {messages.map((m) => {
                const a = analyzeWaMessage(m.body);
                const done = !!waProcessed[m.id];
                return (
                  <div key={m.id} className={`rounded-lg border p-2.5 ${done ? "opacity-60" : ""}`}>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span className="font-semibold text-foreground">{m.sender}</span>
                      <span>{fmtDate(m.ts.slice(0, 10))} {m.ts.slice(11, 16)}</span>
                      <Badge variant="outline" className="h-4 px-1 text-[10px]">{m.groupName || m.groupId}</Badge>
                      {done && <Badge variant="outline" className="ml-auto h-4 px-1 text-[10px]">handled</Badge>}
                    </div>
                    <p className="mt-1 text-sm">{m.body}</p>
                    {!done && (a.shopping.length > 0 || a.concern || a.appointment) && (
                      <div className="mt-2 space-y-1.5 rounded-md bg-teal-50/70 p-2 dark:bg-teal-950/30">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Spotted for the flows</p>
                        {a.shopping.length > 0 && (
                          <div className="flex flex-wrap items-center gap-1.5 text-xs">
                            <ShoppingBasket className="h-3.5 w-3.5 text-teal-700" />
                            {a.shopping.map((s) => (
                              <Button key={s} size="sm" variant="outline" className="h-6 px-2 text-[11px]" disabled={!canTasks}
                                onClick={() => addShopping(s, m)}>
                                + {s} → shopping list
                              </Button>
                            ))}
                          </div>
                        )}
                        {a.concern && (
                          <div className="flex flex-wrap items-center gap-1.5 text-xs">
                            <Siren className="h-3.5 w-3.5 text-rose-500" />
                            <span className="font-medium">{a.concern.label}</span>
                            <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]" disabled={!canTasks}
                              onClick={() => {
                                if (!canTasks) return;
                                onTasksChange([
                                  {
                                    id: uid("t"),
                                    title: `Review WhatsApp concern (${a.concern!.label.toLowerCase()}) from ${m.sender}`,
                                    category: "review", due: addDays(todayStr(), 1), assignee: "either",
                                    forWhom: "dad", done: false, created: todayStr(), source: "whatsapp",
                                    notes: m.body.slice(0, 200),
                                  },
                                  ...tasks,
                                ]);
                                markDone(m);
                              }}>
                              + create review task
                            </Button>
                          </div>
                        )}
                        {a.appointment && (
                          <div className="flex flex-wrap items-center gap-1.5 text-xs">
                            <CalendarPlus className="h-3.5 w-3.5 text-teal-700" />
                            <span>
                              Possible appointment{a.appointment.date ? ` — ${a.appointment.date}` : ""}
                              {a.appointment.time ? ` ${a.appointment.time}` : ""}
                            </span>
                            <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]" disabled={!canTasks}
                              onClick={() => {
                                if (!canTasks) return;
                                onEventsAdd({
                                  id: uid("e"), date: a.appointment!.date || todayStr(), time: a.appointment!.time,
                                  title: `From WhatsApp: ${a.appointment!.text.slice(0, 80)}`,
                                  source: "whatsapp", who: "dad",
                                });
                                markDone(m);
                              }}>
                              + add to calendar
                            </Button>
                          </div>
                        )}
                      </div>
                    )}
                    {!done && (
                      <Button size="sm" variant="ghost" className="mt-1 h-6 text-xs" onClick={() => markDone(m)}>
                        <CircleCheck className="mr-1 h-3.5 w-3.5 text-emerald-600" /> Mark handled
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* dedicated email interface */}
      <CareInbox actor={actor} emailRoute={emailRoute} onEmailRouteChange={onEmailRouteChange} onAudit={onAudit} />
    </div>
  );
}

function GroupPicker({
  value, label, groups, placeholder, onPick, onAudit, actorName,
}: {
  value: string;
  label: string;
  groups: { id: string; name: string; participants: number | null }[] | null;
  placeholder: string;
  onPick: (id: string, name: string) => void;
  onAudit: (action: SysAuditAction, target: string, detail: string, severity?: "info" | "notice" | "warning") => void;
  actorName: string;
}) {
  const current = groups?.find((g) => g.id === value);
  return (
    <div className="space-y-1">
      <Select
        value={value || undefined}
        onValueChange={(id) => {
          const g = groups?.find((x) => x.id === id);
          if (g) {
            onPick(g.id, g.name);
            onAudit("wa.settings", g.name, `group bound by ${actorName} (${g.id})`, "notice");
          }
        }}
      >
        <SelectTrigger><SelectValue placeholder={placeholder} /></SelectTrigger>
        <SelectContent className="max-h-64">
          {(groups ?? (value ? [{ id: value, name: label, participants: null }] : [])).map((g) => (
            <SelectItem key={g.id} value={g.id}>{g.name}{g.participants ? ` (${g.participants})` : ""}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      {value && (
        <p className="truncate text-[11px] text-muted-foreground">
          <Trash2 className="mr-1 inline h-3 w-3" aria-hidden />
          {current ? `${current.name} — ` : ""}{value}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- care inbox
// The family's dedicated email address, interfaced into the portal:
//  · when deployed on Cloudflare, Email Routing → Email Worker → POST /api/inbox
//  · the portal polls GET /api/inbox and lists what arrived
//  · emails can also be logged manually so the record stays complete
function CareInbox({
  actor, emailRoute, onEmailRouteChange, onAudit,
}: {
  actor: SystemUser;
  emailRoute: EmailRouteSettings;
  onEmailRouteChange: (s: EmailRouteSettings) => void;
  onAudit: (action: SysAuditAction, target: string, detail: string, severity?: "info" | "notice" | "warning") => void;
}) {
  const [inbox, setInbox] = useState<InboxMessage[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [manual, setManual] = useState({ from: "", subject: "", body: "" });
  const [note, setNote] = useState<string | null>(null);

  const poll = useCallback(async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/inbox?limit=100");
      const data = (await res.json()) as { ok?: boolean; messages?: InboxMessage[] };
      if (data.ok && data.messages) setInbox(data.messages);
    } catch { /* offline */ } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void poll();
  }, [poll]);

  const logManual = async () => {
    if (!manual.subject.trim() && !manual.body.trim()) return;
    setBusy(true);
    try {
      const res = await fetch("/api/inbox", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from: manual.from || "(logged manually)", subject: manual.subject, body: manual.body }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (data.ok) {
        setNote("Email logged into the care inbox.");
        onAudit("inbox.ingest", manual.subject || "(no subject)", `logged manually by ${actor.name}`, "notice");
        setManual({ from: "", subject: "", body: "" });
        void poll();
      } else setNote(data.error || "Could not log the email.");
    } catch (e) {
      setNote(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base text-teal-900 dark:text-teal-200">
          <Mail className="h-4 w-4 text-teal-700 dark:text-teal-300" />
          Care inbox — your dedicated email address
          <Button size="sm" variant="outline" className="ml-auto" onClick={() => void poll()} disabled={busy}>
            <RefreshCw className={`mr-1 h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} /> Check
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="ce-addr">Dedicated care address</Label>
            <Input
              id="ce-addr" placeholder="e.g. care@yourdomain.com"
              value={emailRoute.dedicatedAddress}
              onChange={(e) => onEmailRouteChange({ ...emailRoute, dedicatedAddress: e.target.value })}
              onBlur={() => onAudit("email.route", "dedicated address", emailRoute.dedicatedAddress || "(set)", "notice")}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ce-fwd">Forward copies to (your normal inbox)</Label>
            <Input
              id="ce-fwd" placeholder="e.g. you@personal.com"
              value={emailRoute.forwardTo}
              onChange={(e) => onEmailRouteChange({ ...emailRoute, forwardTo: e.target.value })}
              onBlur={() => onAudit("email.route", "forwarding", emailRoute.forwardTo || "(set)", "notice")}
            />
          </div>
        </div>
        <p className="rounded-md border bg-teal-50/50 p-2.5 text-xs text-muted-foreground dark:bg-teal-950/20">
          <span className="font-semibold text-foreground">How email reaches this portal:</span> when the hub is
          deployed on Cloudflare, set Email Routing on your domain to send mail for the dedicated address to an
          Email Worker that POSTs <code>{"{ from, subject, body }"}</code> to{" "}
          <code>/api/inbox</code>. Until then, log important emails manually below (or use the email
          templates in Mum&apos;s tab, which keep everything in the log).
        </p>
        <div className="grid gap-2 sm:grid-cols-3">
          <Input placeholder="From (who sent it)" value={manual.from} onChange={(e) => setManual({ ...manual, from: e.target.value })} />
          <Input placeholder="Subject" value={manual.subject} onChange={(e) => setManual({ ...manual, subject: e.target.value })} />
          <Input placeholder="Key points…" value={manual.body} onChange={(e) => setManual({ ...manual, body: e.target.value })} />
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={logManual} disabled={busy}>
            <Plus className="mr-1 h-3.5 w-3.5" /> Log an email manually
          </Button>
          {note && <span className="text-xs font-medium text-teal-800 dark:text-teal-300">{note}</span>}
        </div>
        {inbox === null ? (
          <p className="text-sm text-muted-foreground">Checking the inbox…</p>
        ) : inbox.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing has arrived yet. Emails POSTed to <code>/api/inbox</code> (or logged above) will show here.
          </p>
        ) : (
          <div className="max-h-64 space-y-1.5 overflow-y-auto">
            {inbox.map((m) => (
              <div key={m.id} className="rounded-md border px-2.5 py-1.5 text-sm">
                <p className="text-xs text-muted-foreground">
                  <span className="font-semibold text-foreground">{m.from}</span> · {m.ts.slice(0, 16).replace("T", " ")}
                </p>
                {m.subject && <p className="font-medium">{m.subject}</p>}
                <p className="line-clamp-2 text-xs">{m.body}</p>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export { CareInbox };
