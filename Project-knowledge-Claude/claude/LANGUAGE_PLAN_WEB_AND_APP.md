# 50mm Retina World — Complete Language Plan (Web + Android App)

**Originally written:** 26 July 2026 · **Last updated:** 28 July 2026 (Tier C opened: mojibake cleared, EntryCard + Wallet translated)
**Repo:** `altisinfonet/lens-lustre-learn-Claude`
**Local HEAD:** `eeea211` on `feat/i18n-tier-a` · **33 commits ahead of `origin/feat/i18n-tier-a`** (`fe76369`) · **36 ahead of `origin/main`**
*(both measured: `git rev-list --count origin/feat/i18n-tier-a..HEAD` = 33, `git rev-list --count origin/main..HEAD` = 36. The 33 is what "unpushed" means — the tracking branch. The 36 is what the PR into `main` will carry.)*
**Rule this document is written under:** no guesswork, no assumptions, nothing marked Done without proof.

> **This file lives in the repo at the root, alongside `PROJECT_MASTER_RECORD.md`,
> `NEXT_RELEASE_RUNBOOK.md` and `ANDROID_RELEASE_RUNBOOK.md`.** It previously existed
> only as a delivered artifact and was never committed — a real gap, caught by the user
> on 28 July. A cold-start reader who clones the repo now gets the plan with the code.

> **COLD-START READERS: read §8 before touching any code.** It contains the
> engineering rules, defect classes and traps discovered during Tier A, Tier B and Tier C.
> Several of them are non-obvious and at least six were discovered only because a
> verification step caught a mistake I had already convinced myself was fine.

---

## 0. Read this part first — the honesty section

Three things in this document are **measurements**, and three things are **judgement calls**. I am separating them so you can tell which is which.

**Measured (command output, reproducible):** the file counts, the i18n coverage counts, the dictionary key counts, the untranslated-occurrence total.

**Judgement (my opinion, you can overrule):** which tiers are worth doing, what order to do them in, whether the admin screens are worth translating at all, and **which bucket a given file belongs to**. Bucket membership is a scope decision, not a measurement. See §1.3.

**Mistakes I made in this work and corrected — stated so you can calibrate how much to trust the rest.** This list only grows; I do not remove entries from it.

1. My first coverage scan searched only for `useI18n` and reported "8 files use i18n." Wrong. The codebase has **two** hooks, `useI18n` and `useT`, and most files use `useT`. The correct number was **73**. A plan built on the first number would have been nonsense.
2. My first estimate of the database-content work was "~39 values × 6 languages ≈ 234 strings." I could not substantiate it and retracted it. The only DB figure I can prove is the hero content one (30 strings). **This sandbox has no Supabase credentials**, so I cannot count your rows. I will not invent that number.
3. **A verification script was silently checking the wrong file.** I ran `verify-frs.cjs` against `GlobalSearch.tsx` and it reported a clean result — but the script had the *previous* file's path hardcoded and ignored its command-line arguments entirely. Had I trusted it, GlobalSearch would have shipped with a green verdict that was actually about `FeedRightSidebar`. Fixed by rewriting it to read `process.argv`. **Lesson: a verification tool must itself be verified to be looking at the thing you think it is.**
4. **A hook-order check produced a false "UNSAFE" verdict.** Its regex only matched single-line `if (...) return x;` and could not see block-form `if (...) {` early returns. Fixed, then **re-ran the stricter check against the two files already cleared under the weaker one** — both still passed, so the earlier verdicts hold. Disclosed in the commit message rather than quietly patched.
5. **I mis-recorded `AskAnything.tsx` as "partially converted."** Re-measured on 28 July: it had **zero** i18n hooks and **zero** `t()` calls. The figure I had been carrying came from a `grep` for `t("` which matches `.select("` and `.gt("`. Of the eight then-remaining Tier B files, **only `Feed.tsx` was genuinely partial.**
6. **I published a headline number that was not reproducible.** After building the occurrence scanner I reported "**547** user-facing occurrences, which CONFIRMS the plan's 549 estimate." That 547 came from an **ad-hoc `awk` one-liner retyped per run**. A second such one-liner, over the **identical 2,752-hit scan**, produced **490**. Neither was reproducible; the "confirms 549" sentence claimed a precision it did not have and **is withdrawn**. The classifier now lives in a committed, reviewable rule table (`scripts/i18n/bucket-scan.cjs`) that reconciles against the scanner's own total and refuses to be trusted on a mismatch. **The reproducible figure was 509 at the time, and is 496 now.** That still agrees with the 549 estimate in order of magnitude — but "agrees in order of magnitude" is what I should have written the first time.
7. **A classifier rule was written loosely enough to misfile a real user surface.** The first draft of `bucket-scan.cjs`'s test/dev/qa rule matched a bare `Dev` filename prefix and swallowed `src/components/ActiveDevices.tsx` — a genuine settings screen — because "Devices" starts with "Dev". Caught by reading the `--explain` output instead of accepting the total. **The rule was fixed; the bucket assignment was not hand-edited.**
8. **The mojibake fixer ABORTED on a file it could have repaired, and the abort was WRONG.** Its proof (3) — "reversal reproduces the original byte-for-byte" — re-encoded the *whole file* rather than only the repaired runs, so any pre-existing legitimate non-Latin-1 character elsewhere in the file made the proof fail. The tool was refusing correct work while reporting a safety failure, which is the most dangerous kind of tool bug: it looks like caution. Fixed in `a3c15a3` (proof scoped to the runs it actually changed), disclosed, and only then used. **A tool that says "unsafe" must be read, not obeyed.**
9. **A name-collision check is NOT a duplicate check, and I nearly minted four duplicates because of it.** Translating `Wallet.tsx` I proposed `wal.fldBank` / `wal.fldAccount` / `wal.fldIfsc` / `wal.fldName`. The gate's collision check reported all four "free" — correctly, because it tests whether the *key name* already exists. A separate scan for **any existing key whose English VALUE equals the proposed English value** found `wal.bank`, `wal.account`, `wal.ifsc` and `wal.name` already present, complete in all 7 languages, minted for this very file and never wired to its render sites. **Always run `reuse.cjs` on the VALUE before minting. The gate cannot catch this class.**

**One more limit, stated up front:** the occurrence counts come from a regular-expression scan, not a compiler. **It is a floor, not a ceiling, and it errs in BOTH directions:**

