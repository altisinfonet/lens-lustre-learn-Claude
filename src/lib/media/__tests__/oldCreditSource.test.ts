/**
 * Review of #869, minor 7: the old-credit worker reads an old photo's CLEAN
 * original from its public URL. Two fences, here proven:
 *   - only THIS lane's hosts: its photo CDN (post-images/, avatars/) and its
 *     OWN Supabase project's public storage — never another project's;
 *   - never more than OLD_CREDIT_MAX_SOURCE_BYTES (40 MB): streamed with a
 *     byte limit, so an oversized file is skipped and reported, not loaded.
 */
import { describe, expect, it } from "vitest";
import { OLD_CREDIT_MAX_SOURCE_BYTES, laneSources, readCapped, sourceAllowed } from "../../../../tools/media-derivatives/old-credit-source.mjs";

const PROD = "https://www.50mmretina.com";
const STAGING = "https://staging.50mmretina.com";
const UID = "11111111-2222-4333-8444-555555555555";

describe("old-credit sources: this lane only", () => {
  it("production: its CDN and its own Supabase project", () => {
    expect(laneSources(PROD)).toEqual({ cdn: "cdn.50mmretina.com", supabaseRef: "jtdtehuqtinjxropkkcn" });
    expect(sourceAllowed(`https://cdn.50mmretina.com/post-images/${UID}/posts/1.webp`, PROD)).toBe(true);
    expect(sourceAllowed(`https://cdn.50mmretina.com/avatars/${UID}/photos/1.jpg`, PROD)).toBe(true);
    expect(sourceAllowed("https://jtdtehuqtinjxropkkcn.supabase.co/storage/v1/object/public/post-images/x/1.jpg", PROD)).toBe(true);
  });
  it("refuses another lane's host and another Supabase project", () => {
    expect(sourceAllowed(`https://cdn-staging.50mmretina.com/post-images/${UID}/posts/1.webp`, PROD)).toBe(false);
    expect(sourceAllowed("https://fpszggreishhuvdpkmdr.supabase.co/storage/v1/object/public/post-images/x/1.jpg", PROD)).toBe(false);
    expect(sourceAllowed("https://abcdefghijklmnopqrst.supabase.co/storage/v1/object/public/post-images/x/1.jpg", PROD)).toBe(false);
    expect(sourceAllowed("https://fpszggreishhuvdpkmdr.supabase.co/storage/v1/object/public/post-images/x/1.jpg", STAGING)).toBe(true);
    expect(sourceAllowed(`https://cdn.50mmretina.com/post-images/${UID}/../x.webp`, PROD)).toBe(false);
    expect(sourceAllowed("https://evil.example.com/post-images/x.webp", PROD)).toBe(false);
    expect(laneSources("https://example.com")).toBeNull();
  });
});

describe("old-credit sources: a byte limit while streaming", () => {
  const body = (n: number) => new Response(new Uint8Array(n));
  it("reads a file under the limit whole", async () => {
    const r = await readCapped(body(1000), 4000);
    expect(r.ok).toBe(true);
    expect(r.ok && r.bytes.length).toBe(1000);
  });
  it("stops at the limit and reports the file as too large (declared or not)", async () => {
    const declared = new Response(new Uint8Array(10), { headers: { "content-length": "99999999999" } });
    expect(await readCapped(declared, 4000)).toEqual({ ok: false, reason: "too large (declared 99999999999 bytes)" });
    const r = await readCapped(body(5000), 4000);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toMatch(/too large/);
  });
  it("the limit is 40 MB", () => {
    expect(OLD_CREDIT_MAX_SOURCE_BYTES).toBe(40 * 1024 * 1024);
  });
});
