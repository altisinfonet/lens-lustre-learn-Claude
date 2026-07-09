// Backfill SHA-256 image hashes into photo_meta for entries missing them.
// Admin-only. Processes a small batch per call (default 25 entries) to stay
// within edge runtime limits. Re-invoke until "done": true.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256Url(url: string): Promise<string | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const buf = await r.arrayBuffer();
    return toHex(await crypto.subtle.digest("SHA-256", buf));
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData } = await userClient.auth.getUser();
    if (!userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data: roles } = await admin
      .from("user_roles").select("role").eq("user_id", userData.user.id);
    const isAdmin = (roles ?? []).some((r: any) =>
      ["admin", "super_admin"].includes(r.role)
    );
    if (!isAdmin) {
      return new Response(JSON.stringify({ error: "Forbidden — admin only" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const batchSize = Math.min(Number(body?.batch_size ?? 25), 50);
    const competition_id: string | null = body?.competition_id ?? null;

    let q = admin
      .from("competition_entries")
      .select("id, photos, photo_meta")
      .order("created_at", { ascending: true })
      .limit(batchSize);
    if (competition_id) q = q.eq("competition_id", competition_id);

    const { data: entries, error } = await q;
    if (error) throw error;

    let processed = 0;
    let updated = 0;
    let photosHashed = 0;

    for (const entry of entries ?? []) {
      processed++;
      const photos: string[] = entry.photos ?? [];
      if (photos.length === 0) continue;

      const meta: any[] = Array.isArray(entry.photo_meta) ? [...(entry.photo_meta as any[])] : [];
      // Pad meta to photos length
      while (meta.length < photos.length) {
        meta.push({ caption: "", exif_available: false, image_hash: { sha256: null, phash: null } });
      }

      let entryChanged = false;
      for (let i = 0; i < photos.length; i++) {
        const existing = meta[i]?.image_hash?.sha256 ?? null;
        if (existing && /^[0-9a-f]{64}$/.test(existing)) continue;
        const sha = await sha256Url(photos[i]);
        if (!sha) continue;
        meta[i] = {
          ...(meta[i] ?? {}),
          image_hash: { ...(meta[i]?.image_hash ?? {}), sha256: sha },
        };
        photosHashed++;
        entryChanged = true;
      }

      if (entryChanged) {
        // NOTE: updating photo_meta will trigger validate_competition_entry_photo_meta
        // which now requires every entry have a 64-hex sha256. Skip writes that
        // would still be incomplete (e.g. some photo fetches failed).
        const allValid = meta.every(
          (m) => m?.image_hash?.sha256 && /^[0-9a-f]{64}$/.test(m.image_hash.sha256)
        );
        if (!allValid) continue;
        const { error: upErr } = await admin
          .from("competition_entries")
          .update({ photo_meta: meta })
          .eq("id", entry.id);
        if (!upErr) updated++;
      }
    }

    return new Response(
      JSON.stringify({
        processed,
        updated,
        photos_hashed: photosHashed,
        done: (entries ?? []).length < batchSize,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