- **Under-reports:** it cannot see strings built by concatenation or held in variables. `GlobalSearch` was catalogued at 13 and a full read found ~26. **`Wallet.tsx` was catalogued at 17 and a full read found 8 more** — five rendered gateway-error fallbacks, two input placeholders and a unit suffix — while simultaneously showing that 8 of the 17 it *did* report were brand names that must NOT be translated. **`EditEntryDialog.tsx` is catalogued at 15 and a full read found ~24.**
- **Over-reports:** it cannot see through an indirection layer. `UserMenu.tsx` reports **37** while being **genuinely complete** — see §1.4.

**The scan is a starting queue, never the work list. Every tier is finished by READING each file in full.**

---

## 1. Where the language system stands today — verified 28 July 2026

### 1.1 What genuinely works

| Thing | Status | Proof |
|---|---|---|
| 7 languages defined | Working | `LANGS` in `src/i18n/translations.ts`: `en, hi, bn, mr, gu, ta, te` |
| Translation dictionary | Working | `translations.ts` = **1,714 distinct keys**; `home.ts` = **83 distinct keys**; **1,797 keys × 7 languages = 12,579 values authored** |
| Dictionary integrity | Verified | all 7 blocks in **both** files report identical key count **and identical key set**, **0 duplicate keys** |
| Language picker UI | Working | `src/components/LanguagePicker.tsx` |
| Onboarding language step | Working | present in `OnboardingModal.tsx` |
| Device-language auto-detect | Working | `I18nContext.tsx` order: saved choice → device/browser language → English |
| Preference saved per account | Working | `LanguageAccountSync.tsx` reads/writes `profiles.preferred_language` |
| Preference follows the user across devices | Working | account value wins over device value on login |
| Same behaviour on web and in the Android app | Working | Capacitor loads the same bundled `dist`; no platform-specific i18n code exists |
| **Text encoding** | **Clean** | `scan-mojibake.cjs` reports **0 files / 0 runs** repo-wide |

**Growth this cycle: 8,085 → 12,579 authored values (+4,494).**

### 1.2 Coverage — the actual numbers

```
                                  26 Jul      28 Jul      28 Jul (now)
Total .tsx files in src/             359         359         359
  .tsx using useT or useI18n          73          87          95   (26%)
Pages in src/pages/                   53          53          53
  Pages using useT or useI18n         27          29          30   (57%)
```

Reproduce with:

```
grep -rlE 'useT\(\)|useI18n\(' src --include=*.tsx | wc -l
grep -rlE 'useT\(\)|useI18n\(' src/pages --include=*.tsx | wc -l
```

So **264 of 359 .tsx files still contain no translation hook**, and **23 of your 53 pages are English-only regardless of what language the user picked.**

### 1.3 Untranslated text still in the code — re-measured 28 July, reproducible

Reproduce with `node scripts/i18n/bucket-scan.cjs` (add `--explain` for every file and the rule that claimed it):

```
    54  tests/dev/qa                (6 files)
    32  shadcn ui primitives       (14 files)
   130  lib/ + hooks/              (39 files)
  2027  admin+judge staff surfaces (109 files)
   496  USER-FACING app            (81 files)

  2739  GRAND TOTAL
  2739  scanner's own total
  RECONCILED: every hit landed in exactly one bucket.
```

**Read the two halves of this differently.** The **2,739 total is measured**. **Which bucket a file belongs to is a scope judgement** — the tool says so on every run. The rule table is ordered and first-match-wins, and **directory beats filename deliberately**, because a directory is a fact about the codebase while a filename is a convention. Two files that a name-only rule would misfile, and that are **intentionally counted as user-facing**:

- `PublicJudgeScoresReveal.tsx` — "Judge" in the name, but it is the **public** score-reveal surface members see.
- `JuryImageViewer.tsx` — "Jury" in the name; this plan assigns it to Tier C.

**Movement so far in Tier C:** 2,752 → 2,739 total, user-facing 509 → 496.

### 1.4 A file that reports 37 hits and is nonetheless complete — `UserMenu.tsx`

Tier A recorded `UserMenu.tsx` as done; the scanner reports **37**. That contradiction was **investigated, not assumed away**. Findings, with proof:

- **32 hits** are `label:` / `title:` literals inside `MENU_LABEL_KEYS` and `MENU_SECTION_KEYS`. Those English strings are **lookup keys, not rendered copy**. Both render sites go through `tm()`, which returns `t(k)`:
  `L189` and `L263` → `{tm(MENU_SECTION_KEYS, section.title)}`; `L199` and `L274` → `{tm(MENU_LABEL_KEYS, item.label)}`.
  All **24** dictionary keys those maps target were checked to resolve in **all 7 languages — 0 missing**. This check mattered: `tm()` falls back to the raw English string on a missing key, so a gap would have been **silent**.
- **5 hits** are the `roleBadge` block. `grep` shows `roleBadge` referenced only at its own declaration (L55) and in its explanatory comment (L50) — **never in JSX**. Dead code, already flagged in-file, deliberately not translated.

**`UserMenu.tsx` needs no further translation work.** This is documented in the scanner's own header as the **ENGLISH-AS-LOOKUP-KEY** false-positive class. **A high count is a prompt to read the file, never a verdict.**

---

## 2. What we can and cannot match about Instagram's rule

Instagram's language handling is **two separate systems**:

**System A — interface language.** The user picks a language, Instagram remembers it on the account, and the app chrome renders in it. Their own help page says this is *app-only*. **We already do this, on web as well as in the app.** On this half we are slightly ahead of what their doc describes.

**System B — content translation.** Captions, comments and bios are auto-detected and machine-translated on the fly, with a "See Translation" link and the original always available underneath.

**We have none of System B, and we cannot build it under your current decision.** You ruled out an external translation service, and there is no way to translate user-written captions without one. System B is **parked by your own decision** — that is the correct call for now, and it is not a gap I am hiding.

**"Following the Instagram rule" for us means finishing System A properly.** That is what the rest of this plan is.

One correction still owed: the header comment in `LanguageAccountSync.tsx` claims the file works "the way Facebook/Instagram do." True for preference storage, overstated for everything else. Same in `I18nContext.tsx`.

---

## 3. The plan — status as of 28 July 2026

### Phase 0 — Land the base work to GitHub — **STILL BLOCKING**

The sandbox has **no GitHub write credentials**. Re-verified on 28 July, not assumed — see §5.

**Your action.** The current delivery route is a **zip of changed files, dragged into GitHub's web "Upload files" UI** on branch `feat/i18n-tier-a`. **33 commits are unpushed.** Any zip produced before commit `eeea211` is stale — including `50mm-i18n-tierAB-5f42652.zip`, which predates all five Tier C commits.

