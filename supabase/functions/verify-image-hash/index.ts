// Verify a single photo's SHA-256 against photo_meta[i].image_hash.sha256
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

    // AuthN: must be a logged-in admin or judge
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData } = await userClient.auth.getUser();
    if (!userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data: roles } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", userData.user.id);
    const allowed = (roles ?? []).some((r: any) =>
      ["admin", "super_admin", "judge"].includes(r.role)
    );
    if (!allowed) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const entry_id = String(body?.entry_id ?? "");
    const photo_index = Number(body?.photo_index ?? -1);
    if (!entry_id || !Number.isInteger(photo_index) || photo_index < 0) {
      return new Response(JSON.stringify({ error: "entry_id + photo_index required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: entry, error: entryErr } = await admin
      .from("competition_entries")
      .select("photos, photo_meta")
      .eq("id", entry_id)
      .maybeSingle();
    if (entryErr || !entry) {
      return new Response(JSON.stringify({ error: "Entry not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const photos: string[] = entry.photos ?? [];
    const meta: any[] = (entry.photo_meta as any[]) ?? [];
    if (photo_index >= photos.length) {
      return new Response(JSON.stringify({ error: "photo_index out of range" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const url = photos[photo_index];
    const claimed: string | null = meta[photo_index]?.image_hash?.sha256 ?? null;

    const fetched = await fetch(url);
    if (!fetched.ok) {
      return new Response(JSON.stringify({ error: `Photo fetch failed (${fetched.status})` }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const buf = await fetched.arrayBuffer();
    const digest = await crypto.subtle.digest("SHA-256", buf);
    const computed = toHex(digest);

    return new Response(
      JSON.stringify({
        entry_id,
        photo_index,
        claimed_sha256: claimed,
        computed_sha256: computed,
        match: claimed !== null && claimed === computed,
        bytes: buf.byteLength,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
