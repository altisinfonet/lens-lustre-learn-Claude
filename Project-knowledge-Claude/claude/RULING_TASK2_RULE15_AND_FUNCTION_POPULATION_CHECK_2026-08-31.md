# Ruling — WO-13 Task 2, rule 15, the double-read, and a population check of the 73 functions

Issued 2026-08-31 by the compiler/audit session. §4 was measured in this container against the working clone.

---

## 1. WO-13 Task 2 — ACCEPTED. All three ledger claims reproduce, and the enumeration is the finding.

| Row | Measured | Ledger claimed | As-of |
|---|---|---|---|
| 1 · production `jtdtehuqtinjxropkkcn` | **7 policies**, RLS enabled | 7 | 2026-08-31T06:24:00.150559Z |
| 2 · staging `ztzutckwdhetphwghuzj` | **9 policies**, RLS enabled | 9 | 2026-08-31T06:24:03.390207Z |
| 3 · `submit-judge-decision` | **v23**, serving `access-control-allow-origin: *` | v23, `*` | 2026-08-31T06:24:49Z |

Measured first, compared second, as ordered. **Agreement on all three.**

### The counts were never the point, and Developer 2 was right to enumerate

**The two policies production lacks are both RESTRICTIVE — both tighten access.** Staging has them; production has neither:

- **`Banned users cannot comment on ads`** — INSERT, `NOT is_banned(auth.uid())`
- **`Ad comments follow the ad's visibility`** — SELECT, gated on the parent creative's `is_active` or admin

The other seven are identical across lanes on name, permissive flag, roles, cmd, `qual` and `with_check`.

**Stated plainly, because "7 vs 9" hides it: in production today, a banned user can comment on ads, and ad comments are readable irrespective of whether the parent creative is visible.** That is AF-17 made concrete, and D-10 remains a **post-merge** action. **The merge does not fix it; applying `20260828082136` does.**

### Row 3 was measured as *served*, not as *written* — the right instrument

Four OPTIONS preflights — production origin, staging origin, **`https://evil.example.org`**, and **no Origin at all** — **all returned `*`.** An arbitrary foreign origin receives the same grant as the production origin. That agrees with the deployed bundle carrying the literal `"Access-Control-Allow-Origin": "*"` at line 45. **Carried and served agree.** No `access-control-allow-credentials` on any probe, as-of 06:24:49Z — which bounds the impact and should be stated alongside.

---

## 2. The three disclosures — all correct, and one becomes a standing rule

### 2a. Route (a) correctly refused

> *"The connection role is `postgres` — superuser class, not a read-only role. The read-only property of this capture is a property of the statements I issued (SELECT only), not of a grant."*

**Correct, and the refusal is the valuable part.** §25.4 route (a) requires *"a separate auditor holding read-only access"*. A superuser connection used carefully is not read-only access. Claiming (a) here would have been the easiest and most damaging shortcut available today.

**My recommendation, for any repeat: use a read-only role.** A superuser session against production is one mistyped statement away from a write, and no standing constraint prevents a typo. Nothing improper occurred — SELECT only, no write — but the safety was procedural, not structural.

### 2b. RULE 15 — the observation is more important than the capture

> *"The file has a sha256, which proves it hasn't changed since I wrote it — it does not prove the values came from the databases. **A hash of one's own output is not provenance.**"*

**This is a real gap in the method this whole engagement has been using**, and nobody had named it. We have hashed everything for days. A digest proves **integrity since writing**. It says nothing about **origin**.

**Standing rule 15, adopted: a hash of one's own output proves integrity, not provenance. Provenance requires an instrument the verifier can independently re-run, or a witness the verifier trusts.**

Their own mitigation is the right one and it is what makes this capture usable: **every value is reproducible from the exact queries, and the queries are in the file.** That is provenance by re-runnability. Their conclusion stands as written — *"if a self-authenticating export is required, this does not meet that bar and should be re-taken as a CI job whose logs the auditor reads."*

### 2c. The redaction

Four lines carrying `set-cookie: __cf_bm=…` — a Cloudflare bot-management cookie. **Cookies are named in the standing constraint.** Redacted in the saved transcript, nothing else altered, disclosed unprompted. **Correct on every count.**

---

## 3. Developer 1 — order respected, and two rulings

**The sequence was honoured**: twelve rows written, hashed and published (`ae720a84…`, 4,345 B, 13 lines, 10 fields checked) **before** reading tranche 2. That is what made the convergence meaningful.

**`docs/PROMOTION_LEDGER.md` — verified, not accepted.** `git cat-file -e BASE:docs/PROMOTION_LEDGER.md` fails; +1,173/−0, 80,893 B. **The ledger does not exist on `main`; this promotion adds it.** Recorded `A`, N/A per §25.7.2, frozen under §28.

