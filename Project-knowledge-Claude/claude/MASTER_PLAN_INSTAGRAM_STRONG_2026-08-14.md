# MASTER PLAN — The Road to an Instagram-Strong Platform (DOCX delivered 2026-08-14)

A DOCX version of this plan was delivered to the owner for independent review by
ChatGPT. This is the canonical text. If the reviewer proposes changes, reconcile
against this file.

## The one-page answer

Can 50mm Retina become Instagram-strong? **Yes — and the current work alone will
not get it there.** A platform has two layers: the ENGINE ROOM (database,
security, storage, feed machinery) and the SHOWROOM (what members touch: photo
speed, back button, scroll, polish). The program since 13 Aug has rebuilt the
engine room to Instagram-grade discipline, verified with evidence. The showroom
program has NOT started — and that is where the owner's daily complaints live.

| Phase | Status | Meaning |
|---|---|---|
| A. Security & feed foundation | **DONE** | 5 production migrations; feed verified live end-to-end |
| B. Media foundation (engine) | **IN PROGRESS** | tables + write path live; deletion landmine defused in code (B3a awaiting GO) |
| F. Showroom / feel program | **NOT STARTED** | Feed · Competition · Course · Wallet · Search — needs owner's bug list |
| C. Observability | NOT STARTED | know when things break before members do |
| D. Scale proofs | NOT STARTED | re-test at 100k–1M posts; buffer gate (18% over) parked here |
| E. Final audits & sign-off | NOT STARTED | full regression + security audit, production gate |

## Phase B remainder
- **B3a** (ready, `GO 0555226f`): deploy the repaired orphan detector — the fix that prevents 263 live files (incl. 249 member thumbnails) from being classified as orphans.
- **B3b**: R2-aware orphan detection + post-images sweep; dry-run mandatory, hard delete-cap per run. Only safe after B3a.
- **B3c**: `scheduled_posts.thumbnail_urls` column + publisher fix + backfill the 9 thumbnail-less posts.
- **B3d**: derivative worker (600/1080/1440/original) — Instagram's core photo trick; includes EXIF/GPS stripping (live privacy exposure today).
- **B4**: upload retry/resume on the B2 idempotency layer.
- **B5**: client switch behind a flag; backfill 210 posts. Members feel Phase B only after B5.

## Phase F — Showroom (new)
Driven by the owner's bug list. Method per item: reproduce on real device → fix
→ verify on real site → add an alarm. Frontend has almost no alarms today; that
is why it breaks silently.
- Feed: 10-s skeleton on good network (server answers in 19 ms — delay is app-layer), scroll jank, back behaviour, image sizing
- Competition / Course / Wallet / Search: bug list + full walkthroughs; wallet additionally gets a correctness audit (balances re-derived, never trusted)
- Cross-cutting: navigation audit, scroll-performance pass, loading-state pass; per-page performance budgets as the phase gate

## Phase C — Observability
Real device-level error/latency reporting; independent alerting; /profile unbounded queries; CDN economics.

## Phase D — Scale proofs
Re-run all feed/media measurements at 100k/1M on a production-shaped copy; keyset pagination everywhere. The 2,359-vs-2,000 buffer gate miss is parked here deliberately; targets are not moved to pass.

## Phase E — Final audits
Full regression audit, full security re-audit from zero, written production-readiness verdict. Only after E does the program claim "Instagram-strong engineering".

## Open risks (stated to the owner)
1. **Transport — #1 risk**: 33 commits exist only in the session; push blocked by per-repo allowlist; tarball snapshots are the backstop.
2. Realtime firehose decision pending (broadcast-from-trigger vs accept-and-document).
3. Buffer gate 18% over at 210 posts (parked in D).
4. One edge function parse-checked but not fully type-checked (esm.sh blocked).
5. Frontend alarm blind spot (fixed incrementally by F).

## Honest limits (anti-overclaim, per owner's standing instruction)
Delivered: Instagram-grade discipline, Instagram's core photo experience, solid-feeling app, growth confidence. NOT promised: Instagram's operational scale, ML ranking at their level, human moderation orgs. "More than Instagram" is a false promise and this plan does not make it.

## Reviewer questions (given to ChatGPT)
Phase order right? Transport under-weighted? F method sufficient without device-lab/Lighthouse budgets (proposer: budgets should gate F)? EXIF earlier than B3d? Buffer miss allowed to park, or should it block B5? Wallet as its own engine-room phase (proposer: yes if money volumes grow)?
