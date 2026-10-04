# P12 — One translation chunk per language

**Gate (GATE_REGISTER, verbatim):** "selecting a language downloads that language only; the entry bundle and per-language
chunk sizes recorded."
**Proof type (R-82):** structural — the build emits one chunk per language (read from `dist/`), plus a behavioural test with a
fail-first mutant. No traffic reading.

## Change
- `src/i18n/translations.rest.ts` (527,277 B, six dictionaries in one chunk) → `src/i18n/translations.{hi,bn,mr,gu,ta,te}.ts`,
  one dictionary each, `export default`. The dictionary bodies are byte-identical line slices of the old file (1,116 lines each).
- `src/i18n/I18nContext.tsx`: a `LOADERS` map of six literal `import("./translations.<code>")` calls; the effect loads only the
  active language and merges only that dictionary.
- `scripts/web-bundle-budget.json`: the `translations.rest.js` ceiling removed — P13 failed this build until it was
  (`namedChunks["translations.rest.js"] matches no chunk in dist/`, 10:53 UTC), exactly as designed. The six new chunks
  sit under the 160 KiB default ceiling.

## Readings (staging-lane build of this branch, 2026-10-04)
`scripts/web-baseline.mjs` record: `web-baseline-2026-10-04T10-54-06-831Z-7a01ef69.ndjson` (this folder). The
`language` records now carry exact bytes (`blocked: null`) — the instrument said they would once P12 landed.

| language | chunk | raw B | gzip B | brotli B |
|---|---|---|---|---|
| hi | translations.hi-*.js | 79,500 | 18,808 | 15,809 |
| bn | translations.bn-*.js | 80,742 | 18,376 | 15,736 |
| mr | translations.mr-*.js | 77,778 | 18,729 | 15,919 |
| gu | translations.gu-*.js | 76,647 | 18,419 | 15,878 |
| ta | translations.ta-*.js | 95,621 | 19,182 | 16,249 |
| te | translations.te-*.js | 88,084 | 19,479 | 16,519 |
| **before** | translations.rest-*.js (all six) | **498,263** | | |
| entry | index-*.js | 1,651,879 (was 1,650,878: +1,001 B for the loader map) | 512,293 | |

A Hindi visitor's dictionary download: **498,263 → 79,500 B raw (−84 %)**.

**Each chunk holds its own language only** (10:53:45 UTC): every language's value for `post_see_translation` is unique (6/6);
scanning every `dist/assets/*.js`, each sentinel appears in exactly one chunk — its own — and in no other chunk, including the entry.

## Tests
- `src/i18n/__tests__/oneChunkPerLanguage.test.tsx` — renders `I18nProvider`; English loads nothing; `setLang("hi")` loads hi
  only; `setLang("ta")` then loads ta only. **Mutant** (hi's loader also pulls bn and ta — the pre-P12 shape) →
  `expected ['hi','bn','ta'] to deeply equal ['hi']`, red; reverted → green.
- `src/i18n/__tests__/lazyTranslations.test.ts` — **edited, and stated:** its two assertions about `translations.rest.ts`
  described the shape this unit replaces. They are re-pinned to the per-language shape (each file holds its language only,
  `translations.rest.ts` must not exist, every language imported dynamically and never statically). The intent — no
  dictionary in the boot chunk — is unchanged and the checks are stricter.

## Not in this unit
- `src/i18n/home.ts` (45,601 B, landing-page strings for all seven languages) stays eager in the boot chunk: making it lazy
  would show the English landing for a beat before the chosen language. **F-D2-15**: a separate unit with that trade stated.
- **F-D2-16:** `scripts/add-category-translations.mjs` (a one-off, already-applied helper) edits `translations.rest.ts` and now
  throws if re-run. Not a `web-*` script; left untouched, reported.
