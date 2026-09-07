"use client";

// My tasks — the family member's control panel for responsibilities:
//  1. Task list (overdue / today / week / later) with assignees (Alex / Pat)
//  2. Shopping list fed by carer visit sheets + WhatsApp + manual entries
//  3. Visit task sheets — one per upcoming visit, with the field carers use to
//     note "items for dad's list" (e.g. bleach), which flow into the shopping list.

import { useMemo, useState } from "react";
import {
  CheckCircle2, ClipboardList, ListChecks, Plus, Printer, ShoppingBasket, Trash2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from "@/components/ui/accordion";
import type { CareRecord } from "@/lib/record";
import { fmtDate } from "@/lib/record";
import type { SystemUser } from "@/lib/access";
import { can } from "@/lib/access";
import type { SysAuditAction } from "@/lib/auditlog";
import {
  type MyTask, type ShoppingItem, type VisitSheet, type SheetItem,
  type TaskFor, type TaskCategory, type Assignee,
  TASK_CATEGORY_LABELS, TASK_FOR_LABELS, ASSIGNEE_LABELS, taskBucket,
  uid, todayStr, addDays, nextVisitSlots,
} from "@/lib/family";

const CAT_ORDER: TaskCategory[] = [
  "lpa_financial", "lpa_health", "shopping", "communication", "review", "appointment", "household", "other",
];

export default function MyTasks({
  record, actor, tasks, onTasksChange, shopping, onShoppingChange, sheets, onSheetsChange, onAudit,
}: {
  record: CareRecord;
  actor: SystemUser;
  tasks: MyTask[];
  onTasksChange: (t: MyTask[]) => void;
  shopping: ShoppingItem[];
  onShoppingChange: (s: ShoppingItem[]) => void;
  sheets: VisitSheet[];
  onSheetsChange: (s: VisitSheet[]) => void;
  onAudit: (action: SysAuditAction, target: string, detail: string, severity?: "info" | "notice" | "warning") => void;
}) {
  const today = todayStr();
  const canManage = can(actor, "action.task_manage");
  const displayName = actor.name.split(" ")[0];

  // ----- add task form
  const [nt, setNt] = useState<{ title: string; due: string; forWhom: TaskFor; category: TaskCategory; assignee: Assignee; notes: string }>({
    title: "", due: addDays(today, 1), forWhom: "dad", category: "other", assignee: "alex", notes: "",
  });
  const addTask = () => {
    if (!nt.title.trim() || !canManage) return;
    const task: MyTask = {
      id: uid("t"), title: nt.title.trim(), due: nt.due, forWhom: nt.forWhom,
      category: nt.category, assignee: nt.assignee, done: false, created: today,
      source: "manual", notes: nt.notes.trim() || undefined,
    };
    onTasksChange([task, ...tasks]);
    onAudit("task.add", task.title, `added by ${actor.name} · due ${task.due} · ${TASK_FOR_LABELS[task.forWhom]}`);
    setNt({ ...nt, title: "", notes: "" });
  };
  const toggleTask = (t: MyTask) => {
    if (!canManage) return;
    const next = tasks.map((x) => (x.id === t.id ? { ...x, done: !x.done, doneAt: !x.done ? today : undefined } : x));
    onTasksChange(next);
    onAudit(t.done ? "task.reopen" : "task.complete", t.title, `${t.done ? "re-opened" : "completed"} by ${actor.name}`, "notice");
  };
  const deleteTask = (t: MyTask) => {
    if (!canManage) return;
    onTasksChange(tasks.filter((x) => x.id !== t.id));
    onAudit("task.delete", t.title, `removed by ${actor.name}`, "warning");
  };

  // ----- shopping
  const [si, setSi] = useState("");
  const addShopping = (name: string, via: ShoppingItem["addedVia"], addedBy: string, visitDate?: string) => {
    const item: ShoppingItem = {
      id: uid("s"), name, addedBy, addedVia: via, visitDate, needed: true,
      created: today, forWhom: "dad",
    };
    onShoppingChange([item, ...shopping]);
    onAudit("shopping.add", name, `added via ${via} by ${addedBy}`);
  };
  const markBought = (s: ShoppingItem) => {
    if (!canManage) return;
    onShoppingChange(shopping.map((x) => (x.id === s.id ? { ...x, needed: false, boughtAt: today, boughtBy: displayName } : x)));
    onAudit("shopping.bought", s.name, `marked bought by ${displayName}`);
  };
  const deleteShopping = (s: ShoppingItem) => {
    if (!canManage) return;
    onShoppingChange(shopping.filter((x) => x.id !== s.id));
    onAudit("shopping.delete", s.name, `removed by ${displayName}`, "warning");
  };

  // ----- buckets
  const buckets = (() => {
    const b = { overdue: [] as MyTask[], today: [] as MyTask[], week: [] as MyTask[], later: [] as MyTask[], done: [] as MyTask[] };
    for (const t of tasks) b[taskBucket(t, today)].push(t);
    (Object.keys(b) as (keyof typeof b)[]).forEach((k) => b[k].sort((x, y) => x.due.localeCompare(y.due)));
    return b;
  })();

  const needed = shopping.filter((s) => s.needed);
  const bought = shopping.filter((s) => !s.needed).slice(0, 8);

  // ----- visit sheets (auto-stub from the rota)
  const sheetSlots = useMemo(() => nextVisitSlots(record, 8), [record]);
  const sheetMap = useMemo(() => new Map(sheets.map((s) => [`${s.visitDate}|${s.visitSlot ?? ""}`, s])), [sheets]);
  const ensureSheet = (date: string, slot?: string, carer?: string): VisitSheet =>
    sheetMap.get(`${date}|${slot ?? ""}`) ?? {
      id: uid("vs"), visitDate: date, visitSlot: slot, carer,
      tasksDone: "", items: [], note: "", updated: today,
    };
  const persistSheet = (sheet: VisitSheet) => {
    const exists = sheets.some((s) => s.id === sheet.id);
    const next = exists ? sheets.map((s) => (s.id === sheet.id ? sheet : s)) : [...sheets, sheet];
    onSheetsChange(next);
  };
  const addSheetItem = (sheet: VisitSheet, name: string) => {
    if (!name.trim()) return;
    const item: SheetItem = { id: uid("i"), name: name.trim(), addedBy: displayName, addedAt: today };
    const updated = { ...sheet, items: [...sheet.items, item], updated: today };
    persistSheet(updated);
    addShopping(item.name, "visit_sheet", `${displayName} (visit sheet ${sheet.visitDate})`, sheet.visitDate);
    onAudit("sheet.update", `Visit ${sheet.visitDate}${sheet.visitSlot ? " " + sheet.visitSlot : ""}`, `item added to visit sheet + shopping list: ${item.name}`);
  };
  const removeSheetItem = (sheet: VisitSheet, item: SheetItem) => {
    const updated = { ...sheet, items: sheet.items.filter((i) => i.id !== item.id), updated: today };
    persistSheet(updated);
  };

  const copyList = () => {
    const text = needed.map((s, i) => `${i + 1}. ${s.name}${s.qty ? ` (${s.qty})` : ""}`).join("\n");
    void navigator.clipboard?.writeText(text || "(empty)");
  };
  const printList = () => window.print();

  const [openItem, setOpenItem] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-2">
        {/* ---------------- tasks ---------------- */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base text-teal-900 dark:text-teal-200">
              <ListChecks className="h-4 w-4 text-teal-700 dark:text-teal-300" />
              My tasks
              <Badge variant="outline" className="ml-auto">{tasks.filter((t) => !t.done).length} open</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {canManage && (
              <div className="space-y-2 rounded-lg border bg-teal-50/50 p-3 dark:bg-teal-950/20">
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="sm:col-span-2 space-y-1">
                    <Label htmlFor="task-title">Task</Label>
                    <Input id="task-title" placeholder="e.g. Pay the agency invoice / call the GP" value={nt.title}
                      onChange={(e) => setNt({ ...nt, title: e.target.value })} />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="task-due">Due</Label>
                    <Input id="task-due" type="date" value={nt.due} onChange={(e) => setNt({ ...nt, due: e.target.value })} />
                  </div>
                  <div className="space-y-1">
                    <Label>For</Label>
                    <Select value={nt.forWhom} onValueChange={(v) => setNt({ ...nt, forWhom: v as TaskFor })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {(Object.keys(TASK_FOR_LABELS) as TaskFor[]).map((k) => (
                          <SelectItem key={k} value={k}>{TASK_FOR_LABELS[k]}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label>Category</Label>
                    <Select value={nt.category} onValueChange={(v) => setNt({ ...nt, category: v as TaskCategory })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {CAT_ORDER.map((k) => (
                          <SelectItem key={k} value={k}>{TASK_CATEGORY_LABELS[k]}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label>Who does it</Label>
                    <Select value={nt.assignee} onValueChange={(v) => setNt({ ...nt, assignee: v as Assignee })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {(Object.keys(ASSIGNEE_LABELS) as Assignee[]).map((k) => (
                          <SelectItem key={k} value={k}>{ASSIGNEE_LABELS[k]}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <Button size="sm" className="bg-teal-800 hover:bg-teal-700" onClick={addTask} disabled={!nt.title.trim()}>
                  <Plus className="mr-1 h-3.5 w-3.5" /> Add task
                </Button>
              </div>
            )}

            <TaskBucket title="Overdue" tone="bad" list={buckets.overdue} canManage={canManage} onToggle={toggleTask} onDelete={deleteTask} />
            <TaskBucket title="Today" tone="warn" list={buckets.today} canManage={canManage} onToggle={toggleTask} onDelete={deleteTask} />
            <TaskBucket title="Next 7 days" tone="plain" list={buckets.week} canManage={canManage} onToggle={toggleTask} onDelete={deleteTask} />
            <TaskBucket title="Later" tone="plain" list={buckets.later} canManage={canManage} onToggle={toggleTask} onDelete={deleteTask} />
            {buckets.done.length > 0 && (
              <TaskBucket title="Completed" tone="good" list={buckets.done.slice(0, 6)} canManage={canManage} onToggle={toggleTask} onDelete={deleteTask} />
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          {/* ---------------- shopping list ---------------- */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base text-teal-900 dark:text-teal-200">
                <ShoppingBasket className="h-4 w-4 text-teal-700 dark:text-teal-300" />
                Dad&apos;s shopping list
                <Badge variant="outline" className="ml-auto">{needed.length} needed</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {canManage && (
                <form
                  className="flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (si.trim()) {
                      addShopping(si.trim(), "manual", displayName);
                      setSi("");
                    }
                  }}
                >
                  <Input placeholder="Add an item, e.g. bleach…" value={si} onChange={(e) => setSi(e.target.value)} />
                  <Button type="submit" size="sm" variant="outline" disabled={!si.trim()}>
                    <Plus className="h-3.5 w-3.5" />
                  </Button>
                </form>
              )}
              {needed.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Nothing needed. Items added on carer visit sheets or in the WhatsApp group appear here automatically.
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {needed.map((s) => (
                    <li key={s.id} className="flex items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-sm">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{s.name}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {s.addedBy} · {fmtDate(s.created)} · via {s.addedVia.replace("_", " ")}
                        </p>
                      </div>
                      <div className="flex items-center gap-1">
                        {canManage && (
                          <Button size="sm" variant="ghost" aria-label={`Mark ${s.name} bought`} onClick={() => markBought(s)}>
                            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                          </Button>
                        )}
                        {canManage && (
                          <Button size="sm" variant="ghost" aria-label={`Remove ${s.name}`} onClick={() => deleteShopping(s)}>
                            <Trash2 className="h-4 w-4 text-rose-500" />
                          </Button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex gap-2">
                <Button size="sm" variant="outline" className="flex-1" onClick={copyList} disabled={needed.length === 0}>
                  Copy list
                </Button>
                <Button size="sm" variant="outline" className="flex-1" onClick={printList} disabled={needed.length === 0}>
                  <Printer className="mr-1 h-3.5 w-3.5" /> Print
                </Button>
              </div>
              {bought.length > 0 && (
                <p className="text-[11px] text-muted-foreground">
                  Recently bought: {bought.map((b) => b.name).join(", ")}
                </p>
              )}
            </CardContent>
          </Card>

          {/* ---------------- visit task sheets ---------------- */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base text-teal-900 dark:text-teal-200">
                <ClipboardList className="h-4 w-4 text-teal-700 dark:text-teal-300" />
                Visit task sheets
                <Badge variant="outline" className="ml-auto">next {sheetSlots.length} visits</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="mb-2 text-xs text-muted-foreground">
                One sheet per visit: the carer logs what was done and — in the{" "}
                <span className="font-semibold">“items for Dad&apos;s list”</span> field — anything he needs
                (e.g. bleach). Items flow straight into the shopping list.
              </p>
              <Accordion type="single" collapsible value={openItem ?? undefined} onValueChange={setOpenItem}>
                {sheetSlots.map((slot) => {
                  const sheet = ensureSheet(slot.date, slot.slot, slot.carer);
                  const key = `${sheet.visitDate}|${sheet.visitSlot ?? ""}`;
                  return (
                    <AccordionItem key={key} value={key}>
                      <AccordionTrigger className="py-2 text-sm">
                        <span className="flex w-full items-center justify-between gap-2 pr-2">
                          <span className="font-medium">{fmtDate(sheet.visitDate)}{sheet.visitSlot ? ` · ${sheet.visitSlot}` : ""}</span>
                          {sheet.items.length > 0 ? (
                            <Badge variant="outline" className="border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200">
                              {sheet.items.length} item{sheet.items.length === 1 ? "" : "s"}
                            </Badge>
                          ) : (
                            <span className="text-[11px] text-muted-foreground">no items yet</span>
                          )}
                        </span>
                      </AccordionTrigger>
                      <AccordionContent className="space-y-2">
                        <SheetEditor
                          sheet={sheet}
                          canManage={canManage}
                          onTasksDone={(v) => persistSheet({ ...sheet, tasksDone: v, updated: today })}
                          onNote={(v) => persistSheet({ ...sheet, note: v, updated: today })}
                          onAddItem={(name) => addSheetItem(sheet, name)}
                          onRemoveItem={(item) => removeSheetItem(sheet, item)}
                        />
                      </AccordionContent>
                    </AccordionItem>
                  );
                })}
              </Accordion>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function TaskBucket({
  title, tone, list, canManage, onToggle, onDelete,
}: {
  title: string;
  tone: "good" | "bad" | "warn" | "plain";
  list: MyTask[];
  canManage: boolean;
  onToggle: (t: MyTask) => void;
  onDelete: (t: MyTask) => void;
}) {
  if (list.length === 0) return null;
  const badge: Record<string, string> = {
    bad: "border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-800 dark:bg-rose-950/50 dark:text-rose-200",
    warn: "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200",
    good: "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200",
    plain: "",
  };
  return (
    <div>
      <div className="mb-1 flex items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</span>
        <Badge variant="outline" className={badge[tone]}>{list.length}</Badge>
      </div>
      <div className="space-y-1.5">
        {list.map((t) => (
          <div key={t.id} className={`flex items-start gap-2 rounded-md border px-2.5 py-1.5 ${t.done ? "opacity-60" : ""}`}>
            {canManage && (
              <Checkbox className="mt-0.5" checked={t.done} aria-label={`Toggle ${t.title}`} onCheckedChange={() => onToggle(t)} />
            )}
            <div className="min-w-0 flex-1">
              <p className={`text-sm font-medium ${t.done ? "line-through" : ""}`}>{t.title}</p>
              <p className="text-[11px] text-muted-foreground">
                {fmtDate(t.due)} · {TASK_FOR_LABELS[t.forWhom]} · {TASK_CATEGORY_LABELS[t.category]} · {ASSIGNEE_LABELS[t.assignee]}
                {t.notes ? ` — ${t.notes}` : ""}
              </p>
            </div>
            {canManage && (
              <Button size="sm" variant="ghost" aria-label={`Delete ${t.title}`} onClick={() => onDelete(t)}>
                <Trash2 className="h-3.5 w-3.5 text-rose-500" />
              </Button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function SheetEditor({
  sheet, canManage, onTasksDone, onNote, onAddItem, onRemoveItem,
}: {
  sheet: VisitSheet;
  canManage: boolean;
  onTasksDone: (v: string) => void;
  onNote: (v: string) => void;
  onAddItem: (name: string) => void;
  onRemoveItem: (item: SheetItem) => void;
}) {
  const [itemName, setItemName] = useState("");
  return (
    <div className="space-y-2">
      <div className="space-y-1">
        <Label className="text-xs">Tasks completed this visit</Label>
        <Textarea
          rows={2}
          disabled={!canManage}
          placeholder="e.g. Personal care done, all meds given, breakfast prepared…"
          value={sheet.tasksDone}
          onChange={(e) => onTasksDone(e.target.value)}
        />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Items for Dad&apos;s list (noticed on the visit)</Label>
        <div className="flex gap-2">
          <Input
            disabled={!canManage}
            placeholder="e.g. bleach, 4xAA batteries…"
            value={itemName}
            onChange={(e) => setItemName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && itemName.trim()) {
                onAddItem(itemName);
                setItemName("");
              }
            }}
          />
          <Button
            size="sm"
            variant="outline"
            disabled={!canManage || !itemName.trim()}
            onClick={() => {
              onAddItem(itemName);
              setItemName("");
            }}
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>
        {sheet.items.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {sheet.items.map((i) => (
              <Badge key={i.id} variant="outline" className="gap-1 border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200">
                {i.name}
                <span className="text-[10px] opacity-70">· {i.addedBy}</span>
                {canManage && (
                  <button aria-label={`Remove ${i.name}`} onClick={() => onRemoveItem(i)} className="ml-0.5 text-rose-500">
                    ×
                  </button>
                )}
              </Badge>
            ))}
          </div>
        )}
      </div>
      <div className="space-y-1">
        <Label className="text-xs">General note</Label>
        <Textarea rows={2} disabled={!canManage} value={sheet.note} placeholder="Anything worth remembering about this visit…" onChange={(e) => onNote(e.target.value)} />
      </div>
    </div>
  );
}
