// Service users ("care subjects") — the people care is arranged FOR.
// The hub is family-agnostic: any relative or person can be added as a
// subject (a parent, a sister, a neighbour) and every subject-scoped tab
// keys off the registry here. Server source of truth: Prisma `CareSubject`.
//
// Depersonalisation rule: demo subjects are fictional composites. Never seed
// real names, dates of birth, addresses or NHS numbers into this file.

export interface SubjectProfile {
  // — personal —
  preferredName?: string;
  gender?: string;
  pronouns?: string;
  maritalStatus?: string;
  languages?: string;
  // — health & care —
  gpPractice?: string;
  pharmacy?: string;
  allergies?: string;
  conditions?: string;
  medicationsSummary?: string;
  capacityNotes?: string; // MCA capacity snapshot, date-stamped notes
  mobility?: string;
  sensory?: string; // hearing / sight / communication needs
  nutrition?: string;
  // — preferences & voice —
  likes?: string;
  dislikes?: string;
  routines?: string;
  culture?: string; // culture / religion / end-of-life wishes summary
  goals?: string;
  // — people —
  keyContacts?: string; // free text or pasted vCard notes
  nextOfKin?: string;
  attorneys?: string;
  professionals?: string;
  // — settings —
  keySafe?: string; // key-safe location/codec held by provider
  accessNotes?: string;
}

export interface CareSubjectRecord {
  id: string;
  displayName: string;
  relationship: string;
  setting: "home" | "residential" | "supported-living" | string;
  dateOfBirth: string;
  nhsNumber: string;
  address: string;
  phone: string;
  profile: SubjectProfile;
  archived: boolean;
}

export function parseSubject(row: {
  id: string;
  displayName: string;
  relationship: string;
  setting: string;
  dateOfBirth: string;
  nhsNumber: string;
  address: string;
  phone: string;
  profile: string;
  archived: boolean;
}): CareSubjectRecord {
  let profile: SubjectProfile = {};
  try {
    profile = JSON.parse(row.profile || "{}") as SubjectProfile;
  } catch {
    profile = {};
  }
  return { ...row, profile };
}

export function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("") || "?";
}

// ---------------------------------------------------------------------------
// Demo seed — fictional persons, Ofcom-safe details only.
// ---------------------------------------------------------------------------

export const DEMO_SUBJECTS: Array<Omit<CareSubjectRecord, "archived"> & { sortOrder: number }> = [
  {
    id: "subj-demo-home",
    displayName: "Sam Ellery",
    relationship: "Sample: the person living at home",
    setting: "home",
    dateOfBirth: "1948-11-17",
    nhsNumber: "999 000 1111",
    address: "1 Sample Road, Market Town",
    phone: "01632 960001",
    sortOrder: 0,
    profile: {
      preferredName: "Sam",
      pronouns: "he/him",
      languages: "English",
      gpPractice: "Sample GP Practice, Market Town",
      pharmacy: "Sample Pharmacy (dosette boxes)",
      allergies: "None recorded (sample)",
      conditions: "Memory & cognition, hearing loss, knee arthritis (sample record)",
      medicationsSummary: "Morning / evening dosette box; PRN pain relief (see Medication tab)",
      capacityNotes: "Fluctuating — decisions best made in the morning; LPA attorneys in place",
      mobility: "Walks with a stick; unsteady on stairs",
      sensory: "Hard of hearing — hearing aids, face the person when speaking",
      nutrition: "Likes small lunches, main meal midday",
      likes: "Radio, football on TV, his garden",
      dislikes: "Being rushed, loud crowded rooms",
      routines: "Rises early; sundowning risk late afternoon (see watch items)",
      culture: "Sample entry — record culture/faith and any end-of-life wishes here",
      goals: "Stay at home safely as long as possible",
      nextOfKin: "Sample: family lead (Alex) — see contacts",
      attorneys: "Alex & Pat (sample attorneys) — see Legal & LPA",
      professionals: "Sample: social worker, district nurse — add real names via vault facts",
      keySafe: "Sample: key safe by back door, code held by agency office",
      accessNotes: "Side gate latch — carers know the routine",
    },
  },
  {
    id: "subj-demo-residential",
    displayName: "Robin Ellery",
    relationship: "Sample: the person in residential care",
    setting: "residential",
    dateOfBirth: "1951-03-04",
    nhsNumber: "999 000 2222",
    address: "Sample Care Home, 2 Example Lane",
    phone: "01632 960002",
    sortOrder: 1,
    profile: {
      preferredName: "Robin",
      pronouns: "she/her",
      languages: "English",
      gpPractice: "Practice attached to Sample Care Home",
      conditions: "Osteoarthritis, hypertension (sample)",
      medicationsSummary: "Home-administered; family checked at reviews",
      likes: "Choir on Wednesdays, postcards on the noticeboard",
      routines: "Breakfast 8am; prefers a window seat",
      goals: "Maintain independence in daily choices",
      attorneys: "Alex (sample attorney) — see Legal & LPA",
    },
  },
];

export const SETTING_LABELS: Record<string, string> = {
  home: "Living at home — domiciliary care",
  residential: "Residential / nursing home",
  "supported-living": "Supported living",
};
