#!/usr/bin/env node
/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE WEB BASELINE — Addendum A, Phase 0, unit 0.4. READ-ONLY.
 *
 * WHY THIS EXISTS. Phase 5 turns a byte budget into a build-breaking ceiling
 * (P13). A ceiling asserted against a number nobody measured is a number
 * somebody guessed, and this project has already paid for that twice — a
 * typecheck workflow that compiled nothing (C-34) and a security gate whose
 * forbidden-refs list was empty, so its only cross-lane rule had nothing to
 * compare against. This instrument writes down what the build ACTUALLY emits,
 * today, with a timestamp, so that "smaller than before" is arithmetic instead
 * of an opinion.
 *
 * WHY NO DEPENDENCIES. `node:zlib` gzips and brotlis; `node:crypto` hashes;
 * `node:fs` reads. That is the whole tool. scripts/security-audit.mjs took the
 * same decision for the same reason: an instrument that needs `npm install` to
 * run cannot run on the day the dependency tree is what broke. The dependency
 * window is closed for Phase 0 in any case.
 *
 * WHY IT REFUSES TO PRODUCE AN EMPTY BASELINE. An absent dist/ measured
 * politely yields a file full of zeroes, and a zero is indistinguishable from a
 * triumph. Every failure path here exits non-zero and writes nothing at all.
 * The web-build workflow already makes this argument in prose — "a build that
 * 'succeeds' but emits nothing is the same class of lie as a typecheck that
 * compiles nothing" — this file makes it in code.
 *
 * WHAT THE COMPRESSED NUMBERS ARE, AND ARE NOT. gzip is level 9 and brotli is
 * quality 11 by default: the best a compressor will do, computed here, over the
 * exact bytes on disk. They are a FLOOR for what the CDN can deliver, not a
 * prediction of what Cloudflare will actually send — Cloudflare compresses at a
 * lower quality on the fly unless the asset is pre-compressed. Confirming what
 * the edge really returns is P21 and is a fetch against the running site, not
 * an arithmetic exercise. Do not quote these as delivered bytes.
 *
 * WHAT IT CANNOT DO, STATED SO NOBODY ASSUMES OTHERWISE. Six languages share
 * one emitted chunk today (src/i18n/translations.rest.ts -> one
 * translations.rest-<hash>.js). A per-language BYTE SIZE therefore does not
 * exist to be measured, and this instrument will not invent one: each language
 * gets `bytes: null` and `blocked: "shared-chunk"`. It also reports a
 * script-block share as an explicitly-labelled ESTIMATE, and marks Hindi and
 * Marathi `separable: false` because both are written in Devanagari and no
 * amount of counting code points can tell them apart. When P16 emits one chunk
 * per language these become exact and `blocked` goes null on its own.
 *
 * USAGE
 *   node scripts/web-baseline.mjs [--dist=dist] [--out=docs/evidence/d2/baseline]
 *                                 [--brotli-quality=11] [--help]
 *
 * Every emitted record carries `runId` and `measuredAtUtc` (ISO 8601, Z). That
 * is the gate's literal requirement, and serializeRecords() refuses to write a
 * record that lacks either or whose timestamp is not UTC — see the negative
 * control in scripts/web-baseline.test.mjs.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";

export const TOOL = "web-baseline";
export const TOOL_VERSION = "0.4.0";

/* ── Language tables ──────────────────────────────────────────────────────
   LANGUAGE_SCRIPTS maps a BCP-47 primary subtag to the Unicode script its
   dictionary is written in. It is a lookup table maintained HERE, on purpose:
   deriving it would mean reading src/, and this instrument measures the build
   output, never the source that produced it. Adding a language to the app means
   adding a line here. */
