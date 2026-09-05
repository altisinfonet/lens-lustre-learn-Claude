# URL NAMESPACE — how a member's public address works

**THE SINGLE AUTHORITY FOR THE NAME-URL FEATURE.** Before this file existed, the entire
specification lived only in chat messages. **If a session had ended, the rules would have died with
it** — and the Auditor had already been wrong about them twice in writing. That is why this document
exists and why it records not only the rules but **how they were got wrong**.

**Owner:** the Owner sets the rules. **The Auditor** records and verifies them. **D1** owns the
database half, **D2** the client half, **D3** this file.

**Status:** SPECIFICATION. Nothing here is implemented by this file. Where a rule is not yet
enforced, it says so.

---

## 1 · THE OWNER'S RULES

Each rule is quoted from the Owner. **His words are the authority; the surrounding text is
explanation, not amendment.**

### 1.1 · Every member has one, and the count without one must be ZERO

> **"HAVE NONE must be zero for both site"**

Every member must have a name-URL. **The count of members without one must be ZERO on BOTH lanes** —
staging and production. This is a measurable acceptance criterion, not an aspiration: it is a
`SELECT count(*) … WHERE custom_url IS NULL` that must return `0`, on each lane, and it must be
re-measured after any backfill.

### 1.2 · The format is `first.last`, with digits on collision

> **"Neil Basu -> neil.basu"**
> **"if not available neil2345, anything use but use must"**

Derived from the member's name as `first.last`. **On collision, append digits.** The Owner's last
clause is the operative one: *"anything use but use must"* — **a collision must never result in no
URL at all.** The generator must terminate with a usable value.

### 1.3 · ALWAYS English letters — transliterate, never strip

> **"always all url will be in english. Name নীল বসু but URL will be nil.basu always... hard rule.
> no other language"**

**A non-Latin name is TRANSLITERATED, never stripped.** Stripping non-Latin characters would produce
an empty or mutilated URL and would silently violate §1.1. This is the rule most likely to be got
wrong by an implementation that reaches for a "slugify" helper, because the common ones drop what
they cannot map.

**THE OWNER'S TWO WORKED EXAMPLES ARE ACCEPTANCE CRITERIA. They must pass verbatim:**

| name | REQUIRED url |
|---|---|
| নীল বসু | **`nil.basu`** |
| শীর্ষেন্দু দত্ত | **`shirshendu.dutta`** |

**These are not illustrations. A generator that does not produce exactly these two strings from
exactly these two names has not met the specification.**

### 1.4 · Changeable once a year, and old links live forever

> **"limited mean Once a year"**

A member may change their URL **once a year**. **Old links must keep working forever**, through
`custom_url_history`. A URL that has ever been public is a promise to everyone who saved it.

### 1.5 · The name-URL is the address the member sees

> **"any link always show profilename link"**

Landing on `/profile/<id>` must **end up showing the name-URL**. The ID link itself **stays valid and
shareable** — it is not broken, it resolves and then settles on the name form. Both addresses work;
only one is displayed.

---

## 2 · THE ENGINEERING CONSTRAINTS, each with why it exists

### 2.1 · The reserved list — and why a member could otherwise vanish

**The vanity route is a catch-all matched AFTER every real route.** A member whose URL equals a route
name is **unreachable forever, with nothing appearing broken** — the route wins, the member's page
never renders, and no error is raised anywhere. **Nothing in the system reports this. It is silent by
construction.**

**`Page` and `Post` are real surnames, and both are live routes** (`src/App.tsx`: `/page/:slug`,
`/post/:postId`). This is not a hypothetical.

**The Auditor checked both lanes and found ZERO existing collisions. This constraint is therefore
PREVENTIVE, not remedial** — it is cheap now and unfixable later, because by the time a collision
exists someone's public address is already broken.

**THE LIST MUST BE DERIVED FROM `src/App.tsx` AT BUILD TIME. IT MUST NOT BE HAND-MAINTAINED.**

