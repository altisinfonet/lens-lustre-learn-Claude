// U0: read-only byte measurement on live public photos. Nothing written to disk except the JSON summary.
const sharp = require("sharp"); // run from the repo root after npm ci: node docs/evidence/photo-plan/U0/u0-measure.cjs <anon key> 40 <out.json>
const fs = require('fs');
const SB = 'https://jtdtehuqtinjxropkkcn.supabase.co';
const K = process.argv[2];
const N = Number(process.argv[3] || 40);
const OUT = process.argv[4];
async function head(u) { try { const r = await fetch(u, { method: 'HEAD' }); return r.ok ? Number(r.headers.get('content-length') || 0) : 0; } catch { return 0; } }
(async () => {
  const r = await fetch(SB + '/rest/v1/posts?select=id,image_urls,thumbnail_urls,created_at&image_urls=not.is.null&order=created_at.desc&limit=600', { headers: { apikey: K, Authorization: 'Bearer ' + K } });
  const posts = await r.json();
  let urls = posts.flatMap(p => (p.image_urls || [])).filter(u => /\/post-images\/.+\/posts\//.test(u));
  // spread the sample across the whole list (old and new uploads)
  const step = Math.max(1, Math.floor(urls.length / N));
  const sample = urls.filter((_, i) => i % step === 0).slice(0, N);
  const rows = [];
  for (const u of sample) {
    const base = u.split('?')[0];
    const res = await fetch(base); if (!res.ok) continue;
    const buf = Buffer.from(await res.arrayBuffer());
    const meta = await sharp(buf).metadata();
    const l3 = /-l3\.webp$/.test(base);
    const today = { orig: buf.length, thumb: 0, r1080: 0, r1440: 0 };
    if (l3) {
      today.thumb = await head(base.replace(/\.webp$/, '-thumb.webp'));
      today.r1080 = await head(base.replace(/\.webp$/, '-r1080.webp'));
      today.r1440 = await head(base.replace(/\.webp$/, '-r1440.webp'));
    } else {
      today.thumb = await head(base.replace(/\.webp$/, '-thumb.webp'));
    }
    const enc = async (edge, q) => {
      const o = await sharp(buf).rotate().resize({ width: edge, height: edge, fit: 'inside', withoutEnlargement: true }).webp({ quality: q, effort: 4 }).toBuffer();
      return o.length;
    };
    const neu = { w2048: await enc(2048, 85), w1080: await enc(1080, 82), w600: await enc(600, 78), w320: await enc(320, 75) };
    const neuQ92 = await enc(2048, 92);
    rows.push({ w: meta.width, h: meta.height, l3, today, neu, neu2048q92: neuQ92 });
    process.stdout.write('.');
  }
  const sum = (f) => rows.reduce((a, r) => a + f(r), 0);
  const todayTotal = sum(r => r.today.orig + r.today.thumb + r.today.r1080 + r.today.r1440);
  const newTotal = sum(r => r.neu.w2048 + r.neu.w1080 + r.neu.w600 + r.neu.w320);
  const out = {
    measured_utc: new Date().toISOString(), lane: 'production (cdn.50mmretina.com, public posts via anon REST)',
    posts_listed: posts.length, sample_photos: rows.length,
    l3_count: rows.filter(r => r.l3).length,
    avg_long_edge: Math.round(sum(r => Math.max(r.w, r.h)) / rows.length),
    avg_kb_today: { original: Math.round(sum(r => r.today.orig) / rows.length / 1024), thumb600: Math.round(sum(r => r.today.thumb) / rows.length / 1024), r1080: Math.round(sum(r => r.today.r1080) / Math.max(1, rows.filter(r => r.today.r1080).length) / 1024), r1440: Math.round(sum(r => r.today.r1440) / Math.max(1, rows.filter(r => r.today.r1440).length) / 1024) },
    avg_kb_new: { w2048_q85: Math.round(sum(r => r.neu.w2048) / rows.length / 1024), w2048_q92: Math.round(sum(r => r.neu2048q92) / rows.length / 1024), w1080_q82: Math.round(sum(r => r.neu.w1080) / rows.length / 1024), w600_q78: Math.round(sum(r => r.neu.w600) / rows.length / 1024), w320_q75: Math.round(sum(r => r.neu.w320) / rows.length / 1024) },
    stored_per_photo_kb: { today: Math.round(todayTotal / rows.length / 1024), new: Math.round(newTotal / rows.length / 1024) },
    storage_saving_pct: Math.round((1 - newTotal / todayTotal) * 1000) / 10,
    fullscreen_saving_pct: Math.round((1 - sum(r => r.neu.w2048) / sum(r => r.today.orig)) * 1000) / 10,
    grid_saving_pct_320_vs_600thumb: Math.round((1 - sum(r => r.neu.w320) / Math.max(1, sum(r => r.today.thumb))) * 1000) / 10,
  };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
  console.log('\n' + JSON.stringify(out, null, 2));
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
