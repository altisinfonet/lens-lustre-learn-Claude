#!/usr/bin/env node
/**
 * ─────────────────────────────────────────────────────────────────────────────
 * TESTS FOR scripts/web-baseline.mjs — node:test and node:assert ONLY.
 *
 * WHY NO TEST RUNNER. The repository already carries vitest, and vitest is the
 * right tool for src/. It is the wrong tool here: web-baseline.mjs is a build
 * instrument that must keep running when the dependency tree is broken — the
 * same reason scripts/security-audit.mjs uses nothing but built-ins. A test
 * that needs npm install to prove the instrument works cannot prove it works on
 * the day it is most needed. `node --test scripts/web-baseline.test.mjs`.
 *
 * WHY THESE PARTICULAR TESTS. Three of them are negative controls — each was
 * written against a first implementation and each FAILED there. They are marked
 * NEGATIVE CONTROL with the defect they caught. A test that could not have
 * failed is not evidence (C-34: a typecheck workflow that never ran tsc).
 * ─────────────────────────────────────────────────────────────────────────────
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  classifyJsChunk,
  resolveEntryFromHtml,
  serializeRecords,
  measureFile,
  collectBaseline,
  LANGUAGE_SCRIPTS,
  gitProvenance,
} from "./web-baseline.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, "web-baseline.mjs");

/* A throwaway dist/ that looks enough like a Vite build to be measured. Built
   from bytes we choose, so every expected number is arithmetic, not a guess. */
function makeFixtureDist({ withEntry = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "web-baseline-fixture-"));
  const assets = path.join(root, "assets");
  fs.mkdirSync(assets, { recursive: true });

  // The entry, and a ROUTE chunk whose name differs only by case. Vite really
  // does emit both: dist/assets/index-Cowp9LeG.js (entry) beside
  // dist/assets/Index-BNx5iofT.js (the lazily-loaded Index page).
  fs.writeFileSync(path.join(assets, "index-AAAAAAAA.js"), "console.log('entry');\n".repeat(40));
  fs.writeFileSync(path.join(assets, "Index-BBBBBBBB.js"), "export default function Index(){}\n".repeat(40));
  fs.writeFileSync(path.join(assets, "index-CCCCCCCC.css"), "body{margin:0}\n".repeat(40));
  fs.writeFileSync(path.join(assets, "vendor-react-DDDDDDDD.js"), "export const react=1;\n".repeat(200));

  // The six-language dictionary, in the shape the build actually emits today:
  // one chunk, minified, ending in a record literal of language subtags.
  const dict =
    `const e={a:"${"अनुवाद देखें ".repeat(200)}"},` +
    `a={a:"${"অনুবাদ দেখুন ".repeat(200)}"},` +
    `t={a:"${"अनुवाद पहा ".repeat(200)}"},` +
    `s={a:"${"અનુવાદ જુઓ ".repeat(200)}"},` +
    `n={a:"${"மொழிபெயர்ப்பு ".repeat(200)}"},` +
    `o={a:"${"అనువాదం చూడండి ".repeat(200)}"},` +
    `r={hi:e,bn:a,mr:t,gu:s,ta:n,te:o};export{r as rest};\n`;
  fs.writeFileSync(path.join(assets, "translations.rest-EEEEEEEE.js"), dict);

  // ⚠ THE TRAP. A perfectly ordinary vendor chunk that happens to carry one
  // Devanagari string — a hardcoded label, a test fixture, a comment that
  // survived minification. It is NOT a dictionary.
  fs.writeFileSync(
    path.join(assets, "vendor-react-markdown-FFFFFFFF.js"),
    "export const md=1;const label='नमस्ते';\n" + "export const pad=0;\n".repeat(300)
  );

  const entryTag = withEntry
    ? '<script type="module" crossorigin src="/assets/index-AAAAAAAA.js"></script>'
    : "";
  fs.writeFileSync(
    path.join(root, "index.html"),
    `<!doctype html><html><head>` +
      `<link rel="icon" href="/favicon.png">` +
      entryTag +
      `<link rel="modulepreload" crossorigin href="/assets/vendor-react-DDDDDDDD.js">` +
      `<link rel="stylesheet" crossorigin href="/assets/index-CCCCCCCC.css">` +
      `</head><body><div id="root"></div></body></html>`
  );
  return root;
}

const rm = (d) => fs.rmSync(d, { recursive: true, force: true });

/* ── 1 ─────────────────────────────────────────────────────────────────────
   NEGATIVE CONTROL. Caught: the first classifier called any chunk holding
   non-Latin script characters a language dictionary, so a vendor chunk with a
   single Devanagari label was reported as a dictionary and its 6 KB were
   attributed to Hindi. Classification now needs NAME evidence or a language
   RECORD LITERAL, not merely the presence of a script. */
