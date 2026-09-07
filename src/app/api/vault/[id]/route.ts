// Vault document download & delete. Downloads are audited server-side by
// returning metadata the client logs, and gated by the session (middleware +
// withSession here). Restricted documents are flagged so the UI can limit
// their visibility to admin/family roles (client-side RBAC matrix).

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withSession } from "@/lib/server/guard";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  return withSession(req, async () => {
    const { id } = await ctx.params;
    const row = await db.vaultDocument.findUnique({ where: { id } });
    if (!row) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    if (!row.data) {
      return NextResponse.json({ ok: false, error: "This entry has no stored file (text-only)." }, { status: 404 });
    }
    const buf = Buffer.from(row.data, "base64");
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": row.mimeType || "application/octet-stream",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(row.fileName || row.title)}"`,
        "Cache-Control": "no-store",
        "X-Vault-Sensitivity": row.sensitivity,
      },
    });
  });
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  return withSession(req, async () => {
    const { id } = await ctx.params;
    await db.extractedFact.deleteMany({ where: { documentId: id } });
    await db.financeEntry.updateMany({ where: { receiptId: id }, data: { receiptId: "" } });
    await db.vaultDocument.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  });
}
