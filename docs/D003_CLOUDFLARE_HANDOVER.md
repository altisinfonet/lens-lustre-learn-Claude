# D-003 — AUTHORIZED BYTE DELIVERY: WHAT IS BLOCKED, AND EXACTLY WHAT UNBLOCKS IT

**Status: BLOCKED on external infrastructure. Nothing has been faked, stubbed or
half-built.** This workstream stopped; every other workstream continued.

---

## 1. THE MEASURED SECURITY RESULT, TODAY

Run 2026-08-20 against a real production object, no session, credentials omitted:

```
target      https://cdn.50mmretina.com/post-images/<owner>/posts/…-w1620h1081-l3.webp
fetch()     mode:'no-cors', credentials:'omit'  →  type "opaque", status 0
new Image() no crossOrigin, no credentials      →  LOADED, naturalWidth 1620, naturalHeight 1081
```

**Verdict: the bytes are served with no authorization check of any kind.**

The opaque fetch is not a control — the CDN simply sends no CORS header, so the
*script* cannot read the bytes. `new Image()` needs no CORS and carries no
credentials, and it renders the photograph. That is how a third party actually
retrieves an image, and it works.

The decisive test D-002 requires therefore **FAILS**:

> KNOWN OBJECT URL + NO SESSION + CREDENTIALS OMITTED + UNAUTHORIZED VIEWER
> → HTTP DENIED / NO BYTES

Result today: **HTTP 200, full bytes.**

Supporting facts: the `post-images` prefix sits in R2 bucket `50mm` (APAC,
Standard) served publicly at `cdn.50mmretina.com`, and the Supabase
`storage.objects` SELECT policy for that bucket is `(bucket_id = 'post-images')`
— no privacy condition at all.

**D-002 is NOT closed.** `PrivacyGapNotice` stays in the composer, and
`PrivacyGapDisclosed.test.ts` still fails if the audience chooser is offered
without it.

---

## 2. WHY IT COULD NOT BE BUILT HERE

The Cloudflare Developer Platform connector **is** connected and working — it
reads the account correctly (R2 buckets `50mm`, `agentcrm`; one Worker,
`seo-edge-injector`). It is **read-only for Workers**, and offers no tool for any
of the four things D-003 needs:

| Needed | Tool available? |
|---|---|
| Upload / deploy a Worker script | **No** (`workers_list`, `workers_get_worker`, `workers_get_worker_code` only) |
| Bind R2 to a Worker | **No** |
| Create a Worker route or custom domain | **No** |
| Change DNS, or remove R2 public access | **No** |

What it *can* do — create/delete R2 buckets, D1, KV, Hyperdrive — implements none
of it. So this is blocker category 3 of the closure command: an external
infrastructure action that genuinely cannot be performed with the available tools.

---

## 3. EXACT CLOUDFLARE CONFIGURATION REQUIRED

1. **Worker** named `media-authz` on the account owning `50mmretina.com`.
2. **R2 binding**: variable `MEDIA`, bucket `50mm`, jurisdiction `default`.
3. **Secret**: `MEDIA_TOKEN_KEY` — 32 random bytes, base64url. The same value is
   set as a Supabase secret so the application can sign.
4. **Route**: `cdn.50mmretina.com/*` → `media-authz`.
5. **DNS**: `cdn.50mmretina.com` becomes a proxied (orange-cloud) record pointing
   at the Worker route instead of the R2 public bucket.
6. **R2 public access: DISABLED** on bucket `50mm`.

⚠ Step 6 is the one that actually closes the gap. Steps 1–5 without it leave the
public URL working and the Worker merely optional — the "half-move" the D-003
mutation harness exists to catch.

---

## 4. EXACT WORKER BEHAVIOUR

```
GET /<objectKey>[?t=<token>]

  1. key := decodeURIComponent(path minus leading '/')
     refuse '..', leading '/', '//', backslash            → 400

  2. visibility := lookup(key)          // see §6, cached 60s in KV or Cache API
     if visibility == 'public'          → serve from R2 (long cache, immutable)

  3. restricted (friends|private):
     if no token                        → 403, zero bytes
     verify(token):
        HMAC-SHA256 over `${key}\n${exp}\n${sub}\n${aud}` with MEDIA_TOKEN_KEY
        constant-time compare
        exp > now                       else 403
        aud == 'cdn.50mmretina.com'     else 403
        sub == the viewer the app authorized for THIS key
     on success                         → serve from R2, `Cache-Control: private, no-store`
     on any failure                     → 403, zero bytes
```

