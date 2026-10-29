/**
 * music-check — S7-b · VID-4 copyright music check, VENDOR STUB (default OFF).
 *
 * The check itself is built in SQL (20261005_0006, docs/evidence/d1/VID/README-vid4.md):
 * the `copyright_music_check` switch ships Off and cannot leave Off without the
 * vault key `music_check_api_key`; while Off every video publishes as
 * `not_required` and NO vendor is ever called. The vendor is not chosen
 * (VID-1 DECISION §7.1, Owner; ACRCloud recommended) and costs money per check,
 * so this function is the seam only:
 *
 *   • caller must be service_role (the future cron / wake), else 401;
 *   • MUSIC_CHECK_VENDOR unset or "none" → reads how many checks are due
 *     (music_check_due) and records NOTHING: an 'on' check keeps waiting in
 *     `checking` — never published unchecked (R-97/R-102);
 *   • any other vendor name → 501 until its adapter is written.
 *
 * A vendor adapter will: hash the served audio, call the vendor, and record via
 * music_check_record_result (service_role only). Nothing here is deployed by a
 * merge: d1-deploy-functions.yml is manual.
 */
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

Deno.serve(async (req: Request) => {
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const auth = req.headers.get("authorization") ?? "";
  if (!serviceKey || auth !== `Bearer ${serviceKey}`) return json(401, { error: "service role only" });

  const vendor = (Deno.env.get("MUSIC_CHECK_VENDOR") ?? "none").trim().toLowerCase();
  if (vendor !== "none" && vendor !== "") return json(501, { error: `vendor adapter "${vendor}" is not built yet` });

  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const res = await fetch(`${url}/rest/v1/rpc/music_check_due`, {
    method: "POST",
    headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, "content-type": "application/json" },
    body: JSON.stringify({ _limit: 50 }),
  });
  const due = res.ok ? ((await res.json()) as unknown[]).length : null;
  return json(200, { vendor: "none", due, recorded: 0, note: "no vendor configured: checks wait in 'checking'" });
});
