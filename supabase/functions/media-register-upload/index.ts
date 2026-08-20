/**
 * THE LIVE WRITE PATH'S ONE DOOR FROM `pending` TO `ready`.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * This supersedes `media-verify-upload`, which was written for a storage
 * layout production does not use. That function derives the key from the row
 * as `post-images/<owner>/media/<mediaId>/original.<ext>`; measured on
 * 2026-08-20, **229 of 229 production media objects live at
 * `post-images/<owner>/posts/<name>-w{W}h{H}[-l3].webp`** and zero use the
 * derived shape. Deploying it unchanged would look for an object that does not
 * exist and strand every upload at `pending` for ever.
 *
 * The layout is not incidental. The responsive ladder and the thumbnail are
 * FILENAME conventions — the `-l3` marker, the `w×h` suffix, the `-thumb`
 * sibling — parsed by `imageLadder.ts` and the renderer. Moving new uploads to
 * `media/<id>/original.webp` would silently disable both for every new post,
 * and no unit test would see it. So the object stays where the uploader puts
 * it, and this function REGISTERS it. That is also exactly what
 * `media_migrate_post` does for the existing 229, so the live path and the
 * migrated path converge on one shape rather than forking into two.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHAT DERIVATION WAS PROTECTING, AND HOW IT IS PROTECTED WITHOUT IT
 *
 * `media-verify-upload` derived the key so a caller could not point it at
 * somebody else's object — hashing bytes the member never uploaded and marking
 * THEIR row ready against another person's photograph. Keeping the production
 * layout means the path must come from the caller, so that danger is closed
 * three other ways, none of which depend on derivation:
 *
 *   1. The row must belong to the caller, and the path must begin
 *      `post-images/<row.owner_id>/`. A member can only ever name an object
 *      inside their own folder. Enforced here AND in `media_mark_ready`
 *      (MEDIA-2102), because a check that lives only in an edge function is a
 *      check the next edge function forgets.
 *   2. The bytes must hash to the fingerprint the client declared BEFORE the
 *      upload, in `media_begin_upload`. Naming a different object of your own
 *      fails the hash — and fails into `quarantined`, which is terminal.
 *   3. `owner_id` and `sha256` are frozen after insert by
 *      `trg_media_state_transition`, so a `ready` row cannot be re-aimed.
 *
 * ⚠ DO NOT "SIMPLIFY" THIS BY TRUSTING THE PATH. Every one of those three is
 * load-bearing. Removing any of them makes it possible to publish a photograph
 * the server never looked at, which is the single claim the whole media engine
 * exists to make.
 *
 * WHAT A MISMATCH MEANS — unchanged from media-verify-upload: whether it is
 * corruption, a race, or a deliberate swap, the row is QUARANTINED, which is
 * terminal, and `media_begin_upload` refuses to hand that fingerprint back, so
 * the member is not trapped in an upload/refuse loop.
 *
 * DIMENSIONS ARE CORRECTED, NOT TRUSTED — where the bytes are parseable the
 * server's reading wins; where they are not, the declared values stand.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";
import { getS3Settings, readS3Object } from "../_shared/s3.ts";
import { imageDimsFromBytes } from "../_shared/imageDims.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/** Each call reads a whole object out of R2, so it is bandwidth, not CPU. */
const RATE_LIMIT = 60;
const RATE_WINDOW_MS = 60_000;
const rateBucket = new Map<string, { count: number; resetAt: number }>();

