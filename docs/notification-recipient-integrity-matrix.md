# Notification Recipient-Integrity Matrix (Phase C)

**Question:** does every notification reach exactly the right person, only that person, once — and does the member's own control over it work?

**Answer, in two halves.** *Who* gets notified is correct: every one of the 19 trigger emitters derives its recipient from a row the recipient owns, never from anything the caller supplied, and every one suppresses notifying you about your own action. No wrong-recipient path was found, on any channel. *Whether* the member can turn a notification off is where it breaks: **five of the twenty-one switches on the Notification Settings page are connected to nothing**, and the rule protecting members from mass email has no equivalent on push.

Measured 2026-08-15 against production `jtdtehuqtinjxropkkcn` and the repository at `318240f`. Read-only.

---

## Inventory (the step this audit was required to do first)

| Store | Rows (live) | Role |
|---|---|---|
| `user_notifications` | 2 486 | the bell. Every channel fans out from an insert here |
| `notification_emit_log` | 11 | forensic log + idempotency key for the competition-lifecycle path |
| `notification_preferences` | **1** | per-member switches (see the finding — 93 of 94 members have no row) |
| `push_tokens` | 31 (31 distinct members, **0 duplicate tokens**) | FCM device tokens |
| `push_delivery_log` | 60 (`queued`, `skipped_preference`) | push outcome trail |
| `push_config` | 1, `function_url` set → **push is live** | where the DB posts to send a push |
| `admin_notifications` | — | staff inbox, separate table and policies |
| `gift_announcements` | — | its own surface, 6 policies |
| `suppressed_emails` / `email_unsubscribe_tokens` / `email_send_log` | — | the mail suppression chain |
| `held_result_notifications` | — | competition results withheld until publish |

**Emitters:** 22 functions insert into `user_notifications` — 19 fire from triggers, `emit_notification` is the shared lifecycle helper, `emit_birthday_notifications` runs on a schedule, and three `pj_handle_*` handlers serve the tagged-post fan-out.

**Fan-out:** two AFTER triggers on `user_notifications` — `push_on_notification` and `send_notification_email`. So one insert is up to three deliveries: bell, push, email.

---

## The matrix

Each row states how it was established. "Verified" means read from the live definition, not inferred.

| # | Property | Holds? | How established |
|---|---|---|---|
| 1 | **Wrong recipient is impossible** | **Yes** | All 19 trigger emitters read the recipient out of an owned row — `competition_entries.user_id`, `portfolio_images.uploaded_by`, `friendships.addressee_id`/`requester_id`, `follows.following_id`, `support_tickets.user_id`, the parent comment's author. None takes a recipient from the caller |
| 2 | **You are never notified of your own action** | **Yes** | Every emitter guards it: `follower_id = following_id`, `_owner_id = NEW.user_id`, `_parent_author = NEW.user_id`. `push_on_notification` guards it a second time on `actor_id = user_id` |
| 3 | **A duplicate event does not make a duplicate notification** | **Partly** | Two mechanisms, neither universal: `notification_emit_log_idem` (unique on kind + entity + round + recipient) covers the `emit_notification` path; `uniq_user_notifications_dedup_key` covers the 1 167 of 2 486 rows that carry a `dedup_key`. The remaining emitters rely on the source row being inserted once |
| 4 | **A duplicate event does not make a duplicate email** | **Yes** | Both mail paths carry an idempotency key — `kind-entity-round-recipient` on the lifecycle path, `notif-<notification id>` on the generic trigger |
| 5 | **Push reaches only the current owner of the device** | **Yes** | `push_tokens.token` is UNIQUE and `register_push_token` is `ON CONFLICT (token) DO UPDATE SET user_id = auth.uid()`, so a token that moves to a new account changes hands atomically. Logout calls `unregister_push_token` (deletes only your own row) and `deleteToken()`. The client's `started` latch is reset on logout and the gate re-runs on `[user]`, so a user switch inside one app session re-registers. **0 duplicate tokens live.** Dead tokens are pruned by `send-push` on FCM's `UNREGISTERED` |
| 6 | **A deleted member's identity is handled deliberately** | **Yes — by owner decision** | 41 rows reference an actor that no longer exists (25 distinct, 37 `new_follower`, 4 `post_comment`). This is option C, chosen by the owner on 2026-08-10 and locked by `deletionKeepsTheActor.test.ts`: keep the id, let the profile go, and let `notif_display_name` say *"A deleted account"* rather than the misleading *"A member"* |
| 7 | **A deleted member does not orphan a notification** | **Yes** | 0 rows whose *recipient* no longer exists |
| 8 | **Post privacy is respected** | **Yes** | `fan_out_new_post` returns early unless `privacy = 'public'`, so a friends-only or private photo notifies nobody. Its 1 000-recipient cap is `RAISE LOG`-ed rather than silent |
| 9 | **Push carries no content that privacy could later hide** | **Yes** | `notif_push_body` builds *"<name> <action phrase>"* from a catalogue; no comment text, no photograph, no caption |
| 10 | **A blocked user cannot notify you** | **N/A — conditional row, and the condition fails** | This row was adopted "conditional on verifying a blocking mechanism exists". There is no member-to-member blocking mechanism in the schema. The row cannot be evaluated and is not counted as a pass |
| 11 | **A failed notification is visible** | **No — see N4** | `emit_notification` ends in `EXCEPTION WHEN OTHERS … RETURN NULL`; `push_on_notification` ends in `RAISE LOG`. Both swallow |
| 12 | **The member can turn a notification off** | **No — see N1** | Five of 21 switches are read by nothing |
| 13 | **The mass-broadcast protection covers every channel** | **No — see N2** | It covers email only |

