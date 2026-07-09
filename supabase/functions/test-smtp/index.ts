import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

interface LogEntry {
  timestamp: string;
  step: string;
  status: "ok" | "error" | "info" | "warn";
  detail: string;
}

function log(logs: LogEntry[], step: string, status: LogEntry["status"], detail: string) {
  logs.push({ timestamp: new Date().toISOString(), step, status, detail });
}

async function sendViaBrevo(apiKey: string, fromEmail: string, fromName: string, toEmail: string, subject: string, html: string, logs: LogEntry[]) {
  log(logs, "Brevo API", "info", "Sending via Brevo HTTP API...");
  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "accept": "application/json", "api-key": apiKey, "content-type": "application/json" },
    body: JSON.stringify({
      sender: { name: fromName, email: fromEmail },
      to: [{ email: toEmail }],
      subject,
      htmlContent: html,
    }),
  });
  const text = await res.text();
  if (res.ok) {
    let msgId = "";
    try { msgId = JSON.parse(text).messageId || ""; } catch {}
    log(logs, "Brevo API", "ok", `Email sent! ${msgId ? `Message ID: ${msgId}` : ""}`);
    return true;
  }
  let err = text;
  try { err = JSON.parse(text).message || text; } catch {}
  log(logs, "Brevo API", "error", `Error (${res.status}): ${err}`);
  return false;
}

async function sendViaResend(apiKey: string, fromEmail: string, fromName: string, toEmail: string, subject: string, html: string, logs: LogEntry[]) {
  log(logs, "Resend API", "info", "Sending via Resend HTTP API...");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: `${fromName} <${fromEmail}>`,
      to: [toEmail],
      subject,
      html,
    }),
  });
  const text = await res.text();
  if (res.ok) {
    let msgId = "";
    try { msgId = JSON.parse(text).id || ""; } catch {}
    log(logs, "Resend API", "ok", `Email sent! ${msgId ? `ID: ${msgId}` : ""}`);
    return true;
  }
  let err = text;
  try { err = JSON.parse(text).message || text; } catch {}
  log(logs, "Resend API", "error", `Error (${res.status}): ${err}`);
  return false;
}

async function sendViaSendGrid(apiKey: string, fromEmail: string, fromName: string, toEmail: string, subject: string, html: string, logs: LogEntry[]) {
  log(logs, "SendGrid API", "info", "Sending via SendGrid HTTP API...");
  const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: toEmail }] }],
      from: { email: fromEmail, name: fromName },
      subject,
      content: [{ type: "text/html", value: html }],
    }),
  });
  const text = await res.text();
  if (res.ok || res.status === 202) {
    log(logs, "SendGrid API", "ok", "Email accepted for delivery!");
    return true;
  }
  let err = text;
  try {
    const parsed = JSON.parse(text);
    err = parsed.errors?.map((e: any) => e.message).join("; ") || text;
  } catch {}
  log(logs, "SendGrid API", "error", `Error (${res.status}): ${err}`);
  return false;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const logs: LogEntry[] = [];

  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      log(logs, "Auth", "error", "No authorization header");
      return new Response(JSON.stringify({ error: "Unauthorized", logs }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      log(logs, "Auth", "error", `User verification failed: ${claimsError?.message || "No claims"}`);
      return new Response(JSON.stringify({ error: "Unauthorized", logs }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = claimsData.claims.sub;
    const userEmail = claimsData.claims.email;
    log(logs, "Auth", "ok", `User verified: ${userEmail}`);

    const serviceClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: roleRow, error: roleError } = await serviceClient
      .from("user_roles")
      .select("id")
      .eq("user_id", userId)
      .eq("role", "admin")
      .maybeSingle();
    if (roleError || !roleRow) {
      log(logs, "Auth", "error", "Admin role required");
      return new Response(JSON.stringify({ error: "Admin access required", logs }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    log(logs, "Auth", "ok", "Admin role confirmed");

    const { to_email, smtp_config } = await req.json();
    const provider = smtp_config?.provider || "brevo";
    const fromEmail = smtp_config?.from_email || smtp_config?.username || "noreply@example.com";
    const fromName = smtp_config?.from_name || "50mm Retina World";
    const apiKey = smtp_config?.api_key || "";

    log(logs, "Config", "info", `Provider: ${provider}`);
    log(logs, "Config", "info", `From: ${fromName} <${fromEmail}>`);
    log(logs, "Config", "info", `To: ${to_email}`);

    if (!to_email) {
      log(logs, "Validation", "error", "No recipient email provided");
      return new Response(JSON.stringify({ error: "Missing recipient", logs }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // For custom SMTP, just validate config
    if (provider === "smtp") {
      log(logs, "SMTP", "info", `Host: ${smtp_config?.host || "NOT SET"}, Port: ${smtp_config?.port || "NOT SET"}`);
      log(logs, "SMTP", "warn", "Edge Functions cannot make raw SMTP connections");
      log(logs, "SMTP", "info", "Switch to Brevo, Resend, or SendGrid for actual email delivery");
      return new Response(JSON.stringify({
        success: false,
        message: "Custom SMTP is not supported for sending from edge functions. Please use Brevo, Resend, or SendGrid.",
        logs,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Check API key
    if (!apiKey) {
      log(logs, "Validation", "error", `No API key provided for ${provider}. Please enter your API key in the settings.`);
      return new Response(JSON.stringify({
        success: false,
        message: `No API key configured for ${provider}. Please enter your API key and save settings.`,
        logs,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    log(logs, "Validation", "ok", "API key present");

    const subject = `Test Email from ${fromName}`;
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #333;">✅ Email Test Successful</h2>
        <p style="color: #666; line-height: 1.6;">This is a test email sent from <strong>${fromName}</strong> admin panel.</p>
        <div style="background: #f5f5f5; padding: 15px; border-radius: 8px; margin: 20px 0;">
          <p style="margin: 5px 0; font-size: 14px;"><strong>From:</strong> ${fromName} &lt;${fromEmail}&gt;</p>
          <p style="margin: 5px 0; font-size: 14px;"><strong>To:</strong> ${to_email}</p>
          <p style="margin: 5px 0; font-size: 14px;"><strong>Provider:</strong> ${provider}</p>
          <p style="margin: 5px 0; font-size: 14px;"><strong>Sent at:</strong> ${new Date().toISOString()}</p>
        </div>
        <p style="color: #999; font-size: 12px;">If you received this email, your configuration is working correctly.</p>
      </div>
    `;

    let success = false;
    if (provider === "brevo") {
      success = await sendViaBrevo(apiKey, fromEmail, fromName, to_email, subject, html, logs);
    } else if (provider === "resend") {
      success = await sendViaResend(apiKey, fromEmail, fromName, to_email, subject, html, logs);
    } else if (provider === "sendgrid") {
      success = await sendViaSendGrid(apiKey, fromEmail, fromName, to_email, subject, html, logs);
    }

    log(logs, "Summary", success ? "ok" : "error", success
      ? `Test email sent to ${to_email} via ${provider}`
      : `Failed to send email via ${provider}. Check your API key and sender domain.`
    );

    return new Response(JSON.stringify({
      success,
      message: success ? `Test email sent to ${to_email} via ${provider}` : `Failed to send via ${provider}. See log report.`,
      logs,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err: any) {
    console.error("Test email error:", err);
    log(logs, "Error", "error", err.message || "Unknown error");
    return new Response(
      JSON.stringify({ error: err.message || "Failed to test email", logs }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