test("NEGATIVE CONTROL: a vendor chunk carrying one Devanagari string is not a dictionary", () => {
  const src = "export const md=1;const label='नमस्ते';" + "export const pad=0;".repeat(300);
  const c = classifyJsChunk("assets/vendor-react-markdown-FFFFFFFF.js", src);
  assert.equal(c.languageDictionary, false, "a vendor chunk must not be classified as a dictionary");
  assert.deepEqual(c.languages, []);
});

/* ── 2 ─────────────────────────────────────────────────────────────────── */
test("the six-language chunk is identified, with every language and scope=multi", () => {
  const root = makeFixtureDist();
  try {
    const src = fs.readFileSync(path.join(root, "assets/translations.rest-EEEEEEEE.js"), "utf8");
    const c = classifyJsChunk("assets/translations.rest-EEEEEEEE.js", src);
    assert.equal(c.languageDictionary, true);
    assert.equal(c.dictionaryScope, "multi");
    assert.deepEqual([...c.languages].sort(), ["bn", "gu", "hi", "mr", "ta", "te"]);
    assert.equal(c.evidence.includes("language-record-literal"), true);
  } finally {
    rm(root);
  }
});

/* ── 3 ─────────────────────────────────────────────────────────────────── */
test("a per-language chunk (what P16 will emit) is scope=single and exactly attributed", () => {
  const c = classifyJsChunk("assets/translations.ta-12345678.js", 'const d={a:"மொழி"};export default d;');
  assert.equal(c.languageDictionary, true);
  assert.equal(c.dictionaryScope, "single");
  assert.deepEqual(c.languages, ["ta"]);
});

/* ── 4 ─────────────────────────────────────────────────────────────────────
   NEGATIVE CONTROL. Caught: entry resolution matched files whose basename
   started with "index", which on this build matches THREE emitted files —
   index-<hash>.js (the entry), Index-<hash>.js (the lazily-loaded Index route)
   and index-<hash>.css. It picked the route chunk on a case-insensitive sort
   and would have reported a 3.5 KB entry bundle for a 1.6 MB one. The entry is
   now read from index.html's <script type="module"> and nowhere else. */
test("NEGATIVE CONTROL: the entry is the module script in index.html, not a name that looks like one", () => {
  const root = makeFixtureDist();
  try {
    const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
    const e = resolveEntryFromHtml(html);
    assert.equal(e.entry, "assets/index-AAAAAAAA.js");
    assert.notEqual(e.entry, "assets/Index-BBBBBBBB.js");
    assert.deepEqual(e.modulepreload, ["assets/vendor-react-DDDDDDDD.js"]);
    assert.deepEqual(e.stylesheets, ["assets/index-CCCCCCCC.css"]);
  } finally {
    rm(root);
  }
});

/* ── 5 ─────────────────────────────────────────────────────────────────────
   NEGATIVE CONTROL. Caught: nothing enforced the gate's literal requirement
   that every record carry a UTC measurement timestamp. The first writer
   serialized whatever it was handed, so a record built with a local-offset
   timestamp — or none at all — was written out and read as measured. The
   writer now refuses both. */
test("NEGATIVE CONTROL: serializeRecords refuses a record with no timestamp or a non-UTC one", () => {
  const ok = [{ type: "x", runId: "r", measuredAtUtc: "2026-09-02T10:00:00.000Z" }];
  assert.equal(serializeRecords(ok).trim().split("\n").length, 1);

  assert.throws(() => serializeRecords([{ type: "x", runId: "r" }]), /measuredAtUtc/i);
  assert.throws(
    () => serializeRecords([{ type: "x", runId: "r", measuredAtUtc: "2026-09-02T15:30:00.000+05:30" }]),
    /UTC/i
  );
  assert.throws(() => serializeRecords([{ type: "x", measuredAtUtc: "2026-09-02T10:00:00.000Z" }]), /runId/i);
});

/* ── 6 ─────────────────────────────────────────────────────────────────── */
test("every emitted record carries runId and a UTC timestamp", () => {
  const root = makeFixtureDist();
  try {
    const { records } = collectBaseline({ dist: root, brotliQuality: 5 });
    assert.ok(records.length > 5);
    for (const r of records) {
      assert.equal(typeof r.type, "string");
      assert.match(r.measuredAtUtc, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, `record ${r.type}`);
      assert.equal(typeof r.runId, "string");
    }
  } finally {
    rm(root);
  }
});