---

## N1 — Five switches on the Notification Settings page are connected to nothing

The page renders 21 toggles. Each writes to `notification_preferences` and the value is saved correctly. Then:

| Switch | Read by |
|---|---|
| **In-app → Reactions** (`inapp_reactions`) | **nothing** |
| **In-app → Comments** (`inapp_comments`) | **nothing** |
| **In-app → Social activity** (`inapp_social`) | **nothing** |
| **In-app → Competition activity** (`inapp_competitions`) | **nothing** |
| **Email → Weekly Digest** (`email_weekly_digest`) | **nothing — and there is no weekly digest feature at all** |

Established by searching every migration, every edge function and every client file for each column, excluding the line that *declares* it and excluding the settings page and its own hook. The four `inapp_*` columns appear exactly once in the entire repository — in the `CREATE TABLE` that added them on 2026-04-07. `email_weekly_digest` appears only in the page, its hook and a translation string.

The contrast is what makes this a defect rather than an oversight-in-progress. The **push** switches next to them on the same page are read by `push_on_notification`, and the file even carries a comment recording that they "had simply never been on screen, so the 12 members with a registered device had no way to turn them off." Somebody checked the wiring for push. Nobody checked it for in-app.

**Blast radius today: nobody has been misled yet.** Only **1** of 94 members has a `notification_preferences` row at all, and **0** members have switched any in-app toggle off. So no member has yet turned a switch and been ignored.

**This needs an owner decision, not a fix from me,** because there are two honest answers and they are different products: either the four in-app toggles start hiding those notifications from the bell, or they come off the page. The same is true of Weekly Digest — build it, or remove the switch. Writing a gate on top of an unmade decision would be inventing the decision.

---

## N2 — The rule that stops mass email has no push equivalent

Two broadcast emitters write one `user_notifications` row **per non-suspended member** (94 today):

- `notify_journal_published` — a new Journal article
- `notify_course_published` — a new course
- (`notify_new_competition` does the same, and is handled correctly — see below)

`get_notification_email_enabled` deliberately blocks the first two from mail. The code says why: **BUG-038 — "mass-broadcast types never email the whole base."** `journal_published` returns a hard `false`; `course_published` defaults to `false` (opt-in).

`push_on_notification` has its own, shorter list, and neither type is on it. Both fall through to `ELSE true`. So a type deliberately barred from the member's inbox is delivered, unconditionally, to their phone.

