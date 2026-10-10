# HANDOVER — CONNECT AND CONTINUE IN THE NEXT CHAT

**Written:** 2026-08-21 · **Repo HEAD when written:** `9160b75` on `main` (clean).
This document and the plan were then merged as **PR #85**, which is now the head of `main` —
confirm the actual current HEAD at the start of the next session rather than trusting a SHA here.
**Author:** the session that closed Phase 2's Android acceptance and wrote the Master Execution Plan.

This document exists for one purpose: so the next chat can pick up **without re-deriving
anything and without guessing**. Everything below is either a verified fact with its
evidence, or an explicitly labelled open question. Nothing here is inferred.

---

## 0. HOW TO START THE NEXT CHAT

Paste this as the first message of the new chat:

> Read the project docs `claude/HANDOVER_NEXT_SESSION.md`, `claude/TASK_LEDGER.md` and
> `claude/MASTER_EXECUTION_PLAN_FINAL_2026-08-21.md` before doing anything. Then confirm
> back to me: repo HEAD, the four connectors, and the exact next command. Do not start
> any workstream until I give it.

Then, when you are ready to work, give **one** of the two next commands in §7.

---

## 1. WHAT THIS PROJECT IS

**50mm Retina World** — a photography community app. React + TypeScript + Vite web app,
wrapped for Android via Capacitor. Supabase (Postgres + Auth + Storage) is the backend.
Cloudflare R2 + a Worker at `cdn.50mmretina.com` serve member photographs.

Repository: `https://github.com/altisinfonet/lens-lustre-learn-Claude` (branch `main`).

**No REELS, no LIVE, no video.** Standing owner rule.

---

## 2. CONNECTORS THE NEXT SESSION NEEDS

| Connector | Used for | If missing |
|---|---|---|
| **Supabase MCP** | `execute_sql` (read-only verification), `apply_migration`, `list_migrations`, `get_advisors` | Nothing in Phase 2/3 can be verified. Stop and tell the owner. |
| **Claude in Chrome** | Shipping code (see §4 — `git push` is proxy-blocked), GitHub PR/CI, Play Console, Cloudflare dashboard | Code cannot ship. Database work still can. |
| **Cloudflare MCP** | R2 bucket + Worker inspection for D-002/D-003 | D-002/D-003 cannot be executed. |
| **Projects** (attached) | The 217+ docs of prior evidence | Read-only history is lost. |

The daily monitoring task `trig_01E5WtgQDsCHhphQZvDoaS9c` (03:30 UTC, push-notified)
runs in a **fresh headless session**. Connectors authenticated interactively may not be
present there — that is a known limitation recorded in the plan, not a fault.

---

## 3. WHERE THINGS STAND (verified, not assumed)

### Phase 2 — 97%

- **Write path is live and proven.** RED-1 (detached `supabase.rpc`) is fixed at both
  call sites in `src/lib/media/postMediaWrite.ts`. Proof that it had never worked before:
  0 of 252 posts carried `idempotency_key`. First post through the fixed path:
  `98b2d052-aac5-4602-813b-ff9d2c9028c7` (key `ef03927f`), verified byte-for-byte by
  fetching the CDN object and matching SHA-256 `d9c85888…`.
- **Android channel accepted 2026-08-21** on build 1111 / v1.2.16. Two real app posts:
  - `7eaf0ef8-ab5f-45ad-881d-1cc3f60d54a9` — private, key `b0d9bbb1`, 1922×2560, sha `a2f31104…`
  - `aa98cf72-553c-40ef-923e-d203f60bd42d` — public, key `bbbef949`, 2048×1365, sha `3975df53…`
  Both `platform=app`, owner `cc691988-699f-4da5-9b2e-f2346c7303be`, ready+verified,
  ord 0, `image_urls` derived server-side, thumbnail siblings present.
  Earlier app posts at 06:18 and 06:43 that day are recorded as **FAIL** (old bundle).
- **Legacy media gap closed by decision, not by migration.** The "29 migratable slides"
  premise was overturned: 27 are Supabase-hosted 600px thumbnails absent from R2 (all
  404), and 2 are R2 covers refused by the `MIG-1019`/`MEDIA-2102` ownership rule.
  Recorded permanently in `docs/PERMANENT_LEGACY_EXCLUSIONS.md` (D-006).
