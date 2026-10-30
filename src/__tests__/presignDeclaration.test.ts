// @vitest-environment node
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { signedPutHeaders, validateUploadDeclaration, UPLOAD_MAX_BYTES } from "../../supabase/functions/_shared/uploadDeclaration";

const ROOT = path.resolve(__dirname, "../..");

describe("S11 presigned photo PUT — the declared size and type are checked and SIGNED", () => {
  it("refuses an undeclared, zero, fractional or oversized size (before: 0 skipped the check)", () => {
    for (const s of [undefined, 0, -1, 1.5, "100", NaN]) expect(validateUploadDeclaration(s, "image/webp").ok).toBe(false);
    expect(validateUploadDeclaration(UPLOAD_MAX_BYTES + 1, "image/webp")).toMatchObject({ ok: false, status: 413 });
    expect(validateUploadDeclaration(UPLOAD_MAX_BYTES, "image/webp")).toMatchObject({ ok: true, size: UPLOAD_MAX_BYTES });
  });

  it("refuses types a browser could run as a page; keeps every type the app uploads", () => {
    for (const t of ["text/html", "application/xhtml+xml", "image/svg+xml", "text/xml", "application/javascript", "text/javascript", "application/x-msdownload"]) {
      expect(validateUploadDeclaration(10, t)).toMatchObject({ ok: false, status: 415 });
    }
    for (const t of ["image/webp", "image/jpeg", "image/png", "image/gif", "image/avif", "image/heic", "video/mp4", "video/quicktime", "audio/mpeg",
      "application/pdf", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/octet-stream"]) {
      expect(validateUploadDeclaration(10, t), t).toMatchObject({ ok: true, contentType: t });
    }
    expect(validateUploadDeclaration(10, "")).toMatchObject({ ok: true, contentType: "application/octet-stream" });
    // checked without regard to case, signed exactly as sent (trimmed): "image/JPEG" stays "image/JPEG"
    expect(validateUploadDeclaration(10, " image/JPEG ")).toMatchObject({ ok: true, contentType: "image/JPEG" });
    expect(validateUploadDeclaration(10, "TEXT/HTML")).toMatchObject({ ok: false, status: 415 });
    expect(validateUploadDeclaration(10, "image/svg+xml; charset=utf-8")).toMatchObject({ ok: false, status: 415 });
  });

  it("signs content-length, content-type and host, in SigV4 order", () => {
    const h = signedPutHeaders("abc.r2.cloudflarestorage.com", { size: 1234, contentType: "image/webp" });
    expect(h.signedHeaders).toBe("content-length;content-type;host");
    expect(h.canonicalHeaders).toBe("content-length:1234\ncontent-type:image/webp\nhost:abc.r2.cloudflarestorage.com\n");
  });

  it("s3-presign-upload validates both files and signs with those headers (no host-only signature left)", () => {
    const src = fs.readFileSync(path.join(ROOT, "supabase/functions/s3-presign-upload/index.ts"), "utf8");
    expect(src).toContain("validateUploadDeclaration(body.size, body.contentType)");
    expect(src).toContain('validateUploadDeclaration(pairObj.size, pairObj.contentType, "Pair file")');
    expect(src).toContain('"X-Amz-SignedHeaders": signedHeaders,');
    expect(src).not.toMatch(/"X-Amz-SignedHeaders":\s*"host"/);
    expect(src).not.toMatch(/size > 0 &&/);
  });

  it("the client sends the PUT with the same Content-Type it declared (so the signature matches)", () => {
    const up = fs.readFileSync(path.join(ROOT, "src/lib/s3Upload.ts"), "utf8");
    expect(up).toMatch(/headers: \{ "Content-Type": contentType \}/);
    expect(up).toMatch(/size: fullSize/);
  });
});
