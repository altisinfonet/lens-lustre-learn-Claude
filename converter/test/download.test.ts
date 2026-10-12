// @vitest-environment node
/**
 * Step 2 · the original, fetched with the ETag-pinned presigned GET (design
 * §3 step 4 [R6], review #417 finding 2): the signed If-Match sent exactly,
 * never more than the declared bytes written, ETag and size checked.
 */
import { describe, it, expect, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import { downloadSource, isStorageUrl } from "../src/download";
import { JobFailure } from "../src/failures";
import { ClaimStateStore } from "../src/state";
import { fakeServer, tempDir, type FakeServer } from "./helpers";

const BODY = Buffer.from("0123456789".repeat(1000)); // 10,000 bytes
const ETAG = "a1b2c3d4e5";
let server: FakeServer | null = null;
const dirs: string[] = [];
afterEach(async () => {
  await server?.close(); server = null;
  for (const d of dirs.splice(0)) await fs.rm(d, { recursive: true, force: true });
});

async function setup(handler: Parameters<FakeServer["on"]>[2]) {
  server = await fakeServer();
  server.on("GET", "/bucket/upload/source/s/source", handler);
  const dir = await tempDir();
  dirs.push(dir);
  return { file: path.join(dir, "source"), source: { url: `${server.url}/bucket/upload/source/s/source?X-Amz-Signature=x`, headers: { "if-match": `"${ETAG}"` }, bytes: BODY.length, expires_in: 600 } };
}
const job = { source_bytes: BODY.length, source_etag: ETAG };
const local = { allowUrl: () => true }; // the fake R2 is http://127.0.0.1
const codeOf = async (p: Promise<unknown>) => { try { await p; return "ok"; } catch (e) { return e instanceof JobFailure ? e.code : String(e); } };

describe("converter · downloading the original", () => {
  it("only R2's HTTPS endpoint is ever fetched (never the metadata service, localhost, plain http)", async () => {
    expect(isStorageUrl("https://0123abcd.r2.cloudflarestorage.com/bucket/upload/source/x/source?X-Amz-Signature=s")).toBe(true);
    for (const u of [
      "http://0123abcd.r2.cloudflarestorage.com/b/k", "https://169.254.169.254/opc/v2/instance/", "https://127.0.0.1/x",
      "https://r2.cloudflarestorage.com.evil.example/x", "https://u:p@a.r2.cloudflarestorage.com/x", "https://a.r2.cloudflarestorage.com:8443/x", "not a url",
    ]) expect(isStorageUrl(u), u).toBe(false);
    const { file, source } = await setup((_req, res) => { res.writeHead(200); res.end(BODY); });
    expect(await codeOf(downloadSource(job, source, file))).toBe("internal"); // the default rule refuses the local fake
    expect(server!.requests).toHaveLength(0);
  });

  it("sends the signed If-Match exactly and writes exactly the declared bytes", async () => {
    const { file, source } = await setup((req, res) => {
      res.writeHead(200, { etag: `"${ETAG}"`, "content-length": String(BODY.length) });
      res.end(BODY);
    });
    expect(await downloadSource(job, source, file, local)).toBe(BODY.length);
    expect(Buffer.compare(await fs.readFile(file), BODY)).toBe(0);
    expect(server!.requests[0].headers["if-match"]).toBe(`"${ETAG}"`);
    expect(server!.requests[0].headers["accept-encoding"]).toBe("identity");
  });

  it("a different ETag, or a different size, is source_missing (the original changed)", async () => {
    let s = await setup((_req, res) => { res.writeHead(200, { etag: '"other"', "content-length": String(BODY.length) }); res.end(BODY); });
    expect(await codeOf(downloadSource(job, s.source, s.file, local))).toBe("source_missing");
    await server!.close();
    s = await setup((_req, res) => { res.writeHead(200, { etag: `"${ETAG}"`, "content-length": String(BODY.length + 1) }); res.end(Buffer.concat([BODY, Buffer.from("x")])); });
    expect(await codeOf(downloadSource(job, s.source, s.file, local))).toBe("source_missing");
  });

  it("412 (If-Match failed) and 404 are source_missing; 403 (our signature / clock) is internal", async () => {
    for (const [status, code] of [[412, "source_missing"], [404, "source_missing"], [403, "internal"], [500, "internal"]] as const) {
      const s = await setup((_req, res) => { res.writeHead(status); res.end(); });
      expect(await codeOf(downloadSource(job, s.source, s.file, local)), String(status)).toBe(code);
      await server!.close();
      server = null;
    }
  });

  it("without a Content-Length: stops at the declared count and notices there was more", async () => {
    const { file, source } = await setup((_req, res) => {
      res.writeHead(200, { etag: `"${ETAG}"`, "transfer-encoding": "chunked" });
      res.write(BODY);
      res.end(Buffer.from("extra"));
    });
    expect(await codeOf(downloadSource(job, source, file, local))).toBe("source_missing");
    expect((await fs.stat(file)).size).toBe(BODY.length); // never more than declared on disk
  });

  it("a shorter body without a Content-Length is source_missing; a stalled download is internal", async () => {
    let s = await setup((_req, res) => { res.writeHead(200, { etag: `"${ETAG}"`, "transfer-encoding": "chunked" }); res.end(BODY.subarray(0, 100)); });
    expect(await codeOf(downloadSource(job, s.source, s.file, local))).toBe("source_missing");
    await server!.close();
    s = await setup((_req, res) => { res.writeHead(200, { etag: `"${ETAG}"`, "content-length": String(BODY.length) }); res.write(BODY.subarray(0, 10)); /* then nothing */ });
    expect(await codeOf(downloadSource(job, s.source, s.file, { ...local, idleMs: 200 }))).toBe("internal");
  });
});

describe("converter · the claim on disk", () => {
  it("save → load → clear; an unreadable file counts as none", async () => {
    const d = await tempDir();
    dirs.push(d);
    const store = new ClaimStateStore(path.join(d, "state", "claim.json"));
    expect(await store.load()).toBeNull();
    const s = { source_id: "55555555-5555-4555-8555-555555555555", claim_token: "66666666-6666-4666-8666-666666666666", claimed_at: "2026-10-12T00:00:00Z" };
    await store.save(s);
    expect(await store.load()).toEqual(s);
    if (process.platform !== "win32") expect((await fs.stat(path.join(d, "state", "claim.json"))).mode & 0o777).toBe(0o600);
    await store.clear();
    expect(await store.load()).toBeNull();
    await fs.writeFile(path.join(d, "state", "claim.json"), "{nope");
    expect(await store.load()).toBeNull();
  });
});
