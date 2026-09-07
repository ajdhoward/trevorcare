"use client";

// AI research — ask a question; the engine searches the web (built-in tools)
// and any registered MCP servers, drafts claims each bound to a source, then
// VALIDATES every quote against the fetched text before anything reaches you.
// Verdicts: supported (quote verified) / unsupported (kept visible, marked).
// Nothing enters the record until a human accepts a claim — anti-drift by
// construction, with the full tool-call trace kept for audit.

import { useCallback, useEffect, useRef, useState } from "react";
import { Microscope, Loader2, Send, Check, X, ShieldAlert, ShieldCheck, Server, Plus, Trash2, RefreshCw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { type CareSubjectRecord } from "@/lib/subjects";

interface RunRow {
  id: string;
  question: string;
  status: string;
  grounding: number | null;
  summary: string;
  error: string;
  createdAt: string;
  counts?: { supported: number; unsupported: number };
}

interface ClaimRow {
  id: string;
  runId: string;
  text: string;
  sources: string;
  verdict: string;
  confidence: number;
  status: string;
}

interface SourceParsed {
  url: string;
  title?: string;
  quote: string;
  score: number;
}

interface McpServerRow {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  lastResult: string;
  lastTestAt: string | null;
}

interface LogEntry {
  tool: string;
  args: Record<string, unknown>;
  at: string;
  ok: boolean;
  detail: string;
}

export default function Research({ subjects, canManage }: { subjects: CareSubjectRecord[]; canManage: boolean }) {
  const [question, setQuestion] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [detail, setDetail] = useState<{ run: RunRow & { log?: LogEntry[] }; claims: ClaimRow[] } | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [servers, setServers] = useState<McpServerRow[]>([]);
  const [newServer, setNewServer] = useState({ name: "", url: "", headers: "{}" });
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadRuns = useCallback(async () => {
    try {
      const res = await fetch("/api/research");
      const json = (await res.json()) as { runs?: RunRow[] };
      setRuns(json.runs ?? []);
      return json.runs ?? [];
    } catch {
      return [];
    }
  }, []);

  const loadServers = useCallback(async () => {
    try {
      const res = await fetch("/api/mcp");
      const json = (await res.json()) as { servers?: McpServerRow[] };
      setServers(json.servers ?? []);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void loadRuns();
    void loadServers();
  }, [loadRuns, loadServers]);

  useEffect(() => () => {
    if (pollRef.current) clearInterval(pollRef.current);
  }, []);

  const openRun = async (id: string) => {
    setError(null);
    try {
      const res = await fetch(`/api/research/${id}`);
      const json = (await res.json()) as { ok?: boolean; run?: RunRow & { log?: LogEntry[] }; claims?: ClaimRow[]; error?: string };
      if (!json.ok || !json.run) {
        setError(json.error ?? "Run not found.");
        return;
      }
      setDetail({ run: json.run, claims: json.claims ?? [] });
    } catch {
      setError("Could not load the run detail.");
    }
  };

  const ask = async () => {
    if (question.trim().length < 8) {
      setError("Ask a question of at least a few words.");
      return;
    }
    setRunning(true);
    setError(null);
    setNotice(null);
    setDetail(null);
    try {
      const res = await fetch("/api/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, subjectId }),
      });
      const json = (await res.json()) as { ok?: boolean; runId?: string; error?: string };
      if (!json.ok || !json.runId) {
        setError(json.error ?? "The research run failed to start.");
        setRunning(false);
        return;
      }
      // poll while running (max ~90s)
      let waited = 0;
      const poll = async () => {
        const runsNow = await loadRuns();
        const r = runsNow.find((x) => x.id === json.runId);
        waited += 3;
        if (r && (r.status === "done" || r.status === "error")) {
          if (pollRef.current) clearInterval(pollRef.current);
          setRunning(false);
          await openRun(json.runId as string);
          setQuestion("");
        } else if (waited > 90) {
          if (pollRef.current) clearInterval(pollRef.current);
          setRunning(false);
          setError("Still running — open the run from the history in a moment.");
        }
      };
      await poll();
      pollRef.current = setInterval(poll, 3000);
    } catch {
      setError("Network error starting the run.");
      setRunning(false);
    }
  };

  const decideClaim = async (claim: ClaimRow, status: "accepted" | "dismissed") => {
    const res = await fetch("/api/research/claim", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: claim.id, status }),
    });
    const json = (await res.json()) as { ok?: boolean; decidedBy?: string };
    if (json.ok) setNotice(`Claim ${status} by ${json.decidedBy ?? "you"} — the decision is recorded with the evidence.`);
    await openRun(claim.runId);
  };

  const addServer = async () => {
    if (!newServer.name.trim() || !newServer.url.trim()) {
      setError("The MCP server needs a name and a URL.");
      return;
    }
    setError(null);
    const res = await fetch("/api/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newServer),
    });
    const json = (await res.json()) as { ok?: boolean; error?: string };
    if (!json.ok) setError(json.error ?? "Could not add the server.");
    else {
      setNewServer({ name: "", url: "", headers: "{}" });
      await loadServers();
    }
  };

  const testServer = async (id: string) => {
    setNotice(null);
    const res = await fetch(`/api/mcp/${id}`, { method: "POST" });
    const json = (await res.json()) as { ok?: boolean; tools?: Array<{ name: string }>; error?: string };
    setNotice(json.ok ? `Handshake OK — ${json.tools?.length ?? 0} tool(s) found.` : (json.error ?? "Handshake failed."));
    await loadServers();
  };

  const removeServer = async (id: string) => {
    await fetch(`/api/mcp/${id}`, { method: "DELETE" });
    await loadServers();
  };

  const toggleServer = async (s: McpServerRow) => {
    await fetch(`/api/mcp/${s.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !s.enabled }),
    });
    await loadServers();
  };

  const parseSources = (raw: string): SourceParsed[] => {
    try {
      return JSON.parse(raw) as SourceParsed[];
    } catch {
      return [];
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-wrap items-center gap-3">
          <Microscope className="h-5 w-5 text-teal-300" />
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-bold">AI research (MCP) — validated, anti-drift</h2>
            <p className="text-xs text-muted-foreground">
              Built-in web search + your registered MCP servers. Every claim must quote its source verbatim; the
              validator re-checks quotes against the fetched text. Supported / unsupported verdicts, human review before
              anything is accepted, full trace retained.
            </p>
          </div>
        </CardContent>
      </Card>

      {notice && <p className="rounded-lg border border-emerald-500/40 bg-emerald-950/30 p-2.5 text-sm text-emerald-200">{notice}</p>}
      {error && <p className="rounded-lg border border-rose-500/40 bg-rose-950/30 p-2.5 text-sm text-rose-200" role="alert">{error}</p>}

      <Card>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Input
              className="min-w-64 flex-1"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="e.g. What are a social worker's duties before closing a s.42 safeguarding enquiry?"
              onKeyDown={(e) => e.key === "Enter" && !running && void ask()}
            />
            <Select2 subjects={subjects} value={subjectId} onChange={setSubjectId} />
            <Button className="bg-teal-700 text-white hover:bg-teal-600" onClick={() => void ask()} disabled={running || !canManage}>
              {running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
              {running ? "Researching…" : "Research"}
            </Button>
          </div>
          {running && <Progress value={60} className="h-1.5" />}
          {!canManage && (
            <p className="text-xs text-muted-foreground">Your role can read research results but not start runs.</p>
          )}
        </CardContent>
      </Card>

      {detail && (
        <Card className="border-teal-800/60">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">{detail.run.question}</CardTitle>
            <p className="text-xs text-muted-foreground">
              {detail.run.status === "done" ? (
                <>
                  Grounding:{" "}
                  <strong className={detail.run.grounding !== null && detail.run.grounding >= 0.75 ? "text-emerald-400" : "text-amber-400"}>
                    {Math.round((detail.run.grounding ?? 0) * 100)}% of claims quote-verified
                  </strong>{" "}
                  · {detail.run.summary}
                </>
              ) : (
                <>Status: {detail.run.status}{detail.run.error ? ` — ${detail.run.error}` : ""}</>
              )}
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2">
              {detail.claims.map((c) => {
                const sources = parseSources(c.sources);
                const supported = c.verdict === "supported";
                return (
                  <div key={c.id} className={`rounded-lg border p-3 ${supported ? "border-emerald-700/40" : "border-amber-700/40"}`}>
                    <div className="flex flex-wrap items-center gap-2">
                      {supported ? (
                        <Badge variant="outline" className="border-emerald-500/40 text-emerald-300">
                          <ShieldCheck className="mr-1 h-3 w-3" /> supported
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="border-amber-500/40 text-amber-300">
                          <ShieldAlert className="mr-1 h-3 w-3" /> unsupported
                        </Badge>
                      )}
                      <Badge variant="outline" className="text-[10px] text-muted-foreground">
                        quote match {Math.round(c.confidence * 100)}%
                      </Badge>
                      {c.status !== "pending" && (
                        <Badge variant="outline" className="text-[10px] text-muted-foreground">{c.status}</Badge>
                      )}
                    </div>
                    <p className="mt-1.5 text-sm leading-relaxed">{c.text}</p>
                    {sources.map((s, i) => (
                      <p key={i} className="mt-1 text-xs text-muted-foreground">
                        <Quote_> quote: “{s.quote}”</Quote_>
                        <br />
                        <a className="underline hover:text-foreground" href={s.url} target="_blank" rel="noreferrer">
                          {s.title || s.url}
                        </a>
                      </p>
                    ))}
                    {canManage && c.status === "pending" && (
                      <div className="mt-2 flex gap-2">
                        <Button size="sm" variant="outline" className="h-7 border-emerald-600/50 px-2 text-emerald-300 hover:bg-emerald-950/40" onClick={() => void decideClaim(c, "accepted")}>
                          <Check className="mr-1 h-3.5 w-3.5" /> Accept into the record
                        </Button>
                        <Button size="sm" variant="outline" className="h-7 border-rose-600/50 px-2 text-rose-300 hover:bg-rose-950/40" onClick={() => void decideClaim(c, "dismissed")}>
                          <X className="mr-1 h-3.5 w-3.5" /> Dismiss
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })}
              {detail.claims.length === 0 && detail.run.status === "done" && (
                <p className="text-sm text-muted-foreground">No claims were produced — see the trace below.</p>
              )}
            </div>

            {detail.run.log && detail.run.log.length > 0 && (
              <details className="rounded-lg border p-2.5 text-xs">
                <summary className="cursor-pointer font-semibold">Tool-call trace ({detail.run.log.length})</summary>
                <ul className="mt-2 space-y-1">
                  {detail.run.log.map((l, i) => (
                    <li key={i} className={l.ok ? "text-muted-foreground" : "text-amber-400"}>
                      [{new Date(l.at).toLocaleTimeString()}] {l.tool} {l.ok ? "→" : "✗"} {l.detail}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Run history</CardTitle>
        </CardHeader>
        <CardContent>
          {runs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No runs yet.</p>
          ) : (
            <ul className="space-y-1.5">
              {runs.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-2 rounded-lg border p-2.5 text-sm">
                  <span className="min-w-0 flex-1 truncate">{r.question}</span>
                  {r.counts && (
                    <Badge variant="outline" className="text-[10px]">
                      {r.counts.supported} supported · {r.counts.unsupported} unsupported
                    </Badge>
                  )}
                  <Badge variant="outline" className={`text-[10px] ${r.status === "done" ? "text-emerald-400" : r.status === "error" ? "text-rose-400" : "text-amber-400"}`}>
                    {r.status}
                  </Badge>
                  <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => void openRun(r.id)}>
                    Open
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Tabs defaultValue="registry">
        <TabsList>
          <TabsTrigger value="registry">MCP servers</TabsTrigger>
        </TabsList>
        <TabsContent value="registry">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Server className="h-4 w-4 text-teal-300" /> Registered MCP servers
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                Model Context Protocol over streamable HTTP (JSON-RPC). Servers must be publicly reachable — private
                hosts are blocked. Without any registered server, research still runs on the built-in web tools.
              </p>
            </CardHeader>
            <CardContent className="space-y-3">
              {servers.map((s) => (
                <div key={s.id} className="flex flex-wrap items-center gap-2 rounded-lg border p-2.5 text-sm">
                  <span className="font-semibold">{s.name}</span>
                  <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{s.url}</span>
                  <Badge variant="outline" className={`text-[10px] ${s.enabled ? "text-emerald-400" : "text-muted-foreground"}`}>
                    {s.enabled ? "enabled" : "disabled"}
                  </Badge>
                  <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => void testServer(s.id)}>
                    <RefreshCw className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => void toggleServer(s)}>
                    {s.enabled ? "Disable" : "Enable"}
                  </Button>
                  <Button size="sm" variant="outline" className="h-7 px-2 text-rose-300 hover:bg-rose-950/40" onClick={() => void removeServer(s.id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                  {s.lastResult && <p className="w-full text-[11px] text-muted-foreground">{s.lastResult}</p>}
                </div>
              ))}
              {canManage && (
                <div className="grid gap-2 rounded-lg border border-dashed p-3 sm:grid-cols-4">
                  <div className="space-y-1">
                    <Label className="text-xs">Name</Label>
                    <Input value={newServer.name} onChange={(e) => setNewServer({ ...newServer, name: e.target.value })} placeholder="my-mcp-server" />
                  </div>
                  <div className="space-y-1 sm:col-span-2">
                    <Label className="text-xs">URL (https)</Label>
                    <Input value={newServer.url} onChange={(e) => setNewServer({ ...newServer, url: e.target.value })} placeholder="https://example.com/mcp" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Headers (JSON)</Label>
                    <Input value={newServer.headers} onChange={(e) => setNewServer({ ...newServer, headers: e.target.value })} />
                  </div>
                  <div className="sm:col-span-4">
                    <Button size="sm" variant="outline" onClick={() => void addServer()}>
                      <Plus className="mr-2 h-4 w-4" /> Register server
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Quote_({ children }: { children: React.ReactNode }) {
  return <span className="italic">“{typeof children === "string" ? children.replace(/^ quote: /, "") : children}”</span>;
}

function Select2({
  subjects, value, onChange,
}: {
  subjects: CareSubjectRecord[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-48">
        <SelectValue placeholder="About (optional)" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="">General research</SelectItem>
        {subjects.map((s) => (
          <SelectItem key={s.id} value={s.id}>{s.displayName}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// local import shims to keep the file tidy
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
