import { describe, expect, it } from "vitest";
import { holdKeyFor, isHoldKey } from "../photoHold";
import { handleHold } from "../../../../functions/api/media/hold";

const O = "11111111-1111-4111-8111-111111111111";
const P = "22222222-2222-4222-8222-222222222222";
const CREDIT = `post-images/${O}/posts/credit/${P}-0-0123456789ab.webp`;
const L4 = `post-images/${O}/posts/1793-aa-w2170h1479-l3-w2048h1396-l4.webp`;
const L4_320 = L4.replace("-l4.webp", "-l4-r320.webp");

describe("photo hold — which keys may ever be moved", () => {
  it("only an old credit copy, a never-shown -l4 master or its 320", () => {
    for (const k of [CREDIT, L4, L4_320, `post-images/${O}/1762-abc-w1600h1066-l4.webp`]) expect(isHoldKey(k), k).toBe(true);
  });

  it("never a served copy, a main photo, a rung, a new set, another folder", () => {
    for (const k of [
      L4.replace("-l4.webp", "-l4-r1080.webp"),
      L4.replace("-l4.webp", "-l4-thumb.webp"),
      `post-images/${O}/posts/1793-aa-w2170h1479-l3.webp`,
      `post-images/${O}/posts/1793-aa-w2170h1479-l3-r1440.webp`,
      `post-images/${O}/posts/1793-aa-w2170h1479-l3-thumb.webp`,
      `post-images/${O}/posts/x-w2048h1365-l6.webp`,
      `post-images/${O}/posts/x-w1080h720-l5-r2048c.webp`,
      `post-images/${O}/posts/x-w2048h1365-l4f.webp`,
      `post-images/${O}/old-photo.webp`,
      `avatars/${O}/posts/credit/${P}-0-0123456789ab.webp`,
      `competition-photos/${O}/competitions/a-w6000h4000-l4f.webp`,
      `post-images/${O}/posts/credit/../x-w10h10-l4.webp`,
      `post-images/${O}/posts/credit/${P}-0-0123456789ab.jpg`,
    ]) expect(isHoldKey(k), k).toBe(false);
  });

  it("the holding key is the same key under photo-holding/", () => {
    expect(holdKeyFor(CREDIT)).toBe(`photo-holding/${CREDIT}`);
  });
});

type Store = Map<string, number>;
function bucket(store: Store, log: string[], name: string) {
  return {
    head: async (k: string) => (store.has(k) ? { size: store.get(k)! } : null),
    get: async (k: string) => (store.has(k) ? { size: store.get(k)!, arrayBuffer: async () => new ArrayBuffer(store.get(k)!) } : null),
    put: async (k: string, v: ArrayBuffer) => { log.push(`${name} put ${k}`); store.set(k, v.byteLength); },
    delete: async (k: string) => { log.push(`${name} delete ${k}`); store.delete(k); },
    list: async () => ({ objects: [], truncated: false }),
  };
}

function setup(rows: Array<{ id: number; object_key: string }>, pub: Record<string, number>, priv: Record<string, number> = {}) {
  const calls: string[] = [];
  const log: string[] = [];
  const PH: Store = new Map(Object.entries(pub));
  const MD: Store = new Map(Object.entries(priv));
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.endsWith("/auth/v1/user")) return new Response(JSON.stringify({ id: O }), { status: 200 });
    if (u.endsWith("/rpc/photo_extra_claim")) { calls.push(`claim ${String(init?.body)}`); return new Response(JSON.stringify(rows), { status: 200 }); }
    if (u.endsWith("/rpc/photo_extra_record")) { calls.push(`record ${String(init?.body)}`); return new Response("1", { status: 200 }); }
    return new Response("{}", { status: 404 });
  }) as unknown as typeof fetch;
  const env = { SUPABASE_PROJECT_REF: "abcdefghijklmnopqrst", SUPABASE_ANON_KEY: "anon", PHOTOS: bucket(PH, log, "PHOTOS"), MEDIA: bucket(MD, log, "MEDIA") };
  const call = (body: unknown) => handleHold(new Request("https://site.example/api/media/hold", {
    method: "POST", headers: { authorization: "Bearer jwt", "content-type": "application/json" }, body: JSON.stringify(body),
  }), env as never, fetchImpl);
  return { calls, log, PH, MD, call };
}

