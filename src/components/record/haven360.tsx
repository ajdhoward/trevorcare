"use client";

// Haven 360 family-voice hub (Qwen spec §07 / §06 / §03) + DCPI panel (§08).
// People are the sensors: check-ins, micro-decline questionnaires, mood board,
// ABC log, calming strategies, life story, consent matrix, capacity ledger,
// ACD/ReSPECT vault — all feeding the Dementia Care Progression Index.

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  HeartHandshake, ClipboardCheck, Eye, MessageSquareHeart, Music4, BookOpen,
  ShieldCheck, Gauge, FileWarning, Download, Trash2, Scale, FileHeart, Sun,
} from "lucide-react";
import {
  type CheckIn, type MicroDecline, type MoodEntry, type AbcEntry,
  type CalmingStrategy, type LifeStoryEntry, type ConsentRow, type ConsentTier,
  type CapacityEntry, type AcdDoc, type DcpiInputs,
  checkInStore, microDeclineStore, moodStore, abcStore, calmingStore,
  lifeStoryStore, capacityStore, acdStore, loadConsent, saveConsent,
  CONSENT_TIER_HELP, DCPI_DEFAULTS, dcpiScore, dcpiBand, dcpiStatutoryFlags,
  dcpiReportMd, uid,
} from "@/lib/haven360";
import type { SysAuditAction } from "@/lib/auditlog";

export interface Haven360Props {
  actorName: string;
  onAudit: (action: SysAuditAction, target: string, detail: string, severity?: "info" | "notice" | "warning") => void;
}

function Stars({ value, onChange, labels }: { value: number; onChange: (n: number) => void; labels: [string, string] }) {
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          aria-label={`${n} of 5 — ${labels[0]} to ${labels[1]}`}
          onClick={() => onChange(n)}
          className={`h-8 w-8 rounded-lg border text-sm font-semibold transition-colors ${
            n <= value
              ? "border-teal-600 bg-teal-600 text-white"
              : "border-border bg-background text-muted-foreground hover:border-teal-400"
          }`}
        >
          {n}
        </button>
      ))}
      <span className="ml-2 text-xs text-muted-foreground">{labels[0]} → {labels[1]}</span>
    </div>
  );
}

function HistoryStrip({ items, label }: { items: { date: string; summary: string }[]; label: string }) {
  if (items.length === 0) return <p className="text-xs text-muted-foreground">No {label} yet — the first one takes about 90 seconds.</p>;
  return (
    <div className="flex gap-2 overflow-x-auto pb-1">
      {items.slice(0, 14).map((it, i) => (
        <div key={i} className="min-w-36 shrink-0 rounded-lg border p-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-teal-700 dark:text-teal-300">{it.date}</p>
          <p className="text-xs">{it.summary}</p>
        </div>
      ))}
    </div>
  );
}

function DeleteBtn({ onDelete, label }: { onDelete: () => void; label: string }) {
  return (
    <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-rose-600" aria-label={`Delete ${label}`} onClick={onDelete}>
      <Trash2 className="h-3.5 w-3.5" />
    </Button>
  );
}

