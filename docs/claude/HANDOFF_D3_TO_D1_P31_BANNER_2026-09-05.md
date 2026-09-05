# HANDOVER · D3 → D1 · the P31 migration banner

**Date:** 2026-09-05
**From:** D3 (documentation lane) · **To:** D1 (database & runtime lane)
**Authorised by:** the Auditor, who approved the wording below as written and asked that this
handover be recorded **so the authorship is unambiguous**.

---

## Why this is a handover and not a commit

**`supabase/**` is D1's lane. D3 must not write into it — not even a comment, not even a typo.**
D3 drafted the wording; **D1 applies it.** This is the same rule, in the other direction, that D1
applied when it declined to edit the Auditor's `docs/gates/P1-revocation-list.md` and recorded its
objection in a migration comment instead. **The Auditor called that correct, and it is correct here.**

**Target file:** `supabase/migrations/20260910_0003_p31_search_certificates_revoke.sql`
**Replace:** lines **3–16** of the existing header — the `⚠⚠ DO NOT APPLY` block through
`Committing is not applying.`
**Do NOT delete the banner.** A file that once shouted DO NOT APPLY and now says nothing is worse
than either state, because the next reader cannot tell whether the block was **lifted** or
**forgotten**.

---

## What the file says today, quoted from the file itself

```
-- ⚠⚠ DO NOT APPLY THIS FILE YET. IT IS PREPARED, NOT AUTHORISED, AND IT IS
--    BLOCKED ON A CLIENT FIX THAT HAS NOT MERGED.
--
--    docs/gates/P1-revocation-list.md §2.2 blocks this revoke because all four
--    verification pages collapse "error" and "empty" into one branch
--    (VerifyCertificate.tsx:81, :103, CertificateVerifyByToken.tsx:46,
--    IDVerification.tsx:63). Applied today, a real certificate holder is told,
--    calmly and confidently, that their certificate could not be verified —
--    which reads as a forgery and gets reported by nobody. A SILENT WRONG
--    ANSWER IS WORSE THAN AN ERROR. D2 is landing that fix in its own PR.
--
--    PRECONDITION FOR APPLY: D2's client fix is merged and live on the lane
--    being changed. Then the Auditor authorises. Staging first, always.
--    Committing is not applying.
```

**Note for whoever applies this:** the precondition was **already written into the file**. It is not
being invented now — it is being **shown met**. The block is **satisfied, not lifted**.

---

## The replacement text, approved as written

```sql
-- ⚠⚠ AUTHORISED 2026-09-05 BY THE OWNER. STAGING FIRST. NOT YET APPLIED TO PRODUCTION.
--
--    This file previously read "DO NOT APPLY … PREPARED, NOT AUTHORISED …
--    BLOCKED ON A CLIENT FIX THAT HAS NOT MERGED." That block is now SATISFIED,
--    not forgotten — it is recorded here rather than deleted so the next reader
--    can tell the difference.
--
--    PRECONDITION, AND THE EVIDENCE IT WAS MET: D2's client fix is merged and
--    live in the production bundle. The by-name path renders "Search
--    Unavailable"; the by-ID path renders "Verification Unavailable" with copy
--    ending "— please try again shortly". Those are TWO different messages on
--    TWO different paths — the Auditor confirmed the mapping after getting it
--    wrong once. Quote that copy WHOLE: it reads "We could not complete this
--    check just now. This does not mean the certificate is invalid — please try
--    again shortly." A quotation truncated at the first full stop greps to
--    nothing and manufactures a false negative (C-76).
--
--    THE GATE: docs/gates/P1-revocation-list.md §2.2 is recorded SATISFIED by
--    AUDITOR-RULING-2026-09-05-02, with the original block left standing above
--    the discharge. §2.2's discharge is NOT the closure of F-87, which is a
--    transport failure still surfacing as "No Certificates Found" and is parked
--    at #156.
--
--    RE-MEASURE RATHER THAN BELIEVE — the acl readings on the staging lane:
--      Auditor, 2026-09-05T03:20:23Z
--      D1's own before / after readings for this revoke
--    Both are quoted in the evidence for this unit; a reader who doubts either
--    can take the reading again rather than take our word.
--
--    THE OWNER'S RULING, 2026-09-05: "NO -> we close it. Members can still
--    search when logged in. Anyone holding a certificate ID can still verify it
--    publicly - that never breaks."
--
--    ORDER, non-negotiable: staging → Auditor verifies and reports green →
--    Owner approves → ONE promotion to main → production apply behind his own
--    click. Production run #23 is HELD. Committing is not applying.
```

---

## One thing D1 must fill, because D3 cannot

**D1's own before/after acl readings** are named as placeholders above. **D3 does not have them and
must not invent them.** Substitute the actual timestamps and acl strings from D1's measurement before
committing. The Auditor's reading — **2026-09-05T03:20:23Z, staging lane** — is fixed and may be
quoted as given.

## What D3 has already done, so it is not done twice

* `docs/gates/P1-revocation-list.md` **§2.1** — amended for `email_exists` under
  AUDITOR-RULING-2026-09-05-01. Original clause left visible.
* `docs/gates/P1-revocation-list.md` **§2.2** — recorded **SATISFIED** under
  AUDITOR-RULING-2026-09-05-02. Original block left standing, **not** struck out.

**Nothing in `supabase/` has been touched by D3.**
