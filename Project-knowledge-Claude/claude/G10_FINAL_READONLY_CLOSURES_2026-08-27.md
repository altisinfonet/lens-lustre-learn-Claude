# G10 — FINAL READ-ONLY CLOSURES

**2026-08-27T14:5xZ. Read-only dashboard measurement. No writes, no dispatches, no credentials handled.**

---

## 1 · §8.6 PART 3 — production `isolation-probe/` prefix search **EXECUTED**

Previously recorded **NOT ESTABLISHED** because absence had been *inferred* from `AccessDenied` rather
than measured. It has now been measured.

**Instrument:** Cloudflare dashboard → R2 → bucket **`50mm`** → Objects → *Search objects by prefix*.

| Query | Result |
|---|---|
| `isolation-probe/` | **"No objects matched your search. Try searching for a different prefix."** — zero objects |
| **`avatars/`** *(known-present control)* | **25 matches returned**, e.g. `avatars/01c5059c-…/`, `avatars/060170a3-…/` |

**Control satisfied.** The same instrument, same bucket, same session returned 25 rows for a known-present
prefix and an explicit empty-result message for the probe prefix. **The zero result is a measurement, not
a broken query.**

**Status: VERIFIED · Outcome: SATISFIED — for the *after* state only.**

> **⚠ SCOPE LIMIT, stated rather than glossed.** §8.6 part 3 asks for the production bucket unchanged
> **before and after** the gate. **No "before" reading was captured prior to run `33079091310`, and it
> cannot be captured retrospectively.** What is established is that **no probe object persists on `50mm`
> now**, measured with a discriminating instrument. The strict before/after pairing can only be satisfied
> on a future run. **This does not by itself move G8 off BLOCKED.**

---

## 2 · G7 PREVIEWS — the recorded contradiction is **RESOLVED**, unfavourably

Prior record (`G10_S14_G9_EXCLUSION_RULING…`) logged a contradiction as **NEED EVIDENCE**: the Pages
settings pane appeared to state that preview deployments were *restricted by a Cloudflare Access policy*,
while `/one/access-controls/apps` returned *"You need an active plan to continue."*

**The pane text was read directly this pass, in full:**

> *"**Preview access** — Preview deployments are **public by default**. Restrict previews with Cloudflare
> Access so visitors must sign in before viewing them. You can customize who is allowed in Zero Trust.
> This protects preview deployment URLs only. Production pages.dev and custo[m domains]…"*

**This is generic feature-description boilerplate, not a live status readout.** It states previews are
public **by default** and describes how one *could* restrict them. **It does not assert that previews on
this project are restricted.** The earlier reading treated boilerplate as a status claim.

**Resolution:** the two instruments never actually conflicted. Zero Trust is unprovisioned, therefore **no
Access application or policy exists**, therefore **any preview deployment on this project would be
public**.

**Also read this pass, staging project Branch control:** *Production branch: `staging` · Automatic
deployments: **Enabled***. No preview-branch restriction is shown in that pane.

| Clause | Status | Outcome |
|---|---|---|
| **Previews disabled** (G7's exit wording) | **VERIFIED** | **SATISFIED** |
| Preview deployments protected by Access | **VERIFIED** | **NOT APPLICABLE** — no preview deployments are created, so there is nothing to protect |

**Measured directly in the Branch control panel, staging Pages project, 2026-08-27T14:5xZ:**

```
Production branch : staging
                    [x] Enable automatic production branch deployments
Preview branch    : ( ) All non-Production branches
                    (•) None (Disable automatic branch deployments)   <-- SELECTED
                    ( ) Custom branches
```

**Previews are disabled at source.** The panel was opened read-only and closed with **Cancel**; nothing
was saved.

**This also explains the ambiguity flagged earlier.** The deployments list showed Preview *entries* for
`g10/4.3-arm-pr…` and `scratch/g10-53…`, each reading **"No deployment available"**. With *Preview branch
= None*, builds are triggered but **no preview deployment is created** — exactly what those entries show.
The two candidate explanations are now distinguished, and the benign one is the correct one.

**Consequence for the Access question:** since no preview deployment exists, the absence of a Cloudflare
Access policy has **no exposure implication for previews**. The earlier concern is dissolved rather than
merely unresolved.

**G7 is therefore complete on all four clauses:** staging Pages project ✅ · `staging.50mmretina.com`
resolving and serving ✅ · **previews disabled ✅** · variables set ✅.
**G7 — VERIFIED / SATISFIED.**

> **Separately measured and still true:** `staging.50mmretina.com` served `robots.txt` **without any Access
> sign-in**, so that custom domain is publicly reachable. Its `robots.txt` reads
> `User-agent: *` / `Disallow: /`, so the lane is correctly non-indexable — **exclusion from indexing is
> not the same as access restriction**, and only the former is evidenced.

---

## 3 · WHAT THIS DOES **NOT** CHANGE

| Item | State |
|---|---|
| **G8** | **BLOCKED / NOT ESTABLISHED** — unchanged. Part 3's *after* reading does not supply the control/disposition, nor the *before* reading |
| **§15 row 5 Storage** | **BLOCKED / NOT ESTABLISHED** — unchanged |
| **Promotion verdict** | **NOT READY** — unchanged |

**Superseded conclusions remain retained, struck through, in their original documents. Nothing has been
deleted.**

---

## 4 · REMAINING ITEMS — none of which this session can execute

| # | Item | Why not this session |
|---|---|---|
| 1 | Re-run A.5's known-absent control with **an owner-controlled, minimum-permission credential capable of executing the specific test, used locally only and never supplied to Claude or chat** | Credential handling. **Do not create, request, expose or transmit any credential to this session.** |
| 2 | Capture the `isolation-probe/` **before** reading on the next attempt | Requires a future run |
| 3 | G9 countersignature; C-3, C-4, C-5; CHG-005 signature | Owner acts |
| 4 | §17-9 rollback target — identify and verify, or knowingly accept "roll forward under pressure" | Owner decision |
| 5 | §5.3 re-run — **promotion day only** | §5.3.6 timing |
| 6 | §11 approval + tag → merge → **assert resulting `main` tree equals the approved candidate tree** → only then migrate/deploy | Owner acts |

*No credential value, masked value, prefix, length, hash, token, connection string or secret-derived
output appears in this document.*
