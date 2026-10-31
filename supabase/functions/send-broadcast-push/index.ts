import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─────────────────────────────────────────────────────────────────────────────
// send-broadcast-push — one push to EVERY registered device.
//
// Admin only. Unlike `send-push` (one user, called by the DB trigger), this is
// always a deliberate human action, so there is NO internal-secret path: a valid
// admin JWT is the only way in. A leaked secret must never be able to message
// the whole userbase.
//
// Body: { title, body?, image_url?, link?, dry_run? }
//   image_url → shown as the big picture on Android / attachment on iOS
//   link      → where the app navigates when the notification is tapped
//   dry_run   → count the audience and return WITHOUT sending anything
//
// Deliberately does NOT insert rows into user_notifications: that table has an
// AFTER INSERT trigger which sends its own push, so writing there would deliver
// every broadcast twice.
//
// Secrets: FCM_SERVICE_ACCOUNT (same one send-push uses).
// ─────────────────────────────────────────────────────────────────────────────

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

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
  const s = btoa(String.fromCharCode(...bytes));
  return s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Exchange the service account for a short-lived OAuth2 token (RS256 JWT). */
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
  const sig = new Uint8Array(
    await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(signingInput)),
  );
  const jwt = `${signingInput}.${b64url(sig)}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });
  const out = await res.json();
  if (!out.access_token) throw new Error("FCM token exchange failed: " + JSON.stringify(out));
  return out.access_token;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey);

    // ── Admin JWT required. No secret bypass for a whole-audience send. ──
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    // Validate the caller with the SERVICE client, passing the JWT directly.
    // The earlier version built a second client from SUPABASE_ANON_KEY, which is
    // not reliably present in the function environment — when it was missing the
    // client could not verify anyone and every call came back 401.
    const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();
    const { data: userData, error: userErr } = await admin.auth.getUser(jwt);
    const user = userData?.user;
    if (userErr || !user) {
      return json({ error: "Unauthorized", detail: userErr?.message ?? "no user for token" }, 401);
    }

    const { data: role } = await admin
      .from("user_roles").select("role")
      .eq("user_id", user.id).eq("role", "admin").maybeSingle();
    if (!role) return json({ error: "Admin only" }, 403);

    const { title, body, image_url, link, dry_run } = await req.json();
    if (!title || !String(title).trim()) return json({ error: "A title is required" }, 400);

    // Every distinct device. A member with phone + tablet gets both.
    const { data: tokens, error: tokErr } = await admin.from("push_tokens").select("token, user_id");
    if (tokErr) return json({ error: tokErr.message }, 500);

    const devices = tokens ?? [];
    const audience = new Set(devices.map((t: any) => t.user_id)).size;

    if (dry_run) {
      return json({ success: true, dry_run: true, devices: devices.length, people: audience, sent: 0 });
    }
    if (devices.length === 0) {
      return json({ success: true, sent: 0, devices: 0, people: 0, note: "No devices are registered yet" });
    }

    const saRaw = Deno.env.get("FCM_SERVICE_ACCOUNT");
    if (!saRaw) return json({ error: "FCM_SERVICE_ACCOUNT secret is not set" }, 500);
    const sa = JSON.parse(saRaw);

    const accessToken = await getAccessToken(sa);
    const endpoint = `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`;

    const image = image_url && String(image_url).trim() ? String(image_url).trim() : undefined;

    let sent = 0;
    const stale: string[] = [];
    const errors: string[] = [];

    // Send in small concurrent batches: 9 or 900 devices, same code path, and
    // we never open hundreds of sockets at once.
    const BATCH = 20;
    for (let i = 0; i < devices.length; i += BATCH) {
      const slice = devices.slice(i, i + BATCH);
      await Promise.all(slice.map(async ({ token }: any) => {
        const message: Record<string, unknown> = {
          token,
          notification: { title, body: body || "", ...(image ? { image } : {}) },
          data: {
            type: "broadcast",
            ...(link ? { link: String(link) } : {}),
          },
          android: {
            priority: "high",
            ...(image ? { notification: { image } } : {}),
          },
          apns: {
            payload: { aps: { sound: "default", "mutable-content": image ? 1 : 0 } },
            ...(image ? { fcm_options: { image } } : {}),
          },
        };
        const r = await fetch(endpoint, {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ message }),
        });
        if (r.ok) { sent++; return; }
        const errText = await r.text();
        if (r.status === 404 || /UNREGISTERED|INVALID_ARGUMENT/i.test(errText)) stale.push(token);
        else if (errors.length < 3) errors.push(`${r.status}: ${errText.slice(0, 160)}`);
        console.error("FCM broadcast send failed", r.status, errText);
      }));
    }

    // Drop dead tokens so the audience count stays honest next time.
    if (stale.length > 0) await admin.from("push_tokens").delete().in("token", stale);

    return json({
      success: true,
      sent,
      devices: devices.length,
      people: audience,
      pruned: stale.length,
      ...(errors.length ? { errors } : {}),
    });
  } catch (err) {
    console.error("send-broadcast-push error:", err);
    return json({ error: (err as Error).message }, 500);
  }
});
