# WORKING RULES — the method. Read before touching anything.

Last updated **2026-08-06**. This is the owner's method, in his words where he
gave them, plus every rule learned by getting it wrong.

---

## 0. THE OWNER'S VERBATIM LIST

> **ABSOLUTELY NO:**
> ❌ Guesswork ❌ Assumptions ❌ Implicit behavior ❌ Hidden operations
> ❌ Recursive actions ❌ Fan-out execution ❌ Bulk modifications
> ❌ Auto-fix behavior ❌ "Probably safe" logic ❌ Casual AI shortcuts

> *"not a single kind of mistake I can't afford. Build small but build like a
> bullet proof."* (2026-08-02)

> *"just i cant check is not the soltuion"* — a log the owner cannot open is not
> tracking. **A fix that cannot be SEEN is indistinguishable from no fix.**

---

## 🚫 1. DO NOT — the hard prohibitions

### ❌ NEVER put a personal e-mail address anywhere a member can read it
**Owner ruling, 2026-08-06.** The support address is **`mail@50mmretina.com`**.
The owner's personal gmail (`altisappdev@…`) must **never** appear in any
member-facing page, e-mail template, edge function, SQL, or alt text.

It was live on **Help & Support** (`src/pages/HelpSupport.tsx`) until 2026-08-06,
in **two places at once** — the `mailto:` href AND the visible link text.
**When you change an address, change both**, or the link and the label disagree
and nobody notices.

**Before shipping anything that shows a contact address, run:**
```
grep -rn "altisappdev" src public index.html supabase
```
It must return nothing. (The address is deliberately not repeated in code
comments either, so this grep stays clean.)

### ❌ NEVER delete a user account
### ❌ NEVER enter credentials — he signs in himself
### ❌ NEVER commit secrets
### ❌ NEVER log a member's own words
Comment text, search terms, captions. Log a **length, a count, or a boolean** —
never the text itself. `redact()` does NOT cover this: it drops keys that *look*
like secrets, and `content` does not.

### ❌ NEVER show an invented value
Blank is honest. A column with no data shows nothing, never a guess.

### ❌ NEVER use a third-party brand or format name where a member can read it

### ❌ NEVER say a bug is fixed without saying whether it reaches the APP
The app bundles its own copy of the site (`webDir: 'dist'`, no `server.url`).
A web-only fix is **invisible on the owner's phone**. If he reported it from the
app, "fixed" without a build is not a completed task — say so at the TOP of the
message, not the bottom. **This cost most of 2026-08-06.**

---

## 2. TWO STANDING DIRECTIVES ADDED 2026-08-06 — PERMANENT

### a) Enterprise structured logging on every function you write or modify
Never `console.log`. Never a generic message. Every log carries a **code** from
the catalog and answers: what operation, which function, which file, which
member, which record, what was expected, what actually happened, why this branch
ran, why it failed, and the recommended next investigation. Add timing to
important operations. See **`LOGGING_STANDARD.md`**.

### b) A Completion Verification Report after EVERY task
**Never simply say "Done."** A checklist marking each item ✅ DONE / ❌ NOT DONE
/ ⚠️ PARTIALLY DONE / N/A, with concrete evidence for every DONE, and an explicit
explanation of anything incomplete.

---

## 3. PROOF, NOT CLAIMS

- **Measure before you build.** Query the database, read the raw log, load the
  live page. Every number in a report must come from something you ran.
- **Prove after you ship.** Byte-diff every pushed file
  (`git show origin/main:<path> | diff - <path>`), and check the DEPLOYED chunk —
  not the source — for the feature string.
- **Clicking Commit is not evidence it committed.** Only the byte-diff is.
- **Run a "regression test" against `main` first.** If it passes there, it is not
  a regression test — delete it.
- **Record the pre-existing failure count** before you start. Current baseline:
  **25 failing** (4 ProfilePhotoPrompt + 21 competition/judging).
- **Never conclude "not called" from a truncated grep.** A `head`-truncated
  search once sent an entire investigation at the wrong file.

## 4. SCOPE

- **Do exactly what was asked.** Do not extend a decision from one area to
  another by inference.
- **No bulk modifications.** Convert file by file with verification.
- **Ask when the decision is the owner's** — anything that changes what members
  experience, costs money, or cannot be reversed.
- **Builds are cut only on his explicit GO.** A push to `main` deploys to members
  in ~90 seconds — treat that as needing GO too.

## 5. THE PRODUCT'S OWN RULES

- **A post REQUIRES a photograph. The caption is optional.**
- **A missing profile photo NEVER blocks posting, commenting or reacting.**
  Two SEPARATE rules — they were conflated once and it changed what the product is.
- **Play "What's new" is exactly `Bug fixes and improvements.`** The detailed
  changelog goes ONLY in `ANDROID_BUILD_TRIGGER`.
- **A member's own privacy switch outranks a feature.**
- **Nothing a member does may move a displayed figure.**
- **An error message must tell the member what happened.**
- **No running character counter** on any member text area.
- **Members-only links send a signed-out visitor to the sign-in page.**
- **The web top bar is fixed at all times.**
- **Name first, then badge — and the badge must be VISIBLE.**

## 6. WHEN SOMETHING IS REPORTED BROKEN

1. **Reproduce or measure first.** The "unable to delete a story" report was a
   screen that never refreshed — the delete was working.
2. **A write that succeeds but changes zero rows is almost always RLS.**
3. **When the owner offers evidence, take it.** Screenshots have solved more
   here than reasoning has.
4. **Do not claim a root cause you have not established.** Say "no root cause
   established" and mean it.
5. **Check the mechanism can even fire before you fix it.** The DELETE
   subscription fix only worked because `pubdelete = true` and `profiles` has
   `REPLICA IDENTITY FULL`. Unverified, it would have shipped and done nothing.

## 7. HOW TO WRITE THE CODE

- **Comment WHY, with the owner's words where they exist.**
- **Pin owner rules with tests** that fail with an explanation of whose rule broke.
- **Never break what works.**
- **Never add parameters to a live database function that installed apps still
  call** — it creates an ambiguous overload and breaks every shipped build.
- **A log line is code. It can carry a bug.** A stale-closure variable nearly
  shipped inside a log; a wrong value in a log is worse than no log.