/* ── 7 ─────────────────────────────────────────────────────────────────── */
test("byte sizes are the real file bytes, and gzip/brotli are computed over them", () => {
  const root = makeFixtureDist();
  try {
    const p = path.join(root, "assets/vendor-react-DDDDDDDD.js");
    const raw = fs.readFileSync(p);
    const m = measureFile(p, "assets/vendor-react-DDDDDDDD.js", 5);
    assert.equal(m.bytes, raw.byteLength);
    assert.equal(m.gzipBytes, zlib.gzipSync(raw, { level: 9 }).byteLength);
    assert.ok(m.gzipBytes < m.bytes, "highly repetitive JS must compress");
    assert.ok(m.brotliBytes === null || m.brotliBytes > 0, "brotli is a real size or an honest null");
    assert.match(m.sha256, /^[0-9a-f]{64}$/);
  } finally {
    rm(root);
  }
});

/* ── 8 ─────────────────────────────────────────────────────────────────── */
test("a multi-language chunk reports each language BLOCKED rather than inventing a size", () => {
  const root = makeFixtureDist();
  try {
    const { records } = collectBaseline({ dist: root, brotliQuality: 5 });
    const langs = records.filter((r) => r.type === "language");
    assert.equal(langs.length, 6);
    for (const l of langs) {
      assert.equal(l.bytes, null, `${l.language} must not be given a fabricated byte size`);
      assert.equal(l.blocked, "shared-chunk");
      assert.equal(typeof l.sharedChunk, "string");
      // The script-block share is an estimate and must say so.
      assert.equal(l.estimate.method, "unicode-script-block-share");
      assert.equal(l.estimate.exact, false);
    }
    // hi and mr are both Devanagari: the estimate cannot separate them and says so.
    const hi = langs.find((l) => l.language === "hi");
    assert.equal(hi.estimate.separable, false);
    assert.deepEqual(hi.estimate.sharesScriptWith.sort(), ["mr"]);
    const ta = langs.find((l) => l.language === "ta");
    assert.equal(ta.estimate.separable, true);
    assert.ok(ta.estimate.approxBytes > 0);
  } finally {
    rm(root);
  }
});

/* ── 9 ─────────────────────────────────────────────────────────────────── */
test("an absent dist/ exits non-zero with a message, never an empty baseline", () => {
  const gone = path.join(os.tmpdir(), "web-baseline-absent-" + Date.now());
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "web-baseline-out-"));
  try {
    const r = spawnSync(process.execPath, [SCRIPT, `--dist=${gone}`, `--out=${out}`], { encoding: "utf8" });
    assert.notEqual(r.status, 0, "an absent dist must fail the instrument");
    assert.match(r.stderr, /does not exist|not a directory/i);
    assert.deepEqual(fs.readdirSync(out), [], "nothing may be written when nothing was measured");
  } finally {
    rm(out);
  }
});

/* ── 10 ────────────────────────────────────────────────────────────────── */
test("a dist/ with no JavaScript exits non-zero rather than reporting zero bytes", () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), "web-baseline-empty-"));
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "web-baseline-out2-"));
  try {
    fs.writeFileSync(path.join(empty, "index.html"), "<!doctype html><html></html>");
    const r = spawnSync(process.execPath, [SCRIPT, `--dist=${empty}`, `--out=${out}`], { encoding: "utf8" });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /no JavaScript|entry/i);
  } finally {
    rm(empty);
    rm(out);
  }
});

/* ── 11 ────────────────────────────────────────────────────────────────── */
test("the instrument mutates nothing it measures", () => {
  const root = makeFixtureDist();
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "web-baseline-out3-"));
  try {
    const before = fs
      .readdirSync(path.join(root, "assets"))
      .sort()
      .map((f) => {
        const s = fs.statSync(path.join(root, "assets", f));
        return `${f}:${s.size}:${s.mtimeMs}`;
      });
    const r = spawnSync(process.execPath, [SCRIPT, `--dist=${root}`, `--out=${out}`, "--brotli-quality=4"], {
      encoding: "utf8",
    });
    assert.equal(r.status, 0, r.stderr);
    const after = fs
      .readdirSync(path.join(root, "assets"))
      .sort()
      .map((f) => {
        const s = fs.statSync(path.join(root, "assets", f));
        return `${f}:${s.size}:${s.mtimeMs}`;
      });
    assert.deepEqual(after, before, "dist/ must be byte-for-byte and mtime-for-mtime untouched");
    const written = fs.readdirSync(out).filter((f) => f.endsWith(".ndjson"));
    assert.equal(written.length, 1);
    const lines = fs.readFileSync(path.join(out, written[0]), "utf8").trim().split("\n");
    for (const line of lines) assert.match(JSON.parse(line).measuredAtUtc, /Z$/);
  } finally {
    rm(root);
    rm(out);
  }
});