export const LANGUAGE_SCRIPTS = Object.freeze({
  hi: "Devanagari", mr: "Devanagari", ne: "Devanagari",
  bn: "Bengali", as: "Bengali",
  gu: "Gujarati", pa: "Gurmukhi", or: "Oriya",
  ta: "Tamil", te: "Telugu", kn: "Kannada", ml: "Malayalam", si: "Sinhala",
  ur: "Arabic", ar: "Arabic", fa: "Arabic",
  ru: "Cyrillic", uk: "Cyrillic", el: "Greek", he: "Hebrew", th: "Thai",
  ja: "Japanese", ko: "Hangul", zh: "Han",
  // Latin-script languages have no script signature. They are detected by name
  // or by an explicit language record, never by counting code points.
  en: "Latin", es: "Latin", fr: "Latin", de: "Latin", it: "Latin",
  pt: "Latin", nl: "Latin", pl: "Latin", tr: "Latin", id: "Latin", vi: "Latin",
});

/* Subtags accepted as a key inside a language record literal. Wider than the
   script table so a Latin-only dictionary is still recognised. */
const KNOWN_SUBTAGS = new Set(Object.keys(LANGUAGE_SCRIPTS));

const SCRIPT_RANGES = Object.freeze({
  Greek: [[0x0370, 0x03ff]], Cyrillic: [[0x0400, 0x04ff]], Hebrew: [[0x0590, 0x05ff]],
  Arabic: [[0x0600, 0x06ff], [0x0750, 0x077f]],
  Devanagari: [[0x0900, 0x097f]], Bengali: [[0x0980, 0x09ff]], Gurmukhi: [[0x0a00, 0x0a7f]],
  Gujarati: [[0x0a80, 0x0aff]], Oriya: [[0x0b00, 0x0b7f]], Tamil: [[0x0b80, 0x0bff]],
  Telugu: [[0x0c00, 0x0c7f]], Kannada: [[0x0c80, 0x0cff]], Malayalam: [[0x0d00, 0x0d7f]],
  Sinhala: [[0x0d80, 0x0dff]], Thai: [[0x0e00, 0x0e7f]],
  Japanese: [[0x3040, 0x309f], [0x30a0, 0x30ff]],
  Han: [[0x4e00, 0x9fff]], Hangul: [[0xac00, 0xd7af]],
});

/** Count characters per Unicode script block. Real content evidence: it reads
 *  the bytes that shipped, not a name somebody chose. */
export function scriptCensus(src) {
  const counts = {};
  let total = 0;
  for (const ch of src) {
    total += 1;
    const cp = ch.codePointAt(0);
    if (cp < 0x0370) continue; // ASCII + Latin-1 + Latin Extended: no signature.
    for (const [name, ranges] of Object.entries(SCRIPT_RANGES)) {
      for (const [a, b] of ranges) {
        if (cp >= a && cp <= b) { counts[name] = (counts[name] || 0) + 1; break; }
      }
    }
  }
  return { counts, totalChars: total };
}

/* A Vite content hash: eight base64url characters welded to the end of the
   stem. Stripping it is what lets `translations.rest-CApbV07m` be recognised as
   `translations.rest` across rebuilds. */
const HASH_SUFFIX = /-[A-Za-z0-9_-]{8}$/;
const DICTIONARY_NAME = /(^|[.\-_/])(translations?|i18n|intl|locales?|langs?|messages|dict(ionary)?)([.\-_]|$)/i;

/** The `r={hi:e,bn:a,mr:t,gu:s,ta:n,te:o}` that survives minification because
 *  its keys are DATA, not identifiers, so no minifier may rename them. */
