# `www.50mmretina.com` — READ-ONLY SERVING-PATH FORENSICS

**Governing plan: Master Execution Plan Rev 3.0 only.**
**Window: 2026-08-22 17:29–17:38 UTC.** Read-only throughout.
**Nothing was changed.** No DNS record, no Cloudflare setting, no `www` record,
no deployment, no production data, no repository mutation. Workspace clean at
`9aea8a30916fee06a741c52ef34914e4a2788f96`; `origin/main` untouched at
`32930e75b1d87d361f44e4b4f90dabf9deeda3e1`.

## VERDICT

> ### VERIFIED — INDEPENDENT UNCONTROLLED PRODUCTION SERVING PATH
>
> `www.50mmretina.com` is not served by the Cloudflare Pages production lane.
> None of the Pages-side controls this project has built — the build-time
> isolation guard, `_headers`, `_redirects`, WAF, Access — apply to it.
>
> **What it IS served by is not established.** The PTR is a lead, not proof, and
> the investigation is explicit about which items remain unverifiable here.

---

## 1. INSTRUMENTS, AND ONE THAT WAS DISCARDED

| # | Instrument | Independent of? | Outcome |
|---|---|---|---|
| I1 | `dnspython` → 3 recursive resolvers + the zone's own authoritative servers | Cloudflare's edge, my HTTP tooling | Decisive |
| I2 | Asset-fingerprint probe against a locally reproduced production build | DNS | Corroborating, not decisive alone |
| I3 | Static-file probes (`robots.txt`, `sw-image-cache.js`, `_headers`) | DNS | Corroborating |
| I4 | Cloudflare product documentation via MCP | everything above | Establishes the structural constraint |
| ~~I5~~ | ~~`/sitemap.xml` `_redirects` 200-rewrite test~~ | — | **DISCARDED — non-discriminating** |

**Why I5 was discarded, before it could mislead.** The plan was to treat "does
`/sitemap.xml` return the Supabase function output" as proof that Pages
`_redirects` is in effect. Both `www` and the apex returned the committed static
12-entry sitemap. That looks like proof that `_redirects` is not running — but
**G1 already established that Cloudflare Pages rejects this exact rule**
(`Parsed 0 valid redirect rules`, because a 200-rewrite to an external host is
not permitted). The static sitemap is therefore what a correctly-configured
Pages deployment would serve too. The test cannot separate the hypotheses and
carries no information.

This is the same shape as the withdrawn E3 probe in G1. It is recorded here
rather than deleted so the reasoning is auditable.

---

## 2. FINDINGS AGAINST THE EIGHT REQUESTED ITEMS

### Item 1 — Is `www` serving the same current application/build as the Pages production deployment?

**NO — and the reason is structural, not circumstantial.**

Authoritative answer from the zone's own nameservers (`dell.ns.cloudflare.com`,
`phil.ns.cloudflare.com`), corroborated identically by 8.8.8.8, 1.1.1.1 and 9.9.9.9:

```
www.50mmretina.com.   3600 IN A 185.158.133.1        ← single A, no AAAA, hour TTL
50mmretina.com.        264 IN A 104.21.40.112, 172.67.185.135  + AAAA 2606:4700:…
cdn.50mmretina.com.    300 IN A 104.21.40.112, 172.67.185.135  + AAAA 2606:4700:…
```

The apex and `cdn` carry the proxied ("orange-cloud") signature: Cloudflare
anycast space (`104.21.0.0/16`, `172.67.0.0/16`), dual-stack, short TTL.
`www` carries the DNS-only ("grey-cloud") signature: one third-party address,
no IPv6, 3600s TTL.

**The structural constraint (I4).** Cloudflare's documentation is consistent
across products that a custom domain reaches Cloudflare only through a
**proxied** record — Pages creates that record itself and it is proxied; Workers
Custom Domains, Cloudflare for SaaS custom origins, Page Rules and Custom Errors
all state the same requirement, with Cloudflare for SaaS adding explicitly that
a custom origin *"needs to be a valid hostname with a proxied (orange-clouded)
A, AAAA, or CNAME record. You cannot use an IP address."*

A DNS-only A record to a non-Cloudflare address cannot reach a Cloudflare Pages
project. **Classification: VERIFIED.**

### Item 2 — Do the HTML/JS asset fingerprints match the current production Pages artifact?

