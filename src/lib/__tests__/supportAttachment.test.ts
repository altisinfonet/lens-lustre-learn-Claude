/**
 * S11 uploads · support attachments.
 *
 * Two defects this pins:
 *   1. The reply paperclip on HelpSupport (members) and AdminSupportTickets
 *      offered only JPEG + documents in the picker, while the first-message
 *      drop zone and the scanner accept PNG/WebP/GIF — a phone screenshot
 *      (PNG) could start a ticket but never be attached to a reply.
 *   2. Reply attachments went straight to storage with no GPS guard, while the
 *      drop zone runs guardOriginalUpload on every raw image.
 * The picker list and the scanner list now come from one function, and every
 * support attachment goes through one preparation step.
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const { guard, CLEAN } = vi.hoisted(() => {
  const CLEAN = { name: "guarded copy" } as unknown as File;
  return { CLEAN, guard: vi.fn(async (_f: File) => CLEAN) };
});
vi.mock("@/lib/gpsGuard", async (orig) => ({ ...(await orig<typeof import("@/lib/gpsGuard")>()), guardOriginalUpload: (f: File) => guard(f) }));

import { acceptAttributeFor, allowedMimesFor, scanFile, type AllowedFileType } from "@/lib/fileSecurityScanner";
import { prepareSupportAttachment } from "@/lib/supportAttachment";

// jsdom decodes no images: the scanner's decode check gets a stand-in that "decodes" anything.
beforeAll(() => {
  URL.createObjectURL = () => "blob:test";
  URL.revokeObjectURL = () => {};
  vi.stubGlobal("Image", class {
    naturalWidth = 10; naturalHeight = 10; onload: (() => void) | null = null; onerror: (() => void) | null = null;
    set src(_: string) { queueMicrotask(() => this.onload?.()); }
  });
});

const TYPES: AllowedFileType[] = ["image", "pdf", "image+pdf", "document", "image+pdf+document"];
const MAGIC: Record<string, number[]> = {
  "image/jpeg": [0xff, 0xd8, 0xff, 0xe0], "image/png": [0x89, 0x50, 0x4e, 0x47],
  "image/gif": [0x47, 0x49, 0x46, 0x38], "image/webp": [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50],
  "application/pdf": [0x25, 0x50, 0x44, 0x46],
};
const file = (name: string, type: string, head = MAGIC[type] ?? [1, 2, 3, 4]) =>
  new File([new Uint8Array([...head, ...new Array(64).fill(0x20)])], name, { type });

describe("one list: the picker offers exactly what the scanner accepts", () => {
  it.each(TYPES)("%s: accept attribute == scanner allow-list", (t) => {
    expect(acceptAttributeFor(t).split(",")).toEqual(allowedMimesFor(t));
  });
  it("support replies (image+pdf+document) offer PNG, WebP and GIF screenshots", async () => {
    const accept = acceptAttributeFor("image+pdf+document").split(",");
    for (const m of ["image/png", "image/webp", "image/gif", "image/jpeg", "application/pdf"]) expect(accept).toContain(m);
    expect((await scanFile(file("shot.png", "image/png"), { allowedTypes: "image+pdf+document" })).safe).toBe(true);
  });
  it("never offers SVG (a document that runs script)", () => {
    for (const t of TYPES) expect(acceptAttributeFor(t)).not.toMatch(/svg/);
  });
  it("no picker in the support pages or the drop zone hard-codes its own list", () => {
    for (const f of ["src/pages/HelpSupport.tsx", "src/components/admin/AdminSupportTickets.tsx", "src/components/FileUploadDropZone.tsx"]) {
      const src = readFileSync(join(process.cwd(), f), "utf8");
      expect(src, f).not.toMatch(/accept="[^"*]*(image|application)\/[a-z]/);
      expect(src, f).not.toMatch(/ACCEPT_MAP/);
    }
  });
});

describe("every support attachment is scanned and GPS-guarded before upload", () => {
  beforeEach(() => guard.mockClear());

  it("a JPEG goes through the GPS guard and the GUARDED file is what comes back", async () => {
    const out = await prepareSupportAttachment(file("p.jpg", "image/jpeg"), "image+pdf+document");
    expect(guard).toHaveBeenCalledTimes(1);
    expect(guard.mock.calls[0][0].name).toBe("p.jpg");
    expect(out.ok && out.file).toBe(CLEAN);
  });
  it("an image with no type (some Android pickers) but an image name is guarded too", async () => {
    await prepareSupportAttachment(file("p.jpg", "", MAGIC["image/jpeg"]), "image+pdf");
    expect(guard).toHaveBeenCalledTimes(1);
  });
  it.each([
    ["application/octet-stream", "p.jpg", "image+pdf"],
    ["application/msword", "p.doc", "image+pdf+document"],
    ["application/vnd.ms-excel", "P.XLS", "image+pdf+document"],
  ] as const)("a JPEG labelled %s (%s) is still guarded — mislabelling cannot skip it", async (type, name, kind) => {
    await prepareSupportAttachment(file(name, type, MAGIC["image/jpeg"]), kind);
    expect(guard).toHaveBeenCalledTimes(1);
  });
  it("an Office document with Office bytes is not guarded", async () => {
    const doc = file("r.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", [0x50, 0x4b, 0x03, 0x04]);
    const out = await prepareSupportAttachment(doc, "image+pdf+document");
    expect(guard).not.toHaveBeenCalled();
    expect(out.ok && out.file).toBe(doc);
  });
  it("a PDF is not an image: scanned, not guarded, returned as is", async () => {
    const pdf = file("a.pdf", "application/pdf");
    const out = await prepareSupportAttachment(pdf, "image+pdf");
    expect(guard).not.toHaveBeenCalled();
    expect(out.ok && out.file).toBe(pdf);
  });
  it("a refused scan never reaches the guard", async () => {
    const out = await prepareSupportAttachment(file("x.exe", "application/x-msdownload"), "image+pdf");
    expect(out.ok).toBe(false);
    expect(guard).not.toHaveBeenCalled();
  });
  it("the guard's refusal is returned as the member-readable reason, not thrown", async () => {
    const { GpsPrivacyError, GPS_REFUSAL_MESSAGE } = await import("@/lib/gpsGuard");
    guard.mockRejectedValueOnce(new GpsPrivacyError(GPS_REFUSAL_MESSAGE));
    const out = await prepareSupportAttachment(file("p.png", "image/png"), "image+pdf+document");
    expect(out).toEqual({ ok: false, reason: GPS_REFUSAL_MESSAGE, gps: true });
    expect(out.file).toBeUndefined();
  });
  it("the drop zone (a ticket's first message) decides 'image' by type, name or bytes too", async () => {
    const src = readFileSync(join(process.cwd(), "src/components/FileUploadDropZone.tsx"), "utf8");
    expect(src).toMatch(/const isImage = await looksLikeImage\(file\);/);
    const { looksLikeImage } = await import("@/lib/fileSecurityScanner");
    expect(await looksLikeImage(file("p.bin", "application/octet-stream", MAGIC["image/jpeg"]))).toBe(true);
    expect(await looksLikeImage(file("a.pdf", "application/pdf"))).toBe(false);
  });
  it("both support pages upload only what prepareSupportAttachment returned", () => {
    for (const f of ["src/pages/HelpSupport.tsx", "src/components/admin/AdminSupportTickets.tsx"]) {
      const src = readFileSync(join(process.cwd(), f), "utf8");
      expect(src, f).toMatch(/await prepareSupportAttachment\(file, "image\+pdf(\+document)?"\)/);
      expect(src, f).toMatch(/uploadImage\(\{ bucket: "support-attachments", file: prepared\.file,/);
      expect(src, f).not.toMatch(/uploadImage\(\{ bucket: "support-attachments", file,/);
    }
  });
});
