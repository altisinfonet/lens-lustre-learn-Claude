# OFF-2 · the client outbox (D2 half) — an action made offline is sent once, exactly once

**Rule.** MASTER R-90 OFF-2; OFF-5 G4 ("QUEUED … sent exactly once when online"), R1 (FIFO), R5 (last intent), R7 (retry budget, 4xx final), R8 ("every outbox item carries a client-generated idempotency key (UUID v4)"). D1's half is `20261004_0008` (APPLIED on staging) and the contract `scripts/db-off2-outbox-contract.json` + `docs/evidence/d1/OFF-2/README.md`. R-82: design + enforced guard shown failing first + synthetic test.

## Design
| Piece | File | What it does |
|---|---|---|
| Outbox | `src/lib/offline/outbox.ts` | Own IndexedDB db `retina-outbox` (not the OFF-1 store: that one evicts; G7 says the outbox never is). **Key = `crypto.randomUUID()` once, in `enqueue`, stored with the item**; every send of the item carries it. FIFO; a retryable failure stops the drain. Back-off 1 s, 2 s, 4 s … 60 s ±20 %, max 8 sends. Like/unlike on a post collapse to the last intent. Paused offline (React Query `onlineManager` + OFF-3 net state). Per member; only the signed-in member's items are sent. |
| Sender | `src/lib/offline/outboxSender.ts` | Comment / report: `upsert(..., { onConflict: "<owner>,idempotency_key", ignoreDuplicates: true })`, then read back by (owner, key) = the original row. Like: insert on the natural key; **23505 = delivered**. Unlike: delete (idempotent). Status 0 / 408 / 429 / 5xx retry; any other error is final. |
| Hooks | `useReactToPost`, `useUnreactToPost`, `useAddComment`, `useReportContent` | `submit()` → **delivered** (online, as before) · **queued** (offline/dropped link: kept, comment shows "Pending") · throws (server refused → rollback + message, as before). `networkMode: "always"`: React Query no longer pauses these in memory, where a restart lost them. |
| Bridge | `src/components/OutboxBridge.tsx` (mounted in `App.tsx`) | Starts the outbox for the signed-in member; a queued delivery refreshes the feed (R1/R2); a background refusal is announced once (R3/R7). |
| Sign-out | `src/lib/offline/signOutWipe.ts` | Also wipes the outbox (G6): an unsent action is never sent under the next member. |
| Types | `src/integrations/supabase/types.ts` | `idempotency_key` on `post_comments` and `reports` (= 0008). |

Not in this unit (said, not hidden): posts (already keyed through `create_post_with_media(_idempotency_key)`; a queued composer post is OFF-5 R4, its own unit), follows / friend requests / mark-read / comment likes (in D1's contract, queued in a later unit; the guard below already scans their writes once they join `OUTBOX_TARGETS`).

## Proof
| Kind | File | Fails first on |
|---|---|---|
| **Build guard** | `scripts/web-off2-outbox-check.mjs` + `--self-test` (14 shapes), CI `d2-off2-outbox.yml` | **origin/staging b2aa236** (`guard-fail-first.txt`): no `OUTBOX_TARGETS`; `useAddComment.ts:76` and `useReportContent.ts:48` insert straight into keyed tables. Also fails on any outbox table outside D1's contract or with a different owner / on_conflict / natural key. |
| **Synthetic (vitest)** | `src/lib/offline/__tests__/outbox.test.ts` — 18 tests, the REAL supabase-js against `src/uiharness/fakeTables.ts` (enforces staging's constraints; `loseAnswers(n)` = commit, then the answer is lost) | The pre-OFF-2 insert replayed the same way makes **3 comments** (test "FAILS FIRST"). With the outbox: **1** comment, 1 report, 1 like after 3 sends each; `randomUUID` called once per action across retries; read-back = the first row. **7 mutants all caught** (`mutants.txt`): new key per send, no key, report key regenerated, 4xx retried, FIFO not held, no collapse, sends while offline. |
| **Real browser (OFF-6 leg 2)** | `tools/uishot/offline-harness.mjs` (CI `d2-offline-harness.yml`) | Offline, Like tapped on the REAL Feed (unlike→like on the already-liked fixture post) → **1** queued like on the device → app restarted online, the server loses the first 2 answers → **1 row after 3 sends, outbox empty** (`off6-leg2-pass.json`). **Pre-OFF-2 like hook: 0 rows** (`off6-leg2-FAILFIRST-pre-OFF-2-hook.json`). **Mutant, outbox kept in memory only: 0 rows** (`off6-leg2-MUTANT-outbox-not-on-device.json`). |

Leg 2 drives a like (natural key). The keyed case — a comment, where only the stored key prevents a duplicate — is proved in vitest with the real client and mutants M1/M2.

## Existing test changed (declared)
`src/lib/offline/__tests__/signOutWipe.test.ts`: the wipe result gained a field (`outbox`), so the two exact-shape `toEqual` expectations now include `outbox: true`; one new test proves the outbox is emptied. No assertion was weakened.