function languageRecordKeys(src) {
  const entry = String.raw`["']?([a-z]{2,3}(?:-[A-Za-z0-9]{2,8})?)["']?\s*:\s*[A-Za-z_$][\w$]{0,4}`;
  const re = new RegExp(String.raw`\{\s*(?:${entry}\s*,\s*){1,}${entry}\s*\}`, "g");
  const found = new Set();
  for (const m of src.matchAll(re)) {
    const keys = [...m[0].matchAll(/["']?([a-z]{2,3}(?:-[A-Za-z0-9]{2,8})?)["']?\s*:/g)].map((k) => k[1]);
    if (keys.length < 2) continue;
    // Every key must be a language we know. One stray key and this is an
    // ordinary options object, not a dictionary index.
    if (!keys.every((k) => KNOWN_SUBTAGS.has(k.split("-")[0]))) continue;
    for (const k of keys) found.add(k.split("-")[0]);
  }
  return [...found];
}

/**
 * Decide whether an emitted JavaScript chunk is a language dictionary, and
 * which languages it holds.
 *
 * ⚠ THE RULE THAT MATTERS: the presence of a non-Latin script is NOT on its own
 * evidence of a dictionary. A vendor chunk with one Devanagari label in it — a
 * hardcoded string, a sample, a comment that survived minification — would be
 * swept up by that test and its whole weight attributed to Hindi. Classification
 * needs NAME evidence or a language RECORD LITERAL; the script census only
 * corroborates and apportions. That is negative control 1 in the test file.
 */
export function classifyJsChunk(relPath, src) {
  const base = path.basename(relPath).replace(/\.[^.]+$/, "");
  const stem = base.replace(HASH_SUFFIX, "");
  const { counts, totalChars } = scriptCensus(src);
  const scriptsPresent = Object.keys(counts);
  const nonLatinChars = Object.values(counts).reduce((a, b) => a + b, 0);
  const nonLatinRatio = totalChars ? nonLatinChars / totalChars : 0;

  const none = {
    languageDictionary: false, languages: [], dictionaryScope: null,
    evidence: [], scriptCensus: counts, nonLatinRatio: Number(nonLatinRatio.toFixed(6)),
  };

  const nameLooksLikeDictionary = DICTIONARY_NAME.test(stem);
  const segments = stem.split(/[.\-_]/).filter(Boolean);
  const subtagSegments = segments.filter((s) => KNOWN_SUBTAGS.has(s));
  const recordKeys = languageRecordKeys(src);

  const evidence = [];
  let languages = [];

  // (a) An explicit record of languages. Strongest evidence there is — but it
  //     must be corroborated by the chunk's name or by the scripts it carries,
  //     so a minified options object cannot masquerade as a dictionary index.
  if (recordKeys.length >= 2) {
    const corroborated =
      nameLooksLikeDictionary ||
      recordKeys.some((k) => scriptsPresent.includes(LANGUAGE_SCRIPTS[k]));
    if (corroborated) { evidence.push("language-record-literal"); languages = recordKeys; }
  }

  // (b) A per-language chunk: a dictionary name PLUS a subtag in the name.
  //     This is the shape P16 will emit (translations.ta-<hash>.js) and it is
  //     the only shape that yields an exact per-language byte size.
  if (!languages.length && nameLooksLikeDictionary && subtagSegments.length) {
    evidence.push("dictionary-name+language-tag");
    languages = [...new Set(subtagSegments)];
  }

  // (c) A dictionary name and a chunk that is genuinely dense with a non-Latin
  //     script. The 2% floor is what separates a dictionary from a chunk that
  //     merely mentions one word; the trap chunk in the tests sits at ~0.1%.
  if (!languages.length && nameLooksLikeDictionary && nonLatinRatio >= 0.02) {
    evidence.push("dictionary-name+script-density");
    languages = Object.entries(LANGUAGE_SCRIPTS)
      .filter(([, s]) => scriptsPresent.includes(s))
      .map(([l]) => l);
  }

  if (!languages.length) return none;
  return {
    languageDictionary: true,
    languages: languages.sort(),
    dictionaryScope: languages.length > 1 ? "multi" : "single",
    evidence,
    scriptCensus: counts,
    nonLatinRatio: Number(nonLatinRatio.toFixed(6)),
  };
}

/**
 * The entry bundle is the module script index.html actually loads. Nothing
 * else.
 *
 * ⚠ NOT A NAME MATCH. This build emits `index-<hash>.js` (the entry),
 * `Index-<hash>.js` (the lazily-loaded Index route) and `index-<hash>.css`
 * side by side. Any rule of the form "the file called index" picks one of three
 * files, and on a case-insensitive sort it picks the wrong one — reporting a
 * 3.5 KB entry for a 1.6 MB one. That is negative control 4 in the test file.
 */
export function resolveEntryFromHtml(html) {
  const tags = [...html.matchAll(/<script\b[^>]*>/gi)].map((m) => m[0]);
  const moduleScripts = tags
    .filter((t) => /\btype\s*=\s*["']module["']/i.test(t))
    .map((t) => (t.match(/\bsrc\s*=\s*["']([^"']+)["']/i) || [])[1])
    .filter(Boolean);
  const href = (t) => (t.match(/\bhref\s*=\s*["']([^"']+)["']/i) || [])[1];
  const links = [...html.matchAll(/<link\b[^>]*>/gi)].map((m) => m[0]);
  const strip = (u) => u.replace(/^https?:\/\/[^/]+/i, "").replace(/[?#].*$/, "").replace(/^\//, "");
  return {
    entry: moduleScripts.length ? strip(moduleScripts[0]) : null,
    allModuleScripts: moduleScripts.map(strip),
    modulepreload: links.filter((t) => /\brel\s*=\s*["']modulepreload["']/i.test(t)).map(href).filter(Boolean).map(strip),
    stylesheets: links.filter((t) => /\brel\s*=\s*["']stylesheet["']/i.test(t)).map(href).filter(Boolean).map(strip),
  };
}

/** Measure one file. Reads it; writes nothing; never opens it for append. */
export function measureFile(absPath, relPath, brotliQuality = 11) {
  const buf = fs.readFileSync(absPath);
  let brotliBytes = null;
  let brotliError = null;
  try {
    brotliBytes = zlib.brotliCompressSync(buf, {
      params: {
        [zlib.constants.BROTLI_PARAM_QUALITY]: brotliQuality,
        [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buf.byteLength,
      },
    }).byteLength;
  } catch (err) {
    brotliBytes = null;
    brotliError = String(err && err.message ? err.message : err);
  }
  return {
    path: relPath,
    ext: path.extname(relPath).toLowerCase(),
    bytes: buf.byteLength,
    gzipBytes: zlib.gzipSync(buf, { level: 9 }).byteLength,
    brotliBytes,
    brotliError,
    sha256: crypto.createHash("sha256").update(buf).digest("hex"),
  };
}

const UTC_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/**
 * Turn records into NDJSON — and refuse anything that is not stamped.
 *
 * ⚠ THIS IS A CHECK, NOT A FORMATTER. The gate asks in as many words that every
 * record carry a UTC measurement timestamp. Nothing enforced that in the first
 * draft, so a record built with a local-offset time, or none at all, serialized
 * happily and read afterwards as measured. Negative control 5.
 */
export function serializeRecords(records) {
  const lines = [];
  records.forEach((r, i) => {
    if (!r || typeof r !== "object") throw new Error(`record ${i}: not an object`);
    if (typeof r.runId !== "string" || !r.runId) throw new Error(`record ${i} (${r.type}): missing runId`);
    if (typeof r.measuredAtUtc !== "string" || !r.measuredAtUtc)
      throw new Error(`record ${i} (${r.type}): missing measuredAtUtc`);
    if (!UTC_ISO.test(r.measuredAtUtc))
      throw new Error(`record ${i} (${r.type}): measuredAtUtc "${r.measuredAtUtc}" is not an ISO 8601 UTC instant (must end in Z)`);
    lines.push(JSON.stringify(r));
  });
  return lines.join("\n") + "\n";
}

function walk(dir, base = dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const p = path.join(dir, e.name);
    if (e.isSymbolicLink()) continue; // A symlink out of dist/ is not this build's output.
    if (e.isDirectory()) walk(p, base, out);
    else if (e.isFile()) out.push(path.relative(base, p).split(path.sep).join("/"));
  }
  return out;
}

/* Provenance, read straight off disk. A baseline that cannot be attached to a
   commit is a number without an owner. Read-only and entirely optional. */
function gitProvenance(root) {
  try {
    const head = fs.readFileSync(path.join(root, ".git", "HEAD"), "utf8").trim();
    const m = head.match(/^ref:\s*(.+)$/);
    if (!m) return { commit: head, branch: null };
    const branch = m[1].replace(/^refs\/heads\//, "");
    let commit = null;
    const refFile = path.join(root, ".git", m[1]);
    if (fs.existsSync(refFile)) commit = fs.readFileSync(refFile, "utf8").trim();
    else {
      const packed = fs.readFileSync(path.join(root, ".git", "packed-refs"), "utf8");
      const line = packed.split("\n").find((l) => l.endsWith(" " + m[1]));
      if (line) commit = line.split(" ")[0];
    }
    return { commit, branch };
  } catch {
    return { commit: null, branch: null };
  }
}

/**
 * Measure a built dist/ and return the records. Pure with respect to the
 * directory it is given: it opens files for reading and nothing else.
 */
export function collectBaseline({ dist, brotliQuality = 11, repoRoot = process.cwd() }) {
  const runId = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  const stamp = (rec) => ({ runId, measuredAtUtc: new Date().toISOString(), ...rec });

  const rels = walk(dist);
  const notes = [];

  const htmlPath = path.join(dist, "index.html");
  let html = null;
  if (fs.existsSync(htmlPath)) html = fs.readFileSync(htmlPath, "utf8");
  const refs = html
    ? resolveEntryFromHtml(html)
    : { entry: null, allModuleScripts: [], modulepreload: [], stylesheets: [] };
  if (!html) notes.push({ level: "blocked", note: `${htmlPath} is absent; the entry bundle cannot be identified.` });

  const preloadSet = new Set(refs.modulepreload);
  const cssSet = new Set(refs.stylesheets);

  const assets = [];
  for (const rel of rels) {
    const abs = path.join(dist, rel);
    const m = measureFile(abs, rel, brotliQuality);
    let cls = {
      languageDictionary: false, languages: [], dictionaryScope: null,
      evidence: [], scriptCensus: {}, nonLatinRatio: 0,
    };
    if (m.ext === ".js" || m.ext === ".mjs") cls = classifyJsChunk(rel, fs.readFileSync(abs, "utf8"));
    const roles = [];
    if (rel === refs.entry) roles.push("entry");
    if (preloadSet.has(rel)) roles.push("modulepreload");
    if (cssSet.has(rel)) roles.push("stylesheet");
    if (cls.languageDictionary) roles.push("language-dictionary");
    assets.push(stamp({ type: "asset", ...m, roles, ...cls }));
  }

  const byPath = new Map(assets.map((a) => [a.path, a]));
  const entryAsset = refs.entry ? byPath.get(refs.entry) || null : null;
  if (refs.entry && !entryAsset)
    notes.push({ level: "blocked", note: `index.html loads ${refs.entry}, which is not present in ${dist}.` });

  /* THE INITIAL PAYLOAD is what a first-time visitor pays for before anything
     appears: the entry, everything index.html modulepreloads, and the
     stylesheets it blocks on. Route chunks are excluded by design — 84 of them
     are lazy and no visitor loads them all. */
  const initialPaths = [refs.entry, ...refs.modulepreload, ...refs.stylesheets].filter(Boolean);
  const initial = initialPaths.map((p) => byPath.get(p)).filter(Boolean);
  const sum = (list, k) => list.reduce((a, b) => a + (typeof b[k] === "number" ? b[k] : 0), 0);
  const missingBrotli = assets.some((a) => a.brotliBytes === null);

  const dictionaries = assets.filter((a) => a.languageDictionary);
  const languageRecords = [];
  for (const d of dictionaries) {
    const censusTotal = Object.values(d.scriptCensus).reduce((a, b) => a + b, 0);
    for (const lang of d.languages) {
      const script = LANGUAGE_SCRIPTS[lang] || null;
      const sharesScriptWith = d.languages.filter((l) => l !== lang && LANGUAGE_SCRIPTS[l] === script);
      const single = d.dictionaryScope === "single";
      const share = script && censusTotal ? (d.scriptCensus[script] || 0) / censusTotal : null;
      languageRecords.push(
        stamp({
          type: "language",
          language: lang,
          script,
          chunk: d.path,
          sharedChunk: d.path,
          chunkBytes: d.bytes,
          chunkGzipBytes: d.gzipBytes,
          chunkBrotliBytes: d.brotliBytes,
          // EXACT only when the language owns its chunk outright.
          bytes: single ? d.bytes : null,
          gzipBytes: single ? d.gzipBytes : null,
          brotliBytes: single ? d.brotliBytes : null,
          blocked: single ? null : "shared-chunk",
          blockedReason: single
            ? null
            : `${d.languages.length} languages share ${d.path}; a per-language byte size does not exist in this build. P16 (one chunk per language) is what makes it measurable.`,
          estimate: {
            method: "unicode-script-block-share",
            exact: false,
            separable: sharesScriptWith.length === 0,
            sharesScriptWith: sharesScriptWith.sort(),
            scriptChars: script ? d.scriptCensus[script] || 0 : 0,
            scriptShare: share === null ? null : Number(share.toFixed(6)),
            approxBytes: share === null ? null : Math.round(d.bytes * share),
            caveat:
              "A share of the chunk's non-Latin characters, not a byte size. It ignores keys, punctuation and minified scaffolding, and it cannot separate two languages written in the same script.",
          },
        })
      );
    }
  }

  const records = [
    stamp({
      type: "run",
      tool: TOOL,
      toolVersion: TOOL_VERSION,
      startedAtUtc: startedAt,
      node: process.version,
      platform: `${process.platform}/${process.arch}`,
      dist: path.resolve(dist),
      fileCount: rels.length,
      compression: {
        gzip: { library: "node:zlib", level: 9 },
        brotli: { library: "node:zlib", quality: brotliQuality, available: !missingBrotli },
        meaning: "A floor for what a CDN can deliver, computed here. NOT a measurement of what the edge actually returns — that is P21, and it is a fetch, not arithmetic.",
      },
      git: gitProvenance(repoRoot),
    }),
    ...assets,
    stamp({
      type: "initial-payload",
      note: "What a first-time visitor downloads before anything renders: the entry module, every modulepreload in index.html, and the render-blocking stylesheets. Lazy route chunks are excluded.",
      entry: refs.entry,
      entryBytes: entryAsset ? entryAsset.bytes : null,
      entryGzipBytes: entryAsset ? entryAsset.gzipBytes : null,
      entryBrotliBytes: entryAsset ? entryAsset.brotliBytes : null,
      members: initial.map((a) => a.path),
      bytes: sum(initial, "bytes"),
      gzipBytes: sum(initial, "gzipBytes"),
      brotliBytes: missingBrotli ? null : sum(initial, "brotliBytes"),
    }),
    ...languageRecords,
    stamp({
      type: "summary",
      files: assets.length,
      jsChunks: assets.filter((a) => a.ext === ".js" || a.ext === ".mjs").length,
      cssFiles: assets.filter((a) => a.ext === ".css").length,
      totalBytes: sum(assets, "bytes"),
      totalGzipBytes: sum(assets, "gzipBytes"),
      totalBrotliBytes: missingBrotli ? null : sum(assets, "brotliBytes"),
      jsBytes: sum(assets.filter((a) => a.ext === ".js" || a.ext === ".mjs"), "bytes"),
      languageDictionaryChunks: dictionaries.map((d) => d.path),
      languageDictionaryBytes: sum(dictionaries, "bytes"),
      languagesDetected: [...new Set(dictionaries.flatMap((d) => d.languages))].sort(),
      largestChunks: [...assets]
        .filter((a) => a.ext === ".js" || a.ext === ".mjs")
        .sort((a, b) => b.bytes - a.bytes)
        .slice(0, 10)
        .map((a) => ({ path: a.path, bytes: a.bytes, gzipBytes: a.gzipBytes })),
    }),
    ...notes.map((n) => stamp({ type: "note", ...n })),
  ];

  return { runId, records, assets, refs, notes };
}

/* ── CLI ──────────────────────────────────────────────────────────────── */

const HELP = `web-baseline.mjs — measure what the production build actually emits (read-only).

  node scripts/web-baseline.mjs [options]

  --dist=<dir>              Build output to measure.  Default: dist
  --out=<dir>               Where the NDJSON evidence is written.
                            Default: docs/evidence/d2/baseline
  --brotli-quality=<0-11>   Brotli quality. Default: 11 (slowest, smallest).
  --help, -h                This text.

Writes one newline-delimited-JSON file, <out>/web-baseline-<UTC>-<runId>.ndjson.
Every line carries runId and measuredAtUtc (ISO 8601, Z).

Exits non-zero, and writes nothing at all, when there is nothing honest to
report: an absent dist/, a dist/ with no JavaScript, or an index.html from which
no entry module can be resolved. An empty baseline reads as zero bytes, and zero
bytes reads as a triumph.`;

export function parseArgs(argv) {
  const o = { dist: "dist", out: "docs/evidence/d2/baseline", help: false, brotliQuality: 11 };
  const bad = [];
  for (const a of argv) {
    if (a === "--help" || a === "-h") o.help = true;
    else if (a.startsWith("--dist=")) o.dist = a.slice("--dist=".length);
    else if (a.startsWith("--out=")) o.out = a.slice("--out=".length);
    else if (a.startsWith("--brotli-quality=")) o.brotliQuality = Number(a.slice("--brotli-quality=".length));
    else bad.push(a);
  }
  o.unknown = bad;
  return o;
}

function isInside(child, parent) {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

export function main(argv) {
  const o = parseArgs(argv);
  if (o.help) { console.log(HELP); return 0; }
  if (o.unknown.length) {
    console.error(`web-baseline: unknown argument(s): ${o.unknown.join(", ")}\n\n${HELP}`);
    return 2;
  }
  if (!Number.isInteger(o.brotliQuality) || o.brotliQuality < 0 || o.brotliQuality > 11) {
    console.error(`web-baseline: --brotli-quality must be an integer 0-11, got "${o.brotliQuality}".`);
    return 2;
  }

  const dist = path.resolve(o.dist);
  const out = path.resolve(o.out);

  if (!fs.existsSync(dist)) {
    console.error(
      `web-baseline: ${dist} does not exist. Run the production build first (npm run build).\n` +
        `Refusing to write a baseline of nothing — a file of zeroes is indistinguishable from a small bundle.`
    );
    return 2;
  }
  if (!fs.statSync(dist).isDirectory()) {
    console.error(`web-baseline: ${dist} is not a directory.`);
    return 2;
  }
  /* An output directory inside the thing being measured would put the baseline
     into the next baseline, and would mean this instrument writes into the tree
     it promises not to touch. */
  if (isInside(out, dist)) {
    console.error(
      `web-baseline: --out (${out}) is inside --dist (${dist}). The instrument must never write within the tree it measures.`
    );
    return 2;
  }

  const { runId, records, assets, refs } = collectBaseline({ dist, brotliQuality: o.brotliQuality });

  const jsCount = assets.filter((a) => a.ext === ".js" || a.ext === ".mjs").length;
  if (jsCount === 0) {
    console.error(
      `web-baseline: ${dist} contains no JavaScript. That is not a small bundle, it is a build that did not happen.`
    );
    return 2;
  }
  if (!refs.entry) {
    console.error(
      `web-baseline: no entry module could be resolved from ${path.join(dist, "index.html")} ` +
        `(no <script type="module" src="…">). The entry bundle is the headline number of this baseline; ` +
        `reporting the rest without it would understate the payload.`
    );
    return 2;
  }

  let body;
  try {
    body = serializeRecords(records);
  } catch (err) {
    console.error(`web-baseline: refusing to write an unstamped record — ${err.message}`);
    return 2;
  }

  fs.mkdirSync(out, { recursive: true });
  const stampName = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(out, `web-baseline-${stampName}-${runId.slice(0, 8)}.ndjson`);
  fs.writeFileSync(file, body);

  const summary = records.find((r) => r.type === "summary");
  const initial = records.find((r) => r.type === "initial-payload");
  console.log(`web-baseline ${TOOL_VERSION} — ${records.length} records`);
  console.log(`  entry           ${initial.entry}  ${initial.entryBytes} B raw / ${initial.entryGzipBytes} B gzip`);
  console.log(`  initial payload ${initial.bytes} B raw / ${initial.gzipBytes} B gzip over ${initial.members.length} files`);
  console.log(`  all assets      ${summary.totalBytes} B raw / ${summary.totalGzipBytes} B gzip over ${summary.files} files`);
  console.log(`  dictionaries    ${summary.languageDictionaryChunks.join(", ") || "(none found)"} — ${summary.languagesDetected.join(",") || "-"}`);
  console.log(`  written         ${file}`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(process.argv.slice(2)));
}
