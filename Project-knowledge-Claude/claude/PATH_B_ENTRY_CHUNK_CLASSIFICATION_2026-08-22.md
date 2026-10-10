# PATH B — ENTRY-CHUNK CLASSIFICATION · RESULT: VOID, INSTRUMENT UNRELIABLE

**Governing plan: Master Execution Plan Rev 3.0 + Erratum E-1 (clauses 1–8).**
**2026-08-22, ~17:50 UTC.** Read-only. **No mutation of any kind.**
Workspace clean at `9aea8a30916fee06a741c52ef34914e4a2788f96`;
`origin/main` untouched at `32930e75b1d87d361f44e4b4f90dabf9deeda3e1`.
**G7 remains STOPPED.** No DNS, `www`, Cloudflare, Supabase, R2, deployment or
repository change. No bypass, scanning, credential discovery or invasive probing.

---

## 1. INPUT SUPPLIED BY OWNER

Browser Network panel capture of `https://www.50mmretina.com`, 66 requests.
Entry chunk: **`index-CQNRLXfL.js`**.

### 1.1 The capture independently corroborates the §1 artifact measurement

Loaded by Path B, straight from the owner's browser, verbatim from the capture:

```
index-CQNRLXfL.js                200  script      ← Path B entry chunk
vendor-query-oRGQe2RW.js         200  script      ← identical to local main-HEAD build
vendor-react-DiS8_IVS.js         200  script      ← identical
vendor-framer-motion-BTWshcLX.js 200  script      ← identical
vendor-react-markdown-0EDViLax.js 200 script      ← identical
index-BLWQIo4R.css               200  stylesheet  ← identical
```

Four vendor chunks and the Tailwind CSS bundle match the local `main` HEAD
build by content hash; the entry chunk does not. This is now confirmed by a
**second, fully independent instrument** — the owner's own browser — and no
longer rests on this session's fetches alone. **Classification: VERIFIED.**

Local build for comparison produced `index-DrppXY7Q.js` (CI legacy `anon` key)
and `index-BRwrdrEg.js` (new-style publishable key). Path B serves neither.
Both earlier hypotheses stay refuted.

### 1.2 Other observations from the capture, recorded not interpreted

- `site_settings?select=value&key=eq.cache_buster` — **fetch, 200**, initiator
  `index-CQNRLXfL.js:53`. PostgREST shape.
- `faq_entries?select=id,question,answer,keywords&is_active=eq.true&order=sort_order…`
  — **fetch, 200**, same initiator. PostgREST shape.
- `dashboard-init` — **preflight, 200**. Edge-function shape.
- `v4513226cdae34746b4dedf0b4dfa099e1781791509496` — script, **(blocked:csp)**,
  initiator `(index):120`.
- Totals: 66 requests, 335 kB transferred, DOMContentLoaded 1.40 s.

**A CSP is enforced on Path B.** `main`'s `index.html` carries `http-equiv`
fallbacks for X-Frame-Options, X-Content-Type-Options, X-XSS-Protection,
Referrer-Policy and Permissions-Policy but **no Content-Security-Policy meta**
— verified by source search. The CSP must therefore arrive as a response
header. `public/_headers` on `main` contains exactly such a policy, whose
`connect-src` lists `https://*.supabase.co` — a **wildcard that does not name a
project reference**, so it cannot identify the backend. Whether Path B's host
consumes `_headers` or applies its own policy is **not established** and is not
inferred here.

---

## 2. THE SIX-STEP PROCEDURE — WHAT HAPPENED

| Step | Outcome |
|---|---|
| 1. Fetch the exact public chunk | Executed. `assets/index-CQNRLXfL.js` returned JavaScript |
| 2. Search for backend identifiers | Ran; first pass reported every item **Absent** |
| 3. Compare recovered ref to the two known projects | **Not reached** |
| 4. Known-present / known-absent control | **Executed — and it voided step 2** |
| 5. Classify | **UNVERIFIABLE-BY-DESIGN (instrument limit)** |
| 6. HS-1 assessment | **Not triggered — no production configuration was established** |

### 2.1 Why step 2's result is VOID

The first pass reported no `*.supabase.co`, no project reference, no JWT, no
`sb_publishable_`, no R2 or CDN host, no endpoint. That contradicted the owner's
own capture, in which `index-CQNRLXfL.js:53` initiates PostgREST requests — so a
Supabase origin must exist in that file or its imports.

