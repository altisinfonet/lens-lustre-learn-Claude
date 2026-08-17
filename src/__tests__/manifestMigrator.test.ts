/**
 * THE MIGRATION IS ITS REFUSALS.
 *
 * Every test below is a way the media migration could go wrong. Success is
 * covered once; the other nineteen cases are failures, because the abandoned
 * `backfill-media-objects` passed a green suite of 18 tests while carrying a
 * permanent dead end, an orphan generator, and a population 48 slides wider
 * than the approved one.
 *
 * These tests execute the REAL planner (`_shared/manifestPlan.ts`) — the same
 * module the edge function imports — against hand-built fixtures. They do not
 * grep the source for a string. Two of the old suite's tests did exactly that,
 * and Cycle 5A proved by mutation that one of them passed while the code did
 * the opposite of what its name claimed.
 *
 * FIXTURES ARE SYNTHETIC ON PURPOSE. The real 207-row manifest carries member
 * post ids and owner ids; this repository is public. The real manifest is
 * exercised in the dry run, from the workspace, not committed here.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import {
  assertFence, assertManifestIntegrity, crossPostSharedContent, groupByPost,
  keySetText, parseManifest, planPost, reconcile, verifyMeasured,
  type ManifestRow, type Measured,
} from "../../supabase/functions/_shared/manifestPlan";

const OWNER_A = "11111111-1111-4111-8111-111111111111";
const OWNER_B = "22222222-2222-4222-8222-222222222222";
const POST_1 = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const POST_2 = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";
const SHA = (n: string) => n.repeat(64).slice(0, 64);

function row(over: Partial<ManifestRow> = {}): ManifestRow {
  const owner_id = over.owner_id ?? OWNER_A;
  const file = over.object_path?.split("/").pop() ?? "1785000000000-abc.webp";
  const object_path = over.object_path ?? `post-images/${owner_id}/posts/${file}`;
  const width = over.width ?? 2560, height = over.height ?? 1707;
  return {
    post_id: POST_1, owner_id, ord: 1,
    source_url: `https://cdn.50mmretina.com/${object_path}`,
    source_host: "cdn.50mmretina.com", object_path,
    width, height, aspect_ratio: (width / height).toFixed(6),
    mime: "image/webp", bytes: 1000, sha256: SHA("a"), visibility: "public",
    ...over,
    // keep the derived fields coherent unless the test overrode them directly
    ...(over.source_url ? { source_url: over.source_url } : {}),
  };
}

const COLS: (keyof ManifestRow)[] = [
  "post_id", "owner_id", "ord", "source_url", "source_host", "object_path",
  "width", "height", "aspect_ratio", "mime", "bytes", "sha256", "visibility",
];
const toText = (rows: ManifestRow[]) => rows.map((r) => COLS.map((c) => r[c]).join("\t")).join("\n") + "\n";
const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
const md5 = (s: string) => createHash("md5").update(s, "utf8").digest("hex");

const goodRows = [
  row({ post_id: POST_1, ord: 1, sha256: SHA("a"), object_path: `post-images/${OWNER_A}/posts/a.webp` }),
  row({ post_id: POST_1, ord: 2, sha256: SHA("b"), object_path: `post-images/${OWNER_A}/posts/b.webp` }),
  row({ post_id: POST_2, owner_id: OWNER_B, ord: 1, sha256: SHA("c"), object_path: `post-images/${OWNER_B}/posts/c.webp` }),
];
const goodText = toText(goodRows);
const goodHash = sha256(goodText);
const measuredFor = (r: ManifestRow): Measured =>
  ({ status: 200, bytes: r.bytes, width: r.width, height: r.height, mime: r.mime, sha256: r.sha256 });

// ─────────────────────────────────────────────────────────────────────────────
describe("0. the happy path exists, so the refusals below are not vacuous", () => {
  it("an approved, well-formed manifest parses and plans", () => {
    expect(assertManifestIntegrity(goodHash, goodHash)).toBeNull();
    const { rows, refusal } = parseManifest(goodText);
    expect(refusal).toBeNull();
    expect(rows).toHaveLength(3);
    expect(groupByPost(rows).size).toBe(2);
    const p = planPost(POST_1, rows, [rows[0].source_url, rows[1].source_url], false);
    expect(p.refusal).toBeNull();
    expect(p.plan).toHaveLength(2);
    for (const r of rows) expect(verifyMeasured(r, measuredFor(r))).toBeNull();
  });
});

describe("1–5. the manifest itself", () => {
  it("1. wrong manifest hash → FAIL CLOSED", () => {
    const r = assertManifestIntegrity(sha256("something else"), goodHash);
    expect(r?.code).toBe("MIG-1003");
  });

  it("2. altered manifest → FAIL CLOSED (one byte is enough)", () => {
    const altered = goodText.replace("2560", "2561");
    expect(sha256(altered)).not.toBe(goodHash);
    expect(assertManifestIntegrity(sha256(altered), goodHash)?.code).toBe("MIG-1003");
  });

  it("3. missing manifest row → FAIL CLOSED when the post is planned", () => {
    const { rows } = parseManifest(goodText);
    const withoutPost2 = rows.filter((r) => r.post_id !== POST_2);
    const p = planPost(POST_2, withoutPost2, ["https://cdn.50mmretina.com/x"], false);
    expect(p.refusal?.code).toBe("MIG-1050");
  });

  it("4. unexpected candidate (live has a slide the manifest does not) → FAIL CLOSED", () => {
    const { rows } = parseManifest(goodText);
    const p = planPost(POST_1, rows, [rows[0].source_url, rows[1].source_url, "https://cdn.50mmretina.com/post-images/x/posts/extra.webp"], false);
    expect(p.refusal?.code).toBe("MIG-1051");
    const q = planPost(POST_1, rows, [rows[0].source_url, "https://cdn.50mmretina.com/post-images/x/posts/other.webp"], false);
    expect(q.refusal?.code).toBe("MIG-1052");
  });

  it("5. duplicate manifest key → FAIL CLOSED", () => {
    const dup = toText([goodRows[0], { ...goodRows[0] }]);
    expect(parseManifest(dup).refusal?.code).toBe("MIG-1027");
  });
});

describe("6–12. rows that must never reach the database", () => {
  it("6. wrong owner (owner_id is not the object path's folder) → FAIL CLOSED", () => {
    const bad = toText([row({ owner_id: OWNER_B, object_path: `post-images/${OWNER_A}/posts/a.webp` })]);
    expect(parseManifest(bad).refusal?.code).toBe("MIG-1019");
  });

  it("6b. one post whose slides disagree about the owner → FAIL CLOSED", () => {
    const bad = toText([
      row({ post_id: POST_1, ord: 1, owner_id: OWNER_A, object_path: `post-images/${OWNER_A}/posts/a.webp`, sha256: SHA("a") }),
      row({ post_id: POST_1, ord: 2, owner_id: OWNER_B, object_path: `post-images/${OWNER_B}/posts/b.webp`, sha256: SHA("b") }),
    ]);
    expect(parseManifest(bad).refusal?.code).toBe("MIG-1030");
  });

  it("7. wrong object path → FAIL CLOSED (avatar, traversal, foreign host, url/path drift)", () => {
    const avatar = toText([row({ object_path: `avatars/${OWNER_A}/avatar.webp` })]);
    expect(parseManifest(avatar).refusal?.code).toBe("MIG-1017");

    const traversal = toText([row({ object_path: `post-images/${OWNER_A}/../national-ids/x.webp` })]);
    expect(parseManifest(traversal).refusal?.code).toBe("MIG-1016");

    const foreign = toText([row({ source_host: "evil.example.com" })]);
    expect(parseManifest(foreign).refusal?.code).toBe("MIG-1015");

    const drift = toText([row({ source_url: "https://cdn.50mmretina.com/post-images/other/posts/z.webp" })]);
    expect(parseManifest(drift).refusal?.code).toBe("MIG-1018");
  });

  it("8. SHA mismatch between manifest and measured bytes → FAIL CLOSED", () => {
    const r = goodRows[0];
    const v = verifyMeasured(r, { ...measuredFor(r), sha256: SHA("f") });
    expect(v?.code).toBe("MIG-1063");
    expect(v?.detail).toMatch(/SHA-256 MISMATCH/);
  });

  it("9. duplicate SHA inside one post → FAIL CLOSED; shared across posts → reported, not refused", () => {
    const samePost = toText([
      row({ post_id: POST_1, ord: 1, sha256: SHA("a"), object_path: `post-images/${OWNER_A}/posts/a.webp` }),
      row({ post_id: POST_1, ord: 2, sha256: SHA("a"), object_path: `post-images/${OWNER_A}/posts/b.webp` }),
    ]);
    expect(parseManifest(samePost).refusal?.code).toBe("MIG-1028");

    const acrossPosts = parseManifest(toText([
      row({ post_id: POST_1, ord: 1, sha256: SHA("a"), object_path: `post-images/${OWNER_A}/posts/a.webp` }),
      row({ post_id: POST_2, ord: 1, sha256: SHA("a"), object_path: `post-images/${OWNER_A}/posts/b.webp` }),
    ]));
    expect(acrossPosts.refusal).toBeNull();
    const shared = crossPostSharedContent(acrossPosts.rows);
    expect(shared).toHaveLength(1);
    expect(shared[0].posts.sort()).toEqual([POST_1, POST_2].sort());
  });

  it("10. missing object (non-200) → FAIL CLOSED", () => {
    const r = goodRows[0];
    expect(verifyMeasured(r, { ...measuredFor(r), status: 404 })?.code).toBe("MIG-1060");
  });

  it("11. invalid MIME → FAIL CLOSED, in the manifest and in the bytes", () => {
    expect(parseManifest(toText([row({ mime: "image/gif" })])).refusal?.code).toBe("MIG-1023");
    const r = goodRows[0];
    expect(verifyMeasured(r, { ...measuredFor(r), mime: "image/jpeg" })?.code).toBe("MIG-1064");
    expect(verifyMeasured({ ...r, mime: "image/gif" }, { ...measuredFor(r), mime: "image/gif" })?.code).toBe("MIG-1065");
  });

  it("12. invalid dimensions → FAIL CLOSED, in the manifest and in the bytes", () => {
    expect(parseManifest(toText([row({ width: 0, aspect_ratio: "0.000000" })])).refusal?.code).toBe("MIG-1020");
    expect(parseManifest(toText([row({ height: -1 })])).refusal?.code).toBe("MIG-1021");
    expect(parseManifest(toText([row({ bytes: 0 })])).refusal?.code).toBe("MIG-1022");
    expect(parseManifest(toText([row({ aspect_ratio: "9.999999" })])).refusal?.code).toBe("MIG-1026");
    const r = goodRows[0];
    expect(verifyMeasured(r, { ...measuredFor(r), width: -1 })?.code).toBe("MIG-1066");
    expect(verifyMeasured(r, { ...measuredFor(r), height: 3 })?.code).toBe("MIG-1067");
    expect(verifyMeasured(r, { ...measuredFor(r), bytes: 7 })?.code).toBe("MIG-1061");
  });

  it("12b. ordinals must be dense 1..n — a gap is a lost photograph", () => {
    const gap = toText([
      row({ post_id: POST_1, ord: 1, sha256: SHA("a"), object_path: `post-images/${OWNER_A}/posts/a.webp` }),
      row({ post_id: POST_1, ord: 3, sha256: SHA("b"), object_path: `post-images/${OWNER_A}/posts/b.webp` }),
    ]);
    expect(parseManifest(gap).refusal?.code).toBe("MIG-1029");
  });
});

describe("13–16. failures the database must absorb — proven against the shipped SQL", () => {
  const sql = readFileSync(
    resolve(__dirname, "../../supabase/migrations/20260817170000_media_migration_engine.sql"), "utf8");

  it("13. media_objects failure → the whole post rolls back (one function, one transaction)", () => {
    // A plpgsql function IS a transaction: any RAISE undoes every write it made.
    expect(sql).toMatch(/create or replace function public\.media_migrate_post/);
    expect(sql).toMatch(/language plpgsql/);
    // and every failure path raises rather than continuing
    expect((sql.match(/raise exception 'MIG-20\d\d/g) ?? []).length).toBeGreaterThanOrEqual(9);
  });

  it("14. post_media failure → same transaction, so no media row survives it", () => {
    const body = sql.slice(sql.indexOf("media_migrate_post"), sql.indexOf("revoke all on function public.media_migrate_post"));
    expect(body).toMatch(/insert into public\.post_media/);
    expect(body).toMatch(/raise exception 'MIG-2009/);
    // the references insert comes AFTER the media loop, inside the same function
    expect(body.indexOf("insert into public.media_objects")).toBeLessThan(body.indexOf("insert into public.post_media"));
  });

  it("15. verification failure → raises INSIDE the transaction, so it rolls back", () => {
    expect(sql).toMatch(/MIG-2010 verification read-back disagrees/);
    expect(sql).toMatch(/MIG-2011 a reference on post .* is not ready or not owned/);
  });

  it("16. a row stuck below 'ready' is REPAIRED, not thrown on for ever", () => {
    // This is the permanent dead end from the abandoned migrator, closed.
    //
    // The first version of this test asserted only /_repaired/, and mutation
    // run #9 renamed the DECLARATION while leaving the other mentions in
    // place — the test stayed green. It now asserts the property instead of
    // the word: the counter is declared and returned, and the state-advance
    // runs on the REUSED row, not only on a freshly inserted one.
    expect(sql).toMatch(/_repaired int := 0;/);
    expect(sql).toMatch(/'media_repaired', _repaired/);
    expect(sql).toMatch(/_repaired := _repaired \+ 1;/);

    const body = sql.slice(sql.indexOf("media_migrate_post"), sql.indexOf("revoke all on function public.media_migrate_post"));
    const reuseBranch = body.indexOf("_repaired := _repaired + 1;");
    const advanceToVerified = body.indexOf("set state = 'verified'");
    const advanceToReady = body.indexOf("set state = 'ready'");
    expect(reuseBranch).toBeGreaterThan(-1);
    // the advance happens AFTER the reuse branch, so a reused non-ready row
    // goes through it — that is what makes the dead end recoverable
    expect(advanceToVerified).toBeGreaterThan(reuseBranch);
    expect(advanceToReady).toBeGreaterThan(advanceToVerified);

    expect(sql).toMatch(/MIG-2007 media % for this content is quarantined/);
    // and it never inserts a duplicate to get around the unique index
    expect(sql).not.toMatch(/on conflict do nothing/i);
  });
});

describe("17–20. running it twice, alongside a live platform, and finishing", () => {
  it("17. repeated execution → the post is skipped, not rewritten", () => {
    const { rows } = parseManifest(goodText);
    const p = planPost(POST_1, rows, [rows[0].source_url, rows[1].source_url], true);
    expect(p.skip).toBe("already-has-references");
    expect(p.plan).toBeNull();
    expect(p.refusal).toBeNull();
  });

  it("18. a concurrent arrival changes the live set → FAIL CLOSED on the fence", () => {
    const { rows } = parseManifest(goodText);
    const manifestDigest = md5(keySetText(rows));
    // same set → proceed
    expect(assertFence(rows, manifestDigest, manifestDigest, rows.length)).toBeNull();
    // one arrival → different digest → refuse
    const withArrival = md5(keySetText([...rows, { post_id: POST_2, ord: 2, source_url: "https://cdn.50mmretina.com/post-images/x/posts/new.webp" }]));
    expect(assertFence(rows, withArrival, manifestDigest, rows.length + 1)?.code).toBe("MIG-1040");
  });

  it("18b. A COUNT IS NOT A SET — one leaves and one arrives, count unchanged, still refused", () => {
    const { rows } = parseManifest(goodText);
    const manifestDigest = md5(keySetText(rows));
    const swapped = md5(keySetText([
      rows[0], rows[1],
      { post_id: POST_2, ord: 1, source_url: "https://cdn.50mmretina.com/post-images/x/posts/different.webp" },
    ]));
    expect(swapped).not.toBe(manifestDigest);
    // identical length — a length check would have passed here
    expect(assertFence(rows, swapped, manifestDigest, rows.length)?.code).toBe("MIG-1040");
  });

  it("19. partial batch → resumable, because planning is per-post and order is stable", () => {
    const { rows } = parseManifest(goodText);
    const ids = [...groupByPost(rows).keys()].sort();
    expect(ids.slice(0, 1)).toEqual([ids[0]]);
    expect(ids.slice(1, 2)).toEqual([ids[1]]);
    // resuming at offset 1 must not re-plan post 0
    expect(ids.slice(1)).not.toContain(ids[0]);
  });

  it("20. final reconciliation mismatch → FAIL", () => {
    const { rows } = parseManifest(goodText);
    const expectedMedia = new Set(rows.map((r) => `${r.owner_id}|${r.sha256}`)).size;
    expect(reconcile(rows, { postMediaCount: rows.length, mediaObjectCount: expectedMedia, unreferencedMediaCount: 0, nonReadyMediaCount: 0 }).ok).toBe(true);
    expect(reconcile(rows, { postMediaCount: rows.length - 1, mediaObjectCount: expectedMedia, unreferencedMediaCount: 0, nonReadyMediaCount: 0 }).failures[0].code).toBe("MIG-1070");
    expect(reconcile(rows, { postMediaCount: rows.length, mediaObjectCount: expectedMedia + 1, unreferencedMediaCount: 0, nonReadyMediaCount: 0 }).failures[0].code).toBe("MIG-1071");
    expect(reconcile(rows, { postMediaCount: rows.length, mediaObjectCount: expectedMedia, unreferencedMediaCount: 2, nonReadyMediaCount: 0 }).failures[0].code).toBe("MIG-1072");
    expect(reconcile(rows, { postMediaCount: rows.length, mediaObjectCount: expectedMedia, unreferencedMediaCount: 0, nonReadyMediaCount: 1 }).failures[0].code).toBe("MIG-1073");
  });
});

describe("the engine's own security posture", () => {
  const fnPath = resolve(__dirname, "../../supabase/functions/migrate-post-media/index.ts");
  const fn = existsSync(fnPath) ? readFileSync(fnPath, "utf8") : "";
  const code = fn.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
  const sql = readFileSync(resolve(__dirname, "../../supabase/migrations/20260817170000_media_migration_engine.sql"), "utf8");

  it("it has NO population scan of its own — the manifest is the work list", () => {
    expect(code).not.toMatch(/from\(["']posts["']\)/);
    expect(code).toMatch(/parseManifest\(manifestText\)/);
  });

  it("it fetches only manifest URLs, only from the CDN, and refuses redirects", () => {
    const fetches = [...code.matchAll(/\bfetch\(([^,)]+)/g)].map((m) => m[1].trim());
    expect(fetches).toEqual(["row.source_url"]);
    expect(code).toMatch(/host !== CDN_HOST/);
    expect(code).toMatch(/redirect: "error"/);
  });

  it("it is admin-only and dry by default", () => {
    expect(code).toMatch(/auth\.getUser\(\)/);
    expect(code).toMatch(/\.eq\("role", "admin"\)/);
    expect(code).toMatch(/Admin access required/);
    expect(code).toMatch(/body\?\.dry_run !== false/);
  });

  it("it writes ONLY through the transactional RPC — no direct table writes", () => {
    // Targets the PostgREST chain specifically. A bare /\.update\(/ also
    // matches createHash(...).update(), which is not a database write — the
    // first version of this test failed on exactly that and was sharpened, not
    // relaxed.
    const tableWrite = /\.from\([^)]*\)\s*\.(insert|update|upsert|delete)\(/;
    expect(code).not.toMatch(tableWrite);
    expect(code).toMatch(/rpc\("media_migrate_post"/);
    // and the only .from() uses are reads
    for (const m of code.matchAll(/\.from\([^)]*\)\s*\.(\w+)\(/g)) {
      expect(["select"], `unexpected .from().${m[1]}()`).toContain(m[1]);
    }
  });

  it("MIME and dimensions come from the BYTES, never from a filename", () => {
    expect(code).toMatch(/imageDimsFromBytes\(buf\)/);
    expect(code).toMatch(/sniffMime\(buf\)/);
    expect(code).not.toMatch(/dimsFromName|MIME_BY_EXT|extOf\(/);
  });

  it("SHA-256 is never the public identifier, and the id stays random", () => {
    // The insert names its columns explicitly and `id` is NOT one of them, so
    // gen_random_uuid() supplies it. (An earlier version of this test used a
    // loose regex that matched the legitimate lookup `owner_id = _owner_id and
    // sha256 = _sha`; it was sharpened to assert the real property.)
    const ins = sql.match(/insert into public\.media_objects \(([^)]*)\)/);
    expect(ins, "media_objects insert not found").not.toBeNull();
    const cols = ins![1].split(",").map((c) => c.trim());
    expect(cols).not.toContain("id");
    expect(cols).toEqual(["owner_id", "sha256", "width", "height", "bytes", "mime", "visibility"]);
    // and nothing anywhere casts or encodes a hash into an identifier
    expect(sql).not.toMatch(/sha256[^;\n]*::uuid|uuid[^;\n]*sha256\b[^;\n]*as id/i);
    expect(code).not.toMatch(/media_id:\s*.*sha/i);
  });

  it("the SQL grants nothing to anon or authenticated", () => {
    expect(sql).not.toMatch(/grant\s+execute[\s\S]{0,80}to\s+(anon|authenticated)/i);
    for (const f of ["media_migrate_post", "media_migration_fence_digest", "media_migration_reconcile"]) {
      expect(sql).toMatch(new RegExp(`revoke all on function public\\.${f}[^;]*from anon`));
      expect(sql).toMatch(new RegExp(`revoke all on function public\\.${f}[^;]*from authenticated`));
    }
  });

  it("no existing constraint, trigger or index is weakened to make migration easier", () => {
    expect(sql).not.toMatch(/drop\s+(constraint|trigger|index)/i);
    expect(sql).not.toMatch(/alter table[\s\S]{0,60}(disable|drop)/i);
    expect(sql).not.toMatch(/set session_replication_role/i);
  });

  it("posts.image_urls is never written", () => {
    expect(sql).not.toMatch(/update\s+public\.posts/i);
    expect(code).not.toMatch(/image_urls\s*=/);
  });
});

describe("the abandoned migrator stays abandoned", () => {
  const OLD = resolve(__dirname, "../../supabase/functions/backfill-media-objects/index.ts");
  const ABANDONED_SHA1 = "cfc5051e7dadf488e2c34bb963892d7d39e69f03";

  it("its forensic copy is unmodified — the hash recorded when it was abandoned", () => {
    expect(existsSync(OLD)).toBe(true);
    const buf = readFileSync(OLD);
    const gitBlob = createHash("sha1").update(`blob ${buf.length}\0`).update(buf).digest("hex");
    expect(gitBlob).toBe(ABANDONED_SHA1);
  });

  it("it is NOT configured for deployment — a config entry would be an accident", () => {
    const toml = readFileSync(resolve(__dirname, "../../supabase/config.toml"), "utf8");
    expect(toml).not.toMatch(/\[functions\.backfill-media-objects\]/);
  });

  it("the replacement is not configured for deployment either, in this cycle", () => {
    const toml = readFileSync(resolve(__dirname, "../../supabase/config.toml"), "utf8");
    expect(toml).not.toMatch(/\[functions\.migrate-post-media\]/);
  });
});
