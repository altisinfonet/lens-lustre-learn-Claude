# OFF-5 · Offline and poor-network behaviour per screen, and the sync rules on reconnect

**Unit:** OFF-5 (workstream OFF, MASTER R-90) · **Lane:** D2 + D1 (written by the D3 session; docs only) · **Date:** 2026-10-04 · **Status:** waiting for the Owner's signature · **Path:** `docs/evidence/d2/phase5/OFF-5/` (R-82 rule 2)

**What MASTER R-90 asks for:** "OFF-5 (D2 + D1): sync rules when the app comes back. Server wins for counts; deletes are honoured; no ghost posts." The R-93 D3 row asks for "the OFF-5 offline UX decision (what each screen shows offline)". This file decides both. It is the specification that OFF-1, OFF-2, OFF-3, OFF-4, OFF-6, OFF-7 and OFF-8 build against.

> **OWNER SIGN-OFF:** [ ] Approved as written · Name: ______________ · Date (UTC): ______________

To sign, tick the box or comment `OFF-5 approved` on the PR (merging also counts, R-88). Changes go on the same line, e.g. "approved, but voting may queue".

**Scope:** web and the Android/iOS app alike (P22 was reversed by R-90). On the web the device store is IndexedDB; in the app it is the same code inside Capacitor. It supersedes the P22 decision file, which stays on staging as history.

---

## 1 · Rules that apply to every screen

| # | Rule |
|---|---|
| G1 | **No blank screens.** A screen never shows an empty page or an endless spinner. Within **10 s** it shows content, a saved copy, or a clear card saying what is missing and why. |
| G2 | **Saved first, then fresh.** If the device has a saved copy, it is shown immediately (OFF-1) and refreshed in the background. Age is a **label** ("Saved 2 h ago"), never a reason to hide what is saved. The current 30-minute expiry in `src/lib/feedCache.ts` is removed by OFF-1. |
| G3 | **One network state for the whole app** (OFF-3): `online` · `slow` (a request has been running > 4 s, or the effective connection type is 2g/slow-2g) · `offline` (the browser/Capacitor says so, or 2 consecutive requests fail at network level). A thin banner, not a modal: "You're offline — showing saved posts" / "Slow connection — loading lighter images". It clears itself on recovery. |
| G4 | **Actions are either QUEUED or ONLINE-ONLY**, never silently lost. QUEUED = saved in the outbox (OFF-2), shown at once with a small "Pending" mark, and sent exactly once when online. ONLINE-ONLY = the button stays visible but disabled, with the reason ("Needs a connection"). §2 says which is which. |
| G5 | **Money, safety and fairness are never queued:** payments, wallet, withdrawals, competition entry and voting, blocking and reporting abuse are ONLINE-ONLY. (Report is the exception, see §2.) A queued action is decided later by the server, and these need the answer now. |
| G6 | **Privacy on the device:** only content the signed-in member was allowed to see is saved, and only for that member. **Sign-out wipes everything:** device store, outbox, image cache, Cache Storage (OFF-4, fixing F-D3-6). A second account on the same device starts empty. |
| G7 | **Storage budget** (OFF-7/OFF-8): default 300 MB (user setting, with a Wi-Fi-only option for pre-download). Eviction is least-recently-viewed first. The member's own posts, drafts and the pending outbox are **never evicted**. |
| G8 | **Poor network:** the smallest image first (low-res, then upgrade), video at the lowest quality first, request timeouts of 15 s with a retry and back-off (1 s, 2 s, 4 s … capped at 60 s, with jitter). No request is retried without its idempotency key (OFF-2). |

## 2 · What each screen shows offline

