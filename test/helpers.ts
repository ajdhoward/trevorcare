// Shared test helpers.
//
// D1's exec() splits raw SQL on ";" and rejects chunks that contain no
// statement — which makes comment-only blocks (file headers, per-table
// comments) fail. applySql() strips `--` comment lines first, then executes
// each remaining statement on its own. No mocking: the statements are the
// real migration SQL, executed against the real in-memory D1.

export function sqlStatements(raw: string): string[] {
  return raw
    .split("\n")
    .map((line) => line.replace(/--.*$/, "")) // strip full-line AND inline comments
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function applySql(db: D1Database, raw: string): Promise<void> {
  for (const stmt of sqlStatements(raw)) {
    await db.prepare(stmt).run();
  }
}