- **Class-F repoint executed** — migration `20260820180836_classf_repoint_originals.sql`,
  exactly 8 posts / 20 slides as gated, every digest matching prediction (after
  `e449ef6d…`, others `9a204bfd…`, storage `3a3bc738…` over 116 objects, ref_set_md5
  `dce7bec8…`, 8 audit rows).

### The 3% that remains: D-002/D-003 — **EXTERNAL, BLOCKED**

Authorized delivery of private media. Spec: `docs/D003_AUTHORIZED_DELIVERY_SPEC.md`;
handover: `docs/D003_CLOUDFLARE_HANDOVER.md`. Steps 1–5 need Cloudflare access the owner
holds. Steps 6–9 (unauthenticated-byte negative test against both endpoints, positive
matrix, transition tests, evidence record) are Claude's. **Phase 2 reaches 100% on that
evidence and no other way.** Do not partially implement it; do not mark it internal.

### Phase 3 — specified, NOT started

`claude/PHASE3_OFFLINE_RESILIENCE_AUDIT_2026-08-21.md` proved that Phase 3 **as
originally specified is upload-only** and that the blank offline feed has **5 distinct
causes** (30-minute self-deleting `feed_cache_v1` TTL in `src/lib/feedCache.ts`;
`placeholderData` in `src/hooks/feed/useFeedQuery.ts:451-469`; the
`isError && posts.length === 0` branch at `src/pages/Feed.tsx:319`; the localhost guard
at `src/main.tsx:120-124`; and `public/sw-image-cache.js:38-52` patterns that miss
`cdn.50mmretina.com`). The full spec is Part V of the Master Execution Plan.

**Two owner decisions gate the design:** D-007 and D-008. Both are open.

### Phase 4, Phase 5 (beyond the monitoring slice) — NOT started

---

## 4. HOW WORK SHIPS — READ THIS BEFORE TOUCHING CODE

**Direct `git push` from the sandbox is proxy-blocked.** The working transport is:

1. GitHub web UI, **one directory per commit**.
2. **After every commit, verify each file's blob SHA against the local `git hash-object`
   value.** The web UI silently dropped 3 commits in the last session — the commit button
   moves when a "ProTip" line appears. Every drop was caught only by this check.
3. PR → **7 CI gates** (`android-build`, `apply-migration`, `health`, `security`,
   `typecheck`, `ui-gate`, `web-build`) → squash-merge.
4. CI typecheck runs `tsc --noEmit -p tsconfig.app.json`, which is **stricter than bare
   `npx tsc --noEmit`**. Always verify with the exact CI command.
5. Database changes go through `apply_migration`; the repo ledger file is then renamed to
   the server-assigned version.
6. Android ships only when a **human** uploads the signed AAB from the `android-build`
   workflow artifacts to the Play Console. `PLAY_SERVICE_ACCOUNT_JSON` has never been
   configured, so the Play upload step is skipped in every run (runs 110 and 111 included).

---

## 5. STANDING RULES — NEVER VIOLATE

1. `supabase.rpc` / `supabase.from` are called **in call position, never stored**. The
   detached-method bug shipped twice and cost members their posts. Locked by a
   prototype-bound test mock, a repo-wide static scan, and mutations R1a–R1f.
2. The **frozen 229-migration fence and historical manifests are immutable.**
3. **`MIG-1019` / `MEDIA-2102` ownership rules are not widened** (owner at path segment 2).
4. Migration work comes **only from an approved, hashed manifest** — never a live scan.
5. **`image_urls` is derived inside `post_publish_with_media`**, never caller-supplied.
6. The legacy insert in `WallPosts.tsx` is **the airbag** (D-005), with classified failure
   reporting (MEDIA-4009/4010). It must never become the normal route.
7. No REELS, no LIVE, no video.
8. Never `npm install` casually; Capacitor versions stay pinned; `android/` is not committed.
9. **Mutation harnesses refuse a RED baseline.** A harness once printed 24 green ticks over
   a failing suite. Stale mutation targets are **retargeted with the invariant restated** —
   never deleted, never weakened.
10. **A human-reported PASS enters the plan only with a correlated production row** (G1).
    "The photo appeared" is not proof.

---

## 6. KNOWN TRAPS (each cost real time)

- **A test mock that is an object literal cannot reproduce a prototype-receiver bug.** The
  mock must be class-based, and the classes must live **inside** the `vi.mock` factory (TDZ).