Rules that are not optional:

- **Range requests** must be honoured for public objects and refused (or served
  only after the same token check) for restricted ones.
- **Cache**: never cache a restricted object at the edge. Cloudflare caches per
  full URL *including query string*, so a token in the query string would
  otherwise become a shared cache key — the exact mechanism that already causes
  two cache-busted avatar URLs to return different images.
- **Headers**: pass `Content-Type` and `ETag` from R2; never echo the token.
- **404 vs 403**: a restricted object with a bad token returns **403**, not 404 —
  the object's existence is not the secret, its bytes are.

---

## 5. EXACT TOKEN CONTRACT

```
token   = base64url(HMAC-SHA256(key || '\n' || exp || '\n' || sub || '\n' || aud, MEDIA_TOKEN_KEY))
claims  = { key, exp, sub, aud }
exp     = now + 300s          (5 minutes; short enough that a leaked URL dies)
sub     = viewer's auth.uid() (NOT the owner's — this is who may look)
aud     = 'cdn.50mmretina.com'
```

Replay resistance is `exp` plus `sub`: a stolen URL works only for the viewer it
was minted for, and only for five minutes. It is deliberately **not** a nonce —
a nonce needs shared state on a path that must stay a single R2 read.

---

## 6. EXACT APPLICATION ENDPOINT CONTRACT

A Supabase RPC, service-role or `authenticated` with its own checks:

```
media_delivery_token(_object_keys text[]) → table(object_key text, token text, expires_at timestamptz)
```

For each key it must, inside one query:

1. resolve `object_key` → `media_objects` → `post_media` → `posts`;
2. read that post's `privacy`;
3. `public`      → no token needed, return NULL token;
   `friends`     → token only if `can_view_post(auth.uid(), p.user_id, p.privacy)`;
   `private`     → token only if `auth.uid() = p.user_id`;
4. refuse silently (NULL token) rather than erroring, so the caller cannot use
   the error channel to enumerate which keys exist.

`can_view_post` already exists and is already the function the RLS policies on
`media_objects` and `post_media` use — the Worker path must not invent a second
opinion about who may see a post.

---

## 7. THE TESTS THAT MUST PASS AFTER DEPLOYMENT

| Privacy | Viewer | Expected |
|---|---|---|
| public | anon, no token | **200 + bytes** |
| public | known URL, no session | **200 + bytes** |
| private | owner, valid token | **200 + bytes** |
| private | friend | **403, zero bytes** |
| private | stranger | **403, zero bytes** |
| private | anon | **403, zero bytes** |
| private | known URL, no token | **403, zero bytes** |
| private | expired token | **403, zero bytes** |
| private | token minted for another viewer | **403, zero bytes** |
| private | token minted for another key | **403, zero bytes** |
| friends | accepted friend, valid token | **200 + bytes** |
| friends | stranger | **403, zero bytes** |
| friends | anon | **403, zero bytes** |
| friends | known URL, no token | **403, zero bytes** |

Each must be verified with `new Image()` **as well as** `fetch()` — an opaque
fetch failure proves nothing, because the CDN sends no CORS header either way.

⚠ And the one that catches a half-deployment: with the Worker live, fetch a
restricted object **directly from the R2 public endpoint**. It must also fail.
If it succeeds, step 6 of §3 was skipped and the Worker is decorative.

---

## 8. DEPLOYMENT ORDER

1. Deploy `media-authz` with the R2 binding, route **not** yet attached.
2. Deploy the RPC and set `MEDIA_TOKEN_KEY` on both sides.
3. Attach the route; verify public objects still serve (no regression).
4. Ship the client change that requests tokens for restricted media.
5. **Disable R2 public access.**
6. Run §7 in full.
7. Only then: delete `PrivacyGapNotice`, close D-002, and let
   `tools/mutate-authorized-delivery.mjs` prove the register cannot silently
   reopen.

Steps 1–4 are reversible. Step 5 is the commit point.