---

### Phase 1 — The user-facing strings

**Your decision, given and recorded: `A + B + C + D` — genuinely complete user-facing coverage. Phase 1 first, then Phase 2 (DB).** §6 below is therefore **resolved**; it is kept only as a record of what was asked and answered.

Each tier is a separate reviewable patch. **Within a tier I work one file at a time**, run the gate before every dictionary insert and the per-file verifier after every file, then `npx tsc --noEmit -p tsconfig.app.json` and `vite build`.

#### Tier A — first-run and identity — **COMPLETE**

`PublicProfile`, `Profile`, `EditProfile`, `OnboardingModal`, `UserMenu`, `ForgotPassword`, `Login`, `Signup`, `ResetPassword`, `Dashboard`, `IDVerification`, `DeleteAccountSection`, `ProfileCompletionBar`, `VerificationRequestCard`, `PhotographerUpgradeCard`.

Detailed per-file commit history preserved on branch `archive/tier-a-detailed-history` (tip `ed4a3f3`).

#### Tier B — feed and social — **COMPLETE, 17 of 17 files**

| File | Commit |
|---|---|
| `profile/ProfileStories.tsx` | `8b2e7ca` |
| `PostCommentsSection.tsx` | `4058419` |
| `post/PostCard.tsx` + `post/Badge.tsx`, `post/Caption.tsx`, `lib/postUtils.ts`, `lib/postAnalytics.ts` | `2203545` |
| `ImageEngagement.tsx` + `lib/commentModeration.ts` | `ddd0621` |
| `NotificationBell.tsx` | `1fc6d84` |
| `WallPosts.tsx` | `bd3619e` |
| `FeedRightSidebar.tsx` | `0e7591a` (+ mojibake repair `46f3af5`) |
| `GlobalSearch.tsx` | `2e28018` |
| `AnonymousSidebarFallback.tsx` | `836e768` |
| `AskAnything.tsx` | `9478262` |
| `FriendFollowActions.tsx` | `9ad081e` |
| `profile/FeaturedPhotos.tsx` | `6aecc02` |
| `profile/PhotoAlbums.tsx` | `9a687ad` |
| `post/TagPeopleModal.tsx` | `a057536` |
| `pages/PostDetail.tsx` | `043fe32` |
| `feed/FeedStoriesBar.tsx` | `6a22678` |
| `pages/Feed.tsx` | `486f8a9` |

Interleaved: **seven key-promotion commits** (`144645b`, `a3ab170`, `93b820d`, `f6f5e8a`, `f1a590d`, `02cb6ac`, `a33cfc2`) — see §8.3 — plus two tooling commits (`fbb55b2`, `5f42652`).

#### Tier C — competitions, certificates, wallet — **IN PROGRESS, 2 of 14 files**

| File | Status | Commit | Notes |
|---|---|---|---|
| **mojibake fixer repair** | done | `a3c15a3` | proof (3) was unsound — see mistake #8 |
| **`EntryCard.tsx` encoding** | done | `69837ac` | 48 runs repaired |
| **last 3 mojibake runs** | done | `7b50ec4` | `ImageEngagement.tsx` (2), `useFriendFollow.ts` (1). **Repo is now 0 / 0.** |
| **`EntryCard.tsx`** | **translated** | `6f2a2c2` | 12 keys × 7 languages |
| **`Wallet.tsx`** | **translated** | `eeea211` | 9 new keys × 7 + **5 reuses**; 17 → 6 residual (all brand names + 1 merchant-record field) |
| `EditEntryDialog.tsx` | next | — | scanner says 15; full read finds ~24. Heavy reuse available from the `csub.*` family. |
| `CertificatePreviewModal.tsx` | not started | — | 11 |
| `CompetitionLightbox.tsx` | not started | — | 8 · same `by {… \|\| "Anonymous"}` pattern as EntryCard — `ec.by` / `ec.anonymous` are reusable |
| `JuryImageViewer.tsx` | not started | — | 8 |
| `VerifyCertificate.tsx` | not started | — | 8 |
| `EntryDetail.tsx` | not started | — | 7 |
| `CertificateVerifyByToken.tsx` | not started | — | 6 |
| `CompetitionSubmit.tsx` | not started | — | 5 |
| `Competitions.tsx` | not started | — | 4 |
| `Certificates.tsx` | not started | — | 2 |
| `VotingLightbox.tsx` | not started | — | 2 |
| `Winners.tsx` | not started | — | 1 |

**Left English on purpose in `Wallet.tsx`, each flagged rather than silently skipped:**

- **The jsPDF ledger block (L421–458) is a HARD BLOCKER, not a skip.** jsPDF's built-in standard-14 fonts are **WinAnsi / Latin-1 only**. Translating those `doc.text()` calls would emit **blank or garbled output in all six Indic languages**. Localising the PDF requires `addFileToVFS` + `addFont` with a Unicode TTF (e.g. Noto Sans) **first**. This is real work, not a checkbox.
- `description: "Wallet Top-up"` (L244) is a Razorpay **merchant-record** field as well as a checkout-modal label. Translating it changes what appears in Razorpay's dashboard and in payment records. **Business decision, not a code decision.**
- `{w.status}` (L868) is a raw DB enum rendered straight through — Phase 2.
- Brand names: `Payeliana`, `Stripe`, `PayPal`, `PayPal Checkout`, `Razorpay`, `UPI`.

**Two disclosed English copy changes in `Wallet.tsx`:** the ledger year buttons now render `1 yr` rather than `1yr` (the Indic values are full words and need the separating space), and the withdraw placeholder now renders `Minimum withdrawal is $1.00` rather than `min $1.00` (reuses the existing `wal.minWithdrawal` key already used by the L364 toast; `formatUSD(1)` produces exactly `$1.00`).

#### Tier D — long tail — **NOT STARTED**

Largest measured items: `CourseEditor` 35 · `JournalEditor` 33 · `MobileProfileSheet` 31 · `Index` 18 · `UserNextStepPanel` 16 · `ScheduledPostsList` 14 · `MobileBottomNav` 10 · `PublicJudgeScoresReveal` 10 · `FeaturedArtistPage` 10 · `HelpSupport` 10 · `AdminGiftCredit` 8 · `Navbar` 8 · `CookiePreferencesModal` 7 · `InlineImageDropZone` 7 · `OnboardingModal` 7 · `Dashboard` 7 · `Unsubscribe` 7 — then ~60 files with 1–6 each.

