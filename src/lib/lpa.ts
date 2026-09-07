// LPA framework — the things a health & welfare + property & financial affairs
// attorney should have in place (England & Wales). Each item is assignable to
// one attorney (Alex / Pat / shared) and tracked in localStorage via the
// component, so the checklist doubles as the family's assurance record.
//
// Framing: Mental Capacity Act 2005 s.9–14 (LPAs), s.4 best-interests checklist;
// Office of the Public Guardian guidance; Care Act 2014 s.9/s24; CQC Reg. 9.
// This is practical family guidance, not legal advice.

export type LpaArea = "financial" | "health";
export type LpaAssignee = "alex" | "pat" | "shared";

export interface LpaItem {
  id: string;
  area: LpaArea;
  text: string;
  why: string;
  ref: string;
  assignee: LpaAssignee; // suggested default, editable
}

export const LPA_ASSIGNEE_LABELS: Record<LpaAssignee, string> = {
  alex: "Alex",
  pat: "Pat",
  shared: "Shared",
};

export const LPA_ITEMS: LpaItem[] = [
  // ---------------- property & financial affairs
  {
    id: "fin-lpa-registered", area: "financial", assignee: "shared",
    text: "Registered LPA documents held safely (originals + certified copies for both attorneys)",
    why: "Banks, DWP and the care home each ask for their own certified copy — keep a list of who holds which.",
    ref: "MCA 2005 s.9–11; OPG registration",
  },
  {
    id: "fin-banks", area: "financial", assignee: "alex",
    text: "Banks / building societies notified; third-party mandates or attorney access in place",
    why: "Prevents account freezes at the worst moment; each institution registers the LPA in its own way.",
    ref: "OPG: using the LPA with financial organisations",
  },
  {
    id: "fin-benefits", area: "financial", assignee: "pat",
    text: "Attendance Allowance claimed (or checked) and DWP told an attorney is acting",
    why: "Attendance Allowance is the most-missed benefit for over-65s at home or in care; DWP will deal with attorneys once notified.",
    ref: "DWP AA claims; appointeeship not needed where LPA exists",
  },
  {
    id: "fin-pensions", area: "financial", assignee: "shared",
    text: "State & private pensions receiving; providers notified of attorney contact",
    why: "Checks nothing is unclaimed and payments land in the right account.",
    ref: "DWP / pension provider requirements",
  },
  {
    id: "fin-fees", area: "financial", assignee: "pat",
    text: "Care fees paid & reconciled monthly (invoice vs. actual visits/attendance)",
    why: "The fee-reconciliation habit catches double-billing and cancelled-but-charged visits early — log each check in the audit trail.",
    ref: "Care Act 2014 s.14 cap & charging; provider contract",
  },
  {
    id: "fin-counciltax", area: "financial", assignee: "alex",
    text: "Council tax status checked (single-person discount eligibility / severe mental impairment disregard where relevant)",
    why: "Residents with severe cognitive impairment on an eligible benefit can be disregarded for council tax — worth one call to the council.",
    ref: "Local Government Finance Act 1992 s.3C (SMI disregard)",
  },
  {
    id: "fin-utilities", area: "financial", assignee: "alex",
    text: "Utilities, insurance, TV licence, subscriptions in Dad's name reviewed & in order",
    why: "Direct debits on dormant accounts fail silently; keep the house insured while he lives at home.",
    ref: "Practical housekeeping",
  },
  {
    id: "fin-pensioncredit", area: "financial", assignee: "pat",
    text: "Pension Credit / other entitlements checked (including for Mum as a couple where relevant)",
    why: "Entitlements change with care-home stays — couples are assessed in specific ways for 13-week trial periods etc.",
    ref: "DWP guidance on couples and permanent care stays",
  },
  {
    id: "fin-will", area: "financial", assignee: "shared",
    text: "Wills & estate documents located and current; solicitor contact noted",
    why: "Attorneys don't manage estates, but knowing where the will is avoids a scramble later.",
    ref: "Estate planning",
  },
  {
    id: "fin-accounts", area: "financial", assignee: "shared",
    text: "Annual summary of decisions & spending kept for family transparency",
    why: "Simple ledger habit = trust between attorneys and family, and evidence if OPG ever asks.",
    ref: "OPG supervision expectations",
  },

  // ---------------- health & welfare
  {
    id: "hea-careplan", area: "health", assignee: "shared",
    text: "Care plan reviewed with the agency at least annually (and after any hospital stay)",
    why: "The care plan is the legally operative document carers work to — this portal tracks the September 2026 amendments.",
    ref: "Care Act 2014 s.9/s24 review; agency policy 24",
  },
  {
    id: "hea-medreview", area: "health", assignee: "alex",
    text: "Annual medication review with GP/pharmacist booked (Memantine, Risperidone, PRNs)",
    why: "Sedating PRN use in dementia needs periodic deprescribing review — NICE NG97 expects it.",
    ref: "NICE NG97; formalising section-8M review culture",
  },
  {
    id: "hea-bestinterests", area: "health", assignee: "shared",
    text: "Significant decisions documented as best-interests decisions (consulting family, views, least restrictive)",
    why: "MCA s.4 checklist — the log of who was consulted is what makes a decision lawful, not just the outcome.",
    ref: "MCA 2005 s.4; MCA Code of Practice ch.5",
  },
  {
    id: "hea-advance", area: "health", assignee: "shared",
    text: "Dad's wishes recorded (routine, food, faith, who to call) and shared with carers",
    why: "Advance statements carry real weight in best-interests decisions even though they aren't binding.",
    ref: "MCA Code of Practice; advance statements",
  },
  {
    id: "hea-dnacpr", area: "health", assignee: "alex",
    text: "Aware of any DNACPR / advance decision to refuse treatment (and where copies live)",
    why: "Attorneys can't demand or refuse treatment, but must know what binding advance decisions exist.",
    ref: "MCA 2005 s.24–26; Resuscitation Council UK",
  },
  {
    id: "hea-mum-parity", area: "health", assignee: "shared",
    text: "Same standards applied to Mum at Mum's care home (email/phone protocol in her tab)",
    why: "Her home has no portal, so the cadence of calls/emails is what protects her — the protocol mirrors Dad's agency oversight.",
    ref: "Health & Social Care Act 2008 Reg. 9 (person-centred care)",
  },
  {
    id: "hea-complaints", area: "health", assignee: "pat",
    text: "Complaints raised early and tracked (agency first, then commissioner/CQC if unresolved)",
    why: "The Recommendations tab already drafts these — the discipline is logging the response date.",
    ref: "Local Authority Social Services & NHS Complaints Regs 2009; CQC",
  },
  {
    id: "hea-safeguarding", area: "health", assignee: "alex",
    text: "Safeguarding contacts to hand (Council MASH, out-of-hours, CQC) with raising-thresholds understood",
    why: "Falls + declined care + confusion are the three record themes that meet a 'may be at risk' threshold under s.42.",
    ref: "Care Act 2014 s.42; Council MASH",
  },
  {
    id: "hea-hospital", area: "health", assignee: "alex",
    text: "Hospital plan ready (information pack, meds list, who attends, ‘This is me’ document)",
    why: "A&E admissions for people with dementia go better when the pack exists before it's needed.",
    ref: "Alzheimer's Society 'This is me'; DAA guidance",
  },
  {
    id: "hea-joint", area: "health", assignee: "shared",
    text: "Joint visits/calls to both parents diarised using the joint-availability tool",
    why: "Presence is the single best oversight control — the LPA tab proposes slots both attorneys are free.",
    ref: "Family assurance practice",
  },
];

export const LPA_AREA_META: Record<LpaArea, { title: string; icon: string; blurb: string }> = {
  financial: {
    title: "Property & financial affairs",
    icon: "coins",
    blurb: "Attorneys manage money and property in Dad's (and where relevant Mum's) best interests — with records.",
  },
  health: {
    title: "Health & welfare",
    icon: "heart",
    blurb: "Attorneys make care and treatment decisions only when Dad lacks capacity — always via the best-interests checklist.",
  },
};
