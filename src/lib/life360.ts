// Life360 connector — location awareness for the family circle.
// Life360 has no official public consumer API; this connector uses the widely
// documented internal REST endpoints the mobile/web clients use
// (https://api.cloud.life360.com/v3). Credentials NEVER leave the browser
// except to our own server-side proxy route (/api/life360), which adds the
// Basic client auth and forwards calls. Unofficial — can break; the UI says so.
//
//   POST /v3/oauth2/token  (Basic client creds + username/password grant)
//   GET  /v3/circles
//   GET  /v3/circles/{id}/members
//
// On Cloudflare Workers this maps 1:1 to the same fetch calls (see docs/DEPLOYMENT.md).

export interface Life360Settings {
  mode: "token" | "password";
  token: string; // bearer token (mode=token) — last successful token also cached here
  email: string; // mode=password
  password: string; // mode=password — device-local only, sent to our proxy per call
  clientId: string;
  clientSecret: string;
  homeLat: number | null; // Dad's home coordinates (for the radius alert)
  homeLon: number | null;
  radiusKm: number; // alert radius around home (default 0.8 km)
}

export const LIFE360_DEFAULTS: Life360Settings = {
  mode: "password",
  token: "",
  email: "",
  password: "",
  // Widely-used public client credentials for the Life360 client API
  // (as documented by community integrations). Editable in the UI if rotated.
  clientId: "c21Jc3lEUXt5WUd5L1VZcU5hTnI=",
  clientSecret: "R1Q5SmJrQ2hCQ3p0UmlZMg==",
  homeLat: 53.3811, // the town centre — replace with home's exact pin
  homeLon: -1.2562,
  radiusKm: 0.8,
};

export interface Life360Member {
  id: string;
  name: string;
  avatar?: string;
  phone?: string;
  lat?: number;
  lon?: number;
  lastCheckin?: string;
  battery?: number;
  charging?: boolean;
  speedKmh?: number;
  distanceFromHomeKm?: number | null;
  atHome?: boolean | null;
  raw?: unknown;
}

export interface Life360Circle {
  id: string;
  name: string;
  memberCount?: number;
}

export const K_LIFE360 = "h360-life360";

export function loadLife360Settings(): Life360Settings {
  if (typeof window === "undefined") return LIFE360_DEFAULTS;
  try {
    const raw = localStorage.getItem(K_LIFE360);
    if (!raw) return LIFE360_DEFAULTS;
    return { ...LIFE360_DEFAULTS, ...(JSON.parse(raw) as Partial<Life360Settings>) };
  } catch {
    return LIFE360_DEFAULTS;
  }
}

export function saveLife360Settings(s: Life360Settings) {
  try {
    localStorage.setItem(K_LIFE360, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

export function haversineKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const la1 = (aLat * Math.PI) / 180;
  const la2 = (bLat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function decorateMember(m: Life360Member, s: Life360Settings): Life360Member {
  let distanceFromHomeKm: number | null = null;
  let atHome: boolean | null = null;
  if (m.lat != null && m.lon != null && s.homeLat != null && s.homeLon != null) {
    distanceFromHomeKm = haversineKm(m.lat, m.lon, s.homeLat, s.homeLon);
    atHome = distanceFromHomeKm <= s.radiusKm;
  }
  return { ...m, distanceFromHomeKm, atHome };
}

export function memberInitials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

export function life360Disclaimer(): string {
  return "Life360 does not publish an official consumer API — this connector uses the endpoints its own apps use (api.cloud.life360.com/v3) via our server proxy. It may change without notice; your credentials stay in this browser and are only forwarded to our own /api/life360 route.";
}
