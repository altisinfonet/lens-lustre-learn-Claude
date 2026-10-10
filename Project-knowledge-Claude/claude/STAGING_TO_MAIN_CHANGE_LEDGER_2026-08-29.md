# STAGING → MAIN LEDGER — 29 August 2026

### 📋 The name of this document, to find it again:
# `claude/STAGING_TO_MAIN_CHANGE_LEDGER_2026-08-29.md`

**Version 2 — replaces the version written earlier today. One number was wrong; see §7.**

---

## 1 · IN ONE LINE

**32 changes are waiting on Staging that are not yet on Main.** They cover 135 files. Nothing has
moved to Main yet.

| | Where it points | When |
|---|---|---|
| **Main** (what the public sees) | `b671e1fb` | 25 Aug, 6:17pm |
| **Staging** (what is tested but not public) | `25c04560` | 29 Aug, 4:02am |

---

## 2 · WHAT YOUR MEMBERS WILL ACTUALLY NOTICE

These are the visible changes. Everything else is behind the scenes.

### Posting a photo

- **The grey line under the caption box is gone.** It used to say *"Enter to post · Shift + Enter for
  a new line."* Removed today, as you asked. **Pressing Enter still works exactly as before** — it
  still posts on a computer and still makes a new line on a phone. Only the text label went.
- **The "Only Me" message is shorter.** It now says just *"Only you will see this post on 50mm Retina
  World."* The second sentence about the photo link is gone. ⚠️ **Important — see §5.**

### Comments

- **Multi-line comments now show as multiple lines.** Before, if someone pressed Enter while writing
  a comment, it all got squashed onto one line when posted.
- **Comments on story cards were broken. They now work.**

### Posts and the feed

- **Like/reaction buttons are now real buttons.** They were clickable boxes, which meant screen
  readers and keyboard users could not reach them.
- **Ad cards now show who reacted**, the same way normal posts do.
- **The blue tick now appears everywhere a name appears.** It was missing in some places.

### Certificates (admin side)

- All **16 certificate types** are now worded properly.
- **Deleting a certificate no longer breaks.**
- The **preview now draws the certificate as you type**, instead of showing a PDF in a frame.
- The description now actually prints on the certificate.
- **Custom heading** can be edited.

### Admin

- The **member list is now paged**, and filtering by role or badge happens in the database instead of
  loading everyone at once. This was slow with your member count.
- **Gift-by-email lookup** fixed.

---

## 3 · WHAT YOU WILL NOT SEE, BUT MATTERS

About half of these 32 changes are **separating the test site from the live site.** Before this work,
the two shared settings, and a mistake on one could reach the other.

- The live website's addresses are no longer written into the code by hand.
- A safety check now runs on every build that **fails the build** if test-site addresses leak into the
  live version, or vice versa.
- The email system, the file storage, and the search-engine settings each got the same separation.
- Undo files were written for four database changes, so they can be reversed if something goes wrong.
- Search engines are now told to index **only** the live site, not the test site.

---

## 4 · THE FULL LIST — ALL 32

