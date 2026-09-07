// Read-only care brief for a shared link — e.g. the family's social worker
// opened the WhatsApp link the family sent. Server-rendered from the record
// data on disk; no client state, no editing, no contacts beyond the care team.
// Expiry + revocation enforced here (ShareLink row).

import { notFound } from "next/navigation";
import fs from "node:fs/promises";
import path from "node:path";
import { db } from "@/lib/db";
import type { CareRecord, WellbeingData } from "@/lib/record";
import type { MumInfo } from "@/lib/family";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ token: string }>;
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    const p = path.join(process.cwd(), "public", "data", file);
    return JSON.parse(await fs.readFile(p, "utf8")) as T;
  } catch {
    return null;
  }
}

const CARD = "rounded-xl border border-teal-900/20 bg-white p-4 shadow-sm";

function prettyTheme(t: string): string {
  const map: Record<string, string> = {
    declin: "Declined care", refus: "Refused / declined", confus: "Confusion", pain: "Pain",
    nomad: "Restless / pacing", hearing: "Hearing aid", hearing_aid: "Hearing aid",
    falls: "Falls / balance", personal_care: "Personal care", medicat: "Medication",
  };
  const key = t.toLowerCase();
  if (map[key]) return map[key];
  const prefix = Object.entries(map).find(([k]) => key.startsWith(k));
  if (prefix) return prefix[1];
  return t.charAt(0).toUpperCase() + t.slice(1).replace(/_/g, " ");
}

