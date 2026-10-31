/**
 * THE ENCODE-FAILURE FALLBACK MUST NOT PUBLISH A MEMBER'S LOCATION.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Context (EXIF audit, 2026-08-14): every successful upload is canvas-re-
 * encoded, which strips metadata as a side effect. The ONLY files that reach
 * the public CDN with metadata intact are exactly the ones the encoder fails
 * on — the old fallback uploaded them untouched (`fullResFile = file`),
 * GPS and all. Realistic trigger: iPhone HEIC in a browser without HEIC.
 *
 * Two layers here:
 *   1. REAL byte-level tests of the JPEG splice on synthetic JPEGs — not
 *      source-grep. The splice is the security boundary; it gets behavioural
 *      coverage.
 *   2. Source assertions that the fallback actually CALLS the guard — because
 *      a perfect guard that nothing calls is trap #11, and this program has
 *      now hit that trap twice.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { stripJpegMetadata } from "@/lib/gpsGuard";

/** Build a minimal, structurally valid JPEG: SOI + given segments + SOS + data. */
function seg(marker: number, payload: number[]): number[] {
  const len = payload.length + 2;
  return [0xff, marker, (len >> 8) & 0xff, len & 0xff, ...payload];
}
const SOI = [0xff, 0xd8];
const APP1_EXIF = seg(0xe1, [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, 0x01, 0x02, 0x03]); // "Exif\0\0"+bytes
const APP13 = seg(0xed, [0x50, 0x68, 0x6f, 0x74]); // IPTC-ish
const COM = seg(0xfe, [0x68, 0x69]); // comment "hi"
const DQT = seg(0xdb, [0x00, 0x10, 0x20, 0x30]); // required decode table (kept)
const SOFAKE = seg(0xc0, [0x08, 0x00, 0x10, 0x00, 0x10, 0x01, 0x11, 0x00]); // frame header (kept)
const SOS_AND_DATA = [0xff, 0xda, 0x00, 0x04, 0x01, 0x02, /* entropy data: */ 0xaa, 0xbb, 0xff, 0x00, 0xcc, 0xff, 0xd9];

const jpeg = (...parts: number[][]) => new Uint8Array(parts.flat());
const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");

describe("stripJpegMetadata — the security boundary, tested on bytes", () => {
  it("removes APPn and COM segments, keeps decode tables, frame header, and image data verbatim", () => {
    const input = jpeg(SOI, APP1_EXIF, DQT, APP13, SOFAKE, COM, SOS_AND_DATA);
    const out = stripJpegMetadata(input);
    const expected = jpeg(SOI, DQT, SOFAKE, SOS_AND_DATA);
    expect(hex(out)).toBe(hex(expected));
  });

  it("copies everything from SOS verbatim — 0xFF bytes inside entropy data are not parsed as markers", () => {
    const input = jpeg(SOI, DQT, SOS_AND_DATA);
    const out = stripJpegMetadata(input);
    expect(hex(out)).toBe(hex(input)); // nothing to strip; byte-identical incl. FF 00 stuffing
  });

  it("a metadata-only difference collapses to identical output", () => {
    const withMeta = stripJpegMetadata(jpeg(SOI, APP1_EXIF, COM, DQT, SOS_AND_DATA));
    const without = stripJpegMetadata(jpeg(SOI, DQT, SOS_AND_DATA));
    expect(hex(withMeta)).toBe(hex(without));
  });

  it("never truncates a malformed tail — pixels beat prettiness", () => {
    const malformed = new Uint8Array([...SOI, 0x00, 0x01, 0x02]); // garbage after SOI
    const out = stripJpegMetadata(malformed);
    expect(hex(out)).toBe(hex(malformed));
  });
});

describe("the guard is actually wired in (trap #11 — twice bitten)", () => {
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const upload = strip(readFileSync(join(process.cwd(), "src/lib/imageUpload.ts"), "utf8"));
  const guard = strip(readFileSync(join(process.cwd(), "src/lib/gpsGuard.ts"), "utf8"));

  it("the encode-failure fallback calls guardOriginalUpload, not `fullResFile = file`", () => {
    expect(
      /fullResFile\s*=\s*await\s+guardOriginalUpload\(file\)/.test(upload),
      "The fallback no longer routes through the GPS guard — originals with " +
        "location data upload untouched to the public CDN again.",
    ).toBe(true);
    expect(
      /fullResFile\s*=\s*file\s*;/.test(upload),
      "The ungated assignment `fullResFile = file` is back. That line IS the leak.",
    ).toBe(false);
  });

  it("the dropzone's RAW path (compressImages=false + compression-failure) is gated too", () => {
    // Second raw-upload surface (EXIF pass, 2026-08-14): FileUploadDropZone
    // serves AdminSEO (PUBLIC site-assets) and HelpSupport raw uploads. The
    // gate must sit in the RAW branch, before uploadImage — a file-wide grep
    // would pass on the import alone (loose-anchor lesson), so anchor on the
    // branch's own lines.
    const dz = strip(readFileSync(join(process.cwd(), "src/components/FileUploadDropZone.tsx"), "utf8"));
    expect(
      /if \(isImage\) toStore = await guardOriginalUpload\(file\);/.test(dz),
      "The dropzone raw path no longer routes images through the GPS guard — " +
        "AdminSEO raw uploads reach the PUBLIC site-assets bucket with " +
        "location metadata intact.",
    ).toBe(true);
    expect(
      /uploadImage\(\{ bucket, file: toStore,/.test(dz),
      "toStore is computed but the raw upload sends something else — the " +
        "guarded file is thrown away.",
    ).toBe(true);
  });

  it("the guard fails CLOSED: a GPS-carrying non-JPEG is refused, not uploaded", () => {
    // ⚠ Mutation G4 ESCAPED the first version of this assertion: it checked
    // that a GpsPrivacyError throw exists ANYWHERE, and the verify-path throw
    // satisfied it while the non-JPEG branch quietly returned the file.
    // Anchor on the branch itself: the code between `if (!isJpeg(bytes))` and
    // the strip must throw, and must not return the file.
    const at = guard.indexOf("if (!isJpeg(bytes))");
    expect(at, "the non-JPEG branch is gone entirely").toBeGreaterThan(-1);
    const branch = guard.slice(at, guard.indexOf("stripJpegMetadata(bytes)", at));
    expect(
      /throw new GpsPrivacyError\(GPS_REFUSAL_MESSAGE\)/.test(branch),
      "The non-JPEG branch does not throw — an unstrippable GPS file falls " +
        "through to upload with the member's location.",
    ).toBe(true);
    expect(
      /return\s+file\s*;/.test(branch),
      "The non-JPEG branch returns the original file — that IS the leak.",
    ).toBe(false);
  });

  it("an unreadable file is treated as GPS-present, not GPS-free", () => {
    // The catch around exifr.gps must set hasGps = true. Fail-open here means
    // 'we could not check, so assume clean' — precisely backwards for a
    // public CDN.
    const m = guard.match(/catch\s*\{([\s\S]{0,400}?)\}/);
    expect(m, "no catch around the GPS probe").toBeTruthy();
    expect(
      /hasGps\s*=\s*true/.test(m![1]),
      "exifr failure is treated as 'clean'. Unprovable files must fail closed.",
    ).toBe(true);
  });

  it("the strip is verified before the file is released", () => {
    expect(
      /GPS_STRIP_VERIFY_FAILED/.test(guard),
      "Nothing re-checks the stripped copy — a splice bug would upload GPS " +
        "while logging success.",
    ).toBe(true);
  });
});
