# PRODUCTION LEDGER

**THE AUTHORITATIVE RECORD OF WHAT IS TRUE ON PRODUCTION TODAY — 2026-09-06.**

**Commissioned by the Owner**, in his words: *"write the full PRODUCTION LEDGER, without missing a
single word."*

**Lane:** `main` → Supabase `jtdtehuqtinjxropkkcn` → `www.50mmretina.com` / `cdn.50mmretina.com` /
R2 `50mm`.

**This is NOT the promotion ledger.** `docs/PROMOTION_LEDGER.md` records how work travels. **This
document records only what IS**, on production, today. It is deliberately a separate file.

---

## 0 · HOW TO READ THIS DOCUMENT — the rule it is written under

**Every line carries WHO measured it, WHEN, and FROM WHAT.** A claim without those three is not in
this document.

| label | meaning |
|---|---|
| **D3** | the documentation lane. Measured from the git repository, `2026-09-06T11:11Z`. |
| **Auditor** | measured on production `jtdtehuqtinjxropkkcn`, 2026-09-06, instrument named per line. |
| **D1** | the database lane, instrument named per line. |
| **UNKNOWN** | **not measured. NOT inferred, NOT assumed, NOT probably-fine.** |

**NO CLAIM IN THIS DOCUMENT SURVIVES ON THE AUDITOR'S AUTHORITY ALONE.** Where he is the source, the
line says so, and a reader who doubts it can take the reading again from the instrument named.

**Where D3 could verify a figure independently, D3 did, and the line says which of us measured it.**

---

## 1 · LANE IDENTITY — **measured by D3, from the git repository, 2026-09-06T11:11Z**

| field | value |
|---|---|
| `origin/main` HEAD | **`df4098840889148e1d9c8cfe9d42c19cb2dffb3d`** |
| short | **`df409884`** |
| tree | `61a4e0d5dd1fc0cb00b3e24760dbb1d02aeb43d1` |
| subject | *"F-105 production revokes → main: three files, five REVOKEs, nothing else (#206)"* |
| committed | **2026-09-06T15:26:14+05:30** |
| actor | `Altis Infonet Private limited` |
| tags on origin | **one — `RC-20260831-01`.** No promotion tag exists |

**`main` is 183 commits behind `staging`, and 244 files differ** — 131 under `src/`, 19 under
`supabase/migrations/`, 2 under `functions/`, **0** under `public/` and **0** under
`.github/workflows/`. *(D3, git, 2026-09-06T11:11Z.)*

### 1.1 · ⚠ `main` HAS MOVED SINCE THE PROMOTION LEDGER LAST RECORDED IT

**`docs/PROMOTION_LEDGER.md` §44 (REV-31) records production as untouched at `b309576`. THAT IS NO
LONGER TRUE.** Two commits have landed since:

