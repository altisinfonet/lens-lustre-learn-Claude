# G7 PRE-DNS BASELINE · AND A PRODUCTION SERVING-PATH FINDING

**Governing plan: Master Execution Plan Rev 3.0 only.**
**Probe UTC: 2026-08-22 17:29:03 → 17:29:25.** Read-only. No mutation of any kind.
**G7 NOT STARTED.** This is the known-absent control the post-DNS verification
will need, taken while the records still do not exist — it cannot be taken later.

---

## 1. PRE-DNS BASELINE — the control set

Instrument: `dnspython` against three independent public resolvers, then a
direct query to the zone's own authoritative nameservers. No caching layer of
mine is involved; each is a live UDP query.

### 1.1 Recursive resolvers — A, AAAA and CNAME, three resolvers each

| Host | Google 8.8.8.8 | Cloudflare 1.1.1.1 | Quad9 9.9.9.9 |
|---|---|---|---|
| `staging.50mmretina.com` | **NXDOMAIN** | **NXDOMAIN** | **NXDOMAIN** |
| `cdn-staging.50mmretina.com` | **NXDOMAIN** | **NXDOMAIN** | **NXDOMAIN** |
| `www.50mmretina.com` | A `185.158.133.1` | same | same |
| `cdn.50mmretina.com` | A `104.21.40.112`, `172.67.185.135` + AAAA `2606:4700:…` | same | same |
| `50mmretina.com` | A `104.21.40.112`, `172.67.185.135` + AAAA `2606:4700:…` | same | same |
| `nonexistent-control-4f2a.50mmretina.com` | **NXDOMAIN** | **NXDOMAIN** | **NXDOMAIN** |

### 1.2 Authoritative query — Cloudflare's own nameservers

```
zone NS : dell.ns.cloudflare.com, phil.ns.cloudflare.com   (108.162.192.94, 108.162.193.137)

www.50mmretina.com.          3600 IN A 185.158.133.1                     rcode NOERROR
cdn.50mmretina.com.           300 IN A 104.21.40.112, 172.67.185.135     rcode NOERROR
staging.50mmretina.com.                                                  rcode NXDOMAIN
cdn-staging.50mmretina.com.                                              rcode NXDOMAIN
SOA serial 2410539482
```

### 1.3 Why the control row matters

`nonexistent-control-4f2a.50mmretina.com` — a name that has never existed —
returns **exactly the same NXDOMAIN** as the two staging hosts. So at this
moment NXDOMAIN carries **no information** about whether a record is "not yet
created" or "will never exist" (§5.1, signal saturation).

That is precisely why this baseline is being recorded now. After the owner
creates the records, the discriminating evidence is the **pair**: the two
staging hosts must move to a resolving answer **while the control row stays
NXDOMAIN**, queried in the same run. A resolving staging host on its own would
not prove the change was the owner's; the control is what excludes resolver
behaviour, wildcard records and my own tooling as explanations.

**Classification: VERIFIED.** Live queries, three independent recursive
resolvers plus the authoritative servers, all agreeing, no cache of mine involved.

---

## 2. FINDING — production `www` does not traverse Cloudflare

This came out of taking the baseline. It was not looked for.

### 2.1 What was measured

| Host | Answer | TTL | Cloudflare-proxied? | PTR of the address |
|---|---|---|---|---|
| `50mmretina.com` (apex) | `104.21.40.112`, `172.67.185.135` + IPv6 `2606:4700:…` | 264 | **YES** — Cloudflare anycast | NXDOMAIN (normal for CF) |
| `cdn.50mmretina.com` | `104.21.40.112`, `172.67.185.135` + IPv6 `2606:4700:…` | 300 | **YES** — Cloudflare anycast | NXDOMAIN (normal for CF) |
| **`www.50mmretina.com`** | **`185.158.133.1`, single A, no AAAA** | **3600** | **NO** | **`lovable-app-cd-1-4.p.l5e.io`** |

The apex and `cdn` show the signature of a proxied ("orange-cloud") record:
Cloudflare anycast addresses in `104.21.0.0/16` and `172.67.0.0/16`, dual-stack,
short TTL. `www` shows the signature of a DNS-only ("grey-cloud") record: one
non-Cloudflare address, no IPv6, hour-long TTL — and its reverse DNS names a
**Lovable** application host.

`https://www.50mmretina.com/robots.txt` was fetched and returns the production
`robots.txt` byte-for-byte, including `Sitemap: https://50mmretina.com/sitemap.xml`.
So `www` is serving this application, not a parked page.

