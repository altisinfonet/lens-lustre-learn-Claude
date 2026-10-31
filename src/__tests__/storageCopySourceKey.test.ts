/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE SHARED READ/COPY HELPERS REFUSE BEFORE THEY REQUEST.
 *
 * copyS3Object carries its SOURCE key in the x-amz-copy-source header and its
 * DESTINATION key in the URL. Both are held to storageObjectUrl's check: a key
 * a URL parser would re-read is refused before any request is made, whichever
 * side of the copy it is on. readS3Object / readS3ObjectHead follow the same
 * rule for the key they read.
 *
 * Behavioural tests with a stubbed fetch: the assertion is on what reaches the
 * network, not on the source text.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { webcrypto } from "node:crypto";
import {
  copyS3Object,
  readS3Object,
  readS3ObjectHead,
  type S3Settings,
} from "../../supabase/functions/_shared/s3";

const S3: S3Settings = {
  enabled: true,
  bucket_name: "50mm-staging",
  region: "auto",
  access_key_id: "test-access-key-id",
  secret_access_key: "test-secret-access-key",
  endpoint: "https://acct0123.r2.cloudflarestorage.com",
};

const VALID_FROM = "post-images/u1/posts/1728712345678-abc.webp";
const VALID_TO = "post-images/u1/posts/1728712345678-abc-w1620h1080.webp";
const REREAD = ["a/../b", "a/./b", "../a", "a/..", "./a", "."];

function stubFetch(body = "<CopyObjectResult></CopyObjectResult>", status = 200) {
  // The signer needs WebCrypto; supply Node's if the test DOM does not.
  if (!globalThis.crypto?.subtle) vi.stubGlobal("crypto", webcrypto);
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(body, { status });
  });
  vi.stubGlobal("fetch", fn);
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("copyS3Object validates the SOURCE key, not only the destination", () => {
  for (const bad of REREAD) {
    it(`refuses source ${JSON.stringify(bad)} with no request made`, async () => {
      const calls = stubFetch();
      await expect(copyS3Object(S3, bad, VALID_TO)).rejects.toThrow(/storage key refused/);
      expect(calls).toHaveLength(0);
    });
  }

  for (const bad of REREAD) {
    it(`refuses destination ${JSON.stringify(bad)} with no request made`, async () => {
      const calls = stubFetch();
      await expect(copyS3Object(S3, VALID_FROM, bad)).rejects.toThrow(/storage key refused/);
      expect(calls).toHaveLength(0);
    });
  }

  it("a valid copy makes exactly one PUT: destination in the path, source in the header", async () => {
    const calls = stubFetch();
    await copyS3Object(S3, VALID_FROM, VALID_TO);
    expect(calls).toHaveLength(1);
    const { url, init } = calls[0];
    expect(init.method).toBe("PUT");
    expect(new URL(url).pathname).toBe(`/${S3.bucket_name}/${VALID_TO}`);
    const headers = init.headers as Record<string, string>;
    expect(headers["x-amz-copy-source"]).toBe(`/${S3.bucket_name}/${VALID_FROM}`);
    expect(headers.Authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=test-access-key-id\//);
  });
});

describe("readS3Object / readS3ObjectHead refuse a key the parser would re-read", () => {
  for (const bad of REREAD) {
    it(`readS3Object(${JSON.stringify(bad)}) — refused, no request`, async () => {
      const calls = stubFetch("bytes");
      await expect(readS3Object(S3, bad)).rejects.toThrow(/storage key refused/);
      expect(calls).toHaveLength(0);
    });

    it(`readS3ObjectHead(${JSON.stringify(bad)}) — refused, no request`, async () => {
      const calls = stubFetch("bytes", 206);
      await expect(readS3ObjectHead(S3, bad)).rejects.toThrow(/storage key refused/);
      expect(calls).toHaveLength(0);
    });
  }

  it("a valid read requests exactly /<bucket>/<key>", async () => {
    const calls = stubFetch("bytes");
    const out = await readS3Object(S3, VALID_FROM);
    expect(out).not.toBeNull();
    expect(calls).toHaveLength(1);
    expect(new URL(calls[0].url).pathname).toBe(`/${S3.bucket_name}/${VALID_FROM}`);
  });
});
