# Phase C — Notification Recipient-Integrity Matrix (2026-08-15)

**Commits:** `53af826` matrix · `0fd485f` gate (7 mutations) · `e798f18` evidence. All byte-identical on origin, 0 unpushed.
Suite **1,593 passed | 1 skipped**. security-audit **PASS** (0 CRITICAL / 0 HIGH).

Inventory step performed first, as the plan required.

## Verdict in two halves

**WHO gets notified is correct.** All 19 trigger emitters derive the recipient from a row the recipient *owns* — never from caller input — and every one suppresses self-notification. No wrong-recipient path exists on any channel.

**WHETHER THE MEMBER CAN TURN IT OFF is where it breaks.**

## Verified correct (recorded so it is not re-litigated)
- **Push token ownership.** `push_tokens.token` UNIQUE + `register_push_token` `ON CONFLICT (token) DO UPDATE SET user_id = auth.uid()`; logout deletes only your own row and calls `deleteToken()`; the client `started` latch resets on logout and the gate re-runs on `[user]`. 0 duplicate tokens, 31 devices. The shared-phone bug I went looking for is genuinely closed.
- **Post privacy.** `fan_out_new_post` returns early unless `privacy='public'`; logs its 1 000-recipient cap rather than truncating silently.
- **Push content.** `notif_push_body` uses a phrase catalogue — no comment text, no photograph.
- **Deleted actor.** 41 rows (25 distinct actors) reference a deleted account. This is the owner's option-C decision of 2026-08-10, locked by `deletionKeepsTheActor.test.ts`; the bell says "A deleted account". 0 orphaned *recipients*.
- **Row 10 (blocked user) could not be evaluated** — no member-to-member blocking mechanism exists in the schema. Recorded N/A with the condition failing, not marked green.

## Findings
| | Finding | Blast radius today |
|---|---|---|
| **N1** | **Five switches on Notification Settings are read by nothing.** `inapp_reactions`, `inapp_comments`, `inapp_social`, `inapp_competitions` appear *exactly once* in the whole repo — the CREATE TABLE that added them 2026-04-07. `email_weekly_digest` controls a digest feature that does not exist. The member flips them, they save, they reload flipped, nothing changes. | **1** of 94 members has a preferences row; **0** have switched an in-app toggle off |
| **N2** | **The anti-mass-mail rule has no push equivalent.** `journal_published` (hard `false`) and `course_published` (opt-in `false`) are deliberately barred from email under BUG-038 — "mass-broadcast types never email the whole base" — then fall to `ELSE true` in `push_on_notification` and go to every registered device. `new_competition` is the control: it *is* gated, correctly. Member's only defence is `push_enabled`, all-or-nothing. | push wired, 31 devices; `journal_published` 0 so far; `course_published` **12 already emitted** |
| **N3** | The channel rule is written **twice** (email 12 branches, push 6) and the third channel has **no copy**. Both existing copies default an unlisted type to ON — which is exactly what produced N2. | — |
| **N4** | `emit_notification` swallows everything (`EXCEPTION WHEN OTHERS … RETURN NULL`): caller cannot distinguish "already emitted" / "raced and lost" / "broken" — three facts, two return values. Its idempotency is safe **only** because `notification_emit_log_idem` is unique *and* the forensic insert happens last. Correct by an ordering the code never mentions. `push_on_notification` swallows; `send_notification_email` has no handler at all, so a mail failure aborts the notification insert — opposite postures on the same table. | — |
| **N5** | 93 of 94 members have **no** preferences row; every gate `COALESCE`s to true. **No preference has ever suppressed anything on this platform**, which is why N1 and N2 are both real and both untested by real use. | — |

## Shipped
`docs/notification-recipient-integrity-matrix.md` — 13-row matrix + full inventory.
`src/__tests__/notificationPreferenceWiring.test.ts` — every switch rendered on the settings page must have a reader other than its own *declaration*, the page, and the page's hook; or be named in `UNWIRED_TOGGLES` with the decision it awaits. Toggle list read off the page at run time. Includes a **positive control** on the push switches, because a broken scanner reporting "all clear" reads exactly like a healthy settings page.

**7 mutations:** new dead switch CAUGHT · same switch with a reader PASSES (positive control) · declaration-only mention does **not** count, CAUGHT · wired switch added to the ledger CAUGHT · toggle scanner neutered CAUGHT (3 assertions) · matrix doc deleted CAUGHT · `SEARCH_ROOTS` narrowed CAUGHT by the positive control.

## Self-caught (in AI_EVIDENCE.md)
Two findings I nearly reported that were **not real**: (1) `notify_image_comment`'s apparent `SELECT INTO` NULL-overwrite — the two selects are `IF/ELSIF` on `image_type`, mutually exclusive; my line-extraction query had dropped the branch lines. (2) the shared-phone push bug — properly closed, recorded as verified rather than downgraded into a weaker finding. *An audit that must produce findings will produce them.*

## New owner decisions from this cycle
1. **The five dead switches** — wire them, or take them off the page. Two honest answers, different products; a gate that forced one would be making the call by default.
2. **N2** — whether broadcast types should be barred from push as they are from email. Changes what lands on 31 real phones → its own GO cycle.
