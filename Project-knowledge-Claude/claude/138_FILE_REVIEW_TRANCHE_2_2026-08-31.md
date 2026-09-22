# §25.7.2 item 2 — 138-file review, tranche 2: scripts, config, migrations, `_seo.ts`

Issued 2026-08-31 by the compiler/audit session. Performed against the working clone, read-only.
Continues `05_138_FILE_REVIEW_SECURITY_TRANCHE.md`. **Cumulative coverage: 55 of 138.**

---

## 1. `functions/_seo.ts` — the defect located exactly. It is one line, not a general failure.

I had carried this as RELAYED. Read at `a42b209e`, it is **not** what "missing escaping" suggests.

**An escaping helper exists and is thorough** (line 69):

```js
export function esc(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
```

All five characters. And **every** attribute sink uses it — lines 121–130, `og:title`, `og:description`, `og:image`, `og:url`, `og:type`, `twitter:*`, `rel="canonical"`. Ten sinks, ten `esc()` calls.

**One sink does not — line 118:**

```js
? `<script type="application/ld+json">${JSON.stringify(meta.jsonLd)}</script>`
```

`JSON.stringify` does not escape `<`. A string field containing `</script>` **terminates the script element**, and everything after it is parsed as HTML. That is the standard JSON-LD escape defect.

**`esc()` cannot be the fix here** — HTML-escaping a JSON document destroys the JSON. The correct fix is unicode-escaping the dangerous characters *inside* the serialised output (`<` → `<`, and conventionally `>` and `&`), which remains valid JSON and inert in HTML.

**This independently confirms the shape of the Option 2 patch.** Developer 1 reported that their own document had transcribed the fix as `.replace(/</g, "<")` — the escape eaten — and that the branch actually carries `<`. **`<` is exactly the fix this defect requires.** I reached that from the defect without seeing the patch, and it matches.

### WO-8 B2 — answered here, from source

The question outstanding since WO-8 was whether `stripHtml` is an escape. **It is not.** Line 76:

```js
export function stripHtml(s: string): string {
  return String(s ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}
```

It **removes tag-shaped substrings**. It does not neutralise `<`, and it is not a sanitiser — `<img src=x onerror=…` with no closing `>` survives it, and any `<` reaching an HTML sink is still live. **It must never be relied on as a defence.** WO-8 B2: **VERIFIED — `stripHtml` is a tag stripper, not an escape.**

### Threat model

`meta.jsonLd` originates from `fetch(\`${supabaseUrl(env)}/rest/v1/${path}\`)` — database content. Prior measurement established that JSON-LD writers are admin / `content_editor`. **So this, like the workflow finding, is an authenticated-privileged-actor exposure, not an anonymous one.** Both findings in this release share that shape and should be described together.

---

## 2. `supabase/config.toml` — the deletion-only change. **CLEAN.**

Six lines removed, nothing added — flagged in tranche 1 because a deletion-only config change should never pass unexplained. Three entries were removed:

```toml
-  [functions.translate]                     verify_jwt = false
-  [functions.vote-wallet-reward]            verify_jwt = false
-  [functions.expire-photo-verifications]    verify_jwt = false
```

Removing a `verify_jwt = false` entry would normally be a **security-relevant change**, because Supabase defaults `verify_jwt` to true when a function has no entry — a live function would begin requiring a JWT and its callers would break.

**Measured, on both endpoints:**

| Function | on `main` | at candidate |
|---|---|---|
| `translate` | absent | absent |
| `vote-wallet-reward` | absent | absent |
| `expire-photo-verifications` | absent | absent |
| `translate-text` | **EXISTS** | **EXISTS** |

**All three are stale entries for functions that do not exist in either tree. The change is dead-config removal with no effect on any live function.**

**One trap worth recording:** `translate` is **not** `translate-text`. `translate-text` exists, is deployed, and keeps its own config. A reviewer skimming the diff could easily read the removal of `[functions.translate]` as affecting `translate-text`. It does not.

**Claim: VERIFIED — no security effect.**

---

## 3. `scripts/verify-schema-dependencies.mjs` (+906) — **CLEAN. The vulnerability is not here.**

This is the largest single file in the change set and it consumes the input the workflow passes.

```js
const SOURCE_DIR = process.argv[2] || "src";                       // line 48
out = execFileSync("psql", [dbUrl, "-At", "-c", CATALOG_SQL], {…}) // line 754
```

- `SOURCE_DIR` is read from **`process.argv[2]`** — an argv element, never a shell string.
- The only child process is **`execFileSync` with an argument array**, which does **not** invoke a shell. `dbUrl` and the SQL are separate argv entries, not concatenated into a command line.
- **`SOURCE_DIR` never reaches `execFileSync`.**
- The failure path states *"(The connection string is never printed.)"* — deliberate credential hygiene in the error handler.

