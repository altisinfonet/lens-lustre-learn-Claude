/**
 * S7-e · the extra verdict for the phone-shaped fixtures in the VID-1 encoder
 * harness (tools/uishot/video-encode-harness.mjs). Pure; unit-tested in
 * src/__tests__/videoHarnessShape.test.ts.
 *
 * - orientation: held upright → a portrait package;
 * - length: EVERY media playlist of the OUTPUT sums (EXTINF) to the fixture's
 *   length ±0.5 s. manifest.duration_s is not used: it is the source's own
 *   video.duration (src/lib/video/webEncoder.ts), not a measurement;
 * - fixture: the bytes the page encoded are the bytes the harness served
 *   (sha256), so one phone file cannot pass in place of another.
 * Anything missing fails.
 */

export function playlistSeconds(text) {
  let total = 0;
  for (const m of String(text).matchAll(/^#EXTINF:([0-9]+(?:\.[0-9]+)?)/gm)) total += Number(m[1]);
  return total;
}

export function judgeShape(r, expect) {
  const reasons = [];
  if ((r.manifest.height > r.manifest.width) !== expect.portrait) reasons.push("orientation");
  const renditionSeconds = {};
  for (const [name, text] of Object.entries(r.playlists ?? {})) {
    if (name === "master.m3u8" || !/#EXTINF:/.test(text)) continue;
    renditionSeconds[name] = playlistSeconds(text);
  }
  const secs = Object.values(renditionSeconds);
  if (secs.length === 0 || secs.some((s) => Math.abs(s - expect.seconds) > 0.5)) reasons.push("length");
  const hex = /^[0-9a-f]{64}$/;
  if (!hex.test(r.sourceSha256 ?? "") || r.sourceSha256 !== r.fixtureSha256) reasons.push("fixture");
  return { ok: reasons.length === 0, reasons, renditionSeconds };
}