**NO match found — but this evidence is weaker than item 1 and is labelled so.**

`main` HEAD (`32930e7`) was built locally with the production job's own public
environment values, on node `22.22.2` — **the exact version `.node-version`
pins**, so the toolchain matches CI. Entry chunk produced:

```
assets/index-DrppXY7Q.js      sha256 002da2887dff3604…
```

```
GET https://www.50mmretina.com/assets/index-DrppXY7Q.js   →  404
```

The 404 is a genuine origin 404, not an SPA fallback: `/_headers` on the same
host returns the SPA shell, so this host does distinguish the two. The
instrument discriminates.

**What this does NOT prove.** A 404 is equally consistent with "www is a
different application" and with "www is a Pages deployment built from an older
`main`". On its own it cannot separate them. It corroborates item 1; it does not
carry the verdict.

**Incidental corroboration of G4.** The `main`-tree production build emits
`_headers` hashing `40b681e53735875f42dbb5746a91b9f08fca4d693698df0bf75fc4f0ee9109f0`
— byte-identical to both the recorded production artifact and the `staging`-tree
production build. G4's byte-identity claim now holds across **both** trees,
proven from builds performed in this session.

### Item 3 — Do response headers identify Lovable or another origin?

**UNVERIFIABLE-BY-DESIGN in this session.** The only HTTP instrument available
converts responses to markdown and does not expose response headers; raw HTTP
clients are not permitted here. `cf-ray`, `server` and `x-powered-by` cannot be
read, so no header-based identification was attempted or is claimed.

The reverse DNS of the address is `lovable-app-cd-1-4.p.l5e.io`. **That is
evidence of the DNS destination and nothing more** — it does not establish who
builds or maintains what runs there, and it is not treated as doing so anywhere
in this record.

### Item 4 — Redirect chain between apex and `www`

**Partly VERIFIED, partly UNVERIFIABLE.**

- At the HTTP layer: fetching `https://www.50mmretina.com/robots.txt` reported
  no cross-host redirect. The fetcher returns cross-host redirects rather than
  following them, so an HTTP-level hop would have surfaced.
- At the application layer: **VERIFIED from source.** `index.html` ships an
  inline script, before the app boots:

  ```js
  if (location.hostname === "50mmretina.com") {
    location.replace("https://www.50mmretina.com" + location.pathname + location.search + location.hash);
  }
  ```

  Its own comment records the 2026-08-05 incident and states the intent:
  *"Everyone lands on www, always."* It also notes that
  `cloudflare/seo-edge-injector` would answer with a real HTTP 301 *"once the
  owner re-deploys it"* — i.e. the edge Worker is **not currently deployed**.

- **The consequence, and it is the important sentence in this document:** the
  apex is Cloudflare-proxied and could be the controlled Pages lane, but the
  shipped application redirects every apex visitor to `www` — the host that is
  **not** behind Cloudflare. The controlled path hands its traffic to the
  uncontrolled one.

- **UNVERIFIABLE here:** whether any HTTP-level 301 exists in the other
  direction. Client-side JavaScript is not executed by the available instrument.

### Item 5 — Is the Pages production deployment independently reachable, and does its artifact match `www`?

**UNVERIFIABLE-BY-DESIGN.** G1 placed Cloudflare Access across the
`*.pages.dev` preview hostname pattern. G1 also established by measurement that
a gated deployment and a hostname that never existed return **identical**
responses (`00000000.<project>.pages.dev` proved it). Any probe of the Pages
hostname is therefore saturated and cannot distinguish "exists and is gated"
from "does not exist". No probe was run and no conclusion is offered.

### Item 6 — Does `www` have an independent build/deployment mechanism?

**NOT ESTABLISHED. Leads only, explicitly labelled as such.**

- The repository contains a `.lovable/` directory: an agent working area with
  `plan.md`, `DEFERRED.md`, a `memory/` tree and dated test reports.
- Those reports are from **2026-05-02**, and their run links point at
  `github.com/altisinfonet/lens-lustre-learn` — a **different repository name**
  from the one this project controls, `altisinfonet/lens-lustre-learn-Claude`.
  Their build logs show paths under `/home/runner/work/lens-lustre-learn/`.
- `https://github.com/altisinfonet/lens-lustre-learn` now returns **404** —
  deleted, made private, or otherwise unreachable. GitHub redirects renamed
  repositories rather than 404ing them, so a simple rename does not explain it,
  but nothing here is conclusive.