**This narrows the fix correctly and confirms the Option 2 scope was right.** The exposure is entirely in the YAML line

```yaml
run: node scripts/verify-schema-dependencies.mjs '${{ inputs.source_dir }}'
```

— where the shell command is assembled by textual substitution **before node exists**. Patching the workflow and not the script is the correct decision, and I can now say so from source rather than by deference.

---

## 4. `supabase/migrations/20260828082136…` (D-10 / AF-17) — the arithmetic confirmed

```sql
DROP POLICY IF EXISTS "Banned users cannot comment on ads" ON public.ad_creative_comments;
CREATE POLICY      "Banned users cannot comment on ads"        …
DROP POLICY IF EXISTS "Ad comments follow the ad's visibility" ON public.ad_creative_comments;
CREATE POLICY      "Ad comments follow the ad's visibility"    …
```

**Exactly two policies created**, each idempotently dropped first.

§25.4 row 1 expects `pg_policies` on `ad_creative_comments` to read **7 pre-migration and 9 after**. **7 + 2 = 9.** The ledger's expectation is now confirmed **internally consistent with the migration source**.

**This does not measure the database** — rows 1 and 2 still require a read-only query, and that remains open. It does establish that the expected delta is arithmetically right, so a measured 7-and-9 would corroborate rather than coincide.

---

## 5. `.gitleaks.toml` (AF-19) — correct fix, and an unusually honest one

The allowlist moves from **one** pinned anon-key literal to **two** — production and staging — each pinned by **exact literal, not by pattern**. So a `service_role` key, a rotated anon key, or any other JWT still fails the scan. That is the right design: the pin is what forces re-validation on rotation.

The file also documents its own detection gap without being asked:

> *"It did not fail the gate immediately because the scan runs `--no-merges --first-parent <range>` and the range did not reach back to…"*

**Root cause recorded as a one-lane allowlist never extended when `ccd5e423` added a second lane.** A control whose comment explains why it failed to fire is worth more than one that only says what it does.

**Claim: VERIFIED — fix is correct and correctly scoped.**

---

## 6. `supabase/rollback/` — deviation D-1 confirmed present

Five files. **Three carry the `UNAPPLIED_` prefix**, exactly as deviation D-1 records:

```
UNAPPLIED_20260825060000_certificate_types_and_admin_search_ROLLBACK.sql
UNAPPLIED_20260825120000_certificate_delete_removes_notifications_ROLLBACK.sql
UNAPPLIED_20260825170000_certificate_custom_heading_ROLLBACK.sql
```

plus the two matching the applied migrations. **D-1 is present in the tree as described. No discrepancy.**

---

## 7. Remaining scripts — no input surface

| Script | `process.argv` / `process.env` references |
|---|---|
| `generate-headers.mjs` (+125) | **0** |
| `generate-redirects.mjs` (+43/−10) | **0** |
| `generate-seo-assets.mjs` (+111) | **0** |
| `lane-config.mjs` (+73) | 1 |
| `health-check.mjs` (+5/−10) | 2 |
| `verify-bundle-isolation.mjs` (+193/−14) | 11 (it is a checker; env is its subject) |

The three generators take **no external input at all**. None of the six invokes a shell. `test-isolation-guard.mjs` and `test-seo-assets.mjs` use `spawnSync(process.execPath, [path], …)` — argument array, no shell, and the executable is Node itself.

**Claim: VERIFIED — no shell-injection surface in the changed scripts.**

---

## 8. Coverage and what remains

**Reviewed with a stated claim: 55 of 138.**

| Reviewed | n |
|---|---|
| `.github/workflows/` | 8 of 8 |
| `functions/` | 1 of 7 (`_seo.ts`; six route files unread) |
| `scripts/` | 10 of 10 |
| `supabase/config.toml`, `migrations/`, `rollback/` | 8 of 8 |
| `.gitleaks.toml`, `vite.config.ts`, `vitest.config.ts`, `package.json` | 1 of 4 |

**Remaining: 83 files** — 44 `supabase/functions/`, 29 `src/components/`, 11 `src/__tests__/`, 9 `src/lib/`, 6 `functions/` routes, and the rest. **None of the remaining categories has produced a security finding in any prior measurement**, and the two live findings are both in the reviewed set.

---

## 9. Standing

**Nothing here closes a row.** §25.4 is the owner's rule: *"No row below may be marked closed by the compiler. The compiler is not a second party."*

Three claims moved from RELAYED or open to **VERIFIED from source** in this tranche: the `_seo.ts` defect and its required fix shape, `stripHtml` (WO-8 B2), and the `verify-schema-dependencies.mjs` clean bill.

**Two claims I explicitly did not make**: I have not measured either database, and I have not read the Option 2 patch — the replacement branch is unpushed and unreachable from this clone. The `_seo.ts` fix shape is my own derivation from the defect, not verification of the patch.
