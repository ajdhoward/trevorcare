"use client";

import { useMemo, useState } from "react";
import {
  UsersRound, ShieldCheck, ScrollText, UserPlus, Trash2, Download, Check, Minus,
  AlertTriangle, RefreshCcw, History,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  ROLES, ROLE_ORDER, ROLE_PERMISSIONS, ALL_PERMISSIONS, PERMISSION_LABELS,
  can, type SystemUser, type RoleId, type UserStatus, type Permission,
} from "@/lib/access";
import {
  listEvents, verifyChain, exportEventsCsv, exportEventsJson, clearEvents,
  logEvent, ACTION_LABELS, type SysAuditEvent, type SysAuditAction,
} from "@/lib/auditlog";

const SEV_STYLE: Record<string, string> = {
  info: "border-zinc-300 bg-zinc-100 text-zinc-700 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
  notice: "border-teal-200 bg-teal-50 text-teal-800 dark:border-teal-800 dark:bg-teal-950/40 dark:text-teal-200",
  warning: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200",
};

function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export default function Governance({
  actor,
  users,
  onSwitchUser,
  onUsersChange,
}: {
  actor: SystemUser;
  users: SystemUser[];
  onSwitchUser: (id: string) => void;
  onUsersChange: (users: SystemUser[]) => void;
}) {
  const canManage = can(actor, "action.users_manage");
  const [tab, setTab] = useState<"users" | "matrix" | "trail">("users");
  const [q, setQ] = useState("");
  const [events, setEvents] = useState<SysAuditEvent[]>([]);
  const [newUser, setNewUser] = useState({ name: "", email: "", role: "carer" as RoleId, note: "" });

  const refreshEvents = () => setEvents(listEvents());

  const log = (action: SysAuditAction, target: string, detail: string, severity: SysAuditEvent["severity"] = "info") =>
    logEvent({
      actor: actor.name,
      actorRole: ROLES[actor.role].label,
      action,
      target,
      detail,
      severity,
    });

  const changeRole = (u: SystemUser, role: RoleId) => {
    if (!canManage || u.id === actor.id) return;
    log("user.update", `${u.name} <${u.email}>`, `role changed: ${ROLES[u.role].label} → ${ROLES[role].label}`, "notice");
    onUsersChange(users.map((x) => (x.id === u.id ? { ...x, role } : x)));
  };
  const changeStatus = (u: SystemUser, status: UserStatus) => {
    if (!canManage || u.id === actor.id) return;
    log("user.update", `${u.name} <${u.email}>`, `status changed: ${u.status} → ${status}`, status === "suspended" ? "warning" : "notice");
    onUsersChange(users.map((x) => (x.id === u.id ? { ...x, status } : x)));
  };
  const removeUser = (u: SystemUser) => {
    if (!canManage || u.id === actor.id) return;
    log("user.delete", `${u.name} <${u.email}>`, `removed user with role ${ROLES[u.role].label}`, "warning");
    onUsersChange(users.filter((x) => x.id !== u.id));
  };
  const addUser = () => {
    if (!canManage || !newUser.name.trim() || !newUser.email.trim()) return;
    const u: SystemUser = {
      id: `u-${Date.now().toString(36)}`,
      name: newUser.name.trim(),
      email: newUser.email.trim(),
      role: newUser.role,
      status: "invited",
      added: new Date().toISOString().slice(0, 10),
      note: newUser.note.trim() || undefined,
    };
    log("user.add", `${u.name} <${u.email}>`, `added with role ${ROLES[u.role].label} (status: invited)`, "notice");
    onUsersChange([...users, u]);
    setNewUser({ name: "", email: "", role: "carer", note: "" });
  };
  const switchUser = (id: string) => {
    const u = users.find((x) => x.id === id);
    if (!u) return;
    log("session.switch", u.name, `acting-as session changed from ${actor.name} to ${u.name}`, "notice");
    onSwitchUser(id);
  };

  const filteredEvents = useMemo(() => {
    const needle = q.toLowerCase();
    return [...events]
      .reverse()
      .filter(
        (e) =>
          !needle ||
          e.actor.toLowerCase().includes(needle) ||
          e.action.includes(needle) ||
          e.target.toLowerCase().includes(needle) ||
          e.detail.toLowerCase().includes(needle)
      );
  }, [events, q]);

  const chainBroken = events.length ? verifyChain(events) : null;
  const activeTab = tab;

  return (
    <div className="space-y-4">
      {/* acting as */}
      <Card className="border-teal-200 bg-teal-50/60 dark:border-teal-900 dark:bg-teal-950/30">
        <CardContent className="flex flex-wrap items-center gap-3 py-4">
          <UsersRound className="h-5 w-5 text-teal-700" />
          <div className="min-w-0">
            <p className="text-sm font-semibold">Acting as</p>
            <p className="text-xs text-muted-foreground">
              {canManage
                ? "Switch session identity to see exactly what each role sees. Every switch is written to the audit trail."
                : "Your role is fixed by the administrator."}
            </p>
          </div>
          <div className="ml-auto w-full sm:w-80">
            <Select value={actor.id} onValueChange={canManage ? switchUser : undefined} disabled={!canManage}>
              <SelectTrigger>
                <SelectValue placeholder="Select user" />
              </SelectTrigger>
              <SelectContent>
                {users.map((u) => (
                  <SelectItem key={u.id} value={u.id} disabled={u.status !== "active"}>
                    {u.name} · {ROLES[u.role].label.split(" (")[0]}
                    {u.status !== "active" ? ` (${u.status})` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Tabs value={activeTab} onValueChange={(v) => { setTab(v as typeof tab); if (v === "trail") refreshEvents(); }}>
        <TabsList className="flex h-auto flex-wrap gap-1">
          <TabsTrigger value="users" className="gap-1.5"><UsersRound className="h-4 w-4" /> Users</TabsTrigger>
          <TabsTrigger value="matrix" className="gap-1.5"><ShieldCheck className="h-4 w-4" /> Roles &amp; permissions</TabsTrigger>
          <TabsTrigger value="trail" className="gap-1.5"><ScrollText className="h-4 w-4" /> Audit trail</TabsTrigger>
        </TabsList>

        {/* ------------------------------------------------ users */}
        <TabsContent value="users" className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">User directory ({users.length})</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>User</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Added</TableHead>
                      <TableHead>Note</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {users.map((u) => (
                      <TableRow key={u.id} className="align-top">
                        <TableCell>
                          <div className="text-sm font-medium">
                            {u.name}
                            {u.id === actor.id && (
                              <Badge variant="outline" className="ml-2 text-[10px]">you</Badge>
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground">{u.email}</div>
                        </TableCell>
                        <TableCell>
                          <Select value={u.role} onValueChange={(v) => changeRole(u, v as RoleId)} disabled={!canManage || u.id === actor.id}>
                            <SelectTrigger className="h-8 w-52 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {ROLE_ORDER.map((r) => (
                                <SelectItem key={r} value={r}>{ROLES[r].label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          <Select value={u.status} onValueChange={(v) => changeStatus(u, v as UserStatus)} disabled={!canManage || u.id === actor.id}>
                            <SelectTrigger className="h-8 w-28 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="active">active</SelectItem>
                              <SelectItem value="invited">invited</SelectItem>
                              <SelectItem value="suspended">suspended</SelectItem>
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell className="text-xs">{u.added}</TableCell>
                        <TableCell className="max-w-[240px] text-xs text-muted-foreground">{u.note || "—"}</TableCell>
                        <TableCell>
                          {canManage && u.id !== actor.id && (
                            <Button variant="ghost" size="icon" onClick={() => removeUser(u)} aria-label={`Remove ${u.name}`}>
                              <Trash2 className="h-4 w-4 text-rose-600" />
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {canManage ? (
                <div className="rounded-lg border bg-muted/30 p-3">
                  <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    <UserPlus className="h-3.5 w-3.5" /> Add user
                  </p>
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                    <div className="space-y-1">
                      <Label htmlFor="nu-name" className="text-xs">Name</Label>
                      <Input id="nu-name" value={newUser.name} onChange={(e) => setNewUser({ ...newUser, name: e.target.value })} placeholder="Full name" />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="nu-email" className="text-xs">Email</Label>
                      <Input id="nu-email" type="email" value={newUser.email} onChange={(e) => setNewUser({ ...newUser, email: e.target.value })} placeholder="name@example.com" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Role</Label>
                      <Select value={newUser.role} onValueChange={(v) => setNewUser({ ...newUser, role: v as RoleId })}>
                        <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {ROLE_ORDER.map((r) => (
                            <SelectItem key={r} value={r}>{ROLES[r].label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex items-end">
                      <Button onClick={addUser} disabled={!newUser.name.trim() || !newUser.email.trim()} className="w-full bg-teal-800 hover:bg-teal-700">
                        <UserPlus className="mr-1.5 h-4 w-4" /> Add &amp; mark invited
                      </Button>
                    </div>
                  </div>
                  <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                    New users are created in <strong>invited</strong> state — activate when they confirm.
                    In this local build identities live in browser storage; on the Cloudflare deployment
                    wire the same role model to Workers Access / KV so enforcement happens server-side.
                  </p>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">Only an administrator can manage users.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ------------------------------------------------ matrix */}
        <TabsContent value="matrix" className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Permission matrix — what each role can see &amp; do</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                {ROLE_ORDER.map((r) => (
                  <div key={r} className="rounded-lg border p-3">
                    <p className="text-sm font-semibold">{ROLES[r].label}</p>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{ROLES[r].desc}</p>
                    <p className="mt-1.5 text-[11px] italic leading-relaxed text-muted-foreground">{ROLES[r].basis}</p>
                  </div>
                ))}
              </div>
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="sticky left-0 bg-background">Permission</TableHead>
                      {ROLE_ORDER.map((r) => (
                        <TableHead key={r} className="text-center text-[11px]">
                          {ROLES[r].label.split(" (")[0]}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {ALL_PERMISSIONS.map((p) => (
                      <TableRow key={p}>
                        <TableCell className="sticky left-0 bg-background text-xs">{PERMISSION_LABELS[p]}</TableCell>
                        {ROLE_ORDER.map((r) => (
                          <TableCell key={r} className="text-center">
                            {ROLE_PERMISSIONS[r].includes(p as Permission) ? (
                              <Check className="mx-auto h-4 w-4 text-emerald-600" aria-label="allowed" />
                            ) : (
                              <Minus className="mx-auto h-4 w-4 text-zinc-400" aria-label="denied" />
                            )}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                Tabs and sensitive data (contacts, documents, exports, AI sends) are gated by this
                matrix in the interface. Treat it as the specification for server-side enforcement
                when this runs on Cloudflare with real authentication — client-side gating alone is
                a UX boundary, not a security boundary.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ------------------------------------------------ trail */}
        <TabsContent value="trail" className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <History className="h-5 w-5 text-teal-700" />
                  System audit trail ({events.length} events)
                </CardTitle>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    variant="outline"
                    className={
                      chainBroken === null
                        ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200"
                        : "border-rose-300 bg-rose-100 text-rose-800 dark:bg-rose-950/50 dark:text-rose-200"
                    }
                  >
                    {chainBroken === null
                      ? "Hash chain intact"
                      : `Chain broken at #${chainBroken}`}
                  </Badge>
                  <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter events…" className="w-48" />
                  <Button size="sm" variant="outline" onClick={refreshEvents}>
                    <RefreshCcw className="mr-1 h-3.5 w-3.5" /> Refresh
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => download("care-audit-trail.csv", exportEventsCsv(), "text/csv")}>
                    <Download className="mr-1 h-3.5 w-3.5" /> CSV
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => download("care-audit-trail.json", exportEventsJson(), "application/json")}>
                    <Download className="mr-1 h-3.5 w-3.5" /> JSON
                  </Button>
                  {can(actor, "action.users_manage") && events.length > 0 && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-rose-600"
                      onClick={() => {
                        const n = events.length;
                        clearEvents();
                        logEvent({
                          actor: actor.name,
                          actorRole: ROLES[actor.role].label,
                          action: "users.reset",
                          target: "audit trail",
                          detail: `Audit log cleared (${n} events removed). This event starts a new chain.`,
                          severity: "warning",
                        });
                        refreshEvents();
                      }}
                    >
                      <AlertTriangle className="mr-1 h-3.5 w-3.5" /> Clear
                    </Button>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {events.length === 0 ? (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  <p className="mb-1 font-medium">No events recorded yet in this browser.</p>
                  <p className="text-xs">
                    The trail fills up automatically as people use the interface: user &amp; role
                    changes, acting-as switches, alert edits, exports, AI sends, communication-log
                    edits and letter drafting. Each entry is hash-chained to the previous one so
                    silent tampering is detectable via the integrity badge.
                  </p>
                </div>
              ) : (
                <div className="max-h-[520px] overflow-auto rounded-lg border">
                  <Table>
                    <TableHeader className="sticky top-0 bg-background">
                      <TableRow>
                        <TableHead className="w-14">#</TableHead>
                        <TableHead className="w-44">When</TableHead>
                        <TableHead className="w-40">Actor</TableHead>
                        <TableHead className="w-48">Action</TableHead>
                        <TableHead>Detail</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredEvents.map((e) => (
                        <TableRow key={e.seq}>
                          <TableCell className="font-mono text-xs text-muted-foreground">{e.seq}</TableCell>
                          <TableCell className="whitespace-nowrap text-xs">{e.ts.replace("T", " ").slice(0, 19)}</TableCell>
                          <TableCell className="text-xs">
                            <div className="font-medium">{e.actor}</div>
                            <div className="text-[11px] text-muted-foreground">{e.actorRole}</div>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className={SEV_STYLE[e.severity]}>
                              {ACTION_LABELS[e.action] || e.action}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs">
                            <span className="font-medium">{e.target}</span>
                            {e.detail ? ` — ${e.detail}` : ""}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
