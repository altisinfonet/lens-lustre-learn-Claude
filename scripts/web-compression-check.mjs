#!/usr/bin/env node
/**
 * P15 — BROTLI OR GZIP ON EVERY TEXT RESPONSE, MEASURED BY FETCH.
 *
 * Gate (docs/gates/GATE_REGISTER.md, P15, verbatim):
 *   "Brotli or gzip confirmed active on every text response, measured,
 *    recorded once."
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT "EVERY TEXT RESPONSE" MEANS HERE, and how the list is built rather than
 * typed:
 *   1. the document itself (`/`) and one SPA deep link (served by the same
 *      Pages fallback, but it is the response a shared link actually gets);
 *   2. every `/assets/*.js|css` the entry document references, PLUS every
 *      `assets/*.js|css` name found inside the fetched JS — Vite writes each
 *      lazy route chunk's file name into the chunk that imports it, so walking
 *      the JS to a fixed point finds every chunk the app can ever load, not
 *      only the ones on the first page;
 *   3. every text file `public/` ships (robots.txt, sitemap.xml, llms.txt,
 *      manifest.json, *.svg, the service-worker script) — read from the
 *      repository, so a new public text file is checked without editing this;
 *   4. the Pages Functions that answer with text: `/config/site-settings`
 *      (P4) and one `/page/<slug>` — marked ABSENT, never PASS, when the
 *      origin answers them with the SPA fallback instead.
 *
 * HOW. `curl` with `accept-encoding: br, gzip`, NOT `--compressed`, so the
 * bytes counted are the bytes on the wire; then the body is decoded here with
 * zlib to get the uncompressed size. curl, not Node's fetch, because fetch
 * decodes transparently and hides the wire size — and because curl honours
 * the environment's proxy the same way in CI and in a container.
 *
 * VERDICT per response: PASS when `content-encoding` is `br` or `gzip` and
 * the body decodes; FAIL when a text response arrives identity-encoded. A
 * response whose decoded body is under MIN_BYTES is reported as `tiny` and
 * not failed — no CDN compresses a 30-byte body and gzip would make it larger;
 * that exemption is printed, never silent. Non-200 responses are FAIL: a 404
 * on a chunk the app references is a finding of its own.
 *
 * C-34: `--self-test` drives `classify()` with every header shape it must
 * accept and reject. The pure function is exported for the vitest test too.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   node scripts/web-compression-check.mjs https://staging.50mmretina.com [--json out.json]
 *   node scripts/web-compression-check.mjs --self-test
 */