function rateLimited(userId: string): boolean {
  const now = Date.now();
  const e = rateBucket.get(userId);
  if (!e || now > e.resetAt) {
    rateBucket.set(userId, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return false;
  }
  e.count++;
  return e.count > RATE_LIMIT;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

function toHex(b: Uint8Array): string {
  return "\\x" + Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("");
}

/**
 * The path the caller may name, reduced to a bucket-relative key and checked
 * against the OWNER OF THE ROW — never against anything in the request.
 *
 * Accepts either a bare key (`post-images/<owner>/posts/x.webp`) or a full CDN
 * URL, because the uploader returns a URL and making the client re-derive the
 * key is one more place for the two to disagree. Everything else is refused.
 */
export function objectKeyForOwner(raw: string, ownerId: string): string | null {
  if (typeof raw !== "string") return null;
  let key = raw.trim();
  if (!key) return null;

  // Strip a scheme+host if one was sent. The host itself is not trusted for
  // authorization — the owner-prefix check below is what authorizes.
  const m = /^https?:\/\/[^/]+\/(.*)$/i.exec(key);
  if (m) key = m[1];

  // No query string: `?t=` cache-busters are part of the URL, never the object.
  key = key.split("?")[0].split("#")[0];

  try { key = decodeURIComponent(key); } catch { return null; }

  if (key.startsWith("/")) return null;
  if (key.includes("..")) return null;
  if (key.includes("\\")) return null;
  if (key.includes("//")) return null;

  // The whole authorization, stated once: the object must be in this row's
  // owner's post-images folder. `s3-presign-upload` enforces the same shape on
  // the way in, so an honest client cannot produce anything else.
  if (!key.startsWith(`post-images/${ownerId}/`)) return null;

  // A thumbnail or a rung is not an original. Registering one would publish a
  // 600px copy as the photograph.
  if (/-thumb\.[A-Za-z0-9]+$/.test(key)) return null;
  if (/-r(?:600|1080|1440)\.[A-Za-z0-9]+$/.test(key)) return null;

  return key;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsErr } = await userClient.auth.getClaims(token);
    if (claimsErr || !claimsData?.claims?.sub) return json({ error: "Unauthorized" }, 401);
    const callerId = claimsData.claims.sub as string;

    if (rateLimited(callerId)) {
      return json({ error: "Too many registration requests; try again shortly" }, 429);
    }

    let mediaId = "";
    let rawPath = "";
    try {
      const body = await req.json();
      mediaId = typeof body?.media_id === "string" ? body.media_id.trim() : "";
      rawPath = typeof body?.object_path === "string" ? body.object_path.trim() : "";
    } catch (_) { /* handled below */ }
    if (!/^[0-9a-f-]{36}$/i.test(mediaId)) return json({ error: "Missing or malformed media_id" }, 400);
    if (!rawPath) return json({ error: "Missing object_path" }, 400);

    const adminClient = createClient(supabaseUrl, serviceKey);

    const { data: row, error: rowErr } = await adminClient
      .from("media_objects")
      .select("id, owner_id, sha256, width, height, bytes, mime, state")
      .eq("id", mediaId).maybeSingle();
    if (rowErr) throw new Error(`media lookup failed: ${rowErr.message}`);
    if (!row) return json({ error: "No such upload" }, 404);

    // OWNERSHIP: a member may only register their own upload. Without this,
    // anyone could drive somebody else's row through the state machine.
    // Deliberately the same 404 as "no such row" — whether a media id exists
    // is not a fact a stranger is entitled to.
    if (row.owner_id !== callerId) return json({ error: "No such upload" }, 404);

    const key = objectKeyForOwner(rawPath, row.owner_id);
    if (!key) {
      return json({ error: "object_path is not an original inside your own post-images folder" }, 400);
    }

    if (row.state === "ready") {
      // Idempotent: a retried registration of an already-finished upload is a
      // success, not an error. The client may have lost our first answer.
      return json({ media_id: row.id, state: "ready", already: true });
    }
    if (row.state === "quarantined") {
      return json({ error: "This photograph was rejected by verification", state: "quarantined" }, 409);
    }
    if (row.state !== "pending" && row.state !== "verified") {
      return json({ error: `Upload is in state ${row.state}`, state: row.state }, 409);
    }

    const s3 = await getS3Settings(adminClient);
    if (!s3) return json({ error: "S3 storage not configured/enabled" }, 400);
    const prefix = s3.path_prefix ? s3.path_prefix.replace(/\/+$/, "") + "/" : "";

    const bytes = await readS3Object(s3, prefix + key);
    if (bytes === null) {
      // Not a failure of the member's honesty — the upload simply has not
      // landed. Left pending so the client can retry the PUT and call again.
      return json({ error: "The uploaded file is not in storage yet", state: "pending", retryable: true }, 409);
    }

    // ── The check the whole design rests on ──
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    const actualSha = toHex(digest);
    const declaredSha: string = row.sha256;

    const shaMatches = actualSha.toLowerCase() === String(declaredSha).toLowerCase();
    const sizeMatches = bytes.byteLength === Number(row.bytes);

    if (!shaMatches || !sizeMatches) {
      const reason = !shaMatches
        ? "checksum mismatch: the stored bytes are not the bytes that were declared"
        : `size mismatch: stored ${bytes.byteLength} bytes, declared ${row.bytes}`;
      const { error: qErr } = await adminClient.rpc("media_quarantine", { _id: row.id, _reason: reason });
      if (qErr) throw new Error(`quarantine failed: ${qErr.message}`);
      return json({ media_id: row.id, state: "quarantined", reason }, 409);
    }

    // ── Server truth for dimensions, where the bytes will say ──
    const parsed = imageDimsFromBytes(bytes);
    let correctedDims: { from: string; to: string } | null = null;
    if (parsed && (parsed.width !== row.width || parsed.height !== row.height)) {
      const { error: dErr } = await adminClient
        .from("media_objects")
        .update({ width: parsed.width, height: parsed.height })
        .eq("id", row.id);
      if (dErr) throw new Error(`dimension correction failed: ${dErr.message}`);
      correctedDims = { from: `${row.width}x${row.height}`, to: `${parsed.width}x${parsed.height}` };
    }

    // The state machine is walked, never jumped. A row already at `verified`
    // (a retry that died between the two calls) resumes from there rather than
    // being refused — the trigger refuses pending -> ready either way.
    if (row.state === "pending") {
      const { error: vErr } = await adminClient.rpc("media_mark_verified", { _id: row.id });
      if (vErr) throw new Error(`mark_verified failed: ${vErr.message}`);
    }

    const { error: rErr } = await adminClient.rpc("media_mark_ready", {
      _id: row.id, _derivatives: { original: key },
    });
    if (rErr) throw new Error(`mark_ready failed: ${rErr.message}`);

    return json({
      media_id: row.id,
      state: "ready",
      object_path: key,
      bytes: bytes.byteLength,
      dimensions_corrected: correctedDims,
    });
  } catch (err) {
    console.error("media-register-upload error:", err);
    return json({ error: (err as Error).message }, 500);
  }
});
