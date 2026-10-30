/**
 * S7-e · the extra verdict for the phone-shaped fixtures in the VID-1 encoder
 * harness (tools/uishot/video-encode-harness.mjs). Pure; unit-tested in
 * src/__tests__/videoHarnessShape.test.ts.
 */

/** @param {{ manifest: { width: number, height: number, duration_s: number } }} r */
export function judgeShape(r, expect) {
  const reasons = [];
  if ((r.manifest.height > r.manifest.width) !== expect.portrait) reasons.push("orientation");
  if (Math.abs(r.manifest.duration_s - expect.seconds) > 0.5) reasons.push("length");
  return { ok: reasons.length === 0, reasons };
}