import { execFileSync } from "node:child_process";
import { readdirSync, statSync, writeFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import zlib from "node:zlib";

export const MIN_BYTES = 1024;
const TEXT_TYPE = /^(text\/|application\/(javascript|json|manifest\+json|xml|ld\+json|x-javascript)|image\/svg\+xml)/i;
const PUBLIC_TEXT = /\.(txt|xml|json|svg|js|css|html|webmanifest)$/i;

/** Pure verdict for one response. */
export function classify({ status, contentType, contentEncoding, decodedBytes }) {
  const type = (contentType || "").split(";")[0].trim().toLowerCase();
  const enc = (contentEncoding || "").trim().toLowerCase();
  if (status !== 200) return { verdict: "FAIL", reason: `status ${status}` };
  if (!TEXT_TYPE.test(type)) return { verdict: "SKIP", reason: `not text (${type || "no content-type"})` };
  if (enc === "br" || enc === "gzip") return { verdict: "PASS", reason: enc };
  if (decodedBytes < MIN_BYTES) return { verdict: "TINY", reason: `identity, ${decodedBytes} B < ${MIN_BYTES} B` };
  return { verdict: "FAIL", reason: `identity-encoded text, ${decodedBytes} B` };
}

export const SELF_TEST = [
  { name: "js br", in: { status: 200, contentType: "application/javascript", contentEncoding: "br", decodedBytes: 90000 }, want: "PASS" },
  { name: "css gzip", in: { status: 200, contentType: "text/css; charset=utf-8", contentEncoding: "gzip", decodedBytes: 9000 }, want: "PASS" },
  { name: "html identity, large", in: { status: 200, contentType: "text/html", contentEncoding: "", decodedBytes: 5000 }, want: "FAIL" },
  { name: "json identity, large", in: { status: 200, contentType: "application/json", contentEncoding: undefined, decodedBytes: 3000 }, want: "FAIL" },
  { name: "svg identity, large", in: { status: 200, contentType: "image/svg+xml", contentEncoding: "identity", decodedBytes: 4000 }, want: "FAIL" },
  { name: "deflate is not accepted", in: { status: 200, contentType: "text/javascript", contentEncoding: "deflate", decodedBytes: 4000 }, want: "FAIL" },
  { name: "tiny text", in: { status: 200, contentType: "text/plain", contentEncoding: "", decodedBytes: 40 }, want: "TINY" },
  { name: "chunk 404", in: { status: 404, contentType: "text/html", contentEncoding: "br", decodedBytes: 900 }, want: "FAIL" },
  { name: "png is not text", in: { status: 200, contentType: "image/png", contentEncoding: "", decodedBytes: 90000 }, want: "SKIP" },
];

export function selfTest() {
  return SELF_TEST.filter((c) => classify(c.in).verdict !== c.want).map(
    (c) => `${c.name}: want ${c.want}, got ${classify(c.in).verdict}`,
  );
}

function fetchRaw(url, dir) {
  const body = join(dir, "b");
  const hdr = join(dir, "h");
  const out = execFileSync(
    "curl",
    ["-sS", "-o", body, "-D", hdr, "-H", "accept-encoding: br, gzip", "-H", "user-agent: 50mm-p15-compression-check",
      "-w", "%{http_code} %{size_download}", "--max-time", "30", url],
    { encoding: "utf8" },
  ).trim();
  const [code, wire] = out.split(" ").map(Number);
  // Keep only the LAST header block (proxies and 103 Early Hints add earlier ones).
  const blocks = readFileSync(hdr, "utf8").split(/\r?\n\r?\n/).filter((b) => /^HTTP\//.test(b));
  const last = blocks[blocks.length - 1] || "";
  const h = {};
  for (const line of last.split(/\r?\n/).slice(1)) {
    const i = line.indexOf(":");
    if (i > 0) h[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
  }
  const raw = readFileSync(body);
  let decoded = raw;
  const enc = (h["content-encoding"] || "").toLowerCase();
  if (enc === "br") decoded = zlib.brotliDecompressSync(raw);
  else if (enc === "gzip") decoded = zlib.gunzipSync(raw);
  return { status: code, wireBytes: wire, decoded, headers: h };
}

function publicTextPaths(root = "public") {
  const out = [];
  (function walk(d) {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (PUBLIC_TEXT.test(n)) out.push("/" + relative(root, p).split(sep).join("/"));
    }
  })(root);
  return out.sort();
}

const ASSET_REF = /(?:^|["'`(/])(assets\/[\w.-]+\.(?:js|css))/g;

/** Every `/assets/*.js|css` path named in a document or chunk, de-duplicated. */
export function assetRefs(text) {
  return [...new Set([...text.matchAll(ASSET_REF)].map((m) => "/" + m[1]))];
}

export async function run(origin) {
  const base = origin.replace(/\/+$/, "");
  const dir = mkdtempSync(join(tmpdir(), "p15-"));
  const rows = [];
  const seen = new Set();
  const check = (path, source) => {
    if (seen.has(path)) return null;
    seen.add(path);
    const r = fetchRaw(base + path, dir);
    const c = classify({
      status: r.status,
      contentType: r.headers["content-type"],
      contentEncoding: r.headers["content-encoding"],
      decodedBytes: r.decoded.length,
    });
    rows.push({
      path, source, status: r.status, type: (r.headers["content-type"] || "").split(";")[0],
      encoding: r.headers["content-encoding"] || "identity", wire: r.wireBytes, decoded: r.decoded.length, ...c,
    });
    return r;
  };
  try {
    const doc = check("/", "document");
    check("/explore", "spa deep link");
    const queue = [];
    const enqueue = (text) => {
      for (const p of assetRefs(text)) {
        if (!seen.has(p) && !queue.includes(p)) queue.push(p);
      }
    };
    enqueue(doc.decoded.toString("utf8"));
    while (queue.length) {
      const p = queue.shift();
      const r = check(p, "asset");
      if (r && r.status === 200 && /\.js$/.test(p)) enqueue(r.decoded.toString("utf8"));
    }
    for (const p of publicTextPaths()) check(p, "public/");
    // A Function route that is not deployed falls through to the SPA document
    // and would "pass" as compressed HTML while testing nothing. Each route is
    // checked against the type it must answer with (the page route also
    // answers HTML, so for it the test is "not byte-identical to the plain
    // document"). A miss is marked ABSENT, printed, never counted as a pass.
    const docBody = doc.decoded;
    const FUNCTIONS = [
      ["/config/site-settings", "function (P4)", (r) => /json/i.test(r.headers["content-type"] || "")],
      ["/page/about", "function (page)", (r) => !r.decoded.equals(docBody)],
    ];
    for (const [p, src, isLive] of FUNCTIONS) {
      const r = check(p, src);
      if (r && r.status === 200 && !isLive(r)) {
        const row = rows[rows.length - 1];
        row.verdict = "ABSENT";
        row.reason = "route not deployed on this origin — SPA fallback served";
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return rows;
}

const isCli = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isCli) {
  if (process.argv.includes("--self-test")) {
    const f = selfTest();
    f.forEach((x) => console.error("SELF-TEST FAIL · " + x));
    console.log(`self-test: ${SELF_TEST.length - f.length}/${SELF_TEST.length} header shapes classified correctly`);
    process.exit(f.length ? 1 : 0);
  }
  const origin = process.argv.slice(2).find((a) => /^https?:\/\//.test(a));
  if (!origin) {
    console.error("usage: web-compression-check.mjs <origin> [--json out.json] | --self-test");
    process.exit(2);
  }
  const rows = await run(origin);
  const count = (v) => rows.filter((r) => r.verdict === v).length;
  for (const r of rows) {
    console.log(`${r.verdict.padEnd(4)} ${String(r.status).padEnd(3)} ${r.encoding.padEnd(8)} ${String(r.wire).padStart(8)} / ${String(r.decoded).padStart(8)} B  ${r.path}  (${r.reason})`);
  }
  const text = rows.filter((r) => r.verdict !== "SKIP" && r.verdict !== "ABSENT");
  const wire = text.reduce((a, r) => a + r.wire, 0);
  const dec = text.reduce((a, r) => a + r.decoded, 0);
  const summary = {
    origin, measuredAt: new Date().toISOString(), responses: rows.length,
    pass: count("PASS"), tiny: count("TINY"), fail: count("FAIL"), skip: count("SKIP"), absent: count("ABSENT"),
    textWireBytes: wire, textDecodedBytes: dec,
  };
  console.log(JSON.stringify(summary));
  const ji = process.argv.indexOf("--json");
  if (ji > 0 && process.argv[ji + 1]) writeFileSync(process.argv[ji + 1], JSON.stringify({ summary, rows }, null, 2) + "\n");
  process.exit(summary.fail ? 1 : 0);
}
