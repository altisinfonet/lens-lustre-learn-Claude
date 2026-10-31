#!/usr/bin/env node
/**
 * P13 — THE BYTE CEILING. A BUILD OVER IT FAILS. IT DOES NOT WARN.
 *
 * Gate (docs/gates/GATE_REGISTER.md, P13, verbatim):
 *   "a byte ceiling on the entry bundle and per-route chunks; a build that
 *    exceeds it fails, it does not warn, in the same style as M11."
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IS MEASURED. Raw bytes on disk in dist/ after `npm run build` — the
 * bytes the browser must parse and compile, which is the cost a mid-range
 * Android actually pays. Transfer size is P15's business (Brotli, measured by
 * fetch); a ceiling on compressed bytes would let a chunk double its parse cost
 * as long as it compressed well.
 *
 * WHAT IS CAPPED (scripts/web-bundle-budget.json):
 *   entry          the module index.html loads (resolved from index.html, never
 *                  guessed from a file name)
 *   initial        entry + every modulepreload + every local stylesheet
 *                  index.html blocks on: what a first visit pays before paint
 *   named chunks   the few chunks already larger than the default, each with
 *                  its own ceiling, keyed by the name Vite gives it before the
 *                  hash (`AdminAnalytics-<hash>.js` -> "AdminAnalytics.js")
 *   every other    route/lazy chunk, .js or .css: one default ceiling
 *
 * HOW THE CEILINGS WERE SET. The measured size on 2026-10-04 (origin/staging
 * 64a0d66, staging-lane build) plus ~3 % headroom, rounded up to a KiB — a
 * ratchet, not an aspiration. Lowering a ceiling is always allowed; RAISING one
 * is a reviewed change to the JSON in its own PR with the reason in the body.
 * The JSON is the contract; this script never edits it.
 *
 * WHAT FAILS, AND HOW LOUDLY. Any chunk over its ceiling, a dist/ with no
 * index.html or no entry, a stale named-chunk entry that matches nothing (a
 * ceiling for a chunk that no longer exists is a ceiling nobody is checking),
 * or a malformed budget file. Every failure exits 1 and prints an ::error. No
 * `--warn` mode exists, by design: that is the gate's whole sentence.
 *
 * C-34: `--self-test` builds a miniature dist/ in a temp dir and requires
 * each failure shape to fail and the clean shape to pass.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   node scripts/web-bundle-budget.mjs [--dist=dist] [--budget=scripts/web-bundle-budget.json] [--json out.json]
 *   node scripts/web-bundle-budget.mjs --self-test
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { resolveEntryFromHtml } from "./web-baseline.mjs";

const HASHED = /^(.+)-[A-Za-z0-9_-]{8}\.(js|css)$/;

/** `assets/AdminAnalytics-I0YmyXD4.js` -> `AdminAnalytics.js`; unhashed -> null. */
export function chunkName(rel) {
  const m = path.basename(rel).match(HASHED);
  return m ? `${m[1]}.${m[2]}` : null;
}

export function validateBudget(b) {
  const errs = [];
  const posInt = (v) => Number.isInteger(v) && v > 0;
  if (!b || typeof b !== "object") return ["budget is not an object"];
  if (!posInt(b.entryBytes)) errs.push("entryBytes must be a positive integer");
  if (!posInt(b.initialBytes)) errs.push("initialBytes must be a positive integer");
  if (!posInt(b.defaultChunkBytes)) errs.push("defaultChunkBytes must be a positive integer");
  if (!b.namedChunks || typeof b.namedChunks !== "object") errs.push("namedChunks must be an object");
  else for (const [k, v] of Object.entries(b.namedChunks)) if (!posInt(v)) errs.push(`namedChunks["${k}"] must be a positive integer`);
  return errs;
}

/**
 * Pure check over a list of {rel, bytes} plus the parsed index.html refs.
 * Returns { rows, failures }. No filesystem, so the test drives it directly.
 */
export function evaluate(files, refs, budget) {
  const failures = [...validateBudget(budget)];
  if (failures.length) return { rows: [], failures };
  const size = new Map(files.map((f) => [f.rel, f.bytes]));
  const rows = [];
  const over = (label, rel, bytes, ceiling) => {
    const ok = bytes <= ceiling;
    rows.push({ check: label, path: rel, bytes, ceiling, headroom: ceiling - bytes, ok });
    if (!ok) failures.push(`${label}: ${rel} is ${bytes} B, ceiling ${ceiling} B (over by ${bytes - ceiling} B)`);
  };

  if (!refs.entry) failures.push("index.html names no entry module — nothing to measure");
  else if (!size.has(refs.entry)) failures.push(`index.html loads ${refs.entry}, which is not in dist/`);
  else over("entry", refs.entry, size.get(refs.entry), budget.entryBytes);

  const local = (p) => typeof p === "string" && p.startsWith("assets/");
  const initialPaths = [...new Set([refs.entry, ...(refs.modulepreload || []), ...(refs.stylesheets || [])].filter(local))];
  const missing = initialPaths.filter((p) => !size.has(p));
  for (const p of missing) failures.push(`index.html references ${p}, which is not in dist/`);
  const initialBytes = initialPaths.filter((p) => size.has(p)).reduce((a, p) => a + size.get(p), 0);
  over("initial", initialPaths.join(" + "), initialBytes, budget.initialBytes);

  const usedNames = new Set();
  for (const f of files) {
    if (!/^assets\/.+\.(js|css)$/.test(f.rel) || f.rel === refs.entry) continue;
    const name = chunkName(f.rel);
    if (name && Object.prototype.hasOwnProperty.call(budget.namedChunks, name)) {
      usedNames.add(name);
      over(`chunk ${name}`, f.rel, f.bytes, budget.namedChunks[name]);
    } else {
      over("chunk (default)", f.rel, f.bytes, budget.defaultChunkBytes);
    }
  }
  for (const name of Object.keys(budget.namedChunks)) {
    if (!usedNames.has(name)) failures.push(`namedChunks["${name}"] matches no chunk in dist/ — a stale ceiling checks nothing; remove it`);
  }
  return { rows, failures };
}