Known Tier D items already spotted: `MyPhotos.tsx` L109 `endLabel="No more photos"` and L173 `endLabel="No more tagged photos"`; a sweep of `src/lib/` for user-facing strings (`passwordSecurity.ts` and `profileCompletion.ts` confirmed to contain them); `Discover.tsx` `INTEREST_OPTIONS` (L19, rendered L244) should be checked against the `onb.int.*` pattern; **`src/lib/judging/participantStageLabels.ts` — `PARTICIPANT_PLACEMENT_LABELS` and `participantStageLabel()` supply RENDERED English to `EntryCard`'s placement and status badges** (found during the EntryCard read, deliberately not touched there because it is a shared lib module, not a component).

**Two things on the record about this phase:**

1. **I am authoring the Hindi, Bengali, Marathi, Gujarati, Tamil and Telugu myself.** All 1,714 values are the same provenance. I am not a certified translator and I cannot proofread my own Tamil. **Every tier needs a native-speaker review before Play release.** This is *urgent*, not theoretical: I spliced Devanagari into a Tamil value once and only a gate written afterwards caught it. **That gate still cannot tell Hindi from Marathi**, because both use Devanagari. Specific values to put in front of a reviewer first: `ec.by`, `wal.captureFailed` (its Indic values deliberately widen "capture" to "payment capture" because the bare loanword is opaque), and `wal.yrSuffix`.
2. **Layout risk is real.** Devanagari, Bengali and Tamil run 20–40% longer than English. The hero `h1`, "Selected Works" `h2` and "Start Creating" `h2` all carry `whitespace-nowrap`. **Flagged, deliberately not touched.** New: `wal.yrSuffix` Telugu is `సంవత్సరం` inside a `text-[10px]` chip — a wrap risk that needs a device check.

---

### Phase 2 — Database content (#36 and #37) — **NOT STARTED**

Interface strings live in code. Your *content* lives in Supabase, and no amount of Phase 1 work touches it.

**#36 — storage and read path.** Add a nullable `translations jsonb` column shaped `{"hi": {"title": "..."}}` to `portfolio_images` (title), `photo_of_the_day` (title, description), `featured_artists` (title, excerpt). Plus `site_settings.hero_content` — already `jsonb`, **no migration needed**; its five fields × 6 languages = **30 strings, the one DB number I can prove.** Then a `tr(row, field, lang)` helper falling back to the English column, wired into `Index.tsx`, `PhotoOfTheDay.tsx`, `FeaturedArtist.tsx`.

**Confirmed raw-DB-value render sites** — these render untranslated database text today and belong to Phase 2:

- `FeedRightSidebar.tsx:282` — `course.difficulty`
- `GlobalSearch.tsx:190` — `` `${c.category} · ${c.status}` ``
- `GlobalSearch.tsx:199` — `` `${c.category} · ${c.difficulty}` ``
- `AskAnything.tsx` — `persona.name`, `persona.greeting`
- `PhotoAlbums.tsx` — `album.name`, `photo.caption`
- `TagPeopleModal.tsx` — `tg.taggedUserName`, `f.full_name`
- `PostDetail.tsx` — `post.content`, `post.author_name`
- `feed/FeedStoriesBar.tsx` — `currentStory.caption`, `b.full_name`
- `pages/Feed.tsx` — post content, rendered via `PostCard`
- **`Wallet.tsx:868` — `{w.status}`** (withdrawal status enum)

Also in scope: `auth_page_settings`, and `course.category` / `course.difficulty`.