Rather than record the negative, the instrument was validated against strings
**proven present** by the capture:

| Control string | Status per instrument | Truth per the capture |
|---|---|---|
| `site_settings` | **ABSENT** | **PRESENT** — it initiates that request |
| `cache_buster` | **ABSENT** | **PRESENT** |
| `faq_entries` | **ABSENT** | **PRESENT** |
| `supabase` | ABSENT | must be present |
| `.supabase.co` | ABSENT | must be present |
| `createClient` | ABSENT | must be present |

The fetcher additionally reported roughly **200,000 characters available** and
the content **"truncated — it ends mid-function definition."**

**Every known-present control failed.** The instrument cannot see past its
window, so its "Absent" carries no information about the file. Step 2's result
is **VOID**, not a finding, and is recorded as such.

Known-absent control, same pass: `assets/index-QQQQQQQQ.js` → **404**. So the
*fetch* half of the instrument discriminates correctly; only its *search* half
is truncation-limited. The successful retrieval of `index-CQNRLXfL.js` is
therefore a genuine content match, not an SPA fallback.

### 2.2 Why no further probing was attempted

The full bundle exceeds the only permitted HTTP instrument's window, and
retrieving web content by any other means is not permitted in this session.
Fetching a smaller env-bearing chunk is not available either: on Path B those
chunks are content-addressed under hashes this session cannot enumerate.

Per instruction: **classify UNVERIFIABLE-BY-DESIGN and stop. Nothing inferred.**

---

## 3. CLASSIFICATION

| Question | Classification | Basis |
|---|---|---|
| Path B serves builds of this repository | **VERIFIED** | Four vendor chunks + CSS match by content hash, now confirmed by the owner's browser as a second independent instrument |
| Path B's entry chunk differs from every CI-reproducible build | **VERIFIED** | `index-CQNRLXfL.js` ≠ `index-DrppXY7Q.js` ≠ `index-BRwrdrEg.js`; both key hypotheses refuted |
| Path B's Supabase project reference | **UNVERIFIABLE-BY-DESIGN** | Instrument truncates at ~200k chars; every known-present control failed |
| Path B's publishable key | **UNVERIFIABLE-BY-DESIGN** | Same limit. Nothing extracted; nothing printed |
| Path B's R2 / CDN configuration | **UNVERIFIABLE-BY-DESIGN** | Same limit; `connect-src` names only a wildcard |
| **HS-1 condition (E-1 clause 8)** | **NOT ESTABLISHED — and NOT excluded** | No production configuration was read. Absence of evidence is not recorded as evidence of absence |

**HS-1 is not declared.** Declaring it would require establishing that Path B
carries production Supabase or R2 configuration, and nothing was established.
Equally, Path B is **not cleared** — the question is open, not answered.

---

## 4. CHANGE LEDGER

| Field | **CHG-20260822-009** |
|---|---|
| Change ID | CHG-20260822-009 |
| Path affected | **Path B — read-only observation only** |
| Branch | `staging`, read-only |
| Before SHA / tree | `9aea8a30916fee06a741c52ef34914e4a2788f96` / `aa877b50d3ca329aa0c169a150700fd9887a7d9a` |
| After SHA / tree | **Identical** — `git status` 0 lines |
| Files / configuration changed | **NONE** |
| Reason | E-1 recorded procedure: classify Path B's backend from the public entry chunk |
| Environment impact | None. Two public HTTPS GETs of Path B, one 404 control, two local source reads |
| Verification performed | §2.1 six known-present controls + one known-absent control; instrument truncation confirmed and quantified |
| Rollback reference | Not applicable — nothing changed |
| Evidence classification | Per row in §3. **Step 2's negative is VOID and is not recorded as a finding** |

---

## 5. STATUS — UNCHANGED

G0 GREEN · G1 GREEN · G2 GREEN · G3 **AMBER** · G4 GREEN · G5a GREEN ·
G5b **OPEN** · G6 **AMBER (Path A only)** · G7 **OPEN / STOPPED** ·
G8 **OPEN** · G9 **OPEN** · G10 **BLOCKED**.

---

## 6. WHAT WOULD CLOSE IT

The answer is already inside the capture the owner has open. The
`site_settings?select=value&key=eq.cache_buster` row is a request **to** Path B's
backend; its full Request URL names that backend's host, and the host's
subdomain is the project reference.

Nothing secret is involved: it is a public PostgREST endpoint the browser
already called.
