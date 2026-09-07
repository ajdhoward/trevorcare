// Wizard framework — wizards are DATA, not code.
//
// A WizardDef (stored in Prisma, editable in the Wizard Studio) is a list of
// steps, each with fields. The runtime (components/record/wizard-engine.tsx)
// renders ANY definition, and `runWizardAction` maps the finished values to a
// system action (create a service user, log an OPG receipt, register an LPA
// instrument…). New wizards can be added and existing ones reshaped without
// touching application code — that is the "framework that lets the wizard be
// updated".

export type WizardFieldType =
  | "text"
  | "textarea"
  | "number"
  | "date"
  | "select"
  | "checkbox";

export interface WizardField {
  id: string;
  label: string;
  type: WizardFieldType;
  required?: boolean;
  options?: string[]; // for select
  help?: string;
  prefill?: string;
  placeholder?: string;
}

export interface WizardStep {
  id: string;
  title: string;
  fields: WizardField[];
}

export interface WizardDefData {
  id: string;
  key: string;
  title: string;
  description: string;
  steps: WizardStep[];
  version: number;
  system: boolean;
}

/** What the runtime should DO with a finished wizard run. */
export type WizardActionKey =
  | "create-subject" // add a service user
  | "log-opg-receipt" // finances: receipt + ledger entry
  | "register-lpa" // legal: register an LPA instrument
  | "intake-document" // vault: upload + extract
  | "custom"; // definitions added later — values posted to /api/wizard-runs

export const WIZARD_ACTIONS: Record<string, WizardActionKey> = {
  "add-service-user": "create-subject",
  "opg-receipt": "log-opg-receipt",
  "lpa-setup": "register-lpa",
  "document-intake": "intake-document",
};

// ---------------------------------------------------------------------------
// Seed definitions — loaded into the DB on first use, editable in the studio.
// ---------------------------------------------------------------------------

