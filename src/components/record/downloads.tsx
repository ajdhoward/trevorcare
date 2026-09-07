"use client";

import { useState } from "react";
import {
  FileSpreadsheet,
  Package,
  FileText,
  Copy,
  Check,
  Info,
  ListChecks,
  Download,
  FolderGit2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { type DocInfo, AI_PROMPT, fmtSize } from "@/lib/record";
import type { SysAuditAction } from "@/lib/auditlog";
import { Lock } from "lucide-react";

const ENC = (s: string) => encodeURIComponent(s);

const CSV_LIST = [
  ["visits_summary.csv", "One row per scheduled visit — times, carer, status, outcome counts"],
  ["visits_and_notes.csv", "Visits with the full carer note text"],
  ["visit_task_and_medication_outcomes.csv", "Task- and medication-level outcome for every visit"],
  ["medication_administration_emar.csv", "Dose-by-dose eMAR: given / not completed / cancelled"],
  ["medications_current.csv", "Active prescriptions with doses, directions and risks"],
  ["medications_full_list_history.csv", "Full medication list including past items"],
  ["schedule_upcoming.csv", "Planned visits going forward"],
  ["absences_and_cancellations.csv", "Booked absence and cancellation windows"],
  ["care_package_weekly_schedule.csv", "Commissioned weekly care-package schedule"],
  ["profile_and_contacts.csv", "Client details, GP, pharmacy, next of kin"],
] as const;

export default function Downloads({
  docs,
  canExport,
  onAudit,
}: {
  docs: DocInfo[];
  canExport: boolean;
  onAudit: (action: SysAuditAction, target: string, detail: string, severity?: "info" | "notice" | "warning") => void;
}) {
  const [copied, setCopied] = useState(false);

  if (!canExport) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <Lock className="h-4 w-4 shrink-0" />
          Downloads and exports are not permitted for your role (UK GDPR Art. 5(1)(c) data
          minimisation — managed in Access &amp; audit).
        </CardContent>
      </Card>
    );
  }

  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(AI_PROMPT);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable */
    }
  };

  const carePlan = docs.filter((d) => d.type.toLowerCase().includes("care plan"));
  const risks = docs.filter((d) => d.type.toLowerCase().includes("risk"));
  const policies = docs.filter((d) => d.type.toLowerCase().includes("policy"));

  return (
    <div className="space-y-4">
      {/* hero downloads */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="border-teal-300 bg-gradient-to-br from-teal-50 to-emerald-50/60">
          <CardHeader className="pb-1">
            <CardTitle className="flex items-center gap-2 text-lg text-teal-900">
              <FileSpreadsheet className="h-5 w-5 text-teal-700" />
              Complete Record workbook
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p className="leading-relaxed text-foreground/90">
              The full Dad record from <strong>6 October 2025 to 5 September 2026</strong>{" "}
              in one beautifully formatted Excel workbook: Overview dashboard sheet, Visits, Tasks
              &amp; Medication, eMAR, Current Medications, Schedule, Absences, Documents index,
              Contacts and Care Package — colour-coded statuses, filters and frozen headers
              throughout.
            </p>
            <div className="flex flex-wrap gap-1.5">
              <Badge variant="outline" className="border-teal-300 bg-white text-teal-900">
                1,283 visits
              </Badge>
              <Badge variant="outline" className="border-teal-300 bg-white text-teal-900">
                20,054 task outcomes
              </Badge>
              <Badge variant="outline" className="border-teal-300 bg-white text-teal-900">
                11,020 eMAR records
              </Badge>
              <Badge variant="outline" className="border-teal-300 bg-white text-teal-900">
                11 sheets
              </Badge>
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              <a href="/downloads/Care_Record_Workbook_Sample.xlsx" download
                 onClick={() => onAudit("export.file", "Care_Record_Workbook_Sample.xlsx", "formatted workbook downloaded", "notice")}
                 className="rounded-lg border-2 border-teal-600 bg-white p-3 transition-shadow hover:shadow-md">
                <div className="flex items-center gap-1.5 text-sm font-bold text-teal-900">
                  Excel (.xlsx)
                  <Badge className="ml-auto border-teal-200 bg-teal-100 px-1.5 text-[10px] text-teal-800" variant="outline">Recommended</Badge>
                </div>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  Fully formatted: colour-coded tabs, zebra rows, status colours, filters, frozen headers.
                </p>
              </a>
              <a href="/downloads/Care_Record_Workbook_Sample.ods" download
                 onClick={() => onAudit("export.file", "Care_Record_Workbook_Sample.ods", "ODS workbook downloaded", "notice")}
                 className="rounded-lg border border-teal-200 bg-white p-3 transition-shadow hover:border-teal-400 hover:shadow-md">
                <div className="text-sm font-bold text-teal-900">OpenDocument (.ods)</div>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  Opens in Google Sheets, LibreOffice, OpenOffice. Same 10 sheets, plain formatting.
                </p>
              </a>
              <a href="/downloads/Care_Record_CSV_Sample.zip" download
                 onClick={() => onAudit("export.file", "Care_Record_CSV_Sample.zip", "CSV bundle downloaded", "notice")}
                 className="rounded-lg border border-teal-200 bg-white p-3 transition-shadow hover:border-teal-400 hover:shadow-md">
                <div className="text-sm font-bold text-teal-900">CSV bundle (.zip)</div>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  10 universal comma-separated files — maximum compatibility, no formatting.
                </p>
              </a>
            </div>
          </CardContent>
        </Card>

        <Card className="border-amber-300 bg-gradient-to-br from-amber-50 to-orange-50/60">
          <CardHeader className="pb-1">
            <CardTitle className="flex items-center gap-2 text-lg text-amber-900">
              <Package className="h-5 w-5 text-amber-700" />
              AI Review Bundle — everything in one zip
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p className="leading-relaxed text-foreground/90">
              The complete bundle for asking an AI to review Dad&apos;s care: the workbook, all
              CSV extracts, the <strong>care plan</strong> (including the regenerated 06-09-2026
              version), <strong>risk assessments</strong> and the agency&apos;s full{" "}
              <strong>policy library</strong> — plus an <strong>insights/</strong> folder
              (conditions, recommendations, well-being index, flag analytics, Mental Health Act
              Sections 17/117 check) and a README with a data dictionary, context-window guidance
              and a ready-to-paste review prompt.
            </p>
            <ol className="ml-4 list-decimal space-y-0.5 text-xs text-muted-foreground">
              <li>Download the zip below.</li>
              <li>Attach it (or the files inside) to your AI chat.</li>
              <li>Paste the prompt from this page and send.</li>
            </ol>
            <Button asChild size="lg" className="w-full bg-amber-700 hover:bg-amber-600">
              <a href="/downloads/Family_Care_Record_AI_Review_Bundle.zip" download
                 onClick={() => onAudit("export.bundle", "Family_Care_Record_AI_Review_Bundle.zip", "full AI review bundle downloaded — contains complete record, care plan and policy library", "warning")}>
                <Package className="mr-2 h-4 w-4" />
                Download AI Review Bundle (.zip · ~10 MB)
              </a>
            </Button>
          </CardContent>
        </Card>
        <Card className="border-violet-300 bg-gradient-to-br from-violet-50 to-indigo-50/40">
          <CardHeader className="pb-1">
            <CardTitle className="flex items-center gap-2 text-lg text-violet-900">
              <FolderGit2 className="h-5 w-5 text-violet-700" />
              Portal source package
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p className="leading-relaxed text-foreground/90">
              The whole portal as a git-ready zip: engine, components, demo data, docs and workflows —
              privacy-screened (no <code>.env</code>, no database, no personal data). Unzip, <code>git init</code>,
              push to your own <strong>private</strong> repo and deploy — or skip the terminal with the
              one-click <em>Push portal to repo</em> button in Deploy &amp; sync.
            </p>
            <div className="flex flex-wrap gap-1.5">
              <Badge variant="outline" className="border-violet-300 bg-white text-violet-900">depersonalised engine + demo data</Badge>
              <Badge variant="outline" className="border-violet-300 bg-white text-violet-900">.env excluded</Badge>
              <Badge variant="outline" className="border-violet-300 bg-white text-violet-900">db excluded</Badge>
            </div>
            <Button asChild className="w-full bg-violet-700 hover:bg-violet-600">
              <a href="/downloads/portal-source.zip" download
                 onClick={() => onAudit("export.bundle", "portal-source.zip", "portal source package downloaded (git-ready, privacy-screened)", "notice")}>
                <FolderGit2 className="mr-2 h-4 w-4" />
                Download portal source (.zip)
              </a>
            </Button>
            <p className="text-xs text-muted-foreground">
              Walkthrough: <code>docs/GITHUB-SETUP.md</code> inside the zip — create the repo, scope a fine-grained
              token, push, then let GitHub Actions build-check and deploy.
            </p>
          </CardContent>
        </Card>
      </div>

      {/* prompt */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base text-teal-900">
            <ListChecks className="h-4 w-4 text-teal-700" />
            Ready-to-paste AI review prompt
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded-lg border bg-teal-50/50 p-3 text-xs leading-relaxed text-foreground/90">
{AI_PROMPT}
          </pre>
          <Button onClick={copyPrompt} variant="outline" size="sm">
            {copied ? (
              <>
                <Check className="mr-1.5 h-3.5 w-3.5 text-emerald-600" /> Copied
              </>
            ) : (
              <>
                <Copy className="mr-1.5 h-3.5 w-3.5" /> Copy prompt
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* context window guidance */}
      <Card className="border-amber-200 bg-amber-50/40">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base text-amber-900">
            <Info className="h-4 w-4 text-amber-700" />
            Will everything fit in an AI context window?
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p className="leading-relaxed text-foreground/90">
            Not all at once, in most chat tools. The 23 documents total roughly{" "}
            <strong>112,000 words of extracted text (~150,000 tokens)</strong>, the workbook adds
            1,283 visit rows and 11,020 eMAR rows, and the CSV extracts add ~2 MB more — together
            that exceeds the usable context of most AI models. The bundle therefore includes the
            small, high-signal <strong>insights/</strong> files so an AI can start there and ask
            for specific extracts on request.
          </p>
          <ul className="ml-4 list-disc space-y-1 text-xs text-muted-foreground">
            <li>Start with README_FOR_AI_REVIEW.md + insights/*.json — small and high-signal.</li>
            <li>Then feed the CSV extracts the AI actually needs, one or two at a time.</li>
            <li>If the tool supports file attachments, attach the whole zip and let it read selectively.</li>
            <li>Split by topic when needed: e.g. medication review = eMAR CSV + medications CSV + Medication risk assessment.</li>
          </ul>
        </CardContent>
      </Card>

      {/* CSV extracts */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base text-teal-900">CSV extracts (individual downloads)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="divide-y">
            {CSV_LIST.map(([fn, desc]) => (
              <a
                key={fn}
                href={`/downloads/csv_extracts/${fn}`}
                download={fn}
                onClick={() => onAudit("export.file", fn, "CSV extract downloaded", "notice")}
                className="flex items-center justify-between gap-3 py-2 text-sm hover:bg-teal-50/60"
              >
                <div className="min-w-0">
                  <div className="font-medium">{fn}</div>
                  <div className="text-xs text-muted-foreground">{desc}</div>
                </div>
                <FileText className="h-4 w-4 shrink-0 text-teal-700" />
              </a>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* key documents */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base text-teal-900">Care plan, risk assessments & policies</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          {[
            ["Care plan", carePlan],
            ["Risk assessments", risks],
            ["Policies & handbooks", policies],
          ].map(([label, list]) => (
            <div key={label as string}>
              <div className="pt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {label as string}
              </div>
              <div className="divide-y">
                {(list as DocInfo[]).map((d) => (
                  <div key={d.file} className="flex items-center justify-between gap-3 py-1.5 text-sm">
                    <span className="min-w-0 truncate" title={d.file}>
                      {d.file}{" "}
                      <span className="text-xs text-muted-foreground">({fmtSize(d.size)})</span>
                    </span>
                    <span className="flex shrink-0 gap-1.5">
                      <Button asChild size="sm" variant="ghost" className="h-7 px-2 text-xs">
                        <a href={`/downloads/documents/${ENC(d.file)}`} target="_blank" rel="noreferrer">
                          View
                        </a>
                      </Button>
                      <Button asChild size="sm" variant="outline" className="h-7 px-2 text-xs">
                        <a
                          href={`/downloads/documents/${ENC(d.file)}`}
                          download={d.file}
                          onClick={() => onAudit("export.file", d.file, "document downloaded", "notice")}
                        >
                          <Download className="mr-1 h-3 w-3" />
                          Download
                        </a>
                      </Button>
                    </span>
                  </div>
                ))}
              </div>
              <Separator className="mt-2" />
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="flex items-start gap-2 rounded-lg border border-teal-200 bg-teal-50/60 p-3 text-xs text-muted-foreground">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-teal-700" />
        Privacy: these files contain health and social-care records for Dad. Share only
        with people and AI services the family trusts, and never republish them publicly.
      </div>
    </div>
  );
}
