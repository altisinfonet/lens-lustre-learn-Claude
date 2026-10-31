/**
 * ga-report — Admin-only Google Analytics 4 report proxy.
 *
 * Authenticates a service account (via Web Crypto RS256 JWT — no external deps),
 * exchanges it for a Google access token, and queries the GA4 Data API on the
 * server so the private key never touches the browser. Returns a compact,
 * chart-ready JSON payload for the admin Analytics dashboard.
 *
 * Auth: caller MUST be a signed-in admin (JWT validated + user_roles=admin).
 *
 * Secrets required (set in Supabase project secrets):
 *   GA_SA_CLIENT_EMAIL  — service account email
 *   GA_SA_PRIVATE_KEY   — service account private key (PEM, with \n or real newlines)
 *   GA_PROPERTY_ID      — GA4 property numeric id (e.g. 501234567)
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/* ---------- Service-account auth (RS256 via Web Crypto) ---------- */

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const b64 = pem
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

function b64url(input: ArrayBuffer | string): string {
  let bin: string;
  if (typeof input === "string") {
    bin = input;
  } else {
    const bytes = new Uint8Array(input);
    bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  }
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function getAccessToken(clientEmail: string, privateKeyPem: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: clientEmail,
    scope: "https://www.googleapis.com/auth/analytics.readonly",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };
  const encHeader = b64url(JSON.stringify(header));
  const encClaim = b64url(JSON.stringify(claim));
  const signingInput = `${encHeader}.${encClaim}`;

  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(privateKeyPem),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(signingInput),
  );
  const jwt = `${signingInput}.${b64url(sig)}`;

  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  const data = await resp.json();
  if (!resp.ok || !data.access_token) {
    throw new Error(`token exchange failed: ${resp.status} ${JSON.stringify(data).slice(0, 200)}`);
  }
  return data.access_token as string;
}

/* ---------- GA4 Data API ---------- */

async function runReport(token: string, propertyId: string, body: unknown): Promise<any> {
  const resp = await fetch(
    `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  const data = await resp.json();
  if (!resp.ok) throw new Error(`runReport ${resp.status}: ${JSON.stringify(data).slice(0, 300)}`);
  return data;
}

async function runRealtime(token: string, propertyId: string, body: unknown): Promise<any> {
  const resp = await fetch(
    `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runRealtimeReport`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  const data = await resp.json();
  if (!resp.ok) throw new Error(`realtime ${resp.status}: ${JSON.stringify(data).slice(0, 200)}`);
  return data;
}

const rows = (r: any) => (r?.rows ?? []) as any[];
const dim = (row: any, i = 0) => row.dimensionValues?.[i]?.value ?? "";
const met = (row: any, i = 0) => Number(row.metricValues?.[i]?.value ?? 0);

/* ---------- Handler ---------- */

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  try {
    // 1. Admin auth
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user?.id) return json({ error: "invalid_token" }, 401);

    const admin = createClient(supabaseUrl, serviceKey);
    const { data: roles } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", userData.user.id)
      .eq("role", "admin");
    if (!roles || roles.length === 0) return json({ error: "forbidden_admin_only" }, 403);

    // 2. Config
    const clientEmail = Deno.env.get("GA_SA_CLIENT_EMAIL");
    const privateKey = (Deno.env.get("GA_SA_PRIVATE_KEY") || "").replace(/\\n/g, "\n");
    const propertyId = Deno.env.get("GA_PROPERTY_ID");
    if (!clientEmail || !privateKey || !propertyId) {
      return json({ error: "ga_not_configured", detail: "Set GA_SA_CLIENT_EMAIL, GA_SA_PRIVATE_KEY, GA_PROPERTY_ID." }, 400);
    }

    // 3. Date range (default last 28 days)
    const body = await req.json().catch(() => ({}));
    const startDate = typeof body?.startDate === "string" ? body.startDate : "28daysAgo";
    const endDate = typeof body?.endDate === "string" ? body.endDate : "today";
    const range = [{ startDate, endDate }];

    // 4. Token
    const token = await getAccessToken(clientEmail, privateKey);

    // 5. Reports (parallel)
    const [kpi, series, pages, sources, countries, devices, realtime] = await Promise.all([
      runReport(token, propertyId, {
        dateRanges: range,
        metrics: [
          { name: "sessions" }, { name: "totalUsers" }, { name: "newUsers" },
          { name: "screenPageViews" }, { name: "averageSessionDuration" }, { name: "engagementRate" },
        ],
      }),
      runReport(token, propertyId, {
        dateRanges: range,
        dimensions: [{ name: "date" }],
        metrics: [{ name: "sessions" }, { name: "totalUsers" }],
        orderBys: [{ dimension: { dimensionName: "date" } }],
      }),
      runReport(token, propertyId, {
        dateRanges: range,
        dimensions: [{ name: "pagePath" }],
        metrics: [{ name: "screenPageViews" }],
        orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }],
        limit: 10,
      }),
      runReport(token, propertyId, {
        dateRanges: range,
        dimensions: [{ name: "sessionDefaultChannelGroup" }],
        metrics: [{ name: "sessions" }],
        orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
        limit: 8,
      }),
      runReport(token, propertyId, {
        dateRanges: range,
        dimensions: [{ name: "country" }],
        metrics: [{ name: "totalUsers" }],
        orderBys: [{ metric: { metricName: "totalUsers" }, desc: true }],
        limit: 8,
      }),
      runReport(token, propertyId, {
        dateRanges: range,
        dimensions: [{ name: "deviceCategory" }],
        metrics: [{ name: "sessions" }],
        orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
      }),
      runRealtime(token, propertyId, { metrics: [{ name: "activeUsers" }] }).catch(() => null),
    ]);

    const kpiRow = rows(kpi)[0];
    const fmtDate = (d: string) => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;

    const payload = {
      ok: true,
      range: { startDate, endDate },
      generatedAt: new Date().toISOString(),
      kpis: kpiRow
        ? {
            sessions: met(kpiRow, 0),
            totalUsers: met(kpiRow, 1),
            newUsers: met(kpiRow, 2),
            pageViews: met(kpiRow, 3),
            avgSessionDuration: met(kpiRow, 4),
            engagementRate: met(kpiRow, 5),
          }
        : { sessions: 0, totalUsers: 0, newUsers: 0, pageViews: 0, avgSessionDuration: 0, engagementRate: 0 },
      timeseries: rows(series).map((r) => ({ date: fmtDate(dim(r)), sessions: met(r, 0), users: met(r, 1) })),
      topPages: rows(pages).map((r) => ({ path: dim(r), views: met(r) })),
      channels: rows(sources).map((r) => ({ channel: dim(r), sessions: met(r) })),
      countries: rows(countries).map((r) => ({ country: dim(r), users: met(r) })),
      devices: rows(devices).map((r) => ({ device: dim(r), sessions: met(r) })),
      realtimeActiveUsers: realtime ? met(rows(realtime)[0] ?? {}, 0) : null,
    };

    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
        // 5-minute edge/browser cache to stay well within GA API quotas.
        "Cache-Control": "public, max-age=300",
      },
    });
  } catch (e) {
    console.error("[ga-report] error", e);
    return json({ error: "ga_report_failed", detail: (e as Error)?.message ?? "unknown" }, 500);
  }
});