export const SEED_WIZARDS: Array<{
  key: string;
  title: string;
  description: string;
  system: boolean;
  steps: WizardStep[];
}> = [
  {
    key: "add-service-user",
    title: "Add a service user",
    description:
      "Set up the hub for another relative or person you arrange care for — a parent, a sister, a neighbour. Creates their profile, their section in the navigation, and their own documents, finances and vault space.",
    system: true,
    steps: [
      {
        id: "person",
        title: "Who is the hub for?",
        fields: [
          { id: "displayName", label: "Their name", type: "text", required: true, placeholder: "e.g. Jo Taylor" },
          { id: "relationship", label: "Their relationship to you", type: "text", required: true, placeholder: "e.g. my sister, my mother, a neighbour" },
          {
            id: "setting",
            label: "Where do they live?",
            type: "select",
            required: true,
            options: ["home", "residential", "supported-living"],
            help: "Home = domiciliary care visits; residential = care home; supported-living = housing with support.",
          },
          { id: "dateOfBirth", label: "Date of birth", type: "date", help: "Used for age-related entitlements — leave blank if you prefer." },
          { id: "phone", label: "Their phone (or the house phone)", type: "text" },
          { id: "address", label: "Address", type: "textarea" },
        ],
      },
      {
        id: "health",
        title: "Health snapshot (optional)",
        fields: [
          { id: "gpPractice", label: "GP practice", type: "text" },
          { id: "pharmacy", label: "Pharmacy", type: "text" },
          { id: "conditions", label: "Conditions / diagnoses", type: "textarea" },
          { id: "allergies", label: "Allergies", type: "text" },
          { id: "medicationsSummary", label: "Medication summary", type: "textarea" },
          { id: "sensory", label: "Hearing / sight / communication needs", type: "textarea" },
        ],
      },
      {
        id: "people",
        title: "People & preferences (optional)",
        fields: [
          { id: "nextOfKin", label: "Next of kin", type: "text" },
          { id: "attorneys", label: "Attorneys / deputies (if any)", type: "text" },
          { id: "likes", label: "What they enjoy", type: "textarea" },
          { id: "dislikes", label: "What to avoid", type: "textarea" },
          { id: "routines", label: "Daily routine notes", type: "textarea" },
        ],
      },
    ],
  },
  {
    key: "opg-receipt",
    title: "Log an OPG receipt",
    description:
      "Record a payment made on the service user's behalf and attach the receipt — builds the evidence pack for the Office of the Public Guardian annual supervision report.",
    system: true,
    steps: [
      {
        id: "payment",
        title: "The payment",
        fields: [
          { id: "subjectId", label: "Whose finances?", type: "select", required: true, options: ["@subjects"], help: "Populated from the service-user registry." },
          { id: "date", label: "Date of payment", type: "date", required: true },
          { id: "description", label: "What was paid for?", type: "text", required: true, placeholder: "e.g. Groceries, council tax, care top-up fees" },
          { id: "amount", label: "Amount (£)", type: "number", required: true },
          {
            id: "category",
            label: "Category",
            type: "select",
            required: true,
            options: ["care-fees", "household", "utilities", "council-tax", "medical", "transport", "clothing", "personal", "other"],
          },
          { id: "paymentMethod", label: "How was it paid?", type: "select", options: ["debit-card", "direct-debit", "standing-order", "cash", "bank-transfer", "cheque"] },
          { id: "notes", label: "Notes (optional)", type: "textarea" },
        ],
      },
      {
        id: "receipt",
        title: "Attach the receipt",
        fields: [
          {
            id: "receiptProvided",
            label: "I have a receipt to upload",
            type: "checkbox",
            help: "Receipts are stored in the data vault, tagged as OPG evidence, and linked to this ledger entry.",
          },
        ],
      },
    ],
  },
  {
    key: "lpa-setup",
    title: "Register an LPA instrument",
    description:
      "Record a Lasting Power of Attorney — either property & financial affairs or health & welfare — with donor, attorneys, certificate provider and OPG registration details.",
    system: true,
    steps: [
      {
        id: "instrument",
        title: "The instrument",
        fields: [
          { id: "subjectId", label: "Who is the donor (the person the LPA is about)?", type: "select", required: true, options: ["@subjects"] },
          {
            id: "area",
            label: "Instrument type",
            type: "select",
            required: true,
            options: ["financial", "health"],
            help: "Property & financial affairs, or health & welfare (MCA 2005 s.9–11).",
          },
          {
            id: "status",
            label: "Status",
            type: "select",
            required: true,
            options: ["draft", "signed", "registered", "active"],
            help: "Registration happens with the OPG and typically takes 8–10 weeks.",
          },
          { id: "opgReference", label: "OPG reference number (if registered)", type: "text", placeholder: "e.g. MYPG-XXXX" },
          { id: "registrationDate", label: "Registration date", type: "date" },
        ],
      },
      {
        id: "people",
        title: "People",
        fields: [
          { id: "attorneys", label: "Attorneys (comma separated)", type: "text", required: true },
          { id: "replacementAttorneys", label: "Replacement attorneys (optional)", type: "text" },
          { id: "certificateProvider", label: "Certificate provider", type: "text" },
          { id: "decisions", label: "Key decisions & restrictions recorded in the LPA", type: "textarea", help: "e.g. joint attorney decisions for large gifts; life-sustaining treatment direction." },
        ],
      },
    ],
  },
  {
    key: "document-intake",
    title: "Upload & extract a document",
    description:
      "Put a document into the data vault and let the extraction pipeline pull structured facts out of it — passport MRZ lines, birth-certificate fields, AI chat transcripts, letters and more. Every extracted fact is queued for review; nothing enters the profile automatically.",
    system: true,
    steps: [
      {
        id: "document",
        title: "The document",
        fields: [
          { id: "subjectId", label: "Whose document?", type: "select", required: true, options: ["@subjects"] },
          { id: "title", label: "Title", type: "text", required: true, placeholder: "e.g. Passport (blue, renewed 2024)" },
          {
            id: "category",
            label: "Category",
            type: "select",
            required: true,
            options: ["passport", "birth-certificate", "lpa", "court", "care-contract", "letter", "medical", "finance", "chat-export", "receipt", "other"],
          },
          {
            id: "sensitivity",
            label: "Sensitivity",
            type: "select",
            required: true,
            options: ["standard", "sensitive", "restricted"],
            help: "Restricted documents are only visible to administrator and family roles.",
          },
        ],
      },
      {
        id: "extract",
        title: "Extraction",
        fields: [
          {
            id: "autoExtract",
            label: "Run extraction after upload",
            type: "checkbox",
            help: "Works on text documents, AI-chat exports, passport MRZ images' embedded text, and any pasted text.",
          },
          { id: "pastedText", label: "…or paste the text to extract from", type: "textarea", help: "Useful for AI chat transcripts — paste the conversation and the fact extractor will pull out decisions, dates, contacts and actions." },
        ],
      },
    ],
  },
];

export function parseWizardDef(row: {
  id: string;
  key: string;
  title: string;
  description: string;
  steps: string;
  version: number;
  system: boolean;
}): WizardDefData {
  let steps: WizardStep[] = [];
  try {
    steps = JSON.parse(row.steps) as WizardStep[];
  } catch {
    steps = [];
  }
  return { ...row, steps };
}

export function serializeWizardSteps(steps: WizardStep[]): string {
  return JSON.stringify(steps);
}