### 2.2 What follows, stated no more strongly than the evidence supports

**VERIFIED:** requests to `www.50mmretina.com` are answered by `185.158.133.1`
and therefore **do not pass through Cloudflare**. Cloudflare's `_headers`,
`_redirects`, cache rules, WAF and Access do not apply to that hostname, and
the Cloudflare Pages build-time isolation guard cannot gate what it serves.

**NOT DETERMINED — do not infer:** whether the Lovable host builds the
repository independently, mirrors the Pages output, or is a legacy record that
the apex redirect makes irrelevant in practice; which host members actually
land on; and whether the Pages production deployment is the live serving path
for the apex only. None of that is readable from here.

### 2.3 Why it matters to this project specifically

1. **Rev 3.0 §6 models production as Cloudflare Pages serving both the apex and
   `www`.** The measurement contradicts that for `www`. The plan's architecture
   section is describing something other than what DNS actually does.
2. **G6's Pages-side evidence is narrower than it appears.** A production Pages
   deploy log line proves the guard ran for the **Pages** deployment. If `www`
   is served elsewhere, that log line says nothing about what `www` ships —
   which is the host `VITE_SITE_ORIGIN` points every member at.
3. **G7's premise changes.** "Mirror production with a staging Pages project" is
   only a mirror if production's serving path is Pages. For `www` it currently
   is not.
4. It is the same failure class as the committed `.env`: a second build path
   that nobody is watching, with its own environment.

**This is raised as a finding, not acted upon.** No hard stop is declared,
because nothing was mutated and no gate claim depends on it yet. It needs one
owner answer before G7 is designed.

### 2.4 The question for the owner

**Is `www.50mmretina.com` intentionally served by Lovable, or is that A record a
leftover from before Cloudflare Pages became the production build?**

- If **intentional** — G7 must mirror *that*, and Rev 3.0 §6 needs an erratum
  recording two production serving paths, with G6's scope narrowed in writing.
- If **leftover** — it is a live second serving path with its own environment,
  outside every control this project has built, and repointing it at the Pages
  project is a production change requiring its own gate and Change ID. It must
  not be done casually.

---

## 3. CHANGE LEDGER

| Field | **CHG-20260822-005** |
|---|---|
| Change ID | CHG-20260822-005 |
| Branch | None — no repository interaction |
| Before fingerprint | Zone SOA serial `2410539482`; `staging` and `cdn-staging` NXDOMAIN at all four servers queried |
| After fingerprint | **Identical — read-only probe** |
| Files / configuration changed | **NONE.** No DNS record, no Cloudflare setting, no repository file |
| Reason | Capture the known-absent control required by §5.1 before the owner creates the staging DNS records |
| Environment impact | None. Outbound DNS queries and one HTTPS GET of a public `robots.txt` |
| Verification performed | §1.1 three recursive resolvers × three record types; §1.2 direct authoritative query; §2.1 PTR lookups and a content fetch |
| Rollback reference | Not applicable — nothing changed |
| Evidence classification | **VERIFIED** |

---

## 4. STATUS — UNCHANGED

G0 GREEN · G1 GREEN · G2 GREEN · G3 **AMBER** · G4 GREEN · G5a GREEN ·
G5b **OPEN** · G6 **AMBER** · G7 **OPEN — not started** · G8 **OPEN** ·
G9 **OPEN** · G10 **BLOCKED**.

Nothing in this record promotes any gate. `origin/main` untouched at
`32930e75b1d87d361f44e4b4f90dabf9deeda3e1`.

---

## 5. READY TO RUN THE MOMENT YOU CONFIRM DNS

Prepared, not executed. On your word the following runs as one pass:

1. Re-query all six names — three recursive resolvers plus the authoritative
   servers — **with the control row included in the same run**.
2. Assert the two staging hosts resolve **and** the control stays NXDOMAIN.
3. Compare the answers against the intended targets: `staging.*` must present
   the Cloudflare-proxied signature if it fronts a Pages project;
   `cdn-staging.*` likewise for the R2 custom domain. A grey-cloud answer on
   either is reported, not accepted.
4. Check for conflicting records at the same names — a second A, an AAAA that
   disagrees, a stale CNAME, or a wildcard that would answer for anything.
5. Confirm the zone SOA serial has advanced from `2410539482`, which is the
   server-side signal that the zone genuinely changed rather than my view of it.
6. Only then, and only if every check passes, begin G7.
