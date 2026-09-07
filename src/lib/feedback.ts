// AI feedback contract + parser — the export→AI→ingest loop.
// The AI Review Brief (see docs/AI-REVIEW-GUIDE.md) instructs any AI to return
// findings as fenced JSON blocks whose items follow this schema. The portal
// parses those blocks (paste or file upload), stores the raw copy in the
// AiFeedback table, and lets the family apply each item into the live stores
// (tasks, shopping, recommendations, corrections) with a full audit entry.

export type FeedbackKind =
  | "task_add"
  | "shopping_add"
  | "note"
  | "recommendation"
  | "correction"
  | "question";

export interface FeedbackItem {
  kind: FeedbackKind;
  title?: string;
  detail?: string;
  item?: string; // shopping_add
  person?: "dad" | "mum" | "family";
  due?: string;
  severity?: "info" | "warning" | "urgent";
  priority?: "High" | "Medium" | "Low";
  rationale?: string;
  actions?: string[];
  field?: string; // correction
  value?: string; // correction
  evidence?: string; // correction
}

const KINDS: FeedbackKind[] = ["task_add", "shopping_add", "note", "recommendation", "correction", "question"];

/** Extract fenced ```json blocks plus any bare JSON arrays from arbitrary AI text. */
export function extractFeedbackItems(text: string): FeedbackItem[] {
  const items: FeedbackItem[] = [];
  const push = (arr: unknown) => {
    if (!Array.isArray(arr)) return;
    for (const raw of arr) {
      if (raw && typeof raw === "object") {
        const o = raw as Record<string, unknown>;
        const kind = String(o.kind ?? "").trim() as FeedbackKind;
        if (KINDS.includes(kind)) {
          items.push({
            kind,
            title: str(o.title),
            detail: str(o.detail),
            item: str(o.item),
            person: (["dad", "mum", "family"].includes(String(o.person)) ? o.person : "family") as FeedbackItem["person"],
            due: str(o.due) || undefined,
            severity: (["info", "warning", "urgent"].includes(String(o.severity)) ? o.severity : "info") as FeedbackItem["severity"],
            priority: (["High", "Medium", "Low"].includes(String(o.priority)) ? o.priority : "Medium") as FeedbackItem["priority"],
            rationale: str(o.rationale),
            actions: Array.isArray(o.actions) ? o.actions.map((a) => String(a)).slice(0, 10) : undefined,
            field: str(o.field),
            value: str(o.value),
            evidence: str(o.evidence),
          });
        } else if (o.title || o.item || o.text) {
          // untyped but structured — treat as a note
          items.push({ kind: "note", title: str(o.title), detail: str(o.text ?? o.detail) });
        }
      }
    }
  };
  // fenced blocks
  const fence = /```(?:json)?\s*([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = fence.exec(text))) {
    try {
      push(JSON.parse(m[1]));
    } catch {
      /* block wasn't valid JSON — skip */
    }
  }
  if (items.length === 0) {
    // bare array anywhere
    const bare = text.match(/\[\s*\{[\s\S]*\}\s*\]/);
    if (bare) {
      try {
        push(JSON.parse(bare[0]));
      } catch {
        /* ignore */
      }
    }
  }
  return items.slice(0, 100);
}

function str(v: unknown): string | undefined {
  const s = v == null ? "" : String(v).trim();
  return s ? s : undefined;
}

export const FEEDBACK_KIND_LABEL: Record<FeedbackKind, string> = {
  task_add: "Task for the family",
  shopping_add: "Shopping / needed item",
  note: "Observation to record",
  recommendation: "Recommendation",
  correction: "Record correction",
  question: "Question for the family",
};

export function itemsToMarkdown(items: FeedbackItem[]): string {
  return JSON.stringify(items, null, 2);
}