| commit | when | subject |
|---|---|---|
| `25e2f03a` | 2026-09-06T09:39:20Z | F-105 production revokes: three files, **four** REVOKEs, nothing else |
| `df409884` | 2026-09-06T15:26:14+05:30 | F-105 production revokes → main: three files, **five** REVOKEs, nothing else (#206) |

**D3 counted the REVOKE statements: there are FIVE.** The squash title is correct; **the branch
commit's "four" undercounts its own diff.** *(D3, `git diff b309576e origin/main`, 2026-09-06.)*

**THREE FILES LANDED. NOTHING ELSE.** `git diff --stat b309576e origin/main` is exactly three
migration files, **217 insertions, 0 deletions**. No `src/`, no workflow, no client change.
*(D3, git.)*

### 1.2 · The promotion ledger on production is SEVEN REVISIONS BEHIND

`main`'s copy of `docs/PROMOTION_LEDGER.md` reads **`REV-24`** at line 9. **§40 through §44 —
REV-27 through REV-31 — are ABSENT from `main`.** *(D3, git, 2026-09-06T11:11Z.)*

---

## 2 · THE DATABASE — **OPEN DOORS**

**Measured by the Auditor on production `jtdtehuqtinjxropkkcn`, 2026-09-06, from
`aclexplode(proacl)` — NOT from `has_function_privilege` — and confirmed over REAL ANONYMOUS HTTP
with all-zero UUIDs.**

| function | ACL | anon | HTTP |
|---|---|---|---|
| `are_friends(uuid, uuid)` | 1 empty-grantee entry | **EXECUTE** | **200** |
| `friend_count(uuid)` | 1 empty-grantee entry | **EXECUTE** | **200** |
| `mutual_friend_ids(uuid, uuid, integer)` | 1 empty-grantee entry | **EXECUTE** | **200** |
| `mutual_friends_count(uuid, uuid)` | 1 empty-grantee entry | **EXECUTE** | **200** |
| **`search_certificates(text, text, date)`** | 1 empty-grantee entry | **EXECUTE** | **STILL OPEN** |
| `profiles_public_data` *(control)* | — | — | **200** |

**An empty grantee in `proacl` is the PUBLIC grant.** Both instruments agree: the catalogue says the
door is open and an anonymous caller walked through it. **A control was taken**, so a 200 here means
the door opened and not that the probe was broken.

---

## 3 · THE DATABASE — **ALREADY CLOSED**

**Auditor, production, 2026-09-06, `aclexplode(proacl)` + HTTP.**

| function | ACL | state |
|---|---|---|
| `get_todays_birthdays(uuid)` | **0 empty-grantee entries**, no anon, **keeps `authenticated`** | **HTTP 401.** Result type is still the **three-column pre-F-98c shape** |
| `email_exists(text)` | **0 empty-grantee entries** | **the P30 revoke IS APPLIED** |
| `admin_search_certificate_recipients` | **0 empty-grantee entries** | closed |

---

## 4 · DATABASE CALLERS — **all SECURITY DEFINER, therefore unaffected by any revoke**

**Auditor, production, 2026-09-06.**

| caller | calls |
|---|---|
| `can_view_post` | `are_friends` |
| `get_profile_visible_fields` | `are_friends` |
| `check_friend_limit` | `friend_count` |
| — | **`mutual_friend_ids` and `mutual_friends_count` have NO DB caller** |

**This is why the revokes are safe to apply: every in-database caller runs as DEFINER and does not
consult the caller's grants.**

---

## 5 · THE DEPLOYED PRODUCTION CLIENT

**Auditor, 2026-09-06, by scanning the deployed bundle: the entry chunk plus all 141 lazy chunks,
ZERO fetch failures.**

| item | reading |
|---|---|
| entry bundle | **`index-QwZFENIl.js`** — **unchanged before and after PR #206 merged** |
| `get_todays_birthdays` | **ZERO call sites** |
| `friend_count` | **ZERO call sites** |
| `are_friends` | **entry chunk only** |
| `mutual_friend_ids` | `PublicProfile`, `Friends`, `Discover` |
| `mutual_friends_count` | `PublicProfile`, `useFriendFollow`, `Friends` |

**Deployed edge function `dashboard-init`, version 28**, builds with `SUPABASE_SERVICE_ROLE_KEY` and
**calls the birthdays RPC as admin.** *(Auditor.)*

**The bundle being unchanged across #206 is consistent with §1.1: three migration files landed and no
client file did.** *(D3, cross-check against the git diff.)*

---

## 6 · WHAT PRODUCTION ALREADY HAS — **contrary to what was assumed**

**Auditor, production, 2026-09-06.**

**Present:** `resolve_custom_url` · `username_available` · `profiles.custom_url` ·
`profiles_public_data.custom_url`.

**Fixture accounts on production: ZERO.**

---

## 7 · THE CENTRAL FACT OF THIS DOCUMENT

> # THREE MIGRATION FILES ARE ON `main`. **ZERO OF THEM ARE APPLIED.**

**The files, on `main` at `df409884`** *(D3, git, 2026-09-06)*:

| file | what it would REVOKE |
|---|---|
| `20260910_0016_f105a_birthdays_revoke_authenticated.sql` | `get_todays_birthdays(uuid)` — **from `authenticated`** |
| `20260910_0017_f105c_friend_graph_not_anonymous.sql` | `mutual_friend_ids`, `mutual_friends_count`, `are_friends` — **from PUBLIC, anon** |
| `20260910_0018_f105c_friend_count_not_anonymous.sql` | `friend_count(uuid)` — **from PUBLIC, anon** |

**AND THE DOORS ARE STILL OPEN.** §2 measures `are_friends`, `friend_count`, `mutual_friend_ids` and
`mutual_friends_count` as anon-executable with HTTP 200 **today**, and §3 measures
`get_todays_birthdays` as **still holding `authenticated`**.

**The Auditor states it directly: "Production untouched at the time of writing: zero of the revokes
applied."**

**A MIGRATION FILE ON `main` IS NOT AN APPLIED MIGRATION. COMMITTING IS NOT APPLYING.** Anyone
reading `main`'s tree and concluding that production is closed has read the wrong instrument. **The
instrument for an applied grant is `proacl`, and an anonymous HTTP call. Both were taken. Both say
open.**

---

## 8 · THE GATE

**Read by the Auditor off the ENVIRONMENT SETTINGS PAGE — not off the workflow comment.** 2026-09-06.

| setting | value |
|---|---|
| Required reviewers | **ON — `altisinfonet`** |
| Prevent self-review | **OFF** |
| Wait timer | **OFF** |
| Allow administrators to bypass | **OFF** |
| Deployment branches | **restricted to `main`** |

**NOTHING REACHES PRODUCTION WITHOUT THE OWNER, AND NOBODY CAN BYPASS.**

**⚠ `apply-migration.yml`'s own header claims a required reviewer is "still NOT configured". THAT
COMMENT IS FALSE**, and it is **the third stale comment found in that file.** *(Auditor,
environment settings page vs. the file.)*

**The comment and the setting disagreed, and the setting is the system.** A reader trusting the
header would have believed production was ungated when it is gated by the Owner himself.

---

## 9 · THE QUEUE — and why `search_certificates` is still open

**Auditor and D1, 2026-09-06, from the run pages.**

| run | created | on | carries | state |
|---|---|---|---|---|
| **#22** | — | production | the **P30 `email_exists` revoke** | **SUCCEEDED in 17 s, approved by the Owner** |
| **#23** | **2026-09-05T01:36:01Z** | `main` at **`b309576`** | the **P31 `search_certificates` revoke** | **PARKED on the production review gate ever since** |
| **#38** | **2026-09-06T09:56:56Z** | `main` at **`df40988`** | **migration 0016** | **BLOCKED behind #23** |

**#23's payload was PROVED by D1 from its own session transcript — the dispatch call one second
before the run was created. NOT inferred.**

**#38 is blocked by concurrency group `apply-migration-production` with `cancel-in-progress: false`.**

> **`search_certificates` IS STILL OPEN ON PRODUCTION TODAY BECAUSE RUN #23 HAS BEEN PARKED ON THE
> REVIEW GATE SINCE 2026-09-05. THAT IS THE WHOLE REASON.**

### 9.1 · F-112 — a parked run's payload is invisible to the person approving it

**`apply-migration.yml` has NO `run-name`.**

**Consequence: the person clicking approve cannot see what they are approving.**

**D1 proved all three routes fail:**

1. **GitHub does not persist dispatch inputs in the REST run object**
2. **the job never starts, so no log exists**
3. *(third route proved failed by D1)*

**THE FIX IS ONE LINE.**

**This is the gate working exactly as designed and being useless anyway**: the Owner is required to
approve, cannot bypass, and **cannot see what he is approving.**

---

## 10 · THE ERASER — order matters, and getting it wrong is silent

**D1, confirmed on production, and measured on staging on the real function, oid `17849` → `22509`.**

> **`0016` applied BEFORE `0015` is SILENTLY UNDONE by `0015`'s DROP and CREATE.**

**Why:** Supabase **default privileges re-grant `authenticated`** on the recreated function, and
**`0015` revokes only PUBLIC and anon.** So the `authenticated` revoke that `0016` performed is
restored by `0015` and **nothing reports it.**

**The order is not a preference. Applied in the wrong order, the work is undone and the record says
it succeeded.**

---

## 11 · OWNER RULINGS — verbatim

**Source: the Auditor, relaying the Owner, 2026-09-06.** **D3 did not hear these directly and has no
independent instrument for them.** They are quoted rather than paraphrased so that a later reader
judges their scope from the Owner's own words and not from anyone's summary of them.

| ruling | words |
|---|---|
| the two revokes | **"All approved - Go"** |
| which to apply | **"option 2"** — meaning **`0017` and `0018` to production now, and `0016` HELD** |
| PR #207 | **"1st merge"** — authorising it into `staging` |

**`0016` is HELD BY THE OWNER. It is not forgotten, not deferred by us, and not pending on any
technical blocker — he ruled it held**, and §10 is why that ruling is correct.

---

## 12 · UNKNOWN — what this document does NOT know

**Listed because an unlisted unknown reads as a known.**

| item | state |
|---|---|
| Whether `0017` and `0018` have been applied since the Auditor's reading | **UNKNOWN.** His reading is 2026-09-06 and says zero applied; **no later reading exists in this document** |
| The production result-type of `get_todays_birthdays` after any F-98c change | **UNKNOWN.** Measured today as the **three-column pre-F-98c shape** |
| Whether run #23 has been approved since 2026-09-06 | **UNKNOWN** |
| The third of D1's three failed routes for F-112 | **UNKNOWN to D3** — D1 proved three; two are recorded here by name |
| Production row counts, database size, and F-99's eighteen low-opacity blocks | **NOT RE-MEASURED for this document.** Earlier figures live in `PROMOTION_LEDGER.md` §43.5 and §44 and are **not restated here as current** |
| Whether any production change occurred between the Auditor's reading and this file's commit | **UNKNOWN** |

---

## 13 · PROVENANCE

**D3 measured, from the git repository at 2026-09-06T11:11Z:** `main`'s SHA, tree, subject, commit
time and actor; the tag list; the 183-commit and 244-file gap; the per-directory deltas; the three
migration filenames and their REVOKE targets; the **five** REVOKE statements; `main`'s ledger
pointer at REV-24; and the absence of §40–§44 from `main`.

**The Auditor measured, on production 2026-09-06:** every ACL reading in §2 and §3, from
`aclexplode(proacl)`; every HTTP result, as a real anonymous caller with all-zero UUIDs, with a
control; the DB callers in §4; the deployed-bundle scan in §5 across 141 chunks with zero fetch
failures; the edge function version; §6; the environment settings page in §8; and the queue in §9.

**D1 measured:** run #23's payload from its own session transcript; the three failed F-112 routes;
and the eraser in §10, on the real function, oid `17849` → `22509`.

**Nothing in this document rests on a merge title, a workflow comment, a migration filename, or
anyone's recollection.** Where those disagreed with an instrument — and in §1.1, §8 and §7 they did —
**the instrument is recorded and the claim is not.**

*Written by D3, the documentation lane, 2026-09-06, on the Owner's commission. It authorises nothing
and applies nothing.*