**Deliberately excluded:** `hero_banners` (text appears only in `alt`), `photographer_name` / `artist_name` (people's names are not translated). The same principle was applied throughout Tier B: a user's own `full_name` is never translated — only the *missing-name fallback* is UI copy.

**No RLS change** — the new column sits inside rows that already have policies.

**#37 — admin editors.** Per-language inputs in the admin forms. English required, other six optional, empty means English fallback.

**Blocked on:** Supabase row counts and the real category list. The `home.cat.*` dictionary covers exactly nine categories — `portrait, nature, wildlife, landscape, abstract, documentary, street, general, aerial`. Anything outside those renders as raw English.

---

### Phase 3 — Admin and judge panels — recommendation: **SKIP**

**2,027 measured occurrences across 109 files — four times the remaining user-facing work**, seen only by staff already operating an English console. Instagram does not translate its internal tooling either.

---

### Phase 4 — Build, verify, release

1. **`capacitor.config.ts` has no `server.url`.** The app runs the bundled `dist`, not your live site. **Every frontend change requires a brand-new AAB.**
2. **AAB 1012 was built from `067203e` and predates every commit in this document.** Do not ship it expecting any of this work.
3. **Merging alone does NOT trigger `android-build.yml`** — that needs an edit to `ANDROID_BUILD_TRIGGER`. See `NEXT_RELEASE_RUNBOOK.md`.

Per-release verification: `npx tsc --noEmit -p tsconfig.app.json` clean → `vite build` clean → grep the built bundle for new keys and Indic values → install the AAB and walk the translated screens in **at least Hindi and Tamil**, checking for overflow. **I cannot do the last step** — no device, no Play access.

---

## 4. Sequencing

```
Phase 0  Land work to GitHub                    <- YOUR ACTION, still blocking (33 commits)
Phase 1  Tier A  first-run & identity   COMPLETE
         Tier B  feed & social          COMPLETE (17 of 17)
         Tier C  competitions & wallet  IN PROGRESS (2 of 14) -- next: EditEntryDialog.tsx
         Tier D  long tail              not started
Phase 2  #36 DB storage + read path     not started
         #37 admin per-language editors
Phase 3  Admin/judge  <- recommend SKIP
Phase 4  Build -> verify -> AAB -> Play
```

---

## 5. What I am blocked on, and by what exactly

**GitHub write access — none.** Re-verified 28 July 2026, by actually attempting the push rather than asserting from memory:

```
$ git push origin feat/i18n-tier-a
fatal: could not read Username for 'https://github.com': terminal prompts disabled
exit 128
```

**Delivery route:** a zip of exactly the changed files, every one byte-compared against the working tree with `cmp -s` before delivery, dragged into GitHub's web **"Upload files"** UI on `feat/i18n-tier-a`. **Drag the *contents* — the `src/` and `scripts/` folders — not the wrapper folder.**

**Supabase — no credentials.** No row counts, no category list, no live-data rendering check.

**Play Console — yours.** Build 1010 is Active and unsubmitted; 1012 is stale.

---

## 6. The scope decision — **RESOLVED** (kept as a record)

Asked: which of A / A+B / A+B+C / A+B+C+D / +Phase 3, and whether Phase 2 comes before or after Phase 1.

**Answered: `A + B + C + D`, and Phase 1 before Phase 2.** Phase 3 (admin) not selected — recommendation to skip stands.

---

## 7. Open items carried forward, still awaiting your call

- **Mojibake — RESOLVED.** Was 51 runs in 3 files; now **0 files / 0 runs** repo-wide (`7b50ec4`). **`scripts/scan-mojibake.cjs` can now be promoted to a CI gate with an empty backlog** — the cheapest moment to do it. Not yet done.
- **21 date-locale gaps** — every date is formatted with a hard-coded English locale regardless of the chosen language. All flagged in code, **none auto-fixed**. Full list in §8.7.
- **Number-locale gaps** — `.toLocaleString()` called with **no locale argument** formats using the *browser* locale, not the selected language. Three sites in `FriendFollowActions.tsx`. Flagged, not fixed.
- **Translation drift pairs** — distinct keys with the same English value whose Indic values have diverged. Flagged, not auto-fixed. Full catalogue in §8.8.
- The `whitespace-nowrap` overflow risk on the hero `h1`, "Selected Works" `h2`, "Start Creating" `h2`, and the `FriendFollowStats` row. **Plus the new `wal.yrSuffix` Telugu chip.**
- The short-form "Pinned" translations (`पिन` rather than `पिन किया गया`) chosen because the badge is 7px text in a tight chip.
- The overstated "the way Facebook/Instagram do" comments in `LanguageAccountSync.tsx` and `I18nContext.tsx`.
- **Report-reason storage formats are inconsistent.** `post_reports.reason` stores raw English labels. `comment_reports.reason` is written in **two different formats by two components** — raw English by `ImageEngagement.tsx`, lowercase/underscore slug by `PostCommentsSection.tsx`. Same table, same column. **Flagged, not fixed** — fixing it is a data migration, not an i18n change.
- **Dead code and a11y items, flagged not fixed:** `Feed.tsx` L41 destructures `const { isAdmin } = useIsAdmin();` and never uses it · `UserMenu.tsx` `roleBadge` has no render site · `GlobalSearch.tsx` `authorFilter` declared and cleared but never rendered · `PostDetail.tsx` duplicates `timeAgo` / `privacyIcon` from `src/lib/postUtils.ts` · **`EntryCard.tsx` dead `copyEntryLink` plus unused `Share2` / `ExternalLink` / `Link` / `DropdownMenu*` imports.**
- **`verify-file.cjs` check (6) needs scoping to the component body** — see §8.6. It has now false-positived on three separate files.
- Unexplained: live `index-BVXVwMaJ.js` measured 1,654,953 bytes vs 1,895,966 bytes for the same-named file inside the AAB.

---

## 8. Engineering rules for this codebase — **READ BEFORE CODING**

Everything here was learned the hard way during Tiers A, B and C.

### 8.1 How the translation layer actually works

- **Custom, dependency-free.** No i18next, no react-intl. `src/i18n/`.
- **Two hooks:** `useI18n()` → `{ lang, setLang, t }`, and `useT()` → `t` only. **Both must be searched when auditing coverage.**
- **`t()` has NO interpolation.** Signature is `t: (key: string, fallback?: string) => string`.
- **Lookup order:** `lookup(lang, key) ?? lookup("en", key) ?? fallback ?? key`, where `lookup` checks `homeTranslations` **first**, then `translations`.
- **Two dictionaries, disjoint key sets:** `home.ts` (83 keys, blocks nested as `  en: {`, keys at 4 spaces) and `translations.ts` (1,714 keys, blocks at column 0 as `const en: Dict = {`, keys at exactly 2 spaces). **Any verification script must parse both, and their formats differ.**
- **`t` identity is STABLE** — it is a `useCallback` keyed on `[lang]` inside a `useMemo`. It is therefore **safe in a dependency array**; it changes only on a language switch. Verified by reading `I18nContext.tsx`, not assumed.

### 8.2 Patterns for translating a string

- **Placeholders are `{t}` (text) and `{n}` (number) only.** The call site does `t("key").replace("{n}", String(value))`. **No third placeholder letter is permitted** — the gate rejects it.
- **No plural engine.** Singular and plural are two separate whole keys chosen by a ternary at the call site, **each carrying its own `{n}`**.
- **NEVER glue translated words together at a call site.** English word order is not universal. Each full variant becomes ONE whole key. A sentence built from three fragments driven by two booleans becomes **four whole keys**, not three fragments.
- **Sentence containing an inline React element → split-on-`{t}`.** The whole sentence is one key with `{t}` where the element sits; the call site does `t(key).split("{t}")`.
- **Glyphs stay outside the key.** Arrows (`→`), `⌘K`, `↑↓`, `↵`, `·` are not words.
- **Key names are NOT translated.** `Esc`, `"Escape"`, `"Enter"` stay English.
- **Stored values vs display values.** Anything persisted to the DB, used as a React `key=`, or used as a grouping key stays **English**. Only the rendered label translates. **When in doubt, check every write in the file.** `Wallet.tsx`'s `description: "Wallet Top-up"` is the sharpest example: it is simultaneously a rendered checkout label and a value written into Razorpay's merchant records.
- **Module-scope objects can't call hooks.** Five resolutions, in order of preference: (a) add an additive `labelKey` field resolved at the render site with the English original as the `t()` fallback; (b) pass the translator in as a parameter; (c) if it's a component, call `useT()` inside it; (d) prefer the additive field over a parameter when there are many return sites; (e) for a **dual-purpose** map whose values are both grouping key and display text, leave the map English and add a **separate sibling map** resolved at the render site. `UserMenu.tsx`'s `MENU_LABEL_KEYS` + `tm()` is the reference implementation of (e).
- **`useT()` must sit ABOVE every early return** — including **block-form** `if (cond) { return ... }`.
- **A `t()` call inside a jsPDF `doc.text()` is a trap, not a win.** See §8.9.

### 8.3 Key taxonomy and the promotion rule

Generic UI verbs and shared-feature terms get a neutral family (`common.*`, `report.*`, `post.*`, `mod.*`, `nb.*`, `privacy.*`, `comp.*`, `phase.*`). Feature-specific copy keeps its component prefix.

When a second consumer appears for an existing prefixed key, **PROMOTE the key in its own single-purpose commit** rather than minting a duplicate that can drift.

**Counter-rule 1 — do not break a coherent family.** Do not extract a key out of a *symmetric local cluster*. Mint alongside instead, with values byte-identical to the existing cluster, and record the duplicate.

**Counter-rule 2 — if the prefix is still accurate, no promotion is needed.** `sidebar.browseCourses` was reused inside `AnonymousSidebarFallback.tsx` without a promotion commit, because that component **is** sidebar content. **The promotion rule fires on prefix inaccuracy, not on cross-file use.** Same reasoning applied in Tier C: `EditEntryDialog.tsx` reuses the `csub.*` EXIF family directly, because that dialog is the edit-mode twin of `CompetitionSubmit`'s form.

**Counter-rule 3 — a dynamic lookup wants one coherent family.** `GlobalSearch`'s `typeConfig` got a whole new `gs.type.*` family of five rather than a mixed set drawn from three existing families, because a mixed set is unreviewable by the native speakers who must sign it off.

**Reuse minimises minting, and it works.** `Wallet.tsx` needed only **9** new keys against **5 reuses**. **Every reuse that changes the rendered English must be disclosed at the call site AND in the commit message.**

### 8.4 Reuse traps that look clean and are not

- **The part-of-speech trap.** `composer.post` has `en="Post"` — an exact English match for a noun label. But every Indic value is an **imperative verb** (`hi="पोस्ट करें"`, `ta="இடுகையிடு"`). Hit again in Tier B: `pcd.moveToTrash` = "Move to trash" is an **imperative menu label**, while `Feed.tsx` needed the **past-tense confirmation** "Post moved to trash". **English collision ≠ reusable key. Check part of speech in the target languages, not just English string equality.**
- **The CSS-uppercase latent-change trap.** `dash.qa.learnPhotography` has `en="Learn photography"` (lowercase p) vs a target site's "Learn Photography". A CSS `uppercase` class makes them render identically **today**, but the underlying English differs, so it becomes a rendered-English change the moment that class is touched. Note `uppercase` is **Latin-only**: stored values must keep natural case so every Indic script is unaffected.
- **THE NAME-COLLISION-IS-NOT-A-DUPLICATE-CHECK TRAP — new in Tier C, and the most expensive one so far.** `gate.cjs` check (ii) asks *"does this KEY NAME already exist?"*. It does **not** ask *"does some other key already hold this English VALUE?"*. Those are different questions and only the second one catches a duplicate. Four keys were nearly minted for `Wallet.tsx` that already existed under different names, complete in all seven languages. **`reuse.cjs` on the VALUE is mandatory before minting. A green gate is not a licence to mint.**

### 8.5 Mojibake — a detectable, mathematically reversible defect class

Text that was valid UTF-8, decoded as Latin-1, then re-encoded as UTF-8.

**Detection:** take each run of 2+ characters in U+0080–U+00FF, map codepoints straight back to raw bytes, decode as UTF-8 with `fatal: true`. **Success ⇒ mojibake, and the decode result IS the original character** — recovered, not invented. **Failure ⇒ legitimate Latin-1** (`café`), leave untouched.

- `scripts/scan-mojibake.cjs` — report-only, repo-wide.
- `scripts/fix-mojibake-one-file.cjs` — repairs ONE file behind four gates: run count must equal the CLI-supplied expected count; round-trip inverse proof; **reversal-reproduces-the-original proof, scoped to the repaired runs only**; unchanged line count.

Both are pure ASCII by design.

> **The third gate was WRONG until `a3c15a3`.** It re-encoded the whole file instead of only the runs it changed, so any unrelated legitimate non-Latin-1 character elsewhere made it abort. It refused correct work while reporting a safety failure. See mistake #8. **Read an abort; do not obey it.**

**Current state: 0 files / 0 runs, repo-wide.** This figure was re-checked after every commit in Tiers B and C. **The backlog is empty, which makes right now the cheapest possible moment to add this scanner to CI.**

### 8.6 The mandatory verification workflow

Tooling lives **in the repo** at `scripts/i18n/`. **Five tools, and their argument signatures matter — three of them were discovered the hard way by reading the source after a crash:**

| Tool | Signature | Note |
|---|---|---|
| `gate.cjs` | `<batch.json>` | **Run BEFORE the insert.** Check (ii) is a *collision* test and is meaningless afterwards. |
| `add-i18n-keys.mjs` | `<batch.json>` | lives at `scripts/`, not `scripts/i18n/` |
| `verify-file.cjs` | `<sourceFile> <batch.json>` | **BOTH arguments required.** Omitting the second throws `ERR_INVALID_ARG_TYPE`. |
| `scan-untranslated.cjs` | `[directory] [--list]` | takes a **DIRECTORY**, not a file. A file path throws `ENOTDIR`. `--list` prints per-hit detail; without it you get counts only. |
| `reuse.cjs` | `<"English value"> ...` | accepts many values in one call |
| `bucket-scan.cjs` | `[--explain]` | scope classification |

Mojibake tools are at `scripts/scan-mojibake.cjs` and `scripts/fix-mojibake-one-file.cjs` — **not** under `scripts/i18n/`.

**BEFORE every dictionary insert** — `gate.cjs`, six checks: (i) all 7 languages present and non-empty (ii) zero collisions against `translations.ts` **and** `home.ts` (iii) raw duplicate-key-line scan vs Set size vs `JSON.parse` count — because **`JSON.parse` silently collapses duplicate keys** (iv) `{t}`/`{n}` multiset consistency across all 7 (v) no other placeholder letter (vi) script-block purity, danda-aware.

> **Check (vi) SELF-TESTS.** It splices Devanagari into a Tamil value and must print **`CAUGHT - gate works`**, exiting non-zero if it does not. **A 0-violation verdict from a blind gate is worse than no gate.**
>
> **Known blind spot 1: `hi` and `mr` share the Devanagari range**, so the gate cannot detect Hindi spliced into a Marathi slot. Only a native speaker catches that.
>
> **Known blind spot 2: ASCII is NEUTRAL by design** (`cp < 0x0900`), so Latin brand names embedded in Indic values — "Apple Pay", "NetBanking", "NEFT/IMPS", "Razorpay SDK", "UPI", "IFSC" — pass script purity. That is correct behaviour, not a hole, but do not read a pass as "this value contains no English."

**THE INSERT** — `add-i18n-keys.mjs` splices into all 7 blocks in one pass, anchored on `  "auth.email":` and inserting **bottom-up** so earlier anchor indices stay valid. It refuses the run if any key already exists, if any key is missing any of the 7 languages, or if the anchor count ≠ 7.

**AFTER every file** — `verify-file.cjs`, six checks: forward resolution of every `t()` call site against both dictionaries (distinguishing "fallback-only, OK, dynamic" from "**UNRESOLVED, NO FALLBACK**"); dead-key check (every minted key must be consumed); leftover JSX text-node scan; quoted-literal review list; template-literal scan; `t`-shadowing scan; hook-order confirmation.

> **Check (6) has a KNOWN FALSE-POSITIVE MODE and has now fired three times.** It scans the whole file rather than scoping to the component body, so a `return` inside a **module-level helper declared above the component** is mistaken for an early return.
> — `FeedStoriesBar.tsx`: cited line 44 was `return new File(...)` inside module-level `compressForUpload()`.
> — `EntryCard.tsx`: cited line 35 was inside the plain helper `buildEntryCardSrcSet()`; the component's body opens at L123 and `useT()` at L124 is its first statement.
> — `Wallet.tsx`: cited line 46 was inside the module-level `txnIcon()` helper; the `Wallet` component opens at L52 and `useT()` at L58 is its first hook.
> **Never accept an UNSAFE verdict without reading the cited line, and never wave one away without printing the proof into the commit message. The check itself should be fixed to scope to the component body.**

> **Check (5) `t`-shadowing likewise reports candidates, not defects.** In `Wallet.tsx` it flagged three: two are inside the PDF generator (`.filter(t => …)` at L424 and `for (const t of filtered)` at L445) and contain **no** translation call — the `t("wal.ledgerDownloaded")` at L457 sits outside the loop, which closes at L454 — and the third is the known transaction map at L1023, where every translation call correctly uses the `tr` alias. **All three benign, established by reading the scopes, not by pattern-matching.**

**Reuse check before minting anything** — `reuse.cjs "English string"` prints every existing key with that English value across all 7 languages and flags `*** DRIFT ***`. **This is not optional; see §8.4.**

**Then, always:**

```
node scripts/scan-mojibake.cjs                    # must stay at 0 files / 0 runs
npx tsc --noEmit -p tsconfig.app.json             # EXACT CI command -- never plain tsc --noEmit
timeout 300 npx vite build > /tmp/build.log 2>&1  # run ONCE, then grep the log
```

**Baseline noise to expect, not regressions:** `vite build` emits **4 "is ambiguous" warnings** and an `svgo` resolution error (`vite-plugin-image-optimizer` can't find `svgo` for `placeholder.svg`). **Exit is still 0.**

**Dictionary integrity** — all 7 blocks must report identical key count **and identical key set**, 0 duplicates. Current expected: **1,714 keys per block in `translations.ts`, 83 per block in `home.ts`, 0 duplicates in all 14 blocks.**

### 8.7 Other traps

- **Comment syntax must match context.** `//` in TS function bodies; `{/* */}` only in JSX **child** position — **never inside a JSX opening tag's attribute list**; and a bare `/* ... */` **is** valid in a JavaScript *expression* position.
- **The `t`-shadowing crash class.** A callback parameter literally named `t` inside a component that does `const t = useT()`. **The established remedy is `Wallet.tsx`'s: `const t = useT(); const tr = t;` at the top, and every translation call inside the shadowing scope uses `tr`.** Known harmless instances deliberately not renamed: `AdminTransactions.tsx:331`, `WallPosts.tsx:350` and `:391`.
- **Edit `old_string` matches as a SUBSTRING, not a whole line.** Two identical strings in one file need **two distinct anchored edits**, never `replace_all` — that is a bulk modification. **When a literal genuinely recurs many times (the four `<strong>Bank:</strong>`-style labels in `Wallet.tsx` appear at 8 sites), the safe form is a transform that first asserts the EXACT expected occurrence count for each literal, writes nothing on any mismatch, and post-checks that no literal survived.** Gated and provable, not bulk-and-hope.
- **Pre-existing conditional-hook violation:** `UserMenu.tsx` calls `useT()` **after** an early `if (!user) return null;`. Flagged, not fixed.
- **`src/lib/competitionPhase.ts` `phaseDisplayLabels` is English but used only as a `t()` fallback — correct as-is.** The dynamic pattern is `t("phase." + competition.phase, phaseDisplayLabels[competition.phase] || competition.phase)`.
- **URL/handle placeholders deliberately left English** — `your-name`, `yourprofile`, `yourhandle`, `yourchannel`, `https://…` prefixes, `+91 XXXXX XXXXX`. Reason: `validateCustomUrl` accepts only `[a-zA-Z0-9._-]`. **Same principle covers example values in EXIF fields — `Canon EOS R5`, `24-70mm f/2.8`, `400`, `2.8`, `0.004`, `50` are model names and numeric notation, not copy.**
- **Runtime error strings are not UI copy.** `err.message` from Supabase is passed through untranslated, deliberately. **But a hardcoded English fallback BESIDE one is copy** — `Wallet.tsx` had five (`data?.error || error?.message || "Capture failed"`) that the scanner never saw because they sit in a `||` chain, and all five reach the screen.

**The 21 date-locale gaps** (every one flagged in code, none auto-fixed): Dashboard `TimeAgo`; `OnboardingModal.tsx`; `EditProfile.tsx`; `Profile.tsx` `memberSince`; `IDVerification.tsx` `fmtDate`; `PublicProfile.tsx` (×3); `PostCommentsSection.tsx` `timeAgo`; `src/lib/postUtils.ts:24` `timeAgo` (hard-coded `"en-US"`); `ImageEngagement.tsx` local `timeAgo`; `NotificationBell.tsx` gift expiry; `WallPosts.tsx` schedule toast; `FeedRightSidebar.tsx` L213 and L215; `GlobalSearch.tsx` L613, L234, L472, L500; `PostDetail.tsx`; `feed/FeedStoriesBar.tsx` L324.

**Added in Tier C:** `Wallet.tsx` L1037 and L1041 hard-code `toLocaleDateString("en-US", …)`; L430, L447, L571, L865 and L920 call `toLocaleDateString()` with no locale at all, which silently follows the *browser*, not the chosen language.

### 8.8 Duplicate and drift catalogue — **flag, do not auto-fix**

**Drifted** (same English, diverged Indic): "Accept" (`common.accept`/`jg.accept`, hi) · "Friends" (`menu.friends`/`privacy.friends`, bn) · "Featured" (`common.featured`/`pp.featuredAlt`, hi+mr+gu+te) · "Notifications" (`common.notifications`/`adm.nav.admin_notifications`, hi) · "Just now" (`common.justNow`/`dash.justNow`, hi+ta) · "Like" (`pcs.like`/`cmt.like`, hi+mr+gu+ta+te) · "Failed to delete" (`common.deleteFailed`/`cmt.deleteFailed`, hi+mr+gu) · "Open" (`phase.submission_open`/`comp.filterOpen`/`ast.st.open`, en+mr+gu+ta) · "Voting" (`phase.voting`/`comp.filterVoting`, gu) · "Winners" (`nav.winners`/`msheet.winners`/`win.winners`, gu) · "All" (`common.all`/`comp.filterAll`/`dash.status.all`/`ast.st.all`, en+gu) · "Photographer" (`common.photographer` + 4 others, hi+mr+ta) · "Share" (`post.share`/`jart.share`, hi+te) · "Upload failed" (`ps.uploadFailed`/`onb.uploadFailed`, ta) · **"Photos" (`msheet.photos`/`csub.photosLabel`/`mp.photos`, hi — `csub.photosLabel` is `फोटो` while the other two are `तस्वीरें`; found in Tier C, `EditEntryDialog` uses `csub.photosLabel` because it is the edit twin of the submit form).**

**Same-valued duplicates, no drift today:** "Competitions" (4 keys) · "Courses" (3) · "Journal" (3) · "Upcoming" (2) · "Judging in progress" (4) · "Results announced" (2) · `gs.type.competition`↔`win.competition` · `gs.type.journal`↔`nav.journal` · `anon.learnPhotography`↔`dash.qa.learnPhotography` · the `privacy.*` triad duplicated by `home.privacyPublic`/`home.privacyFriendsShort`/`home.privacyOnlyMe` in the separate `home.ts`.

**Pending promotions, not yet done:** `home.subscribe`/`home.subscribed` → `common.*` · `sidebar.add` → `common.add` · `mp.uploadFailed` → `common.*` · `fr.followingTab` + `pp.follow` → a single `fr.follow`/`fr.following` pair · `gs.type.post` → `common.post`.

### 8.9 The jsPDF font blocker — a real technical dependency, not a to-do

`Wallet.tsx`'s `generateLedgerPDF()` (L421–458) writes the transaction ledger with `doc.text()`. **jsPDF's built-in standard-14 fonts are WinAnsi / Latin-1 only.** Devanagari, Bengali, Tamil, Telugu and Gujarati have no glyphs in that encoding, so translating those strings today would produce **blank or garbled PDFs in six of the seven languages** — strictly worse than leaving them English.

**What localising the PDF actually requires, in order:** obtain a Unicode TTF with the needed script coverage (Noto Sans + Noto Sans Devanagari / Bengali / Tamil / Telugu / Gujarati); convert to jsPDF's VFS format; `doc.addFileToVFS(...)` then `doc.addFont(...)` then `doc.setFont(...)` **per script**; accept the bundle-size cost (these fonts are large, and this is a Capacitor app shipping the bundle inside the AAB); *then* translate the strings.

**Until that is done, the ledger block stays English on purpose.** Anyone who "finishes" this file by wrapping those `doc.text()` calls in `t()` has broken the feature while appearing to improve it.

---

## 9. Git state and how to resume

```
eeea211 feat(i18n): translate Wallet.tsx (Tier C) - 9 new keys x 7 languages + 5 reuses  <- HEAD
6f2a2c2 feat(i18n): translate EntryCard.tsx (Tier C) - 12 keys x 7 languages
7b50ec4 fix(encoding): repair the last 3 mojibake runs - repo is now clean
69837ac fix(encoding): repair 48 mojibake runs in EntryCard.tsx
a3c15a3 fix(tooling): mojibake fixer gave a FALSE ABORT - proof (3) was unsound
5f42652 tooling(i18n): add bucket-scan.cjs; document the lookup-key false positive
fbb55b2 tooling(i18n): add scan-untranslated.cjs occurrence scanner
486f8a9 feat(i18n): translate Feed (Tier B 17/17 - Tier B COMPLETE)
...
fe76369 Add files via upload                          <- origin/feat/i18n-tier-a
```

**Branch `feat/i18n-tier-a`, 33 unpushed commits** (measured with `git log origin/feat/i18n-tier-a..HEAD --oneline | wc -l`, not asserted).
Tier A detailed history preserved on `archive/tier-a-detailed-history` (tip `ed4a3f3`).
Safety tag `backup/local-pre-upload` → `c6dbfff`.

### To resume: Tier C, file 3 of 14 — `src/components/competition/EditEntryDialog.tsx`

The file has **no i18n hook at all** today, so it needs the import and `const t = useT();` added. Reuse is unusually rich here because the dialog is the edit-mode twin of `CompetitionSubmit`'s form — **already confirmed with `reuse.cjs`**: `common.cancel`, `ep.uploading`, `csub.photosLabel`, `csub.photo`, `csub.titleRequired`, `csub.exifCamera`, `csub.exifLens`, `csub.exifIso`, `csub.exifAperture`, `csub.exifShutter`, `csub.exifFocal`, `csub.exifDate`, `csub.rawCommit`, `csub.rawHint`, `csub.missingExif`, `csub.missingExifDesc`, `csub.addDescription`, `tag.photoNumber` (`"Photo {n}"`, for the `alt` text and the per-photo title placeholder).

**The per-file procedure, unchanged:**

1. Read the file **in full** — do not trust the regex count in either direction.
2. `reuse.cjs` on **every** proposed English VALUE before minting anything (§8.4).
3. Mint a batch JSON under `scripts/`.
4. `gate.cjs <batch.json>` — **do not proceed unless you saw `CAUGHT - gate works`**.
5. `add-i18n-keys.mjs <batch.json>`, then re-check dictionary parity.
6. Anchored edits, one at a time, never `replace_all`.
7. `verify-file.cjs <file> <batch.json>` — investigate every verdict, override none silently.
8. `scan-mojibake.cjs` + `npx tsc --noEmit -p tsconfig.app.json` + `vite build`.
9. Commit, alone.

**Per-file commit message convention:** state every verification step **with its actual output**, not a claim that it passed. If a tool was fixed mid-file, say so in the commit message rather than patching it quietly. If a verifier produced a verdict you are overriding, **paste the proof that justifies the override.** Disclose every rendered-English change, every reuse, and every string left English on purpose with the reason.
