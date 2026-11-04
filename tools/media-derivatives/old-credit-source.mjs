/**
 * Where the old-credit worker may read an old photo's CLEAN original, and how
 * much of it (review of #869, minor 7). Used by old-credit.mjs; tested by
 * src/lib/media/__tests__/oldCreditSource.test.ts.
 *
 *   laneSources(site)        the lane fixed by the site the worker talks to:
 *                            its photo CDN and its OWN Supabase project ref
 *   sourceAllowed(url, site) only that CDN's post-images/ or avatars/, or that
 *                            project's public storage — never another lane's,
 *                            never another Supabase project, never `..`
 *   readCapped(res, max)     the body, streamed, stopping at `max` bytes: a
 *                            larger file is skipped and reported, never loaded
 * (The SQL classes old photos the same way since 20261110_0110.)
 */

/** 40 MB: far above any phone photo; a larger "photo" is not read into memory. */
export const OLD_CREDIT_MAX_SOURCE_BYTES = 40 * 1024 * 1024;

const LANES = {
  "https://www.50mmretina.com": { cdn: "cdn.50mmretina.com", supabaseRef: "jtdtehuqtinjxropkkcn" },
  "https://staging.50mmretina.com": { cdn: "cdn-staging.50mmretina.com", supabaseRef: "fpszggreishhuvdpkmdr" },
};

export function laneSources(site) {
  return LANES[String(site).replace(/\/+$/, "")] ?? null;
}

export function sourceAllowed(url, site) {
  const lane = laneSources(site);
  if (!lane || typeof url !== "string" || url.includes("..")) return false;
  return url.startsWith(`https://${lane.cdn}/post-images/`)
    || url.startsWith(`https://${lane.cdn}/avatars/`)
    || url.startsWith(`https://${lane.supabaseRef}.supabase.co/storage/v1/object/public/`);
}

/** @returns {Promise<{ok: true, bytes: Uint8Array} | {ok: false, reason: string}>} */
export async function readCapped(res, max = OLD_CREDIT_MAX_SOURCE_BYTES) {
  const declared = Number(res.headers.get("content-length") ?? "0");
  if (declared > max) {
    try { await res.body?.cancel(); } catch { /* nothing to cancel */ }
    return { ok: false, reason: `too large (declared ${declared} bytes)` };
  }
  if (!res.body) return { ok: true, bytes: new Uint8Array(await res.arrayBuffer()) };
  const reader = res.body.getReader();
  const parts = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      try { await reader.cancel(); } catch { /* already closed */ }
      return { ok: false, reason: `too large (over ${max} bytes)` };
    }
    parts.push(value);
  }
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const p of parts) { bytes.set(p, at); at += p.byteLength; }
  return { ok: true, bytes };
}