`new_competition` is the control that proves this is an omission rather than a policy: it *is* named in the push list, gated on `push_competition_updates`, and behaves correctly.

The only switch a member has against this is `push_enabled`, which is all-or-nothing: to stop Journal pushes they must stop every push.

**Blast radius today, measured:** push is wired (`push_config.function_url` is set) and 31 members have a registered device. `journal_published`: **0** notifications so far. `course_published`: **12** already emitted — that broadcast has fired once, when the member base was much smaller. `push_delivery_log` shows 60 rows with outcomes `queued` and `skipped_preference`, so the path is live and working as built.

Fixing this changes what lands on 31 real phones, so it belongs in its own GO cycle rather than in an audit.

---

## N3 — The channel rule is written twice, and the third channel has no copy

| Channel | Where the rule lives | Branches | Default for an unlisted type |
|---|---|---|---|
| Email | `get_notification_email_enabled` | 12 | `true` |
| Push | an inline `CASE` inside `push_on_notification` | 6 | `true` |
| In-app | **nowhere** | 0 | always sent |

Two independent copies of "which notification types may reach this member", each with its own list, each defaulting a *new* type to on. N2 is precisely what that divergence produces: a type added to one list and not the other. This is the same maintenance risk recorded for the privacy rule, which is written in five places — and here the divergence is not hypothetical, it has already happened.

One narrower note, in the push copy's favour: it computes `_allow` and then tests `IS DISTINCT FROM true`, so a NULL preference column suppresses the push. That direction is the safe one.

---

## N4 — A notification that fails is invisible, and its idempotency is safe by accident

`emit_notification` wraps its whole body in `EXCEPTION WHEN OTHERS THEN RAISE WARNING … RETURN NULL`. `push_on_notification` does the same with `RAISE LOG`. The consequences:

- The caller cannot tell **"already emitted"** (returns the existing log id) from **"raced and lost"** (NULL) from **"genuinely broken"** (NULL). Three different facts, two return values.
- Its idempotency is a `SELECT`-then-`INSERT` with no lock. What actually makes it safe is `notification_emit_log_idem`, a unique index, combined with the fact that the forensic insert happens **last** — so a loser's unique violation rolls the whole subtransaction back, taking its duplicate bell row and its duplicate email with it. That is correct. It is also correct by an ordering the code never mentions: move the forensic insert earlier, as a tidy-up might, and the protection silently disappears.

The two triggers are also inconsistent with each other: `push_on_notification` swallows its failure and lets the notification stand, while `send_notification_email` has no handler at all, so a mail failure aborts the insert of the notification itself. Same table, same moment, opposite postures.

`fan_out_new_post` shows the standard the others should meet — it catches, but logs the post id, the author and the SQLSTATE, with a comment recording that silence "is how push stayed broken from launch to 2026-08-01."

---

## N5 — 93 of 94 members have no preferences row

`notification_preferences` holds **one** row. Every gate is written `COALESCE((SELECT … WHERE user_id = _user_id), true)`, and `push_on_notification` treats a missing row as allow-all, so the defaults are the product for effectively everyone.

Not a defect on its own — the defaults are deliberate and mostly sensible. It is recorded because it changes how the findings above should be read: **no preference has ever suppressed anything on this platform**, so N1's dead switches and N2's push gap are both real and both entirely untested by real use.

---

## What shipped alongside this audit

`src/__tests__/notificationPreferenceWiring.test.ts` — every switch rendered on the Notification Settings page must have a reader somewhere other than its own column declaration, the page itself and the page's hook; or be named in `UNWIRED_TOGGLES` with a reason. The five above are named there, each pointing at the decision it is waiting on. A sixth cannot be added silently.

It deliberately does **not** assert that the five get fixed. Which way they go is the owner's call, and a test that forces one answer would be making that call by default — the same reasoning as the deletion gate.

**Nothing was changed by this audit.** Catalogue queries, eight counting queries, and reads of 22 emitter definitions, 6 helper functions and the settings page.
