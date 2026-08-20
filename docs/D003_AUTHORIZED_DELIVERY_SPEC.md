# D-003 — authorized media delivery: the exact specification

**2026-08-20.** Phase 2 closure, Priority 3. **D-002 IS NOT CLOSED AND IS NOT
CLOSED BY THIS DOCUMENT.** This is what someone with Cloudflare access has to
build, written precisely enough that they do not have to re-derive any of it.

---

## 0. The gap, re-measured today

Run from `https://www.50mmretina.com` with `new Image()`, which needs no CORS
and carries no credentials — which is how a third party actually retrieves
bytes:

```
a migrated post's media   cdn…/post-images/511a9922…/posts/…-w1023h1537-l3.webp   RETRIEVED  1023x1537
a second post's media     cdn…/post-images/83f6d083…/posts/…-w1536h1024-l3.webp   RETRIEVED  1536x1024
CONTROL: a key that cannot exist                                                  refused
```

The control refuses, so the method discriminates. **Byte retrieval is
unauthenticated.** Unchanged since 2026-08-20 02:00.

Also verified today: `post-images` bucket `public = true`, `avatars` bucket
`public = true`, `storage.objects` SELECT policy `(bucket_id = 'post-images')`
for `{public}` with no privacy condition, and **0 posts with
`privacy <> 'public'`**, so live exposure remains zero.

---

## 1. Can this be done from this session? — one qualified NO, and a change

I have no Cloudflare tool. Checked, not assumed: the session's connectors are
Supabase, Magnific and Zventory.

**But the registry has one.** `Cloudflare Developer Platform`
(`directoryUuid 2d60210c-dd92-4be0-b09c-3662f10445c9`) exposes `workers_list`,
`accounts_list`, `kv_namespaces_list` and 16 more. It is **not installed**.

So the correct statement is no longer *"this cannot be built from here"* — it is
**"this cannot be built until that connector is connected."** If the owner
connects it, sections 2–7 below become work I can do rather than work I can only
specify. That is a materially different answer from the one in the previous
report and it should be acted on before anyone builds this by hand.

---

## 2. The architecture (unchanged from D-003, restated for the builder)

```
                       PUBLIC media                         RESTRICTED media
                    (today's 229 objects)              (privacy <> 'public')
                            │                                   │
   GET cdn.50mmretina.com/post-images/…            GET cdn.50mmretina.com/private/…
                            │                                   │
                    ┌───────▼────────────────── Cloudflare Worker ──────────────┐
                    │  key does NOT start with the restricted prefix →          │
                    │      pass through untouched, cache normally               │
                    │  key DOES start with it →                                 │
                    │      require a valid short-lived token, else 403          │
                    └───────┬───────────────────────────────────────────────────┘
                            ▼
                        R2 bucket `50mm`
```

Public objects keep their URLs, their CDN cache and the `/cdn-cgi/image`
transforms. Nothing about the 229 live images changes — that is the property
that ruled out presigning everything and ruled out an edge-function proxy.

The schema is already built for this: `media_objects.visibility` exists with
`('public','restricted','private')` and **defaults to `private`** (migration
`20260814084711`).

---

## 3. DNS / R2 binding requirement

| item | required value |
|---|---|
| zone | `50mmretina.com` |
| hostname | `cdn.50mmretina.com` — already an R2 **custom domain** on bucket `50mm` (account `a7810011a99de537a210130f86306785`) |
| worker route | `cdn.50mmretina.com/*` |
| binding | `R2` → bucket `50mm`, binding name `MEDIA` |
| secret | `MEDIA_TOKEN_KEY` — 32 random bytes, base64; the SAME value as the Supabase secret in §5 |
| var | `RESTRICTED_PREFIX` = `private/` |

⚠ A Worker route on an R2 custom domain **takes over object serving**. If the
Worker throws, `cdn.50mmretina.com` stops serving images — all of them. It must
therefore fail **open for public keys** (§4) and be deployed to a preview
hostname first.

---

## 4. Exact Worker behaviour

```js
export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const key = decodeURIComponent(url.pathname.slice(1));   // no leading /

    // 1. PUBLIC KEYS PASS THROUGH UNTOUCHED. This branch must never throw:
    //    it serves every object that exists today.
    if (!key.startsWith(env.RESTRICTED_PREFIX)) return fetch(req);

    // 2. RESTRICTED KEYS REQUIRE A TOKEN.
    const token = url.searchParams.get("t");
    if (!token) return new Response("Forbidden", { status: 403 });

    //    token = base64url(exp "." key) "." base64url(HMAC-SHA256(key+"."+exp))
    const ok = await verify(token, key, env.MEDIA_TOKEN_KEY);
    if (!ok) return new Response("Forbidden", { status: 403 });

    const obj = await env.MEDIA.get(key);
    if (!obj) return new Response("Not found", { status: 404 });

    return new Response(obj.body, {
      headers: {
        "content-type": obj.httpMetadata?.contentType ?? "application/octet-stream",
        // ⚠ NEVER a public cache. A shared cache would serve the object to the
        // next requester WITHOUT a token, which is the whole gap re-created at
        // the edge.
        "cache-control": "private, max-age=60",
        "vary": "Authorization",
      },
    });
  },
};
```

Rules that are not negotiable:

1. **Constant-time comparison** of the HMAC. A byte-wise `===` on a hex string
   is a timing oracle for the signature.