export default async function SharePage({ params }: Props) {
  const { token } = await params;
  const link = await db.shareLink.findUnique({ where: { token } });
  if (!link || link.revoked || new Date(link.expiresAt) < new Date()) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-teal-50 px-6">
        <div className={CARD}>
          <h1 className="text-lg font-bold text-teal-900">This link is no longer active</h1>
          <p className="mt-2 max-w-md text-sm text-teal-800/80">
            {link?.revoked
              ? "The family has revoked this shared view. Ask Alex for a fresh link if you still need access."
              : link
                ? "The time box on this shared view has expired. Ask Alex for a fresh link if you still need access."
                : "This link is not valid — check it was copied in full, or ask Alex for a fresh link."}
          </p>
        </div>
      </main>
    );
  }

  await db.shareLink.update({
    where: { token },
    data: { views: { increment: 1 }, lastViewedAt: new Date() },
  });

  const [record, wellbeing, mum] = await Promise.all([
    readJson<CareRecord>("record.json"),
    readJson<WellbeingData>("wellbeing.json"),
    readJson<MumInfo>("mum.json"),
  ]);

  const detailed = link.scope === "detailed";
  const cutoff30 = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const flags30 = record ? record.flags.filter((f) => f.date >= cutoff30) : [];
  const themeCount = new Map<string, number>();
  for (const f of flags30) for (const k of f.kw) themeCount.set(k, (themeCount.get(k) ?? 0) + 1);
  const topThemes = [...themeCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  const medEx30 = record ? record.med_events.filter((m) => m.date >= cutoff30).length : 0;
  const visits30 = record ? record.hist.filter((v) => v.date >= cutoff30).length : 0;
  const wb = wellbeing?.monthly?.[wellbeing.monthly.length - 1];
  const latestFlagNotes = detailed ? flags30.slice(0, 8) : [];

  return (
    <main className="mx-auto max-w-3xl space-y-4 bg-teal-50/40 px-4 py-6 sm:px-6">
      <header className="rounded-xl bg-teal-900 p-5 text-white shadow">
        <p className="text-xs font-semibold uppercase tracking-widest text-teal-200">Read-only care brief · shared by the Family family</p>
        <h1 className="mt-1 text-2xl font-bold">Dad &amp; Mum — current care picture</h1>
        <p className="mt-1 text-sm text-teal-100">
          Prepared for <strong>{link.subject}</strong> · time-boxed view (expires {new Date(link.expiresAt).toLocaleDateString("en-GB")}) ·
          the family can revoke at any moment · view #{link.views + 1}
        </p>
      </header>

      <section className={CARD}>
        <h2 className="flex items-center gap-2 text-base font-bold text-teal-900">Dad — Dad <span className="text-xs font-normal text-teal-700">home care · the care agency (Council)</span></h2>
        {record && (
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              ["Visits (30d)", String(visits30)],
              ["Flag notes (30d)", String(flags30.length)],
              ["Dose exceptions (30d)", String(medEx30)],
              ["Active medicines", String(record.meds.length)],
            ].map(([k, v]) => (
              <div key={k} className="rounded-lg border p-2 text-center">
                <p className="text-lg font-bold text-teal-800">{v}</p>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{k}</p>
              </div>
            ))}
          </div>
        )}
        {wb && (
          <p className="mt-3 text-sm">
            <strong>Family-computed well-being index:</strong> {wb ? `${wb.score}/100` : "—"} (monthly average) — the full
            daily series lives in the portal.
          </p>
        )}
        {topThemes.length > 0 && (
          <>
            <p className="mt-3 text-sm font-semibold">What the care notes are flagging (last 30 days)</p>
            <ul className="mt-1 space-y-1 text-sm">
              {topThemes.map(([t, n]) => (
                <li key={t} className="flex items-center justify-between rounded border px-2 py-1">
                  <span>{prettyTheme(t)}</span>
                  <span className="font-bold text-teal-800">{n}×</span>
                </li>
              ))}
            </ul>
          </>
        )}
        {latestFlagNotes.length > 0 && (
          <>
            <p className="mt-3 text-sm font-semibold">Recent flagged notes (evidence quotes)</p>
            <ul className="mt-1 space-y-1.5">
              {latestFlagNotes.map((f, i) => (
                <li key={i} className="rounded border bg-muted/40 p-2 text-xs">
                  <span className="font-semibold">{f.date}</span> — {f.notes}
                </li>
              ))}
            </ul>
          </>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          Known record issues the family is chasing: the portal&apos;s next-of-kin entry (Contact A, niece-in-law) is
          family-verified as wrong and is being corrected with the agency; an Alzheimer&apos;s diagnosis is signposted by
          medication and clinic visits but never named in the record.
        </p>
      </section>

      <section className={CARD}>
        <h2 className="flex items-center gap-2 text-base font-bold text-teal-900">Mum — Mum <span className="text-xs font-normal text-teal-700">Mum's care home, Council</span></h2>
        <p className="mt-2 text-sm">
          The care home has no family portal, so the family runs an email/phone/WhatsApp protocol: weekly calls with a
          checklist, monthly emails for formal updates, quarterly review requests. The family logs every contact and a
          1–5 well-being score in the portal.
        </p>
        {mum && mum.profile?.careHome && (
          <p className="mt-2 text-sm text-muted-foreground">Placement: {mum.profile.careHome.name ?? "Mum's care home"}{mum.profile.careHome.phone ? ` · home tel ${mum.profile.careHome.phone}` : ""}</p>
        )}
      </section>

      <section className={CARD}>
        <h2 className="text-base font-bold text-teal-900">What the family would like help with</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
          <li>Any advice on Care Act s.9 review timing for Dad&apos;s progressing dementia (the family tracks a DCPI score).</li>
          <li>LPA duties — financial &amp; health — and joint decision-making with the co-attorney.</li>
          <li>Whether the declined-care pattern in the notes should become a formal s.42 safeguarding referral.</li>
          <li>Mum&apos;s placement: what to insist on in reviews given no family portal exists.</li>
        </ul>
      </section>

      <footer className="rounded-xl border p-4 text-xs text-muted-foreground">
        Generated {new Date().toLocaleString("en-GB")} from the Family Care Hub · read-only snapshot, not the full
        record · the family holds the complete history (1,283 visits, medication records, policies) in the portal and can
        grant a deeper or longer view on request.
      </footer>
    </main>
  );
}
