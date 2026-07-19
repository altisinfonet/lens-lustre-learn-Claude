import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Send a push notification to all of a user's registered devices via Firebase
// Cloud Messaging HTTP v1. Auth: either an internal secret header (for calls from
// other functions / triggers) or an admin JWT (for manual/test sends).
//
// Required secret: FCM_SERVICE_ACCOUNT = the full Firebase service-account JSON
//   (Project settings -> Service accounts -> Generate new private key).
// Optional secret: PUSH_INTERNAL_SECRET = shared secret for server-to-server calls.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-internal-secret",
};

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const b64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s+/g, "");
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

function b64url(input: string | Uint8Array): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  let s = btoa(String.fromCharCode(...bytes));
  return s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Exchange the service account for a short-lived OAuth2 access token (RS256 JWT).
async function getAccessToken(sa: any): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(JSON.stringify({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }));
  const signingInput = `${header}.${claim}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(sa.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(signingInput)));
  const jwt = `${signingInput}.${b64url(sig)}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });
  const json = await res.json();
  if (!json.access_token) throw new Error("FCM token exchange failed: " + JSON.stringify(json));
  return json.access_token;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey);

    // ── Auth: internal secret OR admin JWT ──
    const internalSecret = Deno.env.get("PUSH_INTERNAL_SECRET");
    const providedSecret = req.headers.get("x-internal-secret");
    let authorized = !!internalSecret && providedSecret === internalSecret;

    if (!authorized) {
      const authHeader = req.headers.get("Authorization");
      if (!authHeader) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
      const caller = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
      const { data: { user } } = await caller.auth.getUser();
      if (!user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
      const { data: role } = await admin.from("user_roles").select("role").eq("user_id", user.id).eq("role", "admin").maybeSingle();
      if (!role) return new Response(JSON.stringify({ error: "Admin only" }), { status: 403, headers: corsHeaders });
      authorized = true;
    }

    const { user_id, title, body, data } = await req.json();
    if (!user_id || !title) {
      return new Response(JSON.stringify({ error: "user_id and title are required" }), { status: 400, headers: corsHeaders });
    }

    const saRaw = Deno.env.get("FCM_SERVICE_ACCOUNT");
    if (!saRaw) return new Response(JSON.stringify({ error: "FCM_SERVICE_ACCOUNT secret not set" }), { status: 500, headers: corsHeaders });
    const sa = JSON.parse(saRaw);

    // Collect the user's device tokens
    const { data: tokens } = await admin.from("push_tokens").select("token").eq("user_id", user_id);
    if (!tokens || tokens.length === 0) {
      return new Response(JSON.stringify({ success: true, sent: 0, note: "no devices registered" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const accessToken = await getAccessToken(sa);
    const endpoint = `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`;

    let sent = 0;
    const stale: string[] = [];
    for (const { token } of tokens) {
      const message: any = {
        token,
        notification: { title, body: body || "" },
        data: data ? Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])) : undefined,
        android: { priority: "high" },
        apns: { payload: { aps: { sound: "default" } } },
      };
      const r = await fetch(endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });
      if (r.ok) {
        sent++;
      } else {
        const errText = await r.text();
        // Token no longer valid → prune it.
        if (r.status === 404 || /UNREGISTERED|INVALID_ARGUMENT/i.test(errText)) stale.push(token);
        console.error("FCM send failed", r.status, errText);
      }
    }

    if (stale.length > 0) {
      await admin.from("push_tokens").delete().in("token", stale);
    }

    return new Response(JSON.stringify({ success: true, sent, pruned: stale.length }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("send-push error:", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500, headers: corsHeaders });
  }
});
