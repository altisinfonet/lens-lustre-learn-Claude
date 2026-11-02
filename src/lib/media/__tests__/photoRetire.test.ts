import { describe, expect, it } from "vitest";
import { isRetireKey } from "../photoRetire";
import { handleRetire } from "../../../../functions/api/media/retire";

const O = "11111111-1111-4111-8111-111111111111";
const FULL = `competition-photos/${O}/competitions/a1-w6000h4000-l4f.webp`;
const OLD = `post-images/${O}/posts/1793-aa-w2170h1479-l3.webp`;

describe("U6/U7 retire — which keys may ever be deleted", () => {
  it("comp_full: only a v2 competition FULL-SIZE file, never its copies", () => {
    expect(isRetireKey("comp_full", FULL)).toBe(true);
    for (const k of [
      `competition-photos/${O}/competitions/a1-w6000h4000-l4f-r2048.webp`,
      `competition-photos/${O}/competitions/a1-w6000h4000-l4f-thumb.webp`,
      `competition-photos/${O}/competitions/a1-w6000h4000-l4f-r1080.webp`,
      `competition-photos/${O}/competitions/old-photo.webp`,
      `competition-photos/${O}/../x-w1h1-l4f.webp`,
      `post-images/${O}/posts/a-w10h10-l4f.webp`,
      OLD,
    ]) expect(isRetireKey("comp_full", k), k).toBe(false);
  });

  it("post_old: an old post photo or its old copies, never a v2 copy, never another folder", () => {
    expect(isRetireKey("post_old", OLD)).toBe(true);
    expect(isRetireKey("post_old", OLD.replace(".webp", "-thumb.webp"))).toBe(true);
    expect(isRetireKey("post_old", OLD.replace(".webp", "-r1440.webp"))).toBe(true);
    for (const k of [
      `post-images/${O}/posts/1793-aa-w2170h1479-l3-w2048h1396-l4.webp`,
      `post-images/${O}/posts/1793-aa-w2170h1479-l3-w2048h1396-l4-thumb.webp`,
      `post-images/${O}/posts/1793-aa-w2170h1479-l3-w2048h1396-l4-r320.webp`,
      `post-images/${O}/d/${O}/w600.webp`,
      `avatars/${O}/avatar.webp`,
      `post-images/${O}/../x.webp`,
      FULL,
    ]) expect(isRetireKey("post_old", k), k).toBe(false);
    expect(isRetireKey("other" as never, OLD)).toBe(false);
  });
});

function setup(rows: Array<{ id: number; kind: string; object_key: string }>, present: Record<string, number>) {
  const calls: string[] = [];
  const deleted: string[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.endsWith("/auth/v1/user")) return new Response(JSON.stringify({ id: O }), { status: 200 });
    if (u.endsWith("/rpc/photo_retire_claim")) { calls.push(`claim ${String(init?.body)}`); return new Response(JSON.stringify(rows), { status: 200 }); }
    if (u.endsWith("/rpc/photo_retire_done")) { calls.push(`done ${String(init?.body)}`); return new Response("true", { status: 200 }); }
    return new Response("{}", { status: 404 });
  }) as unknown as typeof fetch;
  const bucket = {
    head: async (k: string) => (k in present ? { size: present[k] } : null),
    get: async () => null,
    put: async () => { throw new Error("never writes"); },
    delete: async (k: string) => { deleted.push(k); },
    list: async () => ({ objects: [], truncated: false }),
  };
  const env = { SUPABASE_PROJECT_REF: "abcdefghijklmnopqrst", SUPABASE_ANON_KEY: "anon", PHOTOS: bucket };
  const call = (body: unknown) => handleRetire(new Request("https://site.example/api/media/retire", {
    method: "POST", headers: { authorization: "Bearer jwt", "content-type": "application/json" }, body: JSON.stringify(body),
  }), env as never, fetchImpl);
  return { calls, deleted, call };
}

describe("U6/U7 retire route", () => {
  const rows = [
    { id: 1, kind: "comp_full", object_key: FULL },
    { id: 2, kind: "post_old", object_key: OLD },
    { id: 3, kind: "post_old", object_key: `post-images/${O}/posts/x-w2048h1365-l4.webp` }, // a v2 copy: refused
    { id: 4, kind: "post_old", object_key: `post-images/${O}/posts/gone.webp` },            // already absent
  ];

  const R2048 = FULL.replace("-l4f.webp", "-l4f-r2048.webp");

  it("a competition full size whose 2048 copy is NOT in the store is refused — never deleted, never recorded", async () => {
    const s = setup([rows[0]], { [FULL]: 5_000_000 });
    const b = await (await s.call({ limit: 50 })).json() as Record<string, unknown>;
    expect(b).toMatchObject({ deleted: 0, refused: [1] });
    expect(s.deleted).toEqual([]);
    expect(s.calls.some((c) => c.startsWith("done"))).toBe(false);
  });

  it("dry run: counts and sums the bytes, deletes nothing, records nothing", async () => {
    const s = setup(rows, { [FULL]: 5_000_000, [OLD]: 700_000, [R2048]: 400_000 });
    const res = await s.call({ dry_run: true, limit: 50 });
    const b = await res.json() as Record<string, unknown>;
    expect(res.status).toBe(200);
    expect(b).toMatchObject({ dry_run: true, checked: 4, would_delete: 2, bytes: 5_700_000, absent: 1, refused: [3], last_id: 4 });
    expect(s.deleted).toEqual([]);
    expect(s.calls.some((c) => c.startsWith("done"))).toBe(false);
  });

  it("run: deletes only allowed keys, records each (absent ones as 0 bytes), refuses a v2 copy", async () => {
    const s = setup(rows, { [FULL]: 5_000_000, [OLD]: 700_000, [R2048]: 400_000 });
    const b = await (await s.call({ limit: 50 })).json() as Record<string, unknown>;
    expect(b).toMatchObject({ dry_run: false, deleted: 2, bytes: 5_700_000, absent: 1, refused: [3] });
    expect(s.deleted).toEqual([FULL, OLD]);
    expect(s.calls.filter((c) => c.startsWith("done"))).toEqual([
      'done {"_id":1,"_bytes":5000000}', 'done {"_id":2,"_bytes":700000}', 'done {"_id":4,"_bytes":0}',
    ]);
  });

  it("passes kind and cursor to the claim, caps the batch at 50", async () => {
    const s = setup([], {});
    await s.call({ limit: 999, kind: "comp_full", after: 17 });
    expect(s.calls[0]).toBe('claim {"_limit":50,"_kind":"comp_full","_after":17}');
    await s.call({ kind: "nonsense" });
    expect(s.calls[1]).toBe('claim {"_limit":50,"_kind":null,"_after":0}');
  });
});
