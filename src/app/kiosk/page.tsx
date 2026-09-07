"use client";

// "My Day" — the service user's own tablet view (Qwen Haven 360 §03/§05).
// Wall-mount or personal tablet in kiosk mode: huge icons, dementia-friendly,
// no dead-ends. Dad sees today's visits, taps his choices (they flow back to
// the family portal + audit trail), sees family keepsakes, and one big button
// to call the family. WCAG 2.2 AA posture: 7:1 contrast core flows, ~200% type.

import { useEffect, useState } from "react";
import Link from "next/link";
import type { CareRecord, UpcomingVisit } from "@/lib/record";
import { type CalEvent, loadEvents } from "@/lib/family";
import { KIOSK_BOARDS, KIOSK_CALM_LINES, kioskChoiceStore, type KioskChoice, uid } from "@/lib/haven360";
import { logEvent } from "@/lib/auditlog";

export default function KioskPage() {
  const [record, setRecord] = useState<CareRecord | null>(null);
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [choices, setChoices] = useState<KioskChoice[]>([]);
  const [now, setNow] = useState(new Date());
  const [flash, setFlash] = useState<string>("");

  useEffect(() => {
    fetch("/data/record.json")
      .then((r) => r.json())
      .then(setRecord)
      .catch(() => setRecord(null));
    const id = requestAnimationFrame(() => {
      setEvents(loadEvents());
      setChoices(kioskChoiceStore.load());
    });
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => {
      cancelAnimationFrame(id);
      clearInterval(t);
    };
  }, []);

  const today = now.toISOString().slice(0, 10);
  const todaysEvents = events.filter((e) => e.date === today).slice(0, 6);
  const upcoming = (record?.upcoming ?? []).slice(0, 4);

  const choose = (board: string, choice: string) => {
    const c: KioskChoice = { id: uid("kc"), ts: new Date().toISOString(), board, choice };
    const next = [c, ...choices].slice(0, 60);
    setChoices(next);
    kioskChoiceStore.save(next);
    logEvent({
      actor: "My Day tablet (kiosk)",
      actorRole: "Service user",
      action: "kiosk.choice",
      target: `${board}: ${choice}`,
      detail: `Choice made on the My Day tablet — flows to the family portal (${c.ts})`,
      severity: "info",
    });
    setFlash(`${choice} — sent to the family ✓`);
    setTimeout(() => setFlash(""), 3500);
  };

  return (
    <main className="min-h-screen bg-[#0B1B26] px-4 pb-10 pt-6 text-white sm:px-8">
      <div className="mx-auto max-w-5xl">
        {/* header: time + greeting */}
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-2xl font-bold text-white sm:text-3xl">
              {now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
            </p>
            <p className="text-xl font-semibold text-white/90 sm:text-2xl">
              {now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}
            </p>
            <p className="mt-1 text-3xl font-black text-white sm:text-4xl">A very good day to you.</p>
          </div>
          <Link href="/" className="rounded-lg border border-white/30 px-3 py-2 text-sm text-white/80 hover:bg-white/10" aria-label="Family portal (needs the family's sign-in)">
            Family portal →
          </Link>
        </header>

        {flash && (
          <p className="mt-4 rounded-xl bg-emerald-500/90 px-4 py-3 text-xl font-bold text-white shadow-lg">{flash}</p>
        )}

        {/* who is coming today */}
        <section className="mt-6">
          <h2 className="text-xl font-bold text-white sm:text-2xl">Who is coming today</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {upcoming.length === 0 && todaysEvents.length === 0 && (
              <p className="rounded-xl bg-white/10 p-4 text-xl font-semibold text-white/90">No visits to show yet — the carer will knock at the usual time.</p>
            )}
            {upcoming.map((v: UpcomingVisit, i) => (
              <div key={i} className="rounded-2xl bg-[#FFFFFF] p-4 shadow-lg">
                <p className="text-3xl font-black text-[#0B1B26]">{v.times ?? "Today"}</p>
                <p className="mt-1 text-2xl font-bold text-[#0E7C7B]">{v.carer || "Your carer"}</p>
                <p className="text-lg text-[#41586B]">{v.status || "Care visit"}</p>
              </div>
            ))}
            {todaysEvents.map((e) => (
              <div key={e.id} className="rounded-2xl bg-amber-400 p-4 shadow-lg">
                <p className="text-3xl font-black text-[#0B1B26]">{e.time ?? "All day"}</p>
                <p className="mt-1 text-2xl font-bold text-[#0B1B26]">{e.title}</p>
              </div>
            ))}
          </div>
        </section>

        {/* choice boards */}
        <section className="mt-8">
          <h2 className="text-xl font-bold text-white sm:text-2xl">Tap what you want</h2>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            {KIOSK_BOARDS.map((b) => (
              <div key={b.board} className="rounded-2xl bg-white/10 p-4">
                <p className="text-2xl font-bold text-white">{b.icon} {b.board}</p>
                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {b.options.map((o) => {
                    const latest = choices.find((c) => c.board === b.board);
                    const picked = latest?.choice === o;
                    return (
                      <button
                        key={o}
                        onClick={() => choose(b.board, o)}
                        className={`min-h-20 rounded-xl px-2 py-3 text-lg font-bold leading-tight transition-transform active:scale-95 ${
                          picked ? "bg-emerald-400 text-[#0B1B26] shadow-lg" : "bg-[#FFFFFF] text-[#0B1B26] shadow hover:bg-[#FFFFFFE6]"
                        }`}
                      >
                        {o}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* keepsakes + calm */}
        <section className="mt-8 grid gap-4 sm:grid-cols-2">
          <div className="rounded-2xl bg-white/10 p-4">
            <p className="text-2xl font-bold text-white">Family photo wall</p>
            <div className="mt-3 grid grid-cols-3 gap-2 text-center">
              {["🏡", "🎖️", "💍", "🐕", "☕", "🎸"].map((e, i) => (
                <div key={i} className="flex h-20 items-center justify-center rounded-xl bg-white/20 text-4xl" aria-label="family photo placeholder — Alex can add real photos">
                  {e}
                </div>
              ))}
            </div>
            <p className="mt-2 text-sm text-white/70">Photos are placeholders — Alex is adding real family pictures.</p>
          </div>
          <div className="rounded-2xl bg-white/10 p-4">
            <p className="text-2xl font-bold text-white">If you feel worried</p>
            <ul className="mt-3 space-y-2 text-lg font-semibold text-white/90">
              {KIOSK_CALM_LINES.map((l, i) => (
                <li key={i} className="rounded-xl bg-white/10 px-3 py-2">{l}</li>
              ))}
            </ul>
          </div>
        </section>

        {/* call family */}
        <section className="mt-8">
          <a
            href="tel:—"
            onClick={(e) => e.preventDefault()}
            className="flex min-h-24 items-center justify-center gap-3 rounded-2xl bg-emerald-500 px-6 text-center text-3xl font-black text-[#0B1B26] shadow-xl transition-transform active:scale-[0.99]"
            title="Ask Alex to set the family number — the button then dials directly"
          >
            📞 Call the family
          </a>
          <p className="mt-2 text-center text-sm text-white/70">
            Tap a choice above and it goes straight to Alex&apos;s portal. Nothing here can be broken — explore freely.
          </p>
        </section>
      </div>
    </main>
  );
}