**Why, and this is the whole reason:** the Auditor's first list held **28** names. It was produced by
grepping single-segment routes and **silently missed every nested one**. A hand-maintained list is
wrong the moment someone adds a route and does not think about this file — and the failure mode is
silent. **A derived list cannot drift; a hand-written one already has.**

**THE LIST THAT IS ACTUALLY RUNNING HOLDS 68 ROWS.** It is the table
`public.reserved_custom_urls`, seeded by
`supabase/migrations/20260910_0006_f93_reserved_custom_urls.sql` and re-derived in CI by
`scripts/check-reserved-urls.mjs`, which **fails the build when a route exists with no reserved
row.** **The table is the source. This document quotes it; it does not define it.**

| kind | count | what it holds |
|---|---|---|
| **legacy** | **16** | `api` `www` `root` `system` `support` `help` `contact` `about` `user` `users` `mail` `ftp` `cdn` `static` `media` `not-found` |
| **route** | **39** | every first-segment route name derived from `src/App.tsx`, including `__crop-test` and `idverification` |
| **static** | **13** | `assets` `avatars` `images` `_headers` `favicon.png` `robots.txt` `sitemap.xml` `manifest.json` `llms.txt` `og-image.png` `placeholder.svg` `apple-touch-icon.png` `sw-image-cache.js` |
| **TOTAL** | **68** | |

**`assets` IS reserved, and the reason is measured rather than reasoned.** Against staging:
`GET /assets` returns **404 `text/plain`**, `GET /assets/` returns **404 `text/plain`**, and the
control `GET /sofia.duarte` returns **200 `text/html`**. **The Pages catch-all
`functions/assets/[[path]].ts` swallows the bare single segment**, so a member whose slug were
`assets` would be **unreachable** — not merely shadowed at two segments. **A reader who doubts this
can take the three readings again rather than take our word.**

### 2.2 · Historical URLs are NOT free for reuse

A URL released by a member — moved into `custom_url_history` — **must never be reassigned to a
different member.**

**Why:** handing a released URL to someone else **silently redirects every old link to the wrong
person.** The links do not break; they resolve, confidently, to a stranger. **A silent wrong answer
is worse than an error** — the same principle that blocked the P31 revoke in
`docs/gates/P1-revocation-list.md` §2.2.

The uniqueness check must therefore consider `custom_url` **and** `custom_url_history` together.

### 2.3 · Uniqueness is case-insensitive, enforced by the database

**`/Sofia.Duarte` already resolves.** Case-insensitive resolution is live behaviour today, so
case-sensitive uniqueness would permit `sofia.duarte` and `Sofia.Duarte` to be **two rows that are
one address**.

**Enforced by a database constraint, not by application code.** A check in the client or in a
function is advisory; two concurrent writes race past it. **The constraint is the only thing that
cannot be bypassed**, and it must be case-insensitive.

### 2.4 · THE GUARANTEES, AS MEASURED — not as intended

**Read from the live table by the Auditor, not from notes. Lane: `staging`. Date: 2026-09-05.**

| guarantee | measured | state |
|---|---|---|
| every member has a name-URL (§1.1) | **513 of 513** | ✅ **MET on staging** |
| no reserved collisions (§2.1) | **0** | ✅ |
| no duplicates (§2.3) | **0** | ✅ |
| nothing outside `[a-z0-9.]` (§1.3) | **0 rows** | ✅ |

**⚠ THE FIRST ROW IS TRUE OF THE 513 THAT EXIST, NOT OF THE NEXT MEMBER TO SIGN UP.**

**F-93 IS NOT COMPLETE. Units 4, 4b and 5 are merged in code but NOT APPLIED to staging.**
`handle_new_user` **does not mention `custom_url`**, and **there is no INSERT-time trigger** — so
**a member signing up on staging right now still gets NULL.** D1 is applying them.

**§1.1's guarantee is therefore PENDING-ON-APPLY**, and stays pending until the Auditor confirms.
A backfill that fixes 513 rows and leaves the 514th broken has not met *"HAVE NONE must be zero"* —
**the rule is a property of the system, not a one-off state of the table.**

