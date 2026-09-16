# WS-HASH-v1 — deterministic function-bundle hash construction

Defined this run because `ezbr_sha256` (the platform-supplied field on each Supabase edge
function) has an undocumented preimage — we do not know what bytes, in what order, with what
encoding, produce it. It is recorded for reference in every row of the output manifests below,
but it is **not** relied on for any MATCH/DIFFERENT judgment in this work order. WS-HASH-v1 is.

## Input

The `files` array returned by `mcp__Supabase__get_edge_function(project_id, function_slug)` for
one function slug, at the moment of the call. Each element is `{name: string, content: string}`.
`content` is treated as Unicode text and re-encoded to UTF-8 bytes for hashing (an assumption:
that the platform's returned string round-trips to the original source bytes via UTF-8 — flagged
here as an assumption, not verified independently, since we have no lower-level byte-fetch path).

## Construction

1. Let F = the `files` array for this function.
2. Sort F by `name` ascending, using plain Unicode code-point order (Python's default `str`
   comparison / `sorted(F, key=lambda f: f["name"])`). Every file name observed so far is a plain
   ASCII relative path, for which code-point order and byte order are identical. If any file name
   contains a non-ASCII character, that must be flagged explicitly in the output — not silently
   handled — because the sort order guarantee no longer holds without a stated byte-order rule.
3. For each file in sorted order, build one record:

   `RECORD = name.encode("utf-8") + b"\x00" + str(len(content.encode("utf-8"))).encode("ascii") + b"\x00" + content.encode("utf-8") + b"\x0A"`

   That is: UTF-8 name bytes, one `0x00` byte, the file's UTF-8 content length as ASCII decimal
   digits, one `0x00` byte, the UTF-8 content bytes, one `0x0A` byte terminating the record.
4. `BLOB = RECORD_1 || RECORD_2 || ... || RECORD_n` in sorted order, concatenated with no bytes
   between records beyond each record's own trailing `0x0A`.
5. `WS-HASH-v1 = sha256(BLOB).hexdigest()`

The function's slug, version, and project (production/staging) are recorded **beside** the hash
in the manifest, never inside the hashed bytes — so that the same underlying file bundle deployed
under the same slug on both lanes produces the identical WS-HASH-v1, making a direct lane
comparison possible by comparing hash strings, not by re-diffing source.

## Reference implementation (Python)

```python
import hashlib

def ws_hash_v1(files: list[dict]) -> str:
    for f in files:
        if not f["name"].isascii():
            raise ValueError(f"non-ASCII file name, sort order unverified: {f['name']!r}")
    ordered = sorted(files, key=lambda f: f["name"])
    blob = b""
    for f in ordered:
        content_bytes = f["content"].encode("utf-8")
        blob += f["name"].encode("utf-8")
        blob += b"\x00"
        blob += str(len(content_bytes)).encode("ascii")
        blob += b"\x00"
        blob += content_bytes
        blob += b"\x0a"
    return hashlib.sha256(blob).hexdigest()
```

## Reproducibility

Any auditor with `get_edge_function` access to the same project, at a time when the function has
not been redeployed (version unchanged), can reproduce the identical WS-HASH-v1 by running this
exact construction over the `files` array returned for that slug. Manifest rows record the
function's `version` specifically so a later re-run can detect whether the comparison is against
the same deployed artifact or a newer one.

---

# ADDENDUM, added after first use — WS-HASH-v1 is layout-sensitive; WS-CONTENT-v1 added

**A defect in this instrument, found by using it and disclosed rather than worked around.**

The construction above hashes each file's **name** as well as its content. The spec's own claim
that "the same underlying file bundle deployed under the same slug on both lanes produces the
identical WS-HASH-v1" is therefore **too strong, and was wrong as written**. Production and staging
return the same source files under **different path prefixes** — e.g. production
`submit-judge-tag/index.ts` and `_shared/judgingAuth.ts` against staging
`functions/submit-judge-tag/index.ts` and `functions/_shared/judgingAuth.ts`. Byte-identical code
under a relocated path yields a different WS-HASH-v1.

Observed directly: 7 shared slugs had **identical total byte counts and different WS-HASH-v1**
(`judge-session-resume`, `publish-scheduled-posts`, `send-broadcast-push`, `submit-judge-comment`,
`submit-judge-score`, `submit-judge-tag`, `translate-text`). Per F-15, equal length with unequal
hash is a diagnosis, not a curiosity — it was localised, and in all 7 cases the per-file content
multiset was identical and only the path prefixes differed.

WS-HASH-v1 is **kept unchanged** — it is a correct *bundle identity* hash, and path layout is a
real deployment property worth detecting. A second, path-insensitive hash is added alongside it so
that "the code differs" and "the code was relocated" are never conflated.

## WS-CONTENT-v1 — path-insensitive companion

1. For each file in the bundle compute `sha256(content.encode("utf-8")).hexdigest()`.
2. Sort those hex digests ascending as ASCII strings. (A multiset: duplicates are kept, so two
   files with identical content both contribute.)
3. Concatenate each digest followed by a single `\n` (0x0A).
4. `WS-CONTENT-v1 = sha256(that ASCII string).hexdigest()`

```python
def ws_content_v1(files: list[dict]) -> str:
    hs = sorted(hashlib.sha256(f["content"].encode("utf-8")).hexdigest() for f in files)
    return hashlib.sha256("".join(h + "\n" for h in hs).encode("ascii")).hexdigest()
```

**What each hash decides.** Comparing one slug across the two lanes:

| WS-HASH-v1 | WS-CONTENT-v1 | Classification |
|---|---|---|
| equal | equal | `IDENTICAL-BUNDLE` — same content, same paths |
| differs | equal | `SAME-CONTENT-DIFFERENT-LAYOUT` — byte-identical code, relocated |
| differs | differs | `CONTENT-DIFFERS` — the code itself differs |

WS-CONTENT-v1 is deliberately blind to file **names**, so it cannot detect a pure rename, and it is
blind to **order**, so it cannot detect a reordering. Neither is a defect for its stated purpose
(deciding whether the same source bytes are present on both lanes), but neither may be claimed
beyond that purpose.
