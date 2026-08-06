/**
 * THE STALE FILE HANDLE RECOVERY, PINNED.
 *
 * Owner report, 2026-08-06: *"people are not able to post for this error"* —
 * `Failed to create post — non-Error thrown: {"isTrusted":true}`.
 *
 * Measured in production (client_errors) before writing any of this:
 *   * 26 recorded post failures. EVERY ONE platform = "app". None from web.
 *   * Two real members; 23 attempts by one of them in a single morning, the
 *     last at the exact minute of the owner's screenshot.
 *   * The file HAD been read successfully at selection — the composer
 *     thumbnail cannot render otherwise — and then refused to be read again
 *     at Post.
 *
 * The recovery: rebuild the File from the preview taken when the read worked.
 * These tests cover the conversion itself, because getting the bytes wrong
 * would upload a corrupt photograph — a worse failure than the one being fixed.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { fileFromDataUrl, isRebuildableDataUrl } from "@/lib/fileFromDataUrl";

/** A 1×1 transparent PNG — real bytes, not a made-up string. */
const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const PNG_DATA_URL = `data:image/png;base64,${PNG_B64}`;

describe("rebuilding a file the device will not re-read", () => {
  /**
   * Read it back the way the app does — FileReader.readAsArrayBuffer, which is
   * exactly what the security scanner uses. If the rebuilt file cannot be read
   * by that, the recovery is worthless no matter how right the bytes look.
   */
  const readBytes = (file: File) =>
    new Promise<Uint8Array>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
      reader.onerror = () => reject(reader.error ?? new Error("read failed"));
      reader.readAsArrayBuffer(file);
    });

  it("round-trips the exact bytes, not a corrupted copy", async () => {
    const file = fileFromDataUrl(PNG_DATA_URL, "photo.png");
    const bytes = await readBytes(file);
    const expected = Uint8Array.from(atob(PNG_B64), (c) => c.charCodeAt(0));

    expect(bytes.length).toBe(expected.length);
    expect(Array.from(bytes)).toEqual(Array.from(expected));

    // The PNG magic bytes must survive — the security scanner checks exactly
    // these, and a mangled header would be rejected as an unsupported format.
    expect(Array.from(bytes.slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it("keeps the name and the MIME type", () => {
    const file = fileFromDataUrl(PNG_DATA_URL, "sunset.png");
    expect(file.name).toBe("sunset.png");
    expect(file.type).toBe("image/png");
    expect(file.size).toBeGreaterThan(0);
  });

  it("falls back to the original type when the data URL carries none", () => {
    const file = fileFromDataUrl(`data:;base64,${PNG_B64}`, "x.png", "image/jpeg");
    expect(file.type).toBe("image/jpeg");
  });

  it("refuses anything that is not a data URL", () => {
    // A cropped photo's preview can be an object URL. Decoding one would
    // produce garbage bytes, so it must throw rather than guess.
    expect(isRebuildableDataUrl("blob:https://www.50mmretina.com/abc-123")).toBe(false);
    expect(isRebuildableDataUrl("https://cdn.50mmretina.com/a.jpg")).toBe(false);
    expect(isRebuildableDataUrl(null)).toBe(false);
    expect(isRebuildableDataUrl(undefined)).toBe(false);
    expect(isRebuildableDataUrl(PNG_DATA_URL)).toBe(true);
    expect(() => fileFromDataUrl("blob:whatever", "x.png")).toThrow();
  });
});

describe("the composer actually uses the rebuilt file", () => {
  const wallPosts = () =>
    readFileSync(join(__dirname, "..", "..", "components", "WallPosts.tsx"), "utf8")
      .replace(/^\s*\/\*[\s\S]*?\*\//gm, "")
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
      .replace(/^\s*\/\/.*$/gm, "");

  it("uploads the recovered photo, never the stale handle", () => {
    const code = wallPosts();
    // If this regresses to selectedImages[i], the upload re-reads the very
    // handle that just failed the scan — and the fix does nothing.
    expect(code, "the upload must use the recovered file").toMatch(/file:\s*photo,/);
    expect(code).not.toMatch(/file:\s*selectedImages\[i\],/);
  });

  it("records the recovery so a worsening platform is visible", () => {
    const code = wallPosts();
    expect(code).toContain("FILE-5009");
    expect(code).toContain("PHOTO_REBUILT_AFTER_STALE_HANDLE");
    // The original exception must be preserved — it is the only evidence of
    // WHY the handle went stale.
    expect(code).toMatch(/reason:\s*readErr instanceof Error/);
  });

  it("only recovers once — a second failure must surface", () => {
    const code = wallPosts();
    // Two scan calls: the original attempt and exactly one retry. A loop here
    // would hide a genuine problem behind endless retries.
    const scans = code.match(/scanFileWithToast\(/g) || [];
    expect(scans.length).toBe(2);
  });

  it("keeps the catch as a safety net for when caching itself failed", () => {
    const code = wallPosts();
    // The PRIMARY conversion now happens at selection (see the read-once suite
    // below), so this catch should normally never fire. It is not dead code:
    // processFile falls back to the original File if the conversion throws, and
    // this is the only thing standing behind that fallback.
    const inCatch = code.match(/catch\s*\(readErr\)\s*\{[\s\S]*?fileFromDataUrl\(/);
    expect(inCatch, "the post-time recovery must remain").toBeTruthy();
  });
});

describe("read once: the cached bytes survive what a file handle does not", () => {
  /**
   * WHAT THESE CAN AND CANNOT COVER — stated plainly.
   *
   * The owner asked for tests covering delayed uploads, app background/resume,
   * device rotation and repeated uploads. Backgrounding and rotation are native
   * Android WebView lifecycle events; jsdom cannot produce them, and a test that
   * claimed to would be a lie.
   *
   * What every one of those events threatens is a single invariant: that the
   * thing we hold can stop being readable. So that is what is tested here —
   * a cached File is bytes, not a reference, and no elapsed time, no repetition
   * and no failure of the ORIGINAL handle can take it away.
   *
   * Verifying the real lifecycle events needs a device and build 1054.
   */

  const readBytes = (file: File) =>
    new Promise<Uint8Array>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
      reader.onerror = () => reject(reader.error ?? new Error("read failed"));
      reader.readAsArrayBuffer(file);
    });

  it("survives a long delay — a slow upload cannot invalidate it", async () => {
    const cached = fileFromDataUrl(PNG_DATA_URL, "delayed.png");
    const before = await readBytes(cached);
    await new Promise((r) => setTimeout(r, 60));
    const after = await readBytes(cached);
    expect(Array.from(after)).toEqual(Array.from(before));
  });

  it("survives repeated reads — scan, compress, thumbnail, upload", async () => {
    const cached = fileFromDataUrl(PNG_DATA_URL, "repeat.png");
    const first = await readBytes(cached);
    // The old pipeline read the original handle up to five times. Prove the
    // cached copy answers identically every time.
    for (let i = 0; i < 5; i++) {
      const again = await readBytes(cached);
      expect(Array.from(again), `read ${i + 2} differed`).toEqual(Array.from(first));
    }
  });

  it("is independent of the original handle — the invariant rotation and backgrounding threaten", async () => {
    // Stand in for a picked-file reference the platform has invalidated: reading
    // it throws. This is the shape of the failure seen in production.
    const deadHandle = {
      name: "gone.png",
      type: "image/png",
      size: 999,
      slice: () => { throw new DOMException("The requested file could not be read", "NotReadableError"); },
    } as unknown as File;

    await expect(readBytes(deadHandle)).rejects.toBeTruthy();

    // The cached copy, taken while the read still worked, is unaffected.
    const cached = fileFromDataUrl(PNG_DATA_URL, deadHandle.name, deadHandle.type);
    const bytes = await readBytes(cached);
    expect(bytes.length).toBeGreaterThan(0);
    expect(Array.from(bytes.slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it("the composer caches at selection, not at post time", () => {
    const code = readFileSync(
      join(__dirname, "..", "..", "components", "WallPosts.tsx"), "utf8",
    ).replace(/^\s*\/\*[\s\S]*?\*\//gm, "").replace(/^\s*\/\/.*$/gm, "");
    // The conversion must happen where the read already succeeded — inside the
    // selection handler — so nothing downstream ever touches the handle.
    expect(code).toMatch(/stable = fileFromDataUrl\(dataUrl/);
    expect(code, "the cached file must be what is stored").toMatch(/setSelectedImages\(prev => \[\.\.\.prev, stable\]\)/);
  });

  it("every upload log carries the stage and the device", () => {
    const code = readFileSync(
      join(__dirname, "..", "..", "components", "WallPosts.tsx"), "utf8",
    );
    // Owner instruction: stage, app build, Android version, device.
    expect((code.match(/\.\.\.deviceContext\(\)/g) || []).length).toBeGreaterThanOrEqual(4);
    for (const stage of ['stage: "security-scan"', 'stage: "upload"', 'stage: "pipeline"']) {
      expect(code, `missing ${stage}`).toContain(stage);
    }
  });
});