| # | Date | What |
|---|---|---|
| 1 | 29 Aug | Composer hint text removed; Only-Me message shortened |
| 2 | 29 Aug | Multi-line comments render as multiple lines |
| 3 | 29 Aug | Reaction triggers are real buttons, not clickable boxes |
| 4 | 28 Aug | Blue tick shows wherever the name shows |
| 5 | 28 Aug | Ad card shows reaction break-up and who reacted |
| 6 | 28 Aug | (merge commit) |
| 7 | 28 Aug | Story-card comments fixed; ad card on the post card's row and thread |
| 8 | 26 Aug | Undo files for four database changes; schema guard; gift-by-email (#102) |
| 9–12 | 26 Aug | Four file uploads (part of #102) |
| 13 | 25 Aug | Certificates: live preview as you type (#100) |
| 14 | 25 Aug | Certificates: delete fixed, 16 types worded, description printed (#99) |
| 15 | 25 Aug | Certificate view: draw the preview instead of framing a PDF (#98) |
| 16 | 25 Aug | Certificates: six admin problems fixed (#96) |
| 17 | 24 Aug | Admin member list paged; role/badge filtered in the database (#95) |
| 18 | 24 Aug | Unknown websites refused; judge tag mirror fixed |
| 19 | 24 Aug | Import path fix; three stale settings removed |
| 20 | 23 Aug | Safety check could not see the server functions folder at all (#94) |
| 21 | 23 Aug | Email system separated by site; six signing paths checked (#93) |
| 22 | 23 Aug | File storage checked where the passwords are loaded (#92) |
| 23 | 23 Aug | An unchecked area now fails instead of silently passing (#91) |
| 24 | 23 Aug | Only the live site is shown to search engines (#90) |
| 25 | 23 Aug | Live-site defaults removed from page functions (#89) |
| 26 | 22 Aug | Safety rules 7–10 added |
| 27 | 22 Aug | Website permissions wired for both sites separately |
| 28 | 22 Aug | Every site-specific address removed from the code |
| 29 | 22 Aug | (undo of the temporary test below) |
| 30 | 22 Aug | (temporary test to prove the safety check actually fires) |
| 31 | 22 Aug | Safety check test made self-contained |
| 32 | 22 Aug | Build system made aware of both sites |

---

## 5 · ⚠️ ONE THING YOU SHOULD KNOW BEFORE THIS GOES LIVE

**The "Only Me" message got shorter today. The thing it used to warn about is still true.**

The old message said the photo file could still be opened by anyone who has its direct link. **That
is still the case.** Photos are stored in a way that does not check permissions — so if someone gets
the direct link to a photo, they can open it, even on an "Only Me" post.

**You decided today to shorten the message and fix the storage side later.** That is a legitimate
choice and it is recorded properly in the project files so nobody later thinks it was an accident.

**But it means:** once this goes live, a member choosing "Only Me" is told their post is private, and
is no longer told about the photo-link gap. Right now this affects almost nobody, because nearly all
posts are public. It starts to matter as soon as members begin using "Only Me."

**This is not a reason to stop the release.** It is a reason to put the storage fix high on the next
list.

---

## 6 · WHAT HAPPENS NEXT

| Step | Who does it |
|---|---|
| 1. This ledger written | ✅ Done |
| 2. Request opened to move Staging → Main | Me |
| 3. Automatic checks run (tests, build) | Automatic |
| 4. **Press the green Merge button** | **You** |
| 5. Check the live site | You |
| 6. Build the app from Main | Me, once you confirm step 5 |

You only need to press one button at step 4 and look at the site at step 5.

---

## 7 · CORRECTION TO THE EARLIER VERSION OF THIS DOCUMENT

The version written earlier today said **205 commits**. **That was wrong. The correct number is 32.**

The cause: I first downloaded only a shallow copy of the project history, which made the comparison
count many old commits that are *already* on Main. Downloading the full history gave the true figure.
The file count (135) and the line counts (+7,711 / −1,280) were correct in both versions and are
unchanged.

**Recorded rather than quietly amended.**

---

## 8 · THE HONEST CAVEAT

Your project has a formal checking process (the "G1–G10 gates"). The last full check was done on
**26 August**, and it ended with the verdict **NOT READY**, with items still open — including
storage-permission checks and a signed approval record that was never signed.

**7 of these 32 changes came after that check** and have not been through it. They were built and
tested (the automated test suite passes, 2,464 tests), but they did not go through the full formal
review.

**You chose to send everything anyway,** so today's fixes reach your members. That is a reasonable
call for changes of this size — they are mostly small interface fixes. **But it is a deliberate
exception to your own process, not an oversight,** and it is written here so the record is honest.

---

*Nothing was merged, deployed or signed to produce this document. Main is unchanged.*
