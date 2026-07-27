#!/usr/bin/env node
/**
 * add-i18n-keys — insert new keys into every language block of translations.ts.
 *
 * Why a script instead of hand-editing: translations.ts holds 7 separate
 * dictionaries. Adding a key by hand means 7 edits at 7 different line numbers,
 * and a single missed block silently ships an English string in that language.
 * This inserts into all 7 in one pass, bottom-up so earlier line numbers stay
 * valid, and refuses to run if a key already exists anywhere.
 *
 * Usage: node scripts/add-i18n-keys.mjs <batch.json>
 * batch.json shape: { "some.key": { "en": "...", "hi": "...", ... }, ... }
 * Every key must supply all 7 languages. No partial batches.
 */
import { readFileSync, writeFileSync } from "node:fs";

const LANGS = ["en", "hi", "bn", "mr", "gu", "ta", "te"];
const FILE = "src/i18n/translations.ts";
const ANCHOR = /^ {2}"auth\.email":/;

const batchPath = process.argv[2];
if (!batchPath) { console.error("usage: add-i18n-keys.mjs <batch.json>"); process.exit(1); }
const batch = JSON.parse(readFileSync(batchPath, "utf8"));
const keys = Object.keys(batch);
if (keys.length === 0) { console.error("empty batch"); process.exit(1); }

// Fail loudly on an incomplete batch rather than shipping a half-translated key.
for (const k of keys) {
  const missing = LANGS.filter((l) => typeof batch[k][l] !== "string" || batch[k][l] === "");
  if (missing.length) { console.error(`key "${k}" missing languages: ${missing.join(", ")}`); process.exit(1); }
}

const src = readFileSync(FILE, "utf8");
const lines = src.split("\n");

// Refuse to create a duplicate key — JS object literals silently keep the last
// one, so a duplicate would be an invisible bug.
for (const k of keys) {
  if (new RegExp(`^ {2}"${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}":`, "m").test(src)) {
    console.error(`key "${k}" already exists in ${FILE} — refusing to duplicate`);
    process.exit(1);
  }
}

const anchors = [];
lines.forEach((l, i) => { if (ANCHOR.test(l)) anchors.push(i); });
if (anchors.length !== LANGS.length) {
  console.error(`expected ${LANGS.length} anchor lines, found ${anchors.length}`);
  process.exit(1);
}

const esc = (s) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

// Bottom-up so each splice leaves the earlier anchor indices untouched.
for (let i = anchors.length - 1; i >= 0; i--) {
  const lang = LANGS[i];
  const block = keys.map((k) => `  "${k}": "${esc(batch[k][lang])}",`);
  lines.splice(anchors[i] + 1, 0, ...block);
}

writeFileSync(FILE, lines.join("\n"));
console.log(`inserted ${keys.length} key(s) into ${LANGS.length} language blocks (${keys.length * LANGS.length} values)`);