---

## 3 · THE CORRECTIONS — recorded in full, because a spec that hides how it was got wrong teaches nobody

### 3.1 · The Auditor told D1 and the Owner that `custom_url` could be changed later. **FALSE.**

The Auditor stated that `custom_url` could be changed later, and that history made assignment safe.
**Both halves were wrong.**

**D1 tested it. `forbid_custom_url_change()` refused EVERY value-to-value change.** An assignment
would therefore have been **permanent** — a member given a wrong URL by a backfill would have been
stuck with it, and the "we can fix it later" that justified the assignment did not exist.

**Evidence: D1's rolled-back probe**, which demonstrated the refusal against the live function rather
than reasoning about its source.

**The Owner then ruled the permanence itself a defect** — which is how §1.4's once-a-year change
right came to exist. **The correction produced the rule.**

**The lesson, stated plainly:** the Auditor asserted a system behaviour without reading the
instrument. D1 read it. That is the same class as every other correction in this project's ledger —
*a claim reported before its instrument was read.*

### 3.2 · The fixture finding — a generator run against staging today would prove nothing

Measured on staging, ten minutes before this file was written:

| property | count |
|---|---|
| profiles | **513** |
| non-Latin names | **ZERO** |
| Cyrillic names | **ZERO** |
| Bengali names | **ZERO** |
| single-word names | **ZERO** |

**A generator run against staging as it stands would pass 513 of 513 — and exercise NONE of the paths
that can fail.** Every rule in §1.3 — transliteration, the Owner's two Bengali examples, the
single-word case — would go untested while the suite reported green.

**This is C-34 at the level of the fixture: a test that could not have failed is not evidence.** The
usual form of C-34 is a weak assertion; this is the same defect one level down, in the data the
assertion runs against. **A green run here would have been a false negative dressed as proof.**

**This is why the seed is being fixed BEFORE the backfill**, and it compounds F-91 (§40 of the
ledger): the same seed that could not let the Owner spot-check a working fix also cannot let a
generator prove itself.

---

## 4 · WHAT THIS FILE DOES NOT DO

* It **implements nothing.** D1 owns the database half; D2 owns the client half.
* It **does not define** the reserved list. `public.reserved_custom_urls` does; this file quotes it.
* It **does not close** F-91. The seed is still narrow.
* It **does not close** F-93 — §2.4's first guarantee is **pending-on-apply** until the Auditor
  confirms units 4, 4b and 5 are applied to staging.
* It records the specification **as of 2026-09-05**. Where the Owner rules differently, his ruling
  wins and this file is amended — **with the superseded text left visible**, as
  `docs/gates/P1-revocation-list.md` §2.2 was, because a gate that silently loses its own history is
  not a gate.

### 4.1 · SUPERSEDED — this file recorded **51** and was wrong. **C-86.**

**The superseded text, left visible per the convention above:**

> *"Current derivation, measured on `staging` at the time of writing — 51 segments … 39 first-segment
> route names in `src/App.tsx` … 12 top-level entries in `public/` … total 51 … ⚠ OPEN QUESTION FOR
> THE AUDITOR — `assets` is NOT in the 51."*

**Why it was wrong.** The count was **derived from the source tree** — `App.tsx` and `public/` — when
**a table had already been applied that decided the question**. `reserved_custom_urls` holds **68**
rows, not 51: the route half matched exactly, **the static half and the total were stale**, and the
`assets` question the file raised **had been answered by the migration before the document was
written.**

**The route half was sound and is not withdrawn** — 39, independently derived twice, including
`__crop-test` and `idverification`.

**C-86, a Rule 21 finding against this document.** The specification and the applied schema
disagreed, **and the specification is what would have been handed to the Owner as the description of
the system.** A document that describes a list that is not the one running is worse than no document:
it is confidently wrong, and it invites a reader to trust it instead of measuring.

**The lesson is this project's oldest one, committed here in a new place:** *a claim reported before
its instrument was read.* The instrument was the table. **This file now quotes the table and says so.**