describe("photo hold route", () => {
  const rows = [
    { id: 1, object_key: CREDIT },
    { id: 2, object_key: L4 },
    { id: 3, object_key: L4.replace("-l4.webp", "-l4-r1080.webp") }, // served by 0112: refused
    { id: 4, object_key: L4_320 },                                    // never stored: absent
  ];

  it("refuses without an op", async () => {
    const s = setup(rows, {});
    expect((await s.call({})).status).toBe(400);
    expect(s.calls).toEqual([]);
  });

  it("dry run: counts and sums, writes, moves and records nothing", async () => {
    const s = setup(rows, { [CREDIT]: 300, [L4]: 900, [rows[2].object_key]: 100 });
    const b = await (await s.call({ op: "move", dry_run: true })).json() as Record<string, unknown>;
    expect(b).toMatchObject({ op: "move", dry_run: true, checked: 4, would_move: 2, bytes: 1200, absent: 1, refused: [3], last_id: 4 });
    expect(s.log).toEqual([]);
    expect(s.calls.some((c) => c.startsWith("record"))).toBe(false);
  });

  it("move: copies to holding and reads it back BEFORE the public file goes; one record call", async () => {
    const s = setup(rows, { [CREDIT]: 300, [L4]: 900, [rows[2].object_key]: 100 });
    const b = await (await s.call({ op: "move" })).json() as Record<string, unknown>;
    expect(b).toMatchObject({ moved: 2, bytes: 1200, absent: 1, refused: [3] });
    expect(s.log).toEqual([
      `MEDIA put photo-holding/${CREDIT}`, `PHOTOS delete ${CREDIT}`,
      `MEDIA put photo-holding/${L4}`, `PHOTOS delete ${L4}`,
    ]);
    expect(s.PH.has(rows[2].object_key)).toBe(true);
    expect(s.MD.get(`photo-holding/${L4}`)).toBe(900);
    expect(s.calls.filter((c) => c.startsWith("record"))).toEqual([
      'record {"_op":"move","_rows":[{"id":1,"bytes":300},{"id":2,"bytes":900},{"id":4,"bytes":0}]}',
    ]);
  });

  it("move retry after a crash: already in holding with the same size → only the public copy goes", async () => {
    const s = setup([rows[0]], { [CREDIT]: 300 }, { [`photo-holding/${CREDIT}`]: 300 });
    await s.call({ op: "move" });
    expect(s.log).toEqual([`PHOTOS delete ${CREDIT}`]);
  });

  it("a different file already in holding: touch nothing", async () => {
    const s = setup([rows[0]], { [CREDIT]: 300 }, { [`photo-holding/${CREDIT}`]: 5 });
    const b = await (await s.call({ op: "move" })).json() as Record<string, unknown>;
    expect(b).toMatchObject({ moved: 0, refused: [1] });
    expect(s.log).toEqual([]);
    expect(s.calls.some((c) => c.startsWith("record"))).toBe(false);
  });

  it("restore: back to the public bucket, read back, then out of holding", async () => {
    const s = setup([rows[0]], {}, { [`photo-holding/${CREDIT}`]: 300 });
    const b = await (await s.call({ op: "restore" })).json() as Record<string, unknown>;
    expect(b).toMatchObject({ op: "restore", moved: 1, bytes: 300 });
    expect(s.log).toEqual([`PHOTOS put ${CREDIT}`, `MEDIA delete photo-holding/${CREDIT}`]);
    expect(s.calls.filter((c) => c.startsWith("record"))).toEqual(['record {"_op":"restore","_rows":[{"id":1,"bytes":300}]}']);
  });

  it("restore with the file in neither bucket is refused, never recorded as restored", async () => {
    const s = setup([rows[0]], {}, {});
    const b = await (await s.call({ op: "restore" })).json() as Record<string, unknown>;
    expect(b).toMatchObject({ moved: 0, refused: [1] });
    expect(s.calls.some((c) => c.startsWith("record"))).toBe(false);
  });

  it("passes op and cursor to the claim, caps the batch at 50", async () => {
    const s = setup([], {});
    await s.call({ op: "move", limit: 999, after: 17 });
    expect(s.calls[0]).toBe('claim {"_op":"move","_limit":50,"_after":17}');
  });
});