- **`MEDIA-2205`**: `post_attach_media` requires
  `_origin || '/' || (mo.derivatives->>'original') = _slides[t.ord]`. This makes "keep the
  Supabase `image_urls` and attach R2 media" architecturally impossible. Do not try again.
- **Capacitor bundles are frozen at build time** (`webDir: 'dist'`, no `server.url`). An
  installed APK never picks up a web deploy. App origin is `https://localhost`.
- **`apply_migration` can time out having applied nothing.** Verify before retrying —
  last time the audit table's absence proved it had not applied.
- **New tables need explicit RLS.** `media_repair_audit` shipped without it; caught by
  `newTableGrants.test.ts` *after* production application. Add RLS in the same migration.
- Repo-wide static scans must exclude `__tests__` and use a `(?!\s*\()` lookahead, or
  `supabase.from("x").select()` produces false positives.

---

## 7. THE EXACT NEXT COMMAND

**Primary:**

> **"PHASE 2 — CLOSE D-002/D-003."**

Precondition: the owner completes or authorizes the Cloudflare steps (§4.3 items 1–5 of
the Master Execution Plan). Claude then executes items 6–9 and, on PASS, recalculates
Phase 2 — which reaches 100% on that evidence and no other way.

**Alternative, if Cloudflare access is still being arranged** (no external dependency):

> **"PHASE 1 — CERTIFICATION SWEEP."**

Covers the Phase-1 rows still open in the status table: EXIF/GPS certification, the
historical ledger baseline, mirror-trigger `20260429071225`, anonymous judging grants
`20260504132638`, B3d-IMG-1 image delivery, the strict-TS scoped sweep, and
realtime/feed/pagination certification.

**Phase 3 is not to be started** until Phase 2 closes and the owner decides D-007/D-008.

---

## 8. OWNER ACTIONS OUTSTANDING

1. Roll out build 1111 to Play (draft from actions run `32438058103`) so the fleet tail decays.
2. **Settle GitHub billing before 2026-08-31** — Actions is every gate; if it lapses, nothing ships.
3. Grant or perform the Cloudflare steps for D-002/D-003.
4. Decide **D-007** and **D-008** before any 3R-READ design work is approved.
5. Optional: capture the About screen; delete the WS2 private test post `98b2d052…`.

---

## 9. THE 11 OPEN TASKS

Itemised with evidence in `claude/TASK_LEDGER.md` (127 tasks: 116 completed, 9 pending,
2 in_progress). Summary of what they mean:

- **None of them blocks Phase 2 closure.**
- #44, #45, #46, #47, #54, #55 are device-observable UI bugs → fold into the **Phase 3A/3B
  device matrix**, do not fix ad hoc.
- #34 (Instagram-style composer) and #52 (HashtagTypeahead across four caption surfaces)
  are **product features, not gates**.
- #87 and #91 are **stale-open bookkeeping** — the work exists, shipped and is
  mutation-locked. Close them explicitly after a short confirmation; **they were not
  closed by assumption here.**
- #35 is effectively overtaken by builds 1102–1111, but the original "showroom batch"
  scope was never itemised, so it could not be proven the same work.

---

## 10. WHERE EVERYTHING LIVES

| What | Where |
|---|---|
| Authoritative plan | project: `claude/MASTER_EXECUTION_PLAN_FINAL_2026-08-21.md`; repo: `docs/MASTER_EXECUTION_PLAN.md` |
| Task ledger | project: `claude/TASK_LEDGER.md`; repo: `docs/phase2-evidence/TASK_LEDGER.md` |
| This handover | project: `claude/HANDOVER_NEXT_SESSION.md`; repo: `docs/HANDOVER_NEXT_SESSION.md` |
| Phase 2 evidence reports | project `claude/PHASE2_*`; repo `docs/phase2-evidence/` |
| Decision register | repo `docs/DECISIONS.md` (D-001…D-006) |
| Permanent exclusions | repo `docs/PERMANENT_LEGACY_EXCLUSIONS.md` (27+2) |
| Error codes (91) | repo `docs/error-codes.md` — regenerate with `npx tsx scripts/generate-error-codes.ts` |
| Traps read-first | repo `docs/known-traps-read-first.md` |
| Shipping procedure | repo `docs/how-to-ship-code-and-sql.md` |

---

**Handover complete. The next session should confirm §2 and §3 before accepting any
command, and must not begin a workstream that the owner has not named.**
