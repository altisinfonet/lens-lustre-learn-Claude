/**
 * B5-4 — THE MISSING LINK: THE SERVER LOOKS AT THE BYTES.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * The media engine's whole security claim is "publishing bytes the server
 * never checked is impossible". Until now that claim rested on a state
 * machine with nothing to drive it: `media_begin_upload` had no caller,
 * `media_mark_verified` and `media_mark_ready` were reachable only by the
 * service role, and no function anywhere actually compared uploaded bytes
 * against what the member declared. A member could have uploaded anything and
 * the row would have sat at `pending` forever — which is safe, but also means
 * the client could never switch to this path at all.
 *
 * This is that function. It is the ONLY thing that may move a photograph from
 * pending to ready, and it does so only after re-reading the stored object and
 * re-computing its fingerprint.
 *
 * WHY THE SERVER DERIVES THE KEY INSTEAD OF ACCEPTING ONE
 * If the caller passed the storage key, they could point this function at
 * somebody else's object: it would hash bytes the member never uploaded, find
 * they match a fingerprint the member could have copied from anywhere, and
 * mark THEIR row ready against another person's photograph. So the key is
 * computed here from the row's own owner and id. The caller supplies one
 * thing: which of their own uploads to check.
 *
 * WHAT A MISMATCH MEANS
 * The member's client declared a fingerprint before uploading, and the bytes
 * that arrived hash to something else. Whether that is corruption, a race, or
 * a deliberate swap, the answer is the same: the row is QUARANTINED, which is
 * terminal, and `media_begin_upload` refuses to hand that fingerprint back —
 * so the member is not trapped in an upload/refuse loop, they simply get a new
 * row for the real bytes.
 *
 * DIMENSIONS ARE CORRECTED, NOT TRUSTED
 * Width and height came from the client. A wrong pair is not a security
 * problem but it mis-sizes the frame and mislabels every srcset candidate for
 * that photograph. Where the bytes are parseable, the server's reading wins.
 * Where they are not, the declared values stand — refusing to guess, as the
 * parsers do everywhere else.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";
import { getS3Settings, readS3Object } from "../_shared/s3.ts";
import { imageDimsFromBytes } from "../_shared/imageDims.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const EXT_BY_MIME: Record<string, string> = {
  "image/webp": "webp", "image/jpeg": "jpg", "image/png": "png", "image/avif": "avif",
};

/** Each call reads a whole object out of R2, so it is bandwidth, not CPU. */
const RATE_LIMIT = 30;
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

/**
 * The one true storage location for an original. Derived from the row, never
 * from the request. Contains the owner's id as a path segment, which is what
 * s3-presign-upload requires before it will sign an upload.
 */
export function originalKeyFor(ownerId: string, mediaId: string, mime: string): string {
  return `post-images/${ownerId}/media/${mediaId}/original.${EXT_BY_MIME[mime] ?? "webp"}`;
}

function toHex(b: Uint8Array): string {
  return "\\x" + Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("");
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
      return json({ error: "Too many verification requests; try again shortly" }, 429);
    }

    let mediaId = "";
    try {
      const body = await req.json();
      mediaId = typeof body?.media_id === "string" ? body.media_id.trim() : "";
    } catch (_) { /* handled below */ }
    if (!/^[0-9a-f-]{36}$/i.test(mediaId)) return json({ error: "Missing or malformed media_id" }, 400);

    const adminClient = createClient(supabaseUrl, serviceKey);

    const { data: row, error: rowErr } = await adminClient
      .from("media_objects")
      .select("id, owner_id, sha256, width, height, bytes, mime, state")
      .eq("id", mediaId).maybeSingle();
    if (rowErr) throw new Error(`media lookup failed: ${rowErr.message}`);
    if (!row) return json({ error: "No such upload" }, 404);

    // OWNERSHIP: a member may only ask about their own upload. Without this,
    // anyone could drive somebody else's row through the state machine.
    if (row.owner_id !== callerId) return json({ error: "No such upload" }, 404);

    if (row.state === "ready") {
      // Idempotent: a retried verification of an already-finished upload is a
      // success, not an error. The client may have lost our first answer.
      return json({ media_id: row.id, state: "ready", already: true });
    }
    if (row.state === "quarantined") {
      return json({ error: "This photograph was rejected by verification", state: "quarantined" }, 409);
    }
    if (row.state !== "pending") {
      return json({ error: `Upload is in state ${row.state}, expected pending`, state: row.state }, 409);
    }

    const s3 = await getS3Settings(adminClient);
    if (!s3) return json({ error: "S3 storage not configured/enabled" }, 400);
    const prefix = s3.path_prefix ? s3.path_prefix.replace(/\/+$/, "") + "/" : "";

    const key = originalKeyFor(row.owner_id, row.id, row.mime);
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

    const { error: vErr } = await adminClient.rpc("media_mark_verified", { _id: row.id });
    if (vErr) throw new Error(`mark_verified failed: ${vErr.message}`);

    const { error: rErr } = await adminClient.rpc("media_mark_ready", {
      _id: row.id, _derivatives: { original: key },
    });
    if (rErr) throw new Error(`mark_ready failed: ${rErr.message}`);

    return json({
      media_id: row.id,
      state: "ready",
      bytes: bytes.byteLength,
      dimensions_corrected: correctedDims,
    });
  } catch (err) {
    console.error("media-verify-upload error:", err);
    return json({ error: (err as Error).message }, 500);
  }
});
