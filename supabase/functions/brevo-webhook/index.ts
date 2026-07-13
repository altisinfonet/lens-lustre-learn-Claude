import { createClient } from "npm:@supabase/supabase-js@2";

/**
 * BUG-037 — Brevo transactional webhook → suppressed_emails.
 *
 * Production sends via Brevo, but the only suppression intake spoke
 * Mailgun/Lovable's format, so hard bounces / spam complaints / unsubscribes
 * never reached suppressed_emails and dead addresses kept getting mail.
 *
 * Brevo does NOT HMAC-sign webhooks, so this endpoint authenticates with a
 * shared token (BREVO_WEBHOOK_TOKEN) passed as ?token=... (or x-webhook-token
 * header). It FAILS CLOSED: if the secret is unset, every request is rejected,
 * so deploying this before configuring Brevo is harmless.
 *
 * Set up (owner):
 *   1. Supabase → Edge Functions → Secrets → add BREVO_WEBHOOK_TOKEN=<random>
 *   2. Brevo → Transactional → Settings → Webhook → add:
 *        URL: https://<ref>.supabase.co/functions/v1/brevo-webhook?token=<token>
 *        events: hard bounce, spam/complaint, unsubscribe, blocked, invalid email
 */

function json(data: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Brevo event → our suppression reason. Only suppression-worthy events map;
// everything else (delivered, opened, click, request, soft_bounce, deferred…)
// is acknowledged and ignored.
function reasonFor(event: string): "bounce" | "complaint" | "unsubscribe" | null {
  switch ((event || "").toLowerCase().replace(/[\s-]/g, "_")) {
    case "hard_bounce":
    case "blocked":
    case "invalid_email":
      return "bounce";
    case "spam":
    case "complaint":
      return "complaint";
    case "unsubscribed":
    case "unsubscribe":
      return "unsubscribe";
    default:
      return null;
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  // Fail closed: no secret configured → reject everything.
  const token = Deno.env.get("BREVO_WEBHOOK_TOKEN");
  if (!token) {
    console.error("BREVO_WEBHOOK_TOKEN not set — rejecting");
    return json({ error: "not configured" }, 503);
  }

  const url = new URL(req.url);
  const provided = url.searchParams.get("token") || req.headers.get("x-webhook-token") || "";
  if (provided.length !== token.length || provided !== token) {
    return json({ error: "unauthorized" }, 401);
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid json" }, 400);
  }

  const event = String(body?.event ?? "");
  const reason = reasonFor(event);
  const email = String(body?.email ?? body?.recipient ?? "").toLowerCase().trim();

  // Acknowledge non-suppression events (delivered/opened/etc.) so Brevo doesn't retry.
  if (!reason) return json({ ok: true, ignored: event || "unknown" });
  if (!email || !email.includes("@")) return json({ error: "missing email" }, 400);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { error } = await supabase.from("suppressed_emails").upsert(
    {
      email,
      reason,
      metadata: {
        provider: "brevo",
        event,
        message_id: body?.["message-id"] ?? body?.messageId ?? null,
        received_at: body?.date ?? null,
      },
    },
    { onConflict: "email" },
  );

  if (error) {
    console.error("suppressed_emails upsert failed", { error });
    return json({ error: "db write failed" }, 500);
  }

  console.log("Brevo suppression recorded", {
    reason,
    event,
    email_redacted: email[0] + "***@" + email.split("@")[1],
  });
  return json({ ok: true, suppressed: true, reason });
});
