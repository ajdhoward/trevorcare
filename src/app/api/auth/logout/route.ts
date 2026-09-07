// Logout — clears the session cookie. The session itself is stateless (signed
// cookie), so clearing the cookie is the whole logout. To revoke a session
// early, rotate SESSION_SECRET as a deployment secret (signs everyone out).

import { NextResponse } from "next/server";
import { clearedCookie } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.headers.append("Set-Cookie", `care_session=; ${clearedCookie()}`);
  return res;
}