function listFiles(dist) {
  const out = [];
  (function walk(d) {
    for (const n of fs.readdirSync(d)) {
      const p = path.join(d, n);
      if (fs.statSync(p).isDirectory()) walk(p);
      else out.push({ rel: path.relative(dist, p).split(path.sep).join("/"), bytes: fs.statSync(p).size });
    }
  })(dist);
  return out;
}

export function run({ dist = "dist", budgetPath = "scripts/web-bundle-budget.json" } = {}) {
  if (!fs.existsSync(path.join(dist, "index.html"))) {
    return { rows: [], failures: [`${dist}/index.html is absent — build first; an empty dist/ is not under budget, it is not built`] };
  }
  let budget;
  try {
    budget = JSON.parse(fs.readFileSync(budgetPath, "utf8"));
  } catch (e) {
    return { rows: [], failures: [`cannot read ${budgetPath}: ${e.message}`] };
  }
  const refs = resolveEntryFromHtml(fs.readFileSync(path.join(dist, "index.html"), "utf8"));
  return evaluate(listFiles(dist), refs, budget);
}

/** Each failure shape must fail; the clean shape must pass. */
export function selfTest() {
  const problems = [];
  const budget = { entryBytes: 1000, initialBytes: 1500, defaultChunkBytes: 300, namedChunks: { "big.js": 900 } };
  const html = `<script type="module" src="/assets/index-AAAAAAAA.js"></script><link rel="modulepreload" href="/assets/vendor-BBBBBBBB.js"><link rel="stylesheet" href="/assets/index-CCCCCCCC.css">`;
  const make = (sizes, h = html) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "p13-"));
    fs.mkdirSync(path.join(dir, "assets"));
    fs.writeFileSync(path.join(dir, "index.html"), h);
    for (const [n, b] of Object.entries(sizes)) fs.writeFileSync(path.join(dir, "assets", n), "x".repeat(b));
    const bp = path.join(dir, "budget.json");
    fs.writeFileSync(bp, JSON.stringify(budget));
    const r = run({ dist: dir, budgetPath: bp });
    fs.rmSync(dir, { recursive: true, force: true });
    return r;
  };
  const clean = { "index-AAAAAAAA.js": 900, "vendor-BBBBBBBB.js": 300, "index-CCCCCCCC.css": 200, "big-DDDDDDDD.js": 800, "Route-EEEEEEEE.js": 250 };
  const cases = [
    ["clean build", clean, false],
    ["entry over", { ...clean, "index-AAAAAAAA.js": 1001 }, true],
    ["initial over (each part under)", { ...clean, "vendor-BBBBBBBB.js": 299, "index-CCCCCCCC.css": 299, "index-AAAAAAAA.js": 999 }, true],
    ["route chunk over default", { ...clean, "Route-EEEEEEEE.js": 301 }, true],
    ["named chunk over its own ceiling", { ...clean, "big-DDDDDDDD.js": 901 }, true],
    ["stale named ceiling", (({ ["big-DDDDDDDD.js"]: _, ...rest }) => rest)(clean), true],
    ["css route chunk over default", { ...clean, "Page-FFFFFFFF.css": 400 }, true],
  ];
  for (const [name, sizes, shouldFail] of cases) {
    const r = make(sizes);
    if ((r.failures.length > 0) !== shouldFail) problems.push(`${name}: expected ${shouldFail ? "FAIL" : "PASS"}, got ${r.failures.length ? "FAIL: " + r.failures[0] : "PASS"}`);
  }
  const noHtml = run({ dist: path.join(os.tmpdir(), "p13-does-not-exist") });
  if (!noHtml.failures.length) problems.push("absent dist/ must fail");
  return problems;
}

const isCli = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isCli) {
  const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || "").split("=")[1] || d;
  if (process.argv.includes("--self-test")) {
    const p = selfTest();
    p.forEach((x) => console.error("SELF-TEST FAIL · " + x));
    console.log(`self-test: ${p.length ? "FAIL" : "PASS"} (7 dist shapes + absent dist)`);
    process.exit(p.length ? 1 : 0);
  }
  const r = run({ dist: arg("dist", "dist"), budgetPath: arg("budget", "scripts/web-bundle-budget.json") });
  const top = [...r.rows].sort((a, b) => a.headroom - b.headroom).slice(0, 12);
  for (const x of top) console.log(`${x.ok ? "ok  " : "OVER"} ${String(x.bytes).padStart(9)} / ${String(x.ceiling).padStart(9)} B  ${x.check}  ${x.path.slice(0, 120)}`);
  for (const f of r.failures) console.error(`::error::P13 bundle budget · ${f}`);
  console.log(`bundle budget: ${r.rows.length} checks, ${r.failures.length} failure(s) — ${r.failures.length ? "FAIL" : "PASS"}`);
  const ji = process.argv.indexOf("--json");
  if (ji > 0 && process.argv[ji + 1]) fs.writeFileSync(process.argv[ji + 1], JSON.stringify({ measuredAt: new Date().toISOString(), ...r }, null, 2) + "\n");
  process.exit(r.failures.length ? 1 : 0);
}