/* ── 12 ────────────────────────────────────────────────────────────────── */
test("--out inside --dist is refused, so a baseline can never measure itself", () => {
  const root = makeFixtureDist();
  try {
    const inside = path.join(root, "evidence");
    const r = spawnSync(process.execPath, [SCRIPT, `--dist=${root}`, `--out=${inside}`], { encoding: "utf8" });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /inside|within/i);
  } finally {
    rm(root);
  }
});

/* ── 13 ────────────────────────────────────────────────────────────────── */
test("--help exits 0 and names every flag", () => {
  const r = spawnSync(process.execPath, [SCRIPT, "--help"], { encoding: "utf8" });
  assert.equal(r.status, 0);
  for (const flag of ["--dist", "--out", "--help", "--brotli-quality"]) assert.ok(r.stdout.includes(flag), flag);
});

/* ── 14 ────────────────────────────────────────────────────────────────── */
test("the language/script table never maps one subtag to two scripts", () => {
  for (const [lang, script] of Object.entries(LANGUAGE_SCRIPTS)) {
    assert.equal(typeof script, "string", lang);
    assert.ok(script.length > 0, lang);
  }
  assert.equal(LANGUAGE_SCRIPTS.hi, LANGUAGE_SCRIPTS.mr, "hi and mr really do share Devanagari");
  assert.notEqual(LANGUAGE_SCRIPTS.ta, LANGUAGE_SCRIPTS.te);
});

/* ── 15 ────────────────────────────────────────────────────────────────── */
/* Review F-3, 2026-09-02. gitProvenance() read `.git/HEAD` as a file. In a git
 * worktree `.git` is itself a FILE — `gitdir: <path>` — so the read threw, the
 * catch swallowed it, and the run record carried { commit: null, branch: null }
 * from a checkout that had a perfectly good commit. A null that means "could not
 * read" and a null that means "not a repository" looked identical. This fixture
 * is the real worktree layout git writes: `.git` file → gitdir → HEAD → ref in
 * the COMMON dir (worktree refs/heads live there, not under the worktree). */
function makeWorktreeFixture({ detached = false } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "web-baseline-wt-"));
  const main = path.join(base, "main"), wt = path.join(base, "wt");
  const gitdir = path.join(main, ".git", "worktrees", "wt");
  fs.mkdirSync(path.join(main, ".git", "refs", "heads", "d2"), { recursive: true });
  fs.mkdirSync(gitdir, { recursive: true });
  fs.writeFileSync(path.join(main, ".git", "HEAD"), "ref: refs/heads/staging\n");
  fs.writeFileSync(path.join(main, ".git", "refs", "heads", "staging"), "1111111111111111111111111111111111111111\n");
  fs.writeFileSync(path.join(main, ".git", "refs", "heads", "d2", "fix"), "2222222222222222222222222222222222222222\n");
  fs.writeFileSync(path.join(gitdir, "commondir"), "../..\n");
  fs.writeFileSync(path.join(gitdir, "HEAD"), detached ? "3333333333333333333333333333333333333333\n" : "ref: refs/heads/d2/fix\n");
  fs.mkdirSync(wt);
  fs.writeFileSync(path.join(wt, ".git"), "gitdir: " + gitdir + "\n");
  return { base, main, wt };
}

test("NEGATIVE CONTROL (F-3): provenance is read through a worktree's gitdir: pointer, not swallowed", () => {
  const { base, main, wt } = makeWorktreeFixture();
  try {
    const onBranch = gitProvenance(wt);
    assert.equal(onBranch.commit, "2222222222222222222222222222222222222222", "worktree HEAD resolves through the common dir");
    assert.equal(onBranch.branch, "d2/fix");
    const plain = gitProvenance(main);
    assert.equal(plain.commit, "1111111111111111111111111111111111111111", "a plain .git directory still works");
    assert.equal(plain.branch, "staging");
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test("F-3: a detached worktree reports its commit, and a non-repository says so instead of nulling", () => {
  const { base, wt } = makeWorktreeFixture({ detached: true });
  const notARepo = fs.mkdtempSync(path.join(os.tmpdir(), "web-baseline-norepo-"));
  try {
    const d = gitProvenance(wt);
    assert.equal(d.commit, "3333333333333333333333333333333333333333");
    assert.equal(d.branch, null);
    const n = gitProvenance(notARepo);
    assert.equal(n.commit, null);
    assert.equal(n.status, "unknown", "an unreadable provenance is labelled, never a bare null");
    assert.match(String(n.reason), /\.git/i);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
    fs.rmSync(notARepo, { recursive: true, force: true });
  }
});

