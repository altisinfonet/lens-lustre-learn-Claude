# REVIEW — Master Execution Plan (REVISED 2026-08-21)

**Verdict first:** this is the strongest plan document this project has had. The governing
rules are right, the 3R separation is right, Phase 5 existing at all is right, and the
decision log matches what actually happened. Adopt it. What follows is not a rewrite —
it is ten sharpenings, each grounded in something this project has already paid for.

---

## 0. BEFORE ANYTHING ELSE — the plan's §2.2 acceptance row is now WRONG, and I can prove it

The plan says: *"Owner manual Android acceptance: OWNER-VERIFIED… Claude must still
record the exact acceptance evidence."* I just recorded it, read-only, from production
(2026-08-21, since build 1111 was cut at 01:56 UTC):

| when (UTC) | platform | slides | post_media refs | idempotency_key |
|---|---|---|---|---|
| 04:22 | web | 1 | **1** ✅ | ✅ |
| 04:32 | web | 1 | **1** ✅ | ✅ |
| 04:34 | web | 1 | **1** ✅ | ✅ |
| **06:18** | **app** | 1 | **0** ❌ | ❌ |
| **06:43** | **app** | 1 | **0** ❌ | ❌ |

Real members on the **web** are now travelling the full media path — three posts, all
canonical. But **both app-channel posts made after the build are still legacy-only**, and
`delta_growing = true`, `new_unexplained_legacy_posts = 3`. "The app test worked" meant
*the post succeeded and the photo shows* — it did not mean *canonical media references*,
which is the actual Phase-2 gate. The posting device is almost certainly still running
the store build (≤1.2.15), because build 1111's AAB is a Play **draft** (or the sideload
APK was not the app used).

**Action before anything in §11:** on the test phone, check the About screen /
versionCode = **1111**, or install `app-debug-apk-SIDELOAD-THIS` from actions run
32438058103, post once, and I re-verify. Until an app-channel post shows `refs = slides`
and an idempotency key, the plan's §2.2 row must read **NOT ACCEPTED**.

This incident is itself the strongest argument for suggestion 1 below.

---

## The ten sharpenings

**1. Add a governing rule: a human-reported PASS enters the plan only with a production
row behind it.** §0 already says "evidence beats assumption" — make it mechanical: every
acceptance that a person performs (owner device test, Play rollout, Cloudflare change)
gets a named query or probe that Claude runs and records *before the status cell
changes*. Today's §2.2 row is the third time an "it works" turned out to be a different
claim than the gate (07:08 stale bundle; 18:16 app post; today's 06:18/06:43).

**2. Tag every item with its actor: CLAUDE / OWNER / EXTERNAL.** Every stall this month
was an untagged owner-dependency discovered late: the Play upload secret (never set),
Cloudflare access (read-only connector), GitHub billing (**banner says pay by
2026-08-31 — if Actions stops, every gate in this plan stops; it belongs in §11 as a
dated line item**). One column turns "why is this stuck" into a glance.

**3. Pull a thin slice of Phase 5 forward — now, not last.** The plan's own history is
that silent regression is the #1 failure mode, and every one was found by ad-hoc
querying: RED-1 (never ran, nobody noticed), the 07:08 stale client, the 18:16 app leak,
today's two. The detector already exists (`media_write_path_delta()`); what's missing is
someone looking. A daily scheduled check that reads `delta_growing`,
`new_unexplained_legacy_posts`, MEDIA-4009/4010 counts, and posts the result would have
caught all five within hours. That is one small standing task, not Phase 5 — Phase 5
remains the full discipline.

**4. Define the Android acceptance as a fleet property, not one good post.** Old
installed builds keep posting legacy-only until members update — a staged-rollout tail is
*expected*, and the plan should measure it rather than alarm on it: split the delta by
app-channel and app_build, gate on "0 legacy-only posts from builds ≥ 1111", and record
the tail's decay. Otherwise `delta_growing = true` reads as a red gate for weeks while
actually being a rollout curve.

**5. Carry the two one-way doors forward — the plan dropped them.** The engineering plan's
§1.1 (content-addressed storage: decision A/B/C, cost grows daily) and §1.2 (deterministic
ranking) appear nowhere in this revision. Both bite 3R directly: 3R's cache-coherence and
"Cache-Control policy for immutable media" are *half of the content-addressing decision
made implicitly*, and a cached feed page is only reconcilable if ordering is
deterministic. Decide the doors once, in §12, before 3R design — or record explicitly
that option C (keep timestamp keys) was chosen and 3R designs against it.

**6. Add a kill-switch rule for every new client capability.** Installed builds are
permanent (§0.3 of the engineering plan — the shipping asymmetry). The 3R cache and any
offline queue must ship behind a server-side disable flag (the `cache_buster` mechanism
is the working precedent) so a bad cache or a runaway queue can be turned off remotely
without a store release. One sentence in §6.2; enormous insurance.

**7. Split 3R-read (mandatory) from 3R-write (its own decision gate).** Rows 5/6/12 of
the 3R matrix (offline likes/comments, queue-survives-kill) quietly require **server-side
idempotency for reactions and comments, which does not exist today** — that is backend
schema work, moderation interaction, and a new abuse surface, bolted onto what is
otherwise a display-layer workstream. Certify 3R-read first (rows 1–4, 7–11, 13–14); make
3R-write a separately approved decision like D-006 was. Otherwise the read-side value
ships months later than it needs to.

**8. Name where evidence lives and reuse the gate-report format.** §0 demands evidence
but not its location or shape. The format already exists (ENGINEERING_PLAN_V2 §6: Claim →
Instrument → Result → Verdict → Regressions → Could-not-verify → **Invariant lock** →
Abort?). One per phase, append-only, in the project. And promote two practices from this
month into §0 as rules: *mutation harnesses refuse a red baseline*, and *stale mutation
targets are retargeted with the invariant restated, never deleted*.

**9. Restore the cost gate in Phase 4.** The earlier design review made cost an
architecture metric ("a system can be technically scalable and economically impossible");
this revision dropped it. For an image platform egress dominates: add "CDN egress per
1,000 feed views" and "storage growth/month" to Phase 4's measured targets. 3R's image
cache and the derivative ladder are also cost features — measure them as such.

**10. Two factual nits.** §2.1 lists RED-1, RED-2 and P3 under *Phase 1* verified work —
they were Phase-2 workstreams (WS1/WS2), worth correcting so the evidence trail stays
navigable. And define once what "physical-device evidence" means (screen recording +
the correlated production row + `app_build`/versionCode captured), so owner tests
become recordable artifacts instead of reports — which closes the loop with §0 above.

---

## Revised first three steps of §11 (only change I'd make to the order)

1. **Verify the device is on build 1111, one app post, I record the acceptance row** —
   minutes of work, currently falsifying the plan's status table.
2. Stand up the daily delta/error check (suggestion 3) — so every later phase runs with
   the alarm on.
3. Then D-002/D-003 exactly as §4.1 writes it — unchanged, it is correct and complete.

Everything else in §11 stands as written.