**Convergence, six for six**, independently produced: `generate-headers` 0, `generate-redirects` 0, `generate-seo-assets` 0, `lane-config` 1, `health-check` 2, `verify-bundle-isolation` 11 — identical to my §7 table, plus the same two `spawnSync(process.execPath, [path], …)` sites and the same argument-array observation from both.

### RULING — the double-read counts ONCE toward coverage, and TWICE as evidence

Developer 1's question, correctly refused rather than answered self-servingly: *"whether that counts once or twice toward §25.7.2 is your ruling, not mine."*

**Coverage is a property of the 138 paths, not of reading effort. Ten files read twice are ten files. It counts once.**

**But two independent readings of the same ten is a different and higher property, and it must be recorded separately: those ten scripts now carry a stronger evidentiary basis than any other files in the change set.** Recorded as **differential confidence**, not as coverage. Coverage denominators are never inflated by re-reading.

### RULING — the HIGH stands, but `risk` must be defined in the join header

Developer 1 raised `verify-schema-dependencies.mjs` MED→HIGH before knowing the answer, then discharged it themselves: all six `SOURCE_DIR` occurrences are an `existsSync`, a directory walk and three report strings; the only child process is `execFileSync("psql", [dbUrl, "-At", "-c", CATALOG_SQL], …)` — argv array, no shell — and `SOURCE_DIR` is not among its arguments, grep count 0.

**Do not alter the frozen row.** It records a routing judgement made before the answer existed, and it routed correctly — to the largest file in the change set, at the right question.

**But `risk = HIGH` on a row whose question came back clean will be misread by whoever signs.** The schema has no `residual` field and I am not re-cutting a frozen file to add one.

**Ruling: the joined file's header must define the column — `risk` records pre-review attention, not residual risk; discharges are recorded in `check`.** One sentence, stated once, prevents every HIGH in the document from being read as a defect.

**And their limit on the discharge is right and I adopt it:** it does not extend to the workflow line. The shell command is assembled by textual substitution before node exists. **Patching the workflow and not the script was correct — now established from source, twice, independently.**

---

## 4. My own work this round — a population check of all 73 functions, and it comes back clean

Neither half's per-file review asks a population-level question. This one is mine.

### 4a. Config coverage — exact, with no dead entries left

```
functions in tree at RC (excl. _shared)   73
[functions.*] entries in config.toml      24
in tree with NO config entry              49   → verify_jwt defaults to TRUE
config entry not in tree (dead config)     0
```

**Zero dead entries.** This independently confirms tranche 2: the three removed (`translate`, `vote-wallet-reward`, `expire-photo-verifications`) were the only stale ones, and the config is now exactly consistent with the tree. **49 functions inherit the safe default.**

### 4b. The 20 functions with `verify_jwt = false`, cross-checked against service-role use

Twenty are declared `verify_jwt = false`; **fifteen of them reference the service role**, which bypasses RLS entirely. I filtered for the dangerous combination — gateway does not verify, function holds an RLS-bypassing credential, and no obvious in-function caller check — and read every candidate.

| Candidate | Result on reading |
|---|---|
| `handle-email-suppression` | **CLEAN** — HMAC via `verifyWebhookRequest`, `401` on `invalid_signature`. My grep missed it because it uses none of `getUser`/`Authorization`/`auth.` |
| `handle-email-unsubscribe` | **CLEAN** — token-authenticated, from query param or form body. Token *strength* not characterised here |
| `sitemap` | **CLEAN as designed** — public endpoint. Service role is over-privileged for reading published content, but no exposure |
| `submit-judge-score` | **CLEAN** — `authenticateJudge(req)` is the first thing after the method check, `AuthError` → 401, and the seat-mode `as_judge_id` path requires admin, `403` otherwise |

**All four candidates cleared on reading. There is no finding here, and I am not going to manufacture one from a scan that produced candidates rather than defects.** `verify_jwt = false` in this codebase is a deliberate pattern — the function performs its own authentication so it can return a readable error instead of a gateway 401.

**The one observation that survives is least privilege, not authentication:** fifteen `verify_jwt = false` functions hold an RLS-bypassing credential, and `sitemap` demonstrates the pattern — a public reader granted a key that can read everything. **Post-promotion hardening item. Not a merge blocker, and not a §25 row.**

---

## 5. Standing

**Nothing here closes a row.** §25.4 unchanged. Rows 1, 2 and 3 are now **captured** — route (b), with the limit Developer 2 stated themselves — and remain **open** pending the owner's ruling under §25.7.3.

**Review coverage: 55 of 138 by per-file claim, plus a population-level check across all 73 functions.** Both live findings remain inside the reviewed set. The remaining per-file work sits with the two halves.

**Two things I did not do and will not imply:** I did not touch either database, and I have still not read the Option 2 patch — that branch is unpushed and unreachable from this clone.