2. **`exp` is checked against `Date.now()`** and must be ≤ 300 s in the future.
   A token with no expiry is a permanent URL, which is the gap with extra steps.
3. **The signature covers the KEY**, not just the expiry. Otherwise one valid
   token opens every restricted object.
4. **No `Access-Control-Allow-Origin: *`** on the restricted branch.
5. **`cache-control: private`** — see the comment above; this is the single
   easiest way to rebuild the gap by accident.

---

## 5. Exact token contract

```
token   := b64url(payload) "." b64url(sig)
payload := <key> "|" <exp-epoch-seconds>
sig     := HMAC-SHA256(MEDIA_TOKEN_KEY, payload)
lifetime: 300 s maximum, minted per request, never stored
```

The key material is one shared secret held in exactly two places: the Worker
secret `MEDIA_TOKEN_KEY` and the Supabase secret of the same name. It is never
sent to a client, never in a URL, never in a log line.

⚠ **A token is a bearer credential for one object for five minutes.** It may be
minted only after `can_view_post` has said yes, and it must never be minted for
a key the caller did not just prove they may see.

---

## 6. Exact application endpoint contract

New edge function `media-sign-url`, `verify_jwt = false` (in-code `getClaims`,
matching `media-register-upload` and `s3-presign-upload` — the posting path must
not gateway-401 on a transiently stale session).

```
POST /functions/v1/media-sign-url
Authorization: Bearer <member jwt>
{ "post_ids": ["uuid", …] }            ← max 50, mirroring MEDIA-1001

200 { "urls": { "<post_id>": ["https://cdn…/private/…?t=…", …] } }
403 { "error": "…" }
```

Implementation, in order:

1. `getClaims` → `callerId`; 401 without one.
2. Call **`post_media_for(post_ids)`** as the caller. **Do not re-implement the
   visibility rule.** That function's `can_view_post(auth.uid(), …)` is the
   entire access control and is byte-frozen (`5ea99d5975ee68086b82aa2ee0b780b7`,
   968 chars); a second implementation is a second thing to get wrong.
3. For each returned `object_path` under `RESTRICTED_PREFIX`, mint a token.
4. Return only URLs. Never `sha256`, never a bare key, never another member's
   post id.

Client: `resolvePostImageUrls` gains a branch — a path under the restricted
prefix is resolved through `media-sign-url` instead of by string concatenation.
Everything else in `postMediaRead.ts` is unchanged.

---

## 7. The upload-path change

`s3-presign-upload` must route media whose post will be restricted to
`private/<owner>/…`, and `media_mark_ready`'s MEDIA-2102 prefix list must gain
`private` **at the same time** — it currently allows `post-images` and `avatars`
only, so a restricted object could not be marked ready today.

⚠ **DO NOT DO THIS FIRST.** Writing media to a "restricted" prefix on a bucket
that still serves everything publicly is not protection — it is the appearance
of protection, which is worse, and is exactly what D-001 refused to ship. The
Worker must be live and proven (§8) before a single byte is written there.

---

## 8. The tests required after deployment — D-002 closes on these, and only these

Run from a third-party origin (`https://example.com`), `credentials: 'omit'`,
using `new Image()` as well as `fetch`:

| # | case | required result |
|---|---|---|
| 1 | PUBLIC media, no session | **retrieved** — a regression here breaks every existing image |
| 2 | PUBLIC media, `/cdn-cgi/image` transform, `srcset`, `-l3` rungs | **retrieved**, identical bytes to before the Worker |
| 3 | RESTRICTED media, **known object URL**, no token, no session | **403, no bytes** |
| 4 | RESTRICTED media, anon, expired token | **403** |
| 5 | RESTRICTED media, token minted for a DIFFERENT key | **403** |
| 6 | RESTRICTED media, token with the signature altered by one bit | **403** |
| 7 | `private` post, **owner** signed in | retrieved |
| 8 | `private` post, **stranger** signed in | **403** |
| 9 | `friends` post, **accepted friend** | retrieved |
| 10 | `friends` post, **stranger** | **403** |
| 11 | `friends` post, **anon** | **403** |
| 12 | a URL that worked for an authorized viewer, replayed 6 minutes later | **403** (expiry) |
| 13 | a URL that worked for an authorized viewer, replayed by a stranger within the window | retrieved — **and this is accepted**; see below |
| 14 | CONTROL: a restricted key that does not exist, valid token | 404, not 403 — proves the token check ran |
| 15 | the Worker throwing on a public key | must be **impossible**; test by forcing an exception in the restricted branch and confirming public keys still serve |

Case 13 is the honest limit of any bearer-token scheme: within the five-minute
window a leaked URL works. That is a five-minute window instead of for ever, and
it should be written into D-002's closure rather than glossed.

**D-002 closes when 1–12, 14 and 15 pass and case 13's residue is written down.
Not before, and not on database visibility.**

---

## 9. What must NOT be done in the meantime

- **No restricted prefix while the bucket serves everything publicly** (§7).
- **No client-side token minting.** A token the client can compute is not a
  token.
- **No closing D-002 on `post_media_for`.** It decides which ADDRESSES a viewer
  learns; it does not and cannot decide who may fetch them.
- **`PrivacyGapNotice` stays.** It is the one honest thing a member choosing
  "Only me" currently has, and `PrivacyGapDisclosed.test.ts` fails if the
  chooser is offered without it.
