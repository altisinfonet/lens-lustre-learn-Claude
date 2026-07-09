import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getSecureHeaders } from "../_shared/secureHeaders.ts";

Deno.serve(async (req) => {
  const headers = getSecureHeaders(req);

  if (req.method === "OPTIONS") return new Response(null, { headers });
  if (req.method === "TRACE") return new Response("Method Not Allowed", { status: 405, headers });

  const cronSecret = req.headers.get("x-cron-secret");
  if (!cronSecret || cronSecret !== Deno.env.get("CRON_SECRET")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...headers, "Content-Type": "application/json" } });
  }



  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const { data: boosts } = await supabase
    .from("scheduled_boosts").select("*").eq("status", "active");

  if (!boosts || boosts.length === 0) {
    return new Response(JSON.stringify({ processed: 0 }), { headers });
  }

  let processed = 0;

  for (const boost of boosts) {
    if (boost.applied_amount >= boost.total_amount) {
      await supabase.from("scheduled_boosts").update({ status: "completed", updated_at: new Date().toISOString() }).eq("id", boost.id);
      continue;
    }
    if (boost.ends_at && new Date(boost.ends_at) < new Date()) {
      await supabase.from("scheduled_boosts").update({ status: "completed", updated_at: new Date().toISOString() }).eq("id", boost.id);
      continue;
    }

    const toApply = Math.min(boost.increment_per_hour, boost.total_amount - boost.applied_amount);
    const promises = [];
    for (let i = 0; i < toApply; i++) {
      promises.push(
        supabase.from("image_reactions").insert({
          image_id: boost.image_id, image_type: boost.image_type,
          reaction_type: boost.reaction_type, user_id: crypto.randomUUID(),
        })
      );
    }
    await Promise.all(promises);

    await supabase.from("scheduled_boosts").update({
      applied_amount: boost.applied_amount + toApply,
      updated_at: new Date().toISOString(),
      status: (boost.applied_amount + toApply >= boost.total_amount) ? "completed" : "active",
    }).eq("id", boost.id);

    processed++;
  }

  return new Response(JSON.stringify({ processed }), { headers });
});