| # | screen | offline, with a saved copy | offline, nothing saved | actions offline |
|---|---|---|---|---|
| 1 | **Feed** | Saved posts (up to ~200 via OFF-7), low-res images first, banner (G3). At the end: an "You're offline — we'll catch up when you're back" card | The existing honest card ("Couldn't load your feed — a connection problem, not an empty feed") | Like, unlike, comment, save: **QUEUED** |
| 2 | **Composer** | Works fully. A draft autosaves to the device | Same | New post (photo): **QUEUED**, shows as "Posting when you're back online" at the top of the feed and profile. Video: **QUEUED**, the upload resumes (VID-1) |
| 3 | **Post detail + comments** | The saved post + the comments saved with it, with a label that more may exist | "This post isn't saved on this device" + Back | Comment, like: **QUEUED**. Edit or delete own post: **QUEUED** (§3 R4) |
| 4 | **Own profile / wall** | Saved profile + own posts (never evicted, G7), including pending ones | (cannot happen: own data is always kept) | Edit profile fields, avatar, cover: **ONLINE-ONLY** (server-side validation and moderation) |
| 5 | **Other member's profile** | The saved profile + saved posts, labelled with their age | "Not available offline" + Back | Follow / unfollow, friend request: **QUEUED** (last intent wins). Block: **ONLINE-ONLY** (G5) |
| 6 | **Discover / search** | The last results seen, labelled "Saved results" | "Search needs a connection" | Search: **ONLINE-ONLY** |
| 7 | **Notifications** | The saved list | "No saved notifications" | Mark read: **QUEUED** |
| 8 | **Competitions** | List and detail read-only, saved copy, with a deadline shown as an absolute time | "Not available offline" | Enter, pay, vote: **ONLINE-ONLY** (G5: deadlines and fairness are decided by server time) |
| 9 | **Wallet / referrals / gifts** | **Not shown.** "Your balance needs a connection." A stale balance is never displayed as current | Same | All **ONLINE-ONLY** |
| 10 | **Settings / account** | Saved values, read-only | Same | Language and theme: local, apply at once. Everything else **ONLINE-ONLY** |
| 11 | **Journal articles, course pages** | Readable if opened before (saved copy) | "Not available offline" | — |
| 12 | **Course lesson video** | Only if "Save offline" was used (OFF-8) | "This lesson needs a connection" | — |
| 13 | **Sign in, sign up, password reset** | — | "You're offline — sign-in needs a connection". A member who is already signed in stays signed in while offline (the session is not dropped because a token refresh failed) | ONLINE-ONLY |
| 14 | **Admin, judge, staff screens** | — | "Needs a connection" | ONLINE-ONLY |
| 15 | Report a post or member | — | — | **QUEUED**, sent as the first item when back online (a report never loses its evidence because of signal) |
| — | **Any screen not listed** | **ONLINE-ONLY** with the standard offline card (G1) until a later decision adds it here | | |

## 3 · Sync rules when the connection comes back (OFF-5 core)

| # | Rule |
|---|---|
| R1 | **Order on reconnect:** 1) drain the outbox in creation order (FIFO per item, so a comment never arrives before its post) → 2) refresh the feed head → 3) notifications → 4) reconcile the device store (R3). |
| R2 | **Server wins for every count and every server-owned field:** like counts, comment counts, follower counts, vote totals, balances, `created_at`. The device's optimistic +1 is replaced by the server's number on the first answer. The client's clock is never used for ordering on the server. |
| R3 | **Deletes and lost access are honoured at once:** if the refresh shows a post deleted, hidden, moderated, made private, or its author blocked or unfriended, it is **removed from the device store and the image cache** on that refresh. Queued actions on it are dropped, with one quiet toast ("1 action couldn't be sent: the post is no longer available"). |
| R4 | **No ghost posts:** a queued post shows "Pending" and a local id until the server confirms it with the real id. Then it is swapped in place, and there is never a second copy (the idempotency key, OFF-2, makes a retry return the same row). After the final retry fails it stays in the member's Drafts with "Couldn't post · Retry · Delete". It never disappears silently and never shows as posted. |
| R5 | **Toggle actions collapse to the last intent** before sending: like→unlike→like sends one "like". Follow/unfollow the same. |
| R6 | **Edits carry the version they were made against.** If the server's copy changed in between, the server copy wins, and the member's edit is kept as a draft with "This post changed since you edited it". |
| R7 | **Retry budget:** each outbox item gets at most 8 attempts with back-off (G8), and retries are paused while offline. A 4xx answer, other than 408/429, is final (no retry) and is shown to the member. |
| R8 | **Exactly once:** every outbox item carries a client-generated idempotency key (UUID v4). D1 enforces it with a unique constraint per action table (OFF-2), so a duplicate send returns the original result. |

## 4 · Proof (R-82: structural, each shown failing first; built in OFF-6)

1. Offline cold start → the feed shows saved posts within 2 s, with no error card. (It fails today: the cache expires after 30 min, and only 10 posts are kept.)
2. Like offline → reconnect → exactly **1** row on the server, even when the send is forced to repeat 3 times.
3. Post offline → reconnect → 1 post, with the pending item replaced by the server id (no duplicate in the feed).
4. A post deleted on the server while the device was offline → gone from the device store and the image cache after the refresh.
5. Sign-out → IndexedDB, outbox and Cache Storage are all empty.
6. Competition vote button disabled offline. Wallet balance not rendered offline.
7. Throttled 3G (P17 profile) → no screen in §2 stays blank for longer than 10 s.

## 5 · Findings and open items

- **F-D3-13 · Today's feed cache would fail OFF-5 G2:** `src/lib/feedCache.ts` keeps 10 posts in localStorage and deletes them after 30 minutes, so a cold start after more than 30 minutes offline shows the error card. OFF-1 replaces it.
- F-D3-6 (the image service worker is never purged on sign-out) is closed by G6/OFF-4.
- Open for D1 (OFF-2): which tables get an `idempotency_key` unique constraint. The minimum is post_reactions, post_comments, posts, follows, friend requests, notification reads and reports.
