# WHAT IS FINISHED BUT NOT YET ON THE LIVE SITE

**For the Owner. 2026-09-06.**

**Everything in this list is finished on the test site and NONE of it is on the live site.**

---

## READ THIS FIRST — three plain facts

**1. Nothing here is on www.50mmretina.com today.** The live site is still serving the same bundle
of code it was serving before any of this work started. It has not changed.

**2. "GREEN" and "NOT YET PROVEN" mean different things, and the difference is the point.**

| mark | what it means |
|---|---|
| **GREEN** | Somebody opened the real test site in a real browser and **saw it working.** |
| **NOT YET PROVEN** | The work is finished and merged, **but nobody has opened a page and checked it.** It is expected to work. **Expected is not the same as seen.** |

**Most of the safety and plumbing work in the third section has never been checked from a running
page.** It says so on every line. That is not an admission that it is broken — it is an admission
that **nobody has looked**, and this document will not pretend otherwise.

**3. This list was built by reading the actual record of changes**, every one made from 4 September
onward, **not from anybody's memory** — including the Auditor's.

---

# 1 · WHAT MEMBERS WILL NOTICE

*Things a member would see or feel the difference in.*

| # | What was wrong before → what is right now → what it means for a member | Status | Ref |
|---|---|---|---|
| 1 | **A member's web address was an unreadable code.** Sharing your page gave someone a long string of random letters and numbers instead of your name. **Now every member has a web address made from their own name**, and old links keep working forever. **It means you can tell someone your page address out loud.** | **GREEN** | F-93, F-92, #184, #188 |
| 2 | **Clicking a member's name inside the site put the code back in the address bar.** Even after the fix above, moving around inside the site swapped your name back for the code. **Now the name stays in the address bar wherever you click.** **It means the address you share is the one you keep.** | **GREEN** | F-95, #189 |
| 3 | **Typing a page name that does not exist gave a completely blank white screen.** Nothing at all — no message, no way back. **Now it shows a proper "page not found" screen with a way back to the site.** **It means a typo no longer looks like the site is broken.** | **GREEN** | F-85, F-89, #178, #187 |
| 4 | **The "Add Friend" button broke onto two lines** while "Follow" beside it sat on one, which looked wrong. **Now both sit on one line. It means the buttons look like they belong together.** | **GREEN** | F-88, #180 |
| 5 | **The list that appears when you type @ to mention someone cut the last name in half.** You could not read who you were about to pick. **Now the list shows whole names. It means you can see who you are tagging.** | **GREEN** | F-101 |
| 6 | **The Wallet page would not load for signed-in members** and showed nothing where the payment options should be. **Now it loads and lists the payment methods. It means members can reach their wallet.** | **GREEN** | F-102 |
| 7 | **The large photo viewer in competitions did not announce itself** to members using a screen reader — it opened silently, as if nothing had happened. **Now it announces itself properly, with the photo's name.** **It means a member using a screen reader knows the photo has opened.** | **GREEN** | F-107 |
| 8 | **Tapping a photographer's name next to a photo often hit the button beside it instead.** The two overlapped. **Now the name is what you hit when you aim at the name.** | **GREEN** | F-109 |
| 9 | **Someone could not join at all because another member already used the same email provider.** A genuine new member was turned away. **Now they can join. It means the eleventh person to sign up is no longer blocked by the first ten.** | **NOT YET PROVEN** | F-94, #197 |
| 10 | **A member's own name was not the heading of their page.** For a screen reader this meant the page had no title. **Now the member's name is the page's heading.** | **NOT YET PROVEN** | Item 10 |
| 11 | **Buttons and links across the site were too small to tap reliably on a phone.** **Work has started: some are fixed and a measuring tool now counts the rest.** **It means fewer mis-taps, but the job is not finished — between 36 and 88 controls per page are still too small.** | **NOT YET PROVEN** | F-103, F-104 |
| 12 | **The row of tabs on the Friends page was clipped**, so the tops and bottoms of the tap areas were cut off. **It is better — the clipping went from about 16 units to about 2 — but the target is zero, and it is not there yet.** | **NOT YET PROVEN** — measured and **still failing** | F-108, #207 |

---

# 2 · WHAT PROTECTS MEMBERS, WHICH THEY WILL NOT NOTICE

*Doors that were open to strangers and are now closed. A member sees no difference — that is what
success looks like here.*

