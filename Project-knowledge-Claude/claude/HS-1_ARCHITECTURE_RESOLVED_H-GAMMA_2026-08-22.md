# ARCHITECTURE RESOLVED — CORRECTED RECORD

**SUPERSEDES the earlier content of this file**, which concluded that the apex
served a Lovable build and that Cloudflare Pages reached nobody. **That
conclusion was WRONG.** It rested on the `seo-edge-injector` Worker's doc
comment rather than on its bound variable. The comment is stale. The binding is
authoritative. Corrected below, with the error left on the record.

**2026-08-22, ~18:55 UTC.** Rev 3.0 + Erratum E-1. **No mutation.**
`origin/main` `32930e75b1d87d361f44e4b4f90dabf9deeda3e1`; workspace clean at `9aea8a3`.

---

## 1. THE DECIDING READING

`seo-edge-injector` → Settings → Runtime variables (owner-read, two independent
methods, End-key truncation check on each):

```
ORIGIN_HOST           lens-lustre-learn-claude.pages.dev      ← the Pages project
ENABLE_REWRITE        true
SUPABASE_PROJECT_REF  jtdtehuqtinjxropkkcn                    ← production
METADATA_FUNCTION_URL (present, value not read)
```

The Worker's code does `fetch(new URL(path, "https://" + env.ORIGIN_HOST))`.
With that binding, **the Worker is a transparent proxy in front of Cloudflare
Pages**, adding SEO `<head>` injection — not a diversion to a foreign origin.

The stale comment claiming *"fetches the raw HTML from ORIGIN_HOST (the Lovable
.lovable.app backend)"*, and its example ref `isywidnfnjhtydmdfgtk` (neither
production nor staging), describe a configuration that is no longer bound. The
comment should be corrected in source, but it is cosmetic.

---

## 2. THE ACTUAL ARCHITECTURE

```
50mmretina.com          CNAME → lens-lustre-learn-claude.pages.dev, PROXIED
                        └─► Worker route 50mmretina.com/*
                            └─► fetch(ORIGIN_HOST = lens-lustre-learn-claude.pages.dev)
                                └─► CLOUDFLARE PAGES  ✅ CONTROLLED
                                    + SEO head injection (ENABLE_REWRITE=true)
                                    + metadata from jtdtehuqtinjxropkkcn (production)

www.50mmretina.com      A → 185.158.133.1, DNS ONLY
                        └─► never enters Cloudflare
                            └─► Worker route www.50mmretina.com/* NEVER FIRES
                                └─► third-party origin directly  ❌ UNCONTROLLED

index.html redirects apex → www before the app boots.
```

**Determination: H-β, with a Worker in the path.** The apex is served by the
controlled Pages lane. `www` is not, and `www` is where members land.

---

## 3. WHAT CHANGES, WHAT DOES NOT

**Changes — the good news:**
- The Pages lane **is** the production serving path for the apex. It is not
  bypassed, not dead, not shadowed.
- G1–G6's controls protect a lane that genuinely serves.
- The remediation shrinks from a migration to a single custom-domain attachment.

**Does not change — HS-1 stands:**
- `www` is DNS-only to a non-Cloudflare address, outside `_headers`, WAF, Access
  and the build-time guard.
- `www` is production-Supabase-connected — established by the zero-edge-function
  staging inventory versus the observed `dashboard-init` 200 preflight, and by
  0.8 kB of PostgREST rows against a zero-row staging database.
- The application actively redirects members from the controlled path to it.

---

## 4. G6 — GREEN, COMPLETE

Exit conditions of Rev 3.0 §8.4, each now satisfied:

| Condition | Evidence | Class |
|---|---|---|
| Pages production variable and CI literal name the same forbidden ref | Pages `ISOLATION_FORBIDDEN_REFS = ztzutckwdhetphwghuzj`, read three ways (zoomed capture, Home/End no-scroll check, direct input read, length 20). CI `build-production` literal: `ztzutckwdhetphwghuzj`. **Identical** | Pages side **OWNER-ATTESTED**, as §8.4 itself specifies; CI side **VERIFIED** |
| Production build carrying a staging ref fails R3 | `FAIL [R3]: ztzutckwdhetphwghuzj in index.html`, exit 1, on a real production-lane build | **VERIFIED** |
| Staging build carrying a production ref fails R3 | `FAIL [R3]: jtdtehuqtinjxropkkcn in index.html`, exit 1, on a real staging-lane build | **VERIFIED** |
| Empty forbidden list fails R6 | `FAIL [R6]` on both lanes, exit 1; plus the executed `ec1a3b9`/`44e3e92` history pair | **VERIFIED** |
| Known-absent controls | Both bundles carrying a ref belonging to neither lane **PASS** — so the refusals are caused by the foreign ref, not by the edit | **VERIFIED** |

