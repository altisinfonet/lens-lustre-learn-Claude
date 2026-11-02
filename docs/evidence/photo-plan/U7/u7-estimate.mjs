// U7 dry-run estimate on PRODUCTION, read-only: the old files the U7 mark would queue for PUBLIC posts
// (old photo + old thumb in the same folder + -l3 rungs), HEAD sizes on the CDN. Prints counts and bytes only.
const SB = "https://jtdtehuqtinjxropkkcn.supabase.co";
const K = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp0ZHRlaHVxdGluanhyb3Bra2NuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM1NzI3MjEsImV4cCI6MjA5OTE0ODcyMX0.qY8BI5LXb6uLzTwbpf8AleZ6UZyfeaOA0q4_TC5CEpo";
const RE = /^https:\/\/cdn\.50mmretina\.com\/(post-images\/[0-9a-f-]{36}\/(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+\.webp)(?:\?[^#]*)?$/;
const inScope = (k) => k && k.split("/")[2] !== "d" && !/-l4f?(-thumb|-r\d{3,4})?\.webp$/i.test(k) && !/-thumb\.webp$/i.test(k) && !/-l3-r\d{3,4}\.webp$/i.test(k);
const posts = [];
for (let off = 0; ; off += 1000) {
  const r = await fetch(`${SB}/rest/v1/posts?select=id,image_urls,thumbnail_urls&image_urls=not.is.null&limit=1000&offset=${off}`, { headers: { apikey: K } });
  const j = await r.json(); posts.push(...j); if (j.length < 1000) break;
}
const keys = new Set();
let photos = 0;
for (const p of posts) (p.image_urls ?? []).forEach((u, i) => {
  const k = RE.exec(u)?.[1];
  if (!inScope(k)) return;
  photos++;
  keys.add(k);
  const t = RE.exec(p.thumbnail_urls?.[i] ?? "")?.[1];
  if (t && t.split("/")[1] === k.split("/")[1] && !/-l4f?(-thumb|-r\d{3,4})?\.webp$/i.test(t)) keys.add(t);
  if (/-l3\.webp$/.test(k)) { keys.add(k.replace(/-l3\.webp$/, "-l3-r1080.webp")); keys.add(k.replace(/-l3\.webp$/, "-l3-r1440.webp")); }
});
let present = 0, absent = 0, bytes = 0;
const list = [...keys];
for (let i = 0; i < list.length; i += 16) {
  await Promise.all(list.slice(i, i + 16).map(async (k) => {
    const h = await fetch(`https://cdn.50mmretina.com/${k}`, { method: "HEAD" }).catch(() => null);
    if (h?.ok) { present++; bytes += Number(h.headers.get("content-length") || 0); } else absent++;
  }));
}
console.log(JSON.stringify({ measured_utc: new Date().toISOString(), public_posts: posts.length, in_scope_public_photos: photos, candidate_files: list.length, present, absent, bytes, mb: +(bytes / 1048576).toFixed(1) }));
