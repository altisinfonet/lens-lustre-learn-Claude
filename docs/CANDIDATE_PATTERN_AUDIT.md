# The candidate pattern: audit before widening

**2026-08-20.** Phase 2 closure, Priority 2, classes B and C.

34 slides across 19 posts are real photographs, in a bucket the CDN serves,
owned by the member who posted them — and outside every manifest, because the
engine's candidate pattern does not describe them. This is the audit the brief
required *before* the pattern changes.

---

## 1. Where the pattern lives — four places, not one

| # | where | form |
|---|---|---|
| 1 | `media_migration_fence_digest()` (SQL) | `^https://cdn\.50mmretina\.com/post-images/[0-9a-f-]{36}/posts/[^/?]+$` |
| 2 | `measure-post-media` `CANDIDATE_RE` | the same regex, byte for byte |
| 3 | `_shared/manifestPlan.ts` `CANDIDATE_PATH` | bucket-relative, strict UUID: `^post-images/<uuid>/posts/[^/?]+$` |
| 4 | `media_migrate_post` `MIG-2006` | `split_part(object_path,'/',2) = owner_id` |

(1) defines the **population**. (2) decides what may be **measured**. (3) decides
what may enter a **manifest**. (4) is the ownership check at execution.

---

## 2. THE BLOCKER: (1) CANNOT BE WIDENED IN PLACE

`media_migration_fence_digest` digests the population **as of a fence**. Widening
its regex changes what every PAST fence covered. Measured:

```
class B/C slides created at or before each historical fence
  cycle 1  2026-08-17 10:52:06.533572+00   27
  cycle 2  2026-08-19 14:31:54+00          34
  cycle 3  2026-08-19 15:38:02.195291+00   34
  cycle 4  2026-08-20 02:45:07.818428+00   34
```

So a widened v1 would make `f0a74d3e…`, `46c4cad2…`, `eff23edc…` and
`c6173052…` all recompute to different values, and
`docs/MANIFEST_PROVENANCE.md` — which claims each still reproduces — would
become false. That is the one thing the brief forbids: *"The existing 228
manifest/fence must NEVER be modified."*

**Decision: `media_migration_fence_digest` is frozen for ever.** The widened
population gets a NEW function. The old digests stay reproducible by
construction rather than by care.

---

## 3. The proposed patterns, and proof they are disjoint

```
A (frozen)  https://cdn.50mmretina.com/post-images/<uuid>/posts/<file>
B (new)     https://cdn.50mmretina.com/post-images/<uuid>/<file>
C (new)     https://cdn.50mmretina.com/avatars/<uuid>/my-photos/<uuid>/<file>
```

Run over **every slide in production** (310):

```
total slides                       310
matches A                          229
matches B                           19
matches C                           15
matches MORE THAN ONE                0   ← disjoint, proven not assumed
B or C already migrated              0
B or C with privacy <> 'public'      0
B or C where path segment 2 <> the post's author   0
```

A and B cannot overlap because `[^/?]+$` forbids a `/`: `…/<uuid>/posts/x.webp`
has a slash after the uuid and fails B; `…/<uuid>/x.webp` has no `/posts/` and
fails A.

## 4. What the new patterns must NOT match, and why they don't

| not a candidate | why it fails |
|---|---|
| `avatars/<uuid>/avatar.webp?t=…` (class D, 18 slides) | no `/my-photos/<uuid>/` segment. **Mutable** — overwritten on every profile-photo change, so content identity cannot be stable. Must stay out. |
| `avatars/covers/<uuid>/<file>` (class E, 3 slides) | `covers` is not a uuid, so segment 2 fails the pattern — and would fail `MIG-1019`/`MIG-2006` anyway, because the owner is at segment 3. |
| `…supabase.co/storage/…` (class F, 28 slides) | wrong host; `MIG-1015` refuses it, and the CDN does not serve those keys (measured). |
| `…-thumb.webp`, `…-r600.webp` | none exist in the B/C population (measured: 0 of 34), and the live registrar refuses them explicitly. |
| anything with `?` | `[^/?]+$` excludes query strings, so a cache-buster can never be part of an object key. |

## 5. Ownership cannot be spoofed

Unchanged and sufficient for both new classes: `MIG-1019` (manifest) and
`MIG-2006` (execution) both require `object_path.split('/')[1] === owner_id`,
and `owner_id` is checked against `posts.user_id` by `MIG-2003`.

```
B:  post-images/<owner>/<file>                 → segment 1 is the owner ✓
C:  avatars/<owner>/my-photos/<album>/<file>   → segment 1 is the owner ✓
```

Measured across all 34: **0 owner mismatches**. No new check is needed; the
existing one already covers the widened shape.

## 6. Bucket confusion is impossible

`post-images/` and `avatars/` are key **prefixes in one R2 bucket** (`50mm`),
not separate buckets, and both are served by the same CDN origin. Verified by
retrieval, not by assumption:

```
cdn…/post-images/4c200b33…/1775277567455_0.webp                RETRIEVED 1080x1350   (class B)
cdn…/avatars/01c5059c…/my-photos/9f31841a…/1787139817305….webp RETRIEVED 4013x2675   (class C)
a key that cannot exist                                        refused              (control)
```

So a class-C object registered under its own key resolves exactly as a class-A
one does. There is no cross-bucket mapping to get wrong.

## 7. One control has to generalise, and only one

`media_mark_ready` MEDIA-2102 currently requires `^post-images/<owner>/`. The
property it guards is **"the object is inside this row's owner's folder"**, not
"the object is under post-images". Class C is inside the owner's folder, in the
other prefix. So it becomes `^(post-images|avatars)/<owner>/`.

That is not a weakening: the owner segment is still pinned to the row's owner,
and traversal, absolute paths and hosts are still refused by MEDIA-2103.

⚠ The LIVE write path keeps its narrower rule. `media-register-upload`'s
`objectKeyForOwner` still requires `post-images/<owner>/`, because the uploader
only ever writes there and a caller-supplied `avatars/…` path on the live path
would be a member registering their own mutable avatar as a post photograph.
Narrow where the caller is a member; general where the caller is the migration.