**This establishes that a Lovable-driven pipeline existed against a
predecessor repository. It does not establish what builds `www` today.**

### Item 7 — Does `www` carry Supabase/R2/Cloudflare configuration different from the controlled Pages lane?

**UNVERIFIABLE-BY-DESIGN.** Determining it requires reading the JavaScript
`www` actually serves. Its entry chunk cannot be located: its filename is
content-hashed, the HTML instrument strips `<script>` tags, and unknown
`/assets/*` paths 404, so the name cannot be enumerated or guessed.

**No claim is made about which backend `www` talks to.** Given items 1 and 6,
this is the single most important unanswered question in this record — and it is
listed as an owner action rather than inferred.

### Item 8 — Is the Lovable origin merely a DNS destination, or an independently maintained application?

**NOT ESTABLISHED — deliberately.** Item 1 proves that whatever answers `www`
is outside this project's controls. Items 6 and 7 are the ones that would
distinguish "passive mirror" from "independently maintained application", and
both are unverifiable from here.

The PTR alone was **not** used to reach any conclusion, per instruction.

---

## 3. WHY THIS MATTERS TO THE GATES

1. **Rev 3.0 §6 is incomplete, not wrong-in-detail.** It models production as
   the Cloudflare Pages lane. Measurement shows the host that members are
   actively redirected to is outside that lane. §6 needs an erratum before G7
   is designed. **Rev 3.0 is not rewritten** — an erratum is recorded against it.
2. **G6's scope is narrower than its wording suggests.** A production Pages
   deploy log line proves the guard ran for the Pages deployment. It says
   nothing about what `www` ships. G6's AMBER stands, and its eventual GREEN
   must be worded to that scope.
3. **G7's premise needs the owner's answer first.** "Mirror production with a
   staging Pages project" mirrors the apex path only.
4. **This is the `.env` failure class again**: a second build path with its own
   environment that no control in this project observes.

---

## 4. WHAT WAS NOT DONE, BY INSTRUCTION

No change to the `www` record. No repoint. No deletion. No Cloudflare change.
No staging deployment. G7 not started, not designed. If `www` is later
repointed, that is a **production change requiring its own Change ID and
explicit owner authorization** — it is not housekeeping.

---

## 5. CHANGE LEDGER

| Field | **CHG-20260822-006** |
|---|---|
| Change ID | CHG-20260822-006 |
| Branch | `main` checked out read-only for a reproduction build, then restored to `staging` |
| Before SHA / tree | `9aea8a30916fee06a741c52ef34914e4a2788f96` / `aa877b50d3ca329aa0c169a150700fd9887a7d9a` |
| After SHA / tree | **Identical.** `git status` 0 lines; ephemeral `dist` deleted |
| Files / configuration changed | **NONE** — repository, DNS, Cloudflare and Supabase all untouched |
| Reason | Read-only forensic determination of the `www` serving path, ordered before G7 design |
| Environment impact | None. Outbound DNS queries; five HTTPS GETs of public paths; one docs query |
| Verification performed | §1 instrument table; §2 items 1–8 with per-item classification; one instrument discarded as non-discriminating and the reason recorded |
| Rollback reference | Not applicable — nothing changed |
| Evidence classification | **VERIFIED — independent uncontrolled production serving path** (item 1). Items 3, 5, 7, 8 **UNVERIFIABLE-BY-DESIGN**; items 2, 4, 6 partial, each labelled in place |

---

## 6. THE TWO QUESTIONS THAT UNBLOCK G7

1. **Is `www.50mmretina.com` intentionally served by Lovable, or is that A record
   left over from before Cloudflare Pages became the production build?**
2. **If intentional — what backend configuration does it carry?** Item 7 is
   unreadable from here, and it is the question that decides whether an
   uncontrolled path is currently talking to the production Supabase project
   and the production R2 bucket with values nobody in this project has audited.

Until question 1 is answered, G7 is not designed and not started.

---

## 7. GATE STATUS — UNCHANGED BY THIS RECORD

G0 GREEN · G1 GREEN · G2 GREEN · G3 **AMBER** · G4 GREEN · G5a GREEN ·
G5b **OPEN** · G6 **AMBER** · G7 **OPEN — not started, not designed** ·
G8 **OPEN** · G9 **OPEN** · G10 **BLOCKED**.