**G6 = GREEN — COMPLETE**, scoped to Path A per Erratum E-1.

---

## 5. NEW UNEXPLAINED DIFFERENCE — recorded, not escalated

Pages serves entry chunk `index-CQNRLXfL.js`. A local build of the same commit
(`main @ 32930e7`) with the same Supabase URL and a publishable key matching
Pages' on length (208) and full read prefix and suffix produced
`index-DrppXY7Q.js`. The four vendor chunks and the CSS bundle **do** match.

So app-source-plus-environment differs while dependencies and bundler do not.
Three unread inputs can account for it, all Pages settings:

1. `NODE_VERSION` — value not read.
2. `VITE_SUPABASE_PROJECT_ID` — name confirmed, value not read.
3. The Pages **build command** — not read.

This is a gap in the reproduction, not a demonstrated defect. It matters because
Rev 3.0's promotion model assumes the CI mirror and the Pages build produce the
same artifact. **If they do not, the guard in CI and the guard in the Pages
build command are checking different bundles.** Closing it needs those three
values.

`METADATA_FUNCTION_URL` is also unread and, if set, overrides
`SUPABASE_PROJECT_REF` for the SEO metadata call.

---

## 6. REVISED REMEDIATION — NOT AUTHORIZED, NOT EXECUTED

> **PROD-CHG-20260822-003 — Bring `www` onto the controlled path.**

| Stage | Action | Reversible |
|---|---|---|
| **R1** | Attach `www.50mmretina.com` as a custom domain on the Pages project. Cloudflare replaces the DNS-only A record with its own proxied record | **yes** |
| **R2** | Verify `www` serves the Pages artifact; the existing Worker route `www.50mmretina.com/*` now fires and applies the same SEO injection as the apex | — |
| **R3** | Run §18 per path | — |
| **R4** | After soak, detach the domain at the third-party platform. **Never delete it** — it is the rollback target | yes |

**Rollback, recorded while live:** `www.50mmretina.com. 3600 IN A 185.158.133.1`,
**DNS only**. Lower TTL to 300 before R1; worst case 3600 s otherwise.

**Risk is materially lower than previously assessed.** Both hostnames currently
serve the **byte-identical** entry chunk `index-CQNRLXfL.js` — verified by
content-hash fetch on each. Moving `www` to Pages therefore delivers the same
artifact through a different path, rather than swapping one build for another.
Session continuity is preserved: same hostname, same browser origin, same
`localStorage`, same Supabase project.

**Do not bundle the apex→www redirect change into this.** It exists because of
the 2026-08-05 incident; separate Change ID if ever revisited.

---

## 7. GATE STATUS

| Gate | State |
|---|---|
| G0, G1, G2, G4, G5a | **GREEN — COMPLETE** |
| **G6** | **GREEN — COMPLETE** (Path A scope) |
| G3 | **BLOCKED** — §5.3 needs a push and an Actions run; refused at this session's git proxy. Executable today by the code session |
| G5b | **BLOCKED** — needs `SUPABASE_PROJECT_REF` and `SUPABASE_ANON_KEY` added to Pages Production (currently five variables, neither present) |
| G7, G8, G9, §15, RC, G10 | **BLOCKED** — HS-1 active on `www` |

---

## 8. CHANGE LEDGER

| Field | **CHG-20260822-015** |
|---|---|
| Paths affected | **None mutated** |
| Before / after SHA / tree | `9aea8a3` / `aa877b50` → identical |
| Files / configuration changed | **NONE** |
| Reason | Close U1–U5; correct the erroneous H-γ determination; close G6 |
| Environment impact | None. Owner-performed read-only dashboard reads; one authorized `workers_get_worker_code` call |
| Verification | §1 bindings; §4 G6 exit conditions; §5 discrepancy recorded |
| Rollback | Not applicable |
| Classification | **VERIFIED** except: Pages `ISOLATION_FORBIDDEN_REFS` **OWNER-ATTESTED** (as §8.4 requires); `NODE_VERSION`, `VITE_SUPABASE_PROJECT_ID`, the Pages build command and `METADATA_FUNCTION_URL` **NOT READ** |
| Correction recorded | This file previously concluded H-γ with a Lovable origin. Wrong. Cause: reliance on a stale source comment over a live binding |
