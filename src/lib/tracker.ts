// Bluetooth tracker — status, fitting checklist and the structured exit-event
// log (Systems Review P1). The tracker is a family-purchased, crowd-sourced
// Bluetooth device worn like a wristwatch: it logs location after an exit —
// it does not prevent one, cannot raise geofence alarms, and discharges no
// statutory duty. Its portal role is log + evidence: exit events feed the
// elopement theme and the safeguarding pack.

export type TrackerStatus = "ordered" | "fitting" | "active" | "removed";

export interface TrackerStore {
  status: TrackerStatus;
  deviceName: string;
  network: string;
  batteryLifeMonths: number;
  wearing: string;
  checklist: Record<string, boolean>;
  lastChecked?: string; // ISO date of last daily battery/fit check
  updatedBy?: string;
  updatedAt?: string;
}

export interface TrackerExit {
  id: string;
  ts: string; // ISO datetime of the exit / discovery
  lastSeen: string; // location description
  source: "tracker" | "life360" | "family";
  batteryPct?: number; // tracker battery at logging time (0-100)
  note?: string;
  loggedBy: string;
}

const K_TRACKER = "care-tracker-v1";
const K_EXITS = "care-tracker-exits-v1";

export const FITTING_CHECKLIST: { id: string; label: string }[] = [
  { id: "charge", label: "Charge fully, then fit on the non-dominant wrist with the locking strap" },
  { id: "pair", label: "Pair with the family app and confirm a last-seen location on the crowd-sourced network" },
  { id: "test", label: "Run one exit test — log the first event in the tracker log below" },
  { id: "battery", label: "Add a daily battery & fit check to the family routine (wristwatch battery ≈ 1 year)" },
  { id: "boundary", label: "Record the honest boundary: logs location after an exit — prevents nothing, replaces no statutory duty" },
];

export function defaultTracker(): TrackerStore {
  return {
    status: "ordered",
    deviceName: "Bluetooth wrist tracker (sample)",
    network: "Crowd-sourced Bluetooth network (Android proximity)",
    batteryLifeMonths: 12,
    wearing: "Wrist-worn, locking strap",
    checklist: {},
  };
}

function load<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function save<T>(key: string, value: T) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

export function loadTracker(): TrackerStore {
  const t = load<TrackerStore | null>(K_TRACKER, null);
  return t ?? defaultTracker();
}
export function saveTracker(t: TrackerStore) {
  save(K_TRACKER, t);
}

export function loadExits(): TrackerExit[] {
  return load<TrackerExit[]>(K_EXITS, seedExits());
}
export function saveExits(list: TrackerExit[]) {
  save(K_EXITS, list);
}

export function seedExits(): TrackerExit[] {
  return [
    {
      id: "x-seed-1",
      ts: "2026-09-04T10:35:00.000Z",
      lastSeen: "Town centre — bus stop (found by a cousin, returned home)",
      source: "family",
      batteryPct: 88,
      note: "No idea why he was there; logged as elopement evidence. Triggers the OOH pack refresh.",
      loggedBy: "Alex (sample)",
    },
    {
      id: "x-seed-2",
      ts: "2026-08-31T15:10:00.000Z",
      lastSeen: "Alley behind the house (the 'ginnel' incident)",
      source: "family",
      batteryPct: 92,
      note: "Second documented elopement — feeds the safeguarding pack and the placement case.",
      loggedBy: "Alex (sample)",
    },
  ];
}
