// Data vault API — list + upload. Uploads accept multipart/form-data (real
// files) or JSON {title, category, sensitivity, subjectId, text?} for pasted
// content (AI chat transcripts). Payloads live in SQLite as base64 (cap 8 MB);
// on Cloudflare this maps to R2 — see docs/SECURITY.md.

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withSession } from "@/lib/server/guard";
import { extractText } from "@/lib/extract";

const MAX_BYTES = 8 * 1024 * 1024;

export async function GET(req: NextRequest) {
  return withSession(req, async () => {
    const subjectId = req.nextUrl.searchParams.get("subjectId");
    const category = req.nextUrl.searchParams.get("category");
    const rows = await db.vaultDocument.findMany({
      where: {
        ...(subjectId ? { subjectId } : {}),
        ...(category ? { category } : {}),
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true, subjectId: true, title: true, category: true, fileName: true,
        mimeType: true, size: true, sensitivity: true, tags: true, uploadedBy: true,
        createdAt: true, textExtract: true, data: false,
      },
    });
    return NextResponse.json({ ok: true, documents: rows });
  });
}

export async function POST(req: NextRequest) {
  return withSession(req, async (session) => {
    const uploader = session.n || "family";

    const ct = req.headers.get("content-type") || "";
    let title = "";
    let category = "other";
    let sensitivity = "standard";
    let subjectId = "";
    let fileName = "";
    let mimeType = "";
    let base64 = "";
    let pastedText = "";

    if (ct.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      title = String(form.get("title") || "");
      category = String(form.get("category") || "other");
      sensitivity = String(form.get("sensitivity") || "standard");
      subjectId = String(form.get("subjectId") || "");
      pastedText = String(form.get("pastedText") || "");
      if (file && typeof file === "object" && "arrayBuffer" in (file as object)) {
        const f = file as File;
        if (f.size > MAX_BYTES) {
          return NextResponse.json({ ok: false, error: "File exceeds the 8 MB vault limit." }, { status: 413 });
        }
        const buf = Buffer.from(await f.arrayBuffer());
        base64 = buf.toString("base64");
        fileName = f.name;
        mimeType = f.type || "application/octet-stream";
        if (!title) title = f.name;
      }
    } else {
      const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
      title = String(body.title || "");
      category = String(body.category || "other");
      sensitivity = String(body.sensitivity || "standard");
      subjectId = String(body.subjectId || "");
      base64 = String(body.data || "");
      fileName = String(body.fileName || "");
      mimeType = String(body.mimeType || "text/plain");
      pastedText = String(body.pastedText ?? body.text ?? "");
      // derive a meaningful fileName from the title so filename-based
      // extraction routing (passport/birth/chat) keeps working for pastes
      if (!fileName && title) {
        fileName = `${title.replace(/[^\w -]/g, "").trim().slice(0, 40) || "pasted"}.txt`;
      }
      if (base64 && Buffer.byteLength(base64, "base64") > MAX_BYTES) {
        return NextResponse.json({ ok: false, error: "File exceeds the 8 MB vault limit." }, { status: 413 });
      }
    }

    if (!title) title = fileName || "Untitled document";

    // text extraction for the search/extraction pipeline
    let textExtract = pastedText;
    let method = pastedText ? "pasted" : "";
    if (!textExtract && base64) {
      const buf = Buffer.from(base64, "base64");
      const ex = extractText(fileName, mimeType, buf);
      textExtract = ex.text.slice(0, 400_000);
      method = ex.method;
    }

    const row = await db.vaultDocument.create({
      data: {
        subjectId,
        title: title.slice(0, 200),
        category: category.slice(0, 40),
        fileName: fileName.slice(0, 200),
        mimeType,
        size: base64 ? Buffer.byteLength(base64, "base64") : Buffer.byteLength(pastedText || ""),
        sensitivity: ["standard", "sensitive", "restricted"].includes(sensitivity) ? sensitivity : "standard",
        data: base64,
        textExtract,
        tags: JSON.stringify([category, ...(sensitivity !== "standard" ? [sensitivity] : [])]),
        uploadedBy: uploader,
      },
    });

    return NextResponse.json(
      {
        ok: true,
        document: { ...row, data: undefined },
        textMethod: method,
        hasText: textExtract.trim().length > 0,
      },
      { status: 201 }
    );
  });
}