export default function FamilyVoice({ actorName, onAudit }: Haven360Props) {
  const [tab, setTab] = useState("checkin");
  const [checkins, setCheckins] = useState<CheckIn[]>([]);
  const [declines, setDeclines] = useState<MicroDecline[]>([]);
  const [moods, setMoods] = useState<MoodEntry[]>([]);
  const [abcs, setAbcs] = useState<AbcEntry[]>([]);
  const [calms, setCalms] = useState<CalmingStrategy[]>([]);
  const [story, setStory] = useState<LifeStoryEntry[]>([]);
  const [consent, setConsent] = useState<ConsentRow[]>([]);
  const [capacity, setCapacity] = useState<CapacityEntry[]>([]);
  const [acd, setAcd] = useState<AcdDoc[]>([]);

  // form state — check-in
  const [person, setPerson] = useState<"dad" | "mum">("dad");
  const [stamina, setStamina] = useState(3);
  const [sleep, setSleep] = useState(3);
  const [confusion, setConfusion] = useState(2);
  const [appetite, setAppetite] = useState(3);
  const [burnout, setBurnout] = useState(4);
  const [notes, setNotes] = useState("");
  // micro-decline
  const [visitor, setVisitor] = useState(actorName);
  const [weightDelta, setWeightDelta] = useState(0);
  const [homeCond, setHomeCond] = useState(3);
  const [hygiene, setHygiene] = useState(3);
  const [cognition, setCognition] = useState(3);
  const [mdNotes, setMdNotes] = useState("");
  // mood / abc
  const [moodText, setMoodText] = useState("");
  const [moodTags, setMoodTags] = useState("");
  const [abcDate, setAbcDate] = useState(new Date().toISOString().slice(0, 10));
  const [abcTime, setAbcTime] = useState("16:00");
  const [antecedent, setAntecedent] = useState("");
  const [behaviour, setBehaviour] = useState("");
  const [consequence, setConsequence] = useState("");
  const [severity, setSeverity] = useState<"1" | "2" | "3">("2");
  // calming / story
  const [calmTitle, setCalmTitle] = useState("");
  const [calmKind, setCalmKind] = useState<CalmingStrategy["kind"]>("music");
  const [calmWhen, setCalmWhen] = useState("sundowning");
  const [calmDetail, setCalmDetail] = useState("");
  const [storyCat, setStoryCat] = useState<LifeStoryEntry["category"]>("favourites");
  const [storyTitle, setStoryTitle] = useState("");
  const [storyDetail, setStoryDetail] = useState("");
  // capacity / acd
  const [capTask, setCapTask] = useState("");
  const [capLevel, setCapLevel] = useState<CapacityEntry["level"]>("assisted");
  const [capNote, setCapNote] = useState("");
  const [acdKind, setAcdKind] = useState<AcdDoc["kind"]>("ACD");
  const [acdTitle, setAcdTitle] = useState("");
  const [acdStatus, setAcdStatus] = useState<AcdDoc["status"]>("discuss");
  const [acdLocation, setAcdLocation] = useState("");

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      setCheckins(checkInStore.load());
      setDeclines(microDeclineStore.load());
      setMoods(moodStore.load());
      setAbcs(abcStore.load());
      setCalms(calmingStore.load());
      setStory(lifeStoryStore.load());
      setConsent(loadConsent());
      setCapacity(capacityStore.load());
      setAcd(acdStore.load());
    });
    return () => cancelAnimationFrame(id);
  }, []);

  const today = new Date().toISOString().slice(0, 10);

  const saveCheckin = () => {
    const entry: CheckIn = { id: uid("ci"), date: today, person, stamina, sleep, confusion, appetite, burnout, notes: notes.trim() };
    const next = [entry, ...checkins];
    setCheckins(next);
    checkInStore.save(next);
    onAudit("checkin.log", `${person === "dad" ? "Dad" : "Mum"} — daily check-in`, `Stamina ${stamina}/5, sleep ${sleep}/5, confusion ${confusion}/5, appetite ${appetite}/5, carer burnout ${burnout}/10${notes ? " · " + notes.trim() : ""}`, "notice");
    setNotes("");
  };

  const saveDecline = () => {
    const entry: MicroDecline = { id: uid("md"), date: today, visitor: visitor.trim() || actorName, weightDeltaKg: weightDelta, homeCondition: homeCond, hygiene, cognition, notes: mdNotes.trim() };
    const next = [entry, ...declines];
    setDeclines(next);
    microDeclineStore.save(next);
    onAudit("microdecline.log", `Fresh-eyes visit (${entry.visitor})`, `Weight Δ ${weightDelta > 0 ? "+" : ""}${weightDelta}kg, home ${homeCond}/5, hygiene ${hygiene}/5, cognition ${cognition}/5 vs last visit`, "notice");
    setMdNotes("");
  };

  const saveMood = () => {
    if (!moodText.trim()) return;
    const tags = moodTags.split(",").map((t) => t.trim()).filter(Boolean).slice(0, 5);
    const entry: MoodEntry = { id: uid("mood"), ts: new Date().toISOString(), who: actorName, text: moodText.trim(), tags };
    const next = [entry, ...moods];
    setMoods(next);
    moodStore.save(next);
    onAudit("mood.log", "Mood board", `"${moodText.trim().slice(0, 80)}"${tags.length ? ` · tags: ${tags.join(", ")}` : ""}`);
    setMoodText("");
    setMoodTags("");
  };

  const saveAbc = () => {
    if (!behaviour.trim()) return;
    const entry: AbcEntry = {
      id: uid("abc"), date: abcDate, time: abcTime,
      antecedent: antecedent.trim(), behaviour: behaviour.trim(), consequence: consequence.trim(),
      durationMin: 0, severity: (Number(severity) as 1 | 2 | 3),
    };
    const next = [entry, ...abcs];
    setAbcs(next);
    abcStore.save(next);
    onAudit("abc.log", `ABC episode ${entry.date} ${entry.time}`, `A: ${entry.antecedent || "—"} · B: ${entry.behaviour} · C: ${entry.consequence || "—"} · severity ${entry.severity}/3`, "notice");
    setAntecedent("");
    setBehaviour("");
    setConsequence("");
  };

  const hourHistogram = useMemo(() => {
    const counts = new Array(24).fill(0) as number[];
    for (const a of abcs) {
      const h = Number((a.time || "").split(":")[0]);
      if (!Number.isNaN(h) && h >= 0 && h < 24) counts[h] += 1;
    }
    const max = Math.max(1, ...counts);
    return { counts, max };
  }, [abcs]);

  const sundownHint = useMemo(() => {
    const { counts } = hourHistogram;
    const afternoon = counts.slice(15, 20).reduce((a, b) => a + b, 0);
    const rest = counts.reduce((a, b) => a + b, 0) - afternoon;
    return afternoon >= Math.max(2, rest) && afternoon >= 2
      ? "Afternoon/early-evening cluster detected — classic sundowning window. Calm the room, keep routines, pin a calming strategy for 15:00-19:00."
      : abcs.length >= 3
        ? "No clear sundowning cluster yet — keep logging and the pattern will emerge."
        : null;
  }, [hourHistogram, abcs.length]);

  const saveCalm = () => {
    if (!calmTitle.trim()) return;
    const entry: CalmingStrategy = { id: uid("cs"), title: calmTitle.trim(), kind: calmKind, when: calmWhen.trim() || "any time", detail: calmDetail.trim() };
    const next = [entry, ...calms];
    setCalms(next);
    calmingStore.save(next);
    onAudit("calming.add", entry.title, `Strategy for ${entry.when} (${entry.kind})`);
    setCalmTitle("");
    setCalmDetail("");
  };

  const saveStory = () => {
    if (!storyTitle.trim()) return;
    const entry: LifeStoryEntry = { id: uid("ls"), category: storyCat, title: storyTitle.trim(), detail: storyDetail.trim() };
    const next = [entry, ...story];
    setStory(next);
    lifeStoryStore.save(next);
    onAudit("lifestory.add", entry.title, `Life story (${entry.category})`);
    setStoryTitle("");
    setStoryDetail("");
  };

  const updateConsent = (i: number, tier: ConsentTier) => {
    const next = consent.map((r, j) => (j === i ? { ...r, tier, updated: today } : r));
    setConsent(next);
    saveConsent(next);
    onAudit("consent.update", next[i].person, `Visibility tier set to "${tier}"`);
  };

  const saveCapacity = () => {
    if (!capTask.trim()) return;
    const entry: CapacityEntry = { id: uid("cap"), ts: new Date().toISOString(), task: capTask.trim(), level: capLevel, note: capNote.trim() };
    const next = [entry, ...capacity];
    setCapacity(next);
    capacityStore.save(next);
    onAudit("capacity.add", entry.task, `Capacity recorded: ${entry.level}${entry.note ? " · " + entry.note : ""}`);
    setCapTask("");
    setCapNote("");
  };

  const saveAcd = () => {
    if (!acdTitle.trim()) return;
    const entry: AcdDoc = { id: uid("acd"), kind: acdKind, title: acdTitle.trim(), status: acdStatus, location: acdLocation.trim() || "with Alex", updated: today };
    const next = [entry, ...acd];
    setAcd(next);
    acdStore.save(next);
    onAudit("acd.update", entry.title, `${entry.kind} — status: ${entry.status}`);
    setAcdTitle("");
    setAcdLocation("");
  };

  const burnoutTrend = checkins.slice(0, 5).map((c) => c.burnout);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base"><HeartHandshake className="h-5 w-5 text-teal-700" /> Family voice hub</CardTitle>
          <CardDescription>
            The family is the sensor network: structured check-ins, fresh-eyes questionnaires, mood notes and behavioural
            episodes feed the DCPI, shape carer briefings and build the legal evidence trail. Every entry is audited and
            stays under your consent matrix.
          </CardDescription>
        </CardHeader>
      </Card>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex h-auto flex-wrap gap-1">
          <TabsTrigger value="checkin"><ClipboardCheck className="mr-1 h-4 w-4" />Daily check-in</TabsTrigger>
          <TabsTrigger value="decline"><Eye className="mr-1 h-4 w-4" />Fresh-eyes survey</TabsTrigger>
          <TabsTrigger value="mood"><MessageSquareHeart className="mr-1 h-4 w-4" />Mood board</TabsTrigger>
          <TabsTrigger value="abc"><Sun className="mr-1 h-4 w-4" />ABC log &amp; sundowning</TabsTrigger>
          <TabsTrigger value="calm"><Music4 className="mr-1 h-4 w-4" />Calming &amp; life story</TabsTrigger>
          <TabsTrigger value="consent"><ShieldCheck className="mr-1 h-4 w-4" />Consent matrix</TabsTrigger>
          <TabsTrigger value="legal"><Scale className="mr-1 h-4 w-4" />Capacity &amp; ACD vault</TabsTrigger>
        </TabsList>

        {/* -------------------------------------------- check-in */}
        <TabsContent value="checkin" className="space-y-3">
          <Card>
            <CardContent className="space-y-4 pt-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label>Who did you see or speak to today?</Label>
                  <Select value={person} onValueChange={(v) => setPerson(v as "dad" | "mum")}>
                    <SelectTrigger className="mt-1.5 w-56"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="dad">Dad</SelectItem>
                      <SelectItem value="mum">Mum</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="rounded-lg border border-amber-300/60 bg-amber-50/60 p-3 dark:bg-amber-950/30">
                  <Label className="text-amber-900 dark:text-amber-200">Carer burnout self-check — confidential (0-10)</Label>
                  <div className="mt-2 flex items-center gap-3">
                    <Slider value={[burnout]} min={0} max={10} step={1} onValueChange={([v]) => setBurnout(v)} className="flex-1" />
                    <span className="w-8 text-center font-bold">{burnout}</span>
                  </div>
                  <p className="mt-1 text-[11px] text-amber-800 dark:text-amber-300">Only you see this unless a threshold is crossed (≥7 requests a Care Act s.10 carer&apos;s assessment in the DCPI).</p>
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div><Label>Stamina / energy</Label><div className="mt-1.5"><Stars value={stamina} onChange={setStamina} labels={["very low", "strong"]} /></div></div>
                <div><Label>Sleep (last night)</Label><div className="mt-1.5"><Stars value={sleep} onChange={setSleep} labels={["poor", "restful"]} /></div></div>
                <div><Label>Confusion</Label><div className="mt-1.5"><Stars value={confusion} onChange={setConfusion} labels={["clear", "very muddled"]} /></div></div>
                <div><Label>Appetite</Label><div className="mt-1.5"><Stars value={appetite} onChange={setAppetite} labels={["refused", "full"]} /></div></div>
              </div>
              <div>
                <Label htmlFor="ci-notes">Anything worth noting? (shapes the carer pre-visit briefing)</Label>
                <Textarea id="ci-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Lucid with photos this morning, struggling after 4pm; enjoyed the garden…" className="mt-1.5 min-h-20" />
              </div>
              <div className="flex items-center gap-3">
                <Button onClick={saveCheckin} className="bg-teal-800 hover:bg-teal-700">Save check-in</Button>
                {burnoutTrend.length >= 2 && (
                  <span className="text-xs text-muted-foreground">Your last burnout readings: {burnoutTrend.reverse().join(" → ")}/10</span>
                )}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Recent check-ins</CardTitle></CardHeader>
            <CardContent>
              <HistoryStrip
                items={checkins.slice(0, 14).map((c) => ({ date: c.date, summary: `${c.person === "dad" ? "Dad" : "Mum"} · stamina ${c.stamina}/5 · confusion ${c.confusion}/5 · burnout ${c.burnout}/10` }))}
                label="check-ins"
              />
              {checkins.length > 0 && (
                <div className="mt-3">
                  {checkins.slice(0, 3).map((c) => (
                    <div key={c.id} className="flex items-start justify-between gap-2 border-b py-1.5 last:border-0">
                      <p className="text-xs"><span className="font-medium">{c.date} ({c.person === "dad" ? "Dad" : "Mum"})</span> — {c.notes || "no notes"}</p>
                      <DeleteBtn label="check-in" onDelete={() => { const n = checkins.filter((x) => x.id !== c.id); setCheckins(n); checkInStore.save(n); }} />
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* -------------------------------------------- micro-decline */}
        <TabsContent value="decline" className="space-y-3">
          <Card>
            <CardContent className="space-y-4 pt-4">
              <p className="text-sm text-muted-foreground">
                For relatives who visit less often (fortnightly). Fresh eyes notice the deltas that daily eyes normalise —
                these feed the DCPI and the reassessment evidence pack.
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="md-visitor">Visitor</Label>
                  <Input id="md-visitor" value={visitor} onChange={(e) => setVisitor(e.target.value)} className="mt-1.5" />
                </div>
                <div>
                  <Label htmlFor="md-weight">Weight change since last visit (kg, ± allowed)</Label>
                  <Input id="md-weight" type="number" step="0.1" value={weightDelta} onChange={(e) => setWeightDelta(Number(e.target.value))} className="mt-1.5" />
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <div><Label>Home condition</Label><div className="mt-1.5"><Stars value={homeCond} onChange={setHomeCond} labels={["worrying", "excellent"]} /></div></div>
                <div><Label>Personal care / hygiene</Label><div className="mt-1.5"><Stars value={hygiene} onChange={setHygiene} labels={["concerning", "well kept"]} /></div></div>
                <div><Label>Cognition vs last visit</Label><div className="mt-1.5"><Stars value={cognition} onChange={setCognition} labels={["much worse", "much better"]} /></div></div>
              </div>
              <div>
                <Label htmlFor="md-notes">What changed? (be specific — examples beat adjectives)</Label>
                <Textarea id="md-notes" value={mdNotes} onChange={(e) => setMdNotes(e.target.value)} className="mt-1.5 min-h-20" placeholder="e.g. two unopened letters on the mat, fridge nearly empty, repeats the same question about Mum's carers…" />
              </div>
              <Button onClick={saveDecline} className="bg-teal-800 hover:bg-teal-700">Submit fresh-eyes survey</Button>
            </CardContent>
          </Card>
          {declines.length > 0 && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Previous surveys</CardTitle></CardHeader>
              <CardContent className="space-y-1.5">
                {declines.slice(0, 8).map((d) => (
                  <div key={d.id} className="flex items-start justify-between gap-2 border-b pb-1.5 last:border-0">
                    <p className="text-xs"><span className="font-medium">{d.date} · {d.visitor}</span> — weight Δ {d.weightDeltaKg > 0 ? "+" : ""}{d.weightDeltaKg}kg · home {d.homeCondition}/5 · hygiene {d.hygiene}/5 · cognition {d.cognition}/5{d.notes ? ` · ${d.notes}` : ""}</p>
                    <DeleteBtn label="survey" onDelete={() => { const n = declines.filter((x) => x.id !== d.id); setDeclines(n); microDeclineStore.save(n); }} />
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* -------------------------------------------- mood board */}
        <TabsContent value="mood" className="space-y-3">
          <Card>
            <CardContent className="space-y-3 pt-4">
              <Label htmlFor="mood-text">Observation (voice notes welcome — type what was said)</Label>
              <Textarea id="mood-text" value={moodText} onChange={(e) => setMoodText(e.target.value)} className="min-h-20" placeholder="e.g. Dad sang along to the Forces' Songbook and laughed twice before teatime…" />
              <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                <Input value={moodTags} onChange={(e) => setMoodTags(e.target.value)} placeholder="tags, comma separated (good-day, sundowning, pain…)" />
                <Button onClick={saveMood} className="bg-teal-800 hover:bg-teal-700">Post to mood board</Button>
              </div>
              <p className="text-xs text-muted-foreground">Mood-board notes shape how every professional visit should begin — they are pushed into the WhatsApp carer group briefing and the AI review brief.</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Mood board</CardTitle></CardHeader>
            <CardContent className="space-y-1.5">
              {moods.length === 0 && <p className="text-xs text-muted-foreground">Nothing yet — the small moments are the ones the care plan misses.</p>}
              {moods.slice(0, 20).map((m) => (
                <div key={m.id} className="flex items-start justify-between gap-2 border-b pb-1.5 last:border-0">
                  <div>
                    <p className="text-xs">{m.text}</p>
                    <p className="text-[10px] text-muted-foreground">{new Date(m.ts).toLocaleString("en-GB")} · {m.who}{m.tags.length ? ` · ${m.tags.join(", ")}` : ""}</p>
                  </div>
                  <DeleteBtn label="mood note" onDelete={() => { const n = moods.filter((x) => x.id !== m.id); setMoods(n); moodStore.save(n); }} />
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        {/* -------------------------------------------- ABC */}
        <TabsContent value="abc" className="space-y-3">
          <Card>
            <CardContent className="space-y-3 pt-4">
              <p className="text-sm text-muted-foreground">
                Log behavioural episodes with the same A-B-C structure carers use — merged analytics reveal patterns the
                agency never sees from its side (Qwen spec §05, closed behavioural loop).
              </p>
              <div className="grid gap-3 sm:grid-cols-3">
                <div><Label htmlFor="abc-date">Date</Label><Input id="abc-date" type="date" value={abcDate} onChange={(e) => setAbcDate(e.target.value)} className="mt-1.5" /></div>
                <div><Label htmlFor="abc-time">Time</Label><Input id="abc-time" type="time" value={abcTime} onChange={(e) => setAbcTime(e.target.value)} className="mt-1.5" /></div>
                <div>
                  <Label>Severity</Label>
                  <Select value={severity} onValueChange={(v) => setSeverity(v as "1" | "2" | "3")}>
                    <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">1 — mild</SelectItem>
                      <SelectItem value="2">2 — moderate</SelectItem>
                      <SelectItem value="3">3 — severe</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div><Label htmlFor="abc-a">Antecedent — what happened just before?</Label><Input id="abc-a" value={antecedent} onChange={(e) => setAntecedent(e.target.value)} className="mt-1.5" placeholder="e.g. carer he didn't recognise arrived unannounced" /></div>
              <div><Label htmlFor="abc-b">Behaviour</Label><Input id="abc-b" value={behaviour} onChange={(e) => setBehaviour(e.target.value)} className="mt-1.5" placeholder="e.g. raised voice, refused entry, paced for 20 minutes" /></div>
              <div><Label htmlFor="abc-c">Consequence — what calmed it / followed?</Label><Input id="abc-c" value={consequence} onChange={(e) => setConsequence(e.target.value)} className="mt-1.5" placeholder="e.g. calming clip on the tablet, sat with the dog photo album" /></div>
              <Button onClick={saveAbc} className="bg-teal-800 hover:bg-teal-700">Log episode</Button>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Distress-time pattern (episodes by hour)</CardTitle>
              <CardDescription>The classic sundowning window is 15:00–19:00.</CardDescription>
            </CardHeader>
            <CardContent>
              {abcs.length === 0 ? (
                <p className="text-xs text-muted-foreground">No episodes logged yet.</p>
              ) : (
                <>
                  <div className="flex h-28 items-end gap-1">
                    {hourHistogram.counts.map((n, h) => (
                      <div key={h} className="flex flex-1 flex-col items-center gap-0.5">
                        <div
                          className={`w-full rounded-t ${h >= 15 && h < 19 ? "bg-amber-500" : "bg-teal-600"}`}
                          style={{ height: `${Math.max(3, (n / hourHistogram.max) * 88)}%` }}
                          title={`${String(h).padStart(2, "0")}:00 — ${n} episode(s)`}
                        />
                        <span className="text-[9px] text-muted-foreground">{h % 3 === 0 ? h : ""}</span>
                      </div>
                    ))}
                  </div>
                  {sundownHint && (
                    <p className="mt-2 rounded-lg border border-amber-300/60 bg-amber-50/60 p-2 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">{sundownHint}</p>
                  )}
                </>
              )}
            </CardContent>
          </Card>
          {abcs.length > 0 && (
            <Card>
              <CardContent className="space-y-1.5 pt-4">
                {abcs.slice(0, 10).map((a) => (
                  <div key={a.id} className="flex items-start justify-between gap-2 border-b pb-1.5 last:border-0">
                    <p className="text-xs">
                      <span className="font-medium">{a.date} {a.time}</span> <Badge variant="outline" className="ml-1 px-1 py-0 text-[10px]">sev {a.severity}</Badge>{" "}
                      {a.antecedent && <>· A: {a.antecedent} </>}{a.behaviour && <>· B: {a.behaviour} </>}{a.consequence && <>· C: {a.consequence}</>}
                    </p>
                    <DeleteBtn label="episode" onDelete={() => { const n = abcs.filter((x) => x.id !== a.id); setAbcs(n); abcStore.save(n); }} />
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* -------------------------------------------- calming & life story */}
        <TabsContent value="calm" className="space-y-3">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><Music4 className="h-4 w-4 text-teal-700" /> Calming strategies</CardTitle>
                <CardDescription>30-second "how to calm me" kit — surfaced to carers at distress moments and shown on the My Day tablet.</CardDescription></CardHeader>
              <CardContent className="space-y-3">
                <Input value={calmTitle} onChange={(e) => setCalmTitle(e.target.value)} placeholder="e.g. Vera Lynn — We'll Meet Again (plays on tablet)" />
                <div className="grid gap-2 sm:grid-cols-2">
                  <Select value={calmKind} onValueChange={(v) => setCalmKind(v as CalmingStrategy["kind"])}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="music">Music / playlist</SelectItem>
                      <SelectItem value="clip">Video / voice clip</SelectItem>
                      <SelectItem value="phrase">Reassuring phrase</SelectItem>
                      <SelectItem value="activity">Activity</SelectItem>
                      <SelectItem value="object">Comfort object</SelectItem>
                    </SelectContent>
                  </Select>
                  <Input value={calmWhen} onChange={(e) => setCalmWhen(e.target.value)} placeholder="when to use: sundowning, bath time…" />
                </div>
                <Textarea value={calmDetail} onChange={(e) => setCalmDetail(e.target.value)} placeholder="details for the carer: volume low, sit to his left, give him the photo album first…" className="min-h-16" />
                <Button onClick={saveCalm} size="sm" className="bg-teal-800 hover:bg-teal-700">Add strategy</Button>
                <Separator />
                {calms.length === 0 && <p className="text-xs text-muted-foreground">No strategies yet — start with the song that always works.</p>}
                {calms.map((c) => (
                  <div key={c.id} className="flex items-start justify-between gap-2 border-b pb-1.5 last:border-0">
                    <div>
                      <p className="text-xs font-medium">{c.title} <Badge variant="outline" className="ml-1 px-1 py-0 text-[10px]">{c.kind}</Badge></p>
                      <p className="text-[11px] text-muted-foreground">Use at: {c.when} — {c.detail}</p>
                    </div>
                    <DeleteBtn label="strategy" onDelete={() => { const n = calms.filter((x) => x.id !== c.id); setCalms(n); calmingStore.save(n); }} />
                  </div>
                ))}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><BookOpen className="h-4 w-4 text-teal-700" /> Life-story co-authoring</CardTitle>
                <CardDescription>History, triggers, favourites — pushed to the provider's care plan and mirrored on the My Day tablet.</CardDescription></CardHeader>
              <CardContent className="space-y-3">
                <Select value={storyCat} onValueChange={(v) => setStoryCat(v as LifeStoryEntry["category"])}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="history">History</SelectItem>
                    <SelectItem value="family">Family</SelectItem>
                    <SelectItem value="work">Work / service</SelectItem>
                    <SelectItem value="favourites">Favourites</SelectItem>
                    <SelectItem value="triggers">Triggers</SelectItem>
                    <SelectItem value="milestones">Milestones</SelectItem>
                  </SelectContent>
                </Select>
                <Input value={storyTitle} onChange={(e) => setStoryTitle(e.target.value)} placeholder="e.g. 21 years Royal Engineers" />
                <Textarea value={storyDetail} onChange={(e) => setStoryDetail(e.target.value)} placeholder="details the carers should know and use in conversation…" className="min-h-16" />
                <Button onClick={saveStory} size="sm" className="bg-teal-800 hover:bg-teal-700">Add to life story</Button>
                <Separator />
                {story.length === 0 && <p className="text-xs text-muted-foreground">No entries yet.</p>}
                {story.map((s) => (
                  <div key={s.id} className="flex items-start justify-between gap-2 border-b pb-1.5 last:border-0">
                    <div>
                      <p className="text-xs font-medium">{s.title} <Badge variant="outline" className="ml-1 px-1 py-0 text-[10px]">{s.category}</Badge></p>
                      {s.detail && <p className="text-[11px] text-muted-foreground">{s.detail}</p>}
                    </div>
                    <DeleteBtn label="story entry" onDelete={() => { const n = story.filter((x) => x.id !== s.id); setStory(n); lifeStoryStore.save(n); }} />
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* -------------------------------------------- consent matrix */}
        <TabsContent value="consent" className="space-y-3">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm"><ShieldCheck className="h-4 w-4 text-teal-700" /> Consent matrix — who sees what</CardTitle>
              <CardDescription>
                Dignity through data control: each relative sees a different slice of the record, revocable at any moment
                (UK GDPR Art. 7; Qwen spec P·03). Shared links for advisers are governed separately in the Share tab.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {consent.map((row, i) => (
                  <div key={row.person} className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{row.person}</p>
                      <p className="text-xs text-muted-foreground">{CONSENT_TIER_HELP[row.tier]}{row.note ? ` · ${row.note}` : ""} · updated {row.updated}</p>
                    </div>
                    <Select value={row.tier} onValueChange={(v) => updateConsent(i, v as ConsentTier)}>
                      <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="full">Full</SelectItem>
                        <SelectItem value="lifestyle">Lifestyle only</SelectItem>
                        <SelectItem value="activities">Activities only</SelectItem>
                        <SelectItem value="none">None — revoked</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* -------------------------------------------- capacity & ACD */}
        <TabsContent value="legal" className="space-y-3">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><Gauge className="h-4 w-4 text-teal-700" /> Capacity ledger</CardTitle>
                <CardDescription>Time-stamped, decision-specific capacity entries the family holds and can contest — a defensible MCA trail for every decision window.</CardDescription></CardHeader>
              <CardContent className="space-y-3">
                <Input value={capTask} onChange={(e) => setCapTask(e.target.value)} placeholder="decision/task — e.g. managing his heating credit" />
                <div className="grid gap-2 sm:grid-cols-2">
                  <Select value={capLevel} onValueChange={(v) => setCapLevel(v as CapacityEntry["level"])}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="independent">Independent</SelectItem>
                      <SelectItem value="assisted">Can decide with support</SelectItem>
                      <SelectItem value="lacking">Lacking for this decision</SelectItem>
                    </SelectContent>
                  </Select>
                  <Input value={capNote} onChange={(e) => setCapNote(e.target.value)} placeholder="context / who assessed" />
                </div>
                <Button onClick={saveCapacity} size="sm" className="bg-teal-800 hover:bg-teal-700">Add capacity entry</Button>
                <Separator />
                {capacity.length === 0 && <p className="text-xs text-muted-foreground">No entries yet.</p>}
                {capacity.map((c) => (
                  <div key={c.id} className="flex items-start justify-between gap-2 border-b pb-1.5 last:border-0">
                    <div>
                      <p className="text-xs"><span className="font-medium">{c.task}</span> — <Badge variant="outline" className="px-1 py-0 text-[10px]">{c.level}</Badge></p>
                      <p className="text-[10px] text-muted-foreground">{new Date(c.ts).toLocaleString("en-GB")}{c.note ? ` · ${c.note}` : ""}</p>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="sm" className="h-7 px-2 text-[11px]" onClick={() => { const n = capacity.map((x) => (x.id === c.id ? { ...x, contested: !x.contested } : x)); setCapacity(n); capacityStore.save(n); }}>
                        {c.contested ? "contested ✓" : "contest"}
                      </Button>
                      <DeleteBtn label="entry" onDelete={() => { const n = capacity.filter((x) => x.id !== c.id); setCapacity(n); capacityStore.save(n); }} />
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><FileHeart className="h-4 w-4 text-teal-700" /> ACD / ReSPECT vault</CardTitle>
                <CardDescription>Anticipatory care documents, family-held and carer-visible. Gentle prompts now, while Dad can still take part.</CardDescription></CardHeader>
              <CardContent className="space-y-3">
                <div className="grid gap-2 sm:grid-cols-2">
                  <Select value={acdKind} onValueChange={(v) => setAcdKind(v as AcdDoc["kind"])}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ACD">Advance Choice Document</SelectItem>
                      <SelectItem value="ReSPECT">ReSPECT plan</SelectItem>
                      <SelectItem value="DNACPR">DNACPR</SelectItem>
                      <SelectItem value="Care wishes">Care wishes</SelectItem>
                      <SelectItem value="LPA note">LPA note</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={acdStatus} onValueChange={(v) => setAcdStatus(v as AcdDoc["status"])}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="discuss">To discuss</SelectItem>
                      <SelectItem value="planned">Planned</SelectItem>
                      <SelectItem value="draft">Draft</SelectItem>
                      <SelectItem value="in place">In place</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Input value={acdTitle} onChange={(e) => setAcdTitle(e.target.value)} placeholder="title — e.g. ReSPECT plan conversation with GP" />
                <Input value={acdLocation} onChange={(e) => setAcdLocation(e.target.value)} placeholder="where it lives — e.g. blue folder, GP record" />
                <Button onClick={saveAcd} size="sm" className="bg-teal-800 hover:bg-teal-700">Add vault entry</Button>
                <Separator />
                {acd.length === 0 && <p className="text-xs text-muted-foreground">No documents yet — start the ReSPECT conversation while it still counts.</p>}
                {acd.map((d) => (
                  <div key={d.id} className="flex items-start justify-between gap-2 border-b pb-1.5 last:border-0">
                    <div>
                      <p className="text-xs"><span className="font-medium">{d.title}</span> <Badge variant="outline" className="ml-1 px-1 py-0 text-[10px]">{d.kind} · {d.status}</Badge></p>
                      <p className="text-[10px] text-muted-foreground">at {d.location} · updated {d.updated}</p>
                    </div>
                    <DeleteBtn label="vault entry" onDelete={() => { const n = acd.filter((x) => x.id !== d.id); setAcd(n); acdStore.save(n); }} />
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

// =================================================================== DCPI
export interface DcpiPanelProps {
  actorName: string;
  onAudit: Haven360Props["onAudit"];
  medRefusedPerWeek?: number;
}

export function DcpiPanel({ actorName, onAudit, medRefusedPerWeek }: DcpiPanelProps) {
  const [inputs, setInputs] = useState<DcpiInputs | null>(null);
  const [abcs, setAbcs] = useState<AbcEntry[]>([]);

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      setAbcs(abcStore.load());
      const lastBurnout = checkInStore.load()[0]?.burnout;
      setInputs({
        ...DCPI_DEFAULTS,
        burnout: lastBurnout ?? DCPI_DEFAULTS.burnout,
        // eMAR exception rows are raw counts across all meds — clamp to the
        // indicator scale (0-10) so one noisy week can't pin the whole index.
        medsRefused: medRefusedPerWeek != null ? Math.min(10, Math.max(0, medRefusedPerWeek)) : DCPI_DEFAULTS.medsRefused,
      });
    });
    return () => cancelAnimationFrame(id);
  }, [medRefusedPerWeek]);

  const effective = inputs ?? DCPI_DEFAULTS;

  const set = (k: keyof DcpiInputs, v: number) => setInputs((p) => ({ ...(p ?? DCPI_DEFAULTS), [k]: v }));

  const score = dcpiScore(effective);
  const band = dcpiBand(score);
  const flags = dcpiStatutoryFlags(effective);
  const bandColor =
    band.tone === "green" ? "text-emerald-600" : band.tone === "amber" ? "text-amber-600" : band.tone === "red" ? "text-rose-600" : "text-rose-800";

  const abcHours = useMemo<[number, number][]>(() => {
    const counts = new Array(24).fill(0) as number[];
    for (const a of abcs) {
      const h = Number((a.time || "").split(":")[0]);
      if (!Number.isNaN(h) && h >= 0 && h < 24) counts[h] += 1;
    }
    return counts.map((n, h) => [h, n] as [number, number]).filter(([, n]) => n > 0);
  }, [abcs]);

  const compile = () => {
    const md = dcpiReportMd(effective, score, band, flags, abcHours);
    const blob = new Blob([md], { type: "text/markdown" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `DCPI_transition_report_${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(a.href);
    onAudit("dcpi.report", `DCPI ${score}/100`, `Transition report compiled — ${band.label}${flags.length ? ` · ${flags.length} statutory threshold(s) crossed` : " · no statutory thresholds crossed"}`, "notice");
  };

  const sliders: { k: keyof DcpiInputs; label: string; max: number; unit: string; hint: string }[] = [
    { k: "wandering", label: "Wandering / unsafe exit attempts", max: 10, unit: "/wk", hint: "Exit attempts, key-safe events, Herbert Protocol triggers" },
    { k: "disorientation", label: "Disorientation episodes (time/place)", max: 10, unit: "/wk", hint: "Doesn't know day/place, asks about Mum repeatedly" },
    { k: "weightLoss", label: "Weight loss (12 weeks)", max: 10, unit: "%", hint: "≥3% crosses the MUST re-assessment threshold" },
    { k: "hydrationDays", label: "Days below hydration target (last 14)", max: 14, unit: "d", hint: "From carer notes and your check-ins" },
    { k: "medsRefused", label: "Medications refused / missed", max: 10, unit: "/wk", hint: "From eMAR exceptions + family observations" },
    { k: "nightDisturbance", label: "Night disturbance / unsafe appliance events", max: 10, unit: "/wk", hint: "Night wandering, cooker left on, night-time calls" },
    { k: "burnout", label: "Primary carer burnout (0–10, confidential)", max: 10, unit: "/10", hint: "Pre-filled from your daily check-ins" },
  ];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base"><FileWarning className="h-5 w-5 text-teal-700" /> Dementia Care Progression Index (DCPI)</CardTitle>
          <CardDescription>
            The family&apos;s objective answer to &quot;is visiting care still enough?&quot; — blending provider data with family
            observations, and compiling the report that triggers statutory reassessment (Qwen Haven 360 spec §08).
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5 lg:grid-cols-[1.2fr_1fr]">
          <div className="space-y-4">
            {sliders.map((s) => (
              <div key={s.k}>
                <div className="flex items-baseline justify-between">
                  <Label className="text-xs">{s.label}</Label>
                  <span className="text-sm font-bold tabular-nums">{effective[s.k]} {s.unit}</span>
                </div>
                <Slider value={[effective[s.k]]} min={0} max={s.max} step={1} onValueChange={([v]) => set(s.k, v)} className="mt-1.5" />
                <p className="mt-0.5 text-[10px] text-muted-foreground">{s.hint}</p>
              </div>
            ))}
          </div>
          <div className="space-y-4">
            <div className="rounded-xl border p-5 text-center">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">DCPI score</p>
              <p className={`mt-1 text-5xl font-black tabular-nums ${bandColor}`}>{score}<span className="text-lg font-semibold text-muted-foreground"> / 100</span></p>
              <p className={`mt-1 text-sm font-bold ${bandColor}`}>{band.label}</p>
              <p className="mt-2 text-xs text-muted-foreground">{band.advice}</p>
            </div>
            <div>
              <p className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold"><FileWarning className="h-4 w-4 text-rose-600" /> Crossed statutory thresholds</p>
              {flags.length === 0 ? (
                <p className="rounded-lg border p-2.5 text-xs text-muted-foreground">None this run — keep the inputs honest and re-run monthly or after any incident.</p>
              ) : (
                <ul className="space-y-1.5">
                  {flags.map((f) => (
                    <li key={f.title} className="rounded-lg border border-rose-200 bg-rose-50/60 p-2.5 text-xs dark:border-rose-900 dark:bg-rose-950/30">
                      <p className="font-semibold text-rose-900 dark:text-rose-200">{f.title}</p>
                      <p className="mt-0.5 text-rose-800/90 dark:text-rose-300/90">Basis: {f.basis}</p>
                      <p className="mt-0.5">→ {f.action}</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <Button onClick={compile} className="w-full bg-teal-800 hover:bg-teal-700"><Download className="mr-1.5 h-4 w-4" /> Compile transition report (.md)</Button>
            <p className="text-[11px] text-muted-foreground">Report compiled by {actorName} · attaches to a Care Act s.9 reassessment request in Social &amp; comms. Decision-support, not legal or medical advice.</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