| # | What was wrong before → what is right now → what it means for a member | Status | Ref |
|---|---|---|---|
| 13 | **Anyone at all — not even signed in — could ask the site whether a given email address had an account.** That is how lists of real email addresses get built. **Now the question is refused.** | **GREEN** — and **already applied to the live site** | P30, #147 |
| 14 | **Anyone could search the certificate directory by name** and read who holds what. **Now that search is closed to strangers. Verifying a certificate you hold still works and always will.** | **GREEN on test** — **NOT on the live site**, see the note below | P31, #150 |
| 15 | **Anyone could ask who is friends with whom**, and get an answer without signing in. **Now it is refused.** | **NOT YET PROVEN** | F-105c |
| 16 | **Anyone could ask how many friends a member has**, without signing in. **Now it is refused.** | **NOT YET PROVEN** | F-105c |
| 17 | **Any signed-in member could ask whose birthdays another member can see.** **Now it is restricted.** | **NOT YET PROVEN** | F-105a |
| 18 | **A member's own page could be reached in a way that exposed the internal code** rather than their name. **Now it always resolves to their name.** | **GREEN** | F-92, F-96 |

> ### ⚠ The important note on items 14 to 17
> **These are written and approved but the switch has not been thrown on the live site.** They are
> waiting on a single approval step that has been sitting unclicked since 5 September. **Until then
> the doors described above are still open on the live site.** The full detail is in the production
> record.

---

# 3 · INTERNAL SAFETY WORK

*Tools, tests and guard rails. A member will never see any of it. It exists so that mistakes are
caught before members meet them.*

**Almost none of this has been checked from a running page. Every line says so.**

| # | What it is, in plain words | Status | Ref |
|---|---|---|---|
| 19 | **A tool that fills the test site with a hundred thousand fake posts**, so slowness can be found before real members feel it — plus the ability to remove them all again cleanly. | **NOT YET PROVEN from a running page** | F-79, F-84, #161, #168 |
| 20 | **A safety catch that stops that tool from ever pointing at the live site.** | **NOT YET PROVEN from a running page** | seeder guard |
| 21 | **A check that a member's page address can never be a word the site already uses** — so nobody ends up with an address that silently leads nowhere. | **NOT YET PROVEN from a running page** | F-93 |
| 22 | **Measurements of how fast pages load**, recorded so future changes can be compared against them. | **NOT YET PROVEN from a running page** | Phase 0, #137, #163 |
| 23 | **A fix to a warning system that could not tell "nothing is wrong" from "I could not check".** Both looked identical, so a failure to look was being reported as safety. | **NOT YET PROVEN from a running page** | F-72, F-73 |
| 24 | **A repair to the tool that checks button sizes**, which had been renaming every button in the app and reporting 340 of them as missing when none were. | **NOT YET PROVEN from a running page** | F-103 |
| 25 | **A repair to the tool that checks the @mention list**, which was passing on a broken screen because it was asking the wrong question. | **NOT YET PROVEN from a running page** | F-101 |
| 26 | **Several written records** — what is true on the live site, how member addresses work, and a full account of what was found and fixed, including the mistakes made along the way. | **These are documents. Nothing to prove.** | ledger, gates |

---

# 4 · THE HONEST SUMMARY

| | count |
|---|---|
| Things a member would notice | **12** |
| Of those, seen working on the test site | **8** |
| Of those, finished but not yet checked on a page | **4** — and **one of those was checked and is still failing** |
| Protections closed to strangers | **6** |
| Of those, already live | **1** |
| Of those, waiting on one unclicked approval | **4** |
| Internal safety work | **8 items, none checked from a running page** |

**The single biggest fact in this document:** the live site is unchanged. **Every item above, except
item 13, is sitting on the test site waiting to be moved across.**

---

## HOW THIS WAS BUILT, AND WHAT IT IS NOT

**Built by reading the record of every change made from 4 September onward** — 81 separate changes —
**and not from anyone's memory.** *(D3, the documentation lane, 2026-09-06.)*

**The Auditor supplied the on-screen readings** marked GREEN in sections 1 and 2, taken on the
deployed test site.

**Two of his corrections are carried here rather than his earlier reports:** the Friends tabs are
**still failing** and are marked so; and a suspected broken share link **was withdrawn — it was never
broken.**

**Checked independently by D3, from the code itself:** the large photo viewer on the live site has
**none** of the four accessibility improvements — no announcement, no modal marking, no photo name,
no enlarged tap region — and the test site has **all four.** *(D3, 2026-09-06.)*

**What this document is not:** it is not a promise of dates, not an approval to publish anything, and
not a claim that the unproven items are broken. **It is a list of what is finished, what has been
seen working, and what has not been looked at.**
