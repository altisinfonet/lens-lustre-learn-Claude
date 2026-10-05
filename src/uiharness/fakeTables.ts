/**
 * OFF-2 / OFF-6 leg 2 · a tiny PostgREST stand-in that ENFORCES UNIQUENESS.
 *
 * The harness fake backend answers reads from fixed rows; that is enough to
 * photograph a screen, and useless for "exactly once": a fake that accepts
 * every insert would count three sends as three rows no matter what the client
 * did, and a fake that dedupes by itself would hide a client that sends three
 * different keys. This one does what staging does after D1's 0008, no more:
 *
 *   post_reactions  UNIQUE (post_id, user_id)                 natural key
 *   post_comments   UNIQUE (user_id, idempotency_key)         0008, NULL keys never collide
 *   reports         UNIQUE (reporter_id, idempotency_key)     0008
 *
 * A conflicting insert answers 409 with code 23505 naming the constraint —
 * unless the request says `Prefer: resolution=ignore-duplicates` AND
 * `on_conflict=` names that constraint's columns, exactly as PostgREST's
 * ON CONFLICT DO NOTHING. Filters: `col=eq.value` only (all the outbox uses).
 *
 * FAULTS. `loseAnswers(n)`: the next n writes are COMMITTED and then the
 * answer is lost (the fetch throws, as a dropped link does) — the case where a
 * client cannot know whether its send landed, and so must resend safely.
 *
 * Imports nothing from the app: the harness installs it before the client.
 */
export interface TableRequest {
  method: string;
  table: string;
  params: URLSearchParams;
  headers: Headers;
  body: unknown;
}
export type TableReply = { status: number; body?: unknown };
type Row = Record<string, unknown>;

export const CONSTRAINTS: Record<string, { name: string; cols: string[] }[]> = {
  post_reactions: [{ name: "post_reactions_post_id_user_id_key", cols: ["post_id", "user_id"] }],
  post_comments: [{ name: "post_comments_user_idempotency_key", cols: ["user_id", "idempotency_key"] }],
  reports: [{ name: "reports_reporter_idempotency_key", cols: ["reporter_id", "idempotency_key"] }],
};

export class LostAnswer extends TypeError {
  constructor() { super("Failed to fetch"); }
}

export function createFakeTables() {
  const tables = new Map<string, Row[]>(Object.keys(CONSTRAINTS).map((t) => [t, []]));
  let lose = 0;
  let n = 0;
  const log: string[] = [];

  const match = (row: Row, params: URLSearchParams) => {
    for (const [k, v] of params) {
      if (["select", "on_conflict", "order", "limit", "offset", "columns"].includes(k)) continue;
      if (!v.startsWith("eq.")) continue;
      if (String(row[k]) !== v.slice(3)) return false;
    }
    return true;
  };

  function handle(req: TableRequest): TableReply {
    const rows = tables.get(req.table);
    if (!rows) return { status: 404, body: { code: "42P01", message: `relation "${req.table}" is not in the fake` } };
    const m = req.method.toUpperCase();
    if (m === "GET" || m === "HEAD") return { status: 200, body: rows.filter((r) => match(r, req.params)) };
    if (m === "DELETE") {
      const keep = rows.filter((r) => !match(r, req.params));
      tables.set(req.table, keep);
      log.push(`DELETE ${req.table} -${rows.length - keep.length}`);
      return { status: 204 };
    }
    if (m === "POST") {
      const prefer = req.headers.get("prefer") ?? "";
      const ignore = /resolution=ignore-duplicates/.test(prefer);
      const onConflict = (req.params.get("on_conflict") ?? "").split(",").filter(Boolean).sort().join(",");
      const incoming = (Array.isArray(req.body) ? req.body : [req.body]) as Row[];
      const inserted: Row[] = [];
      for (const r of incoming) {
        const hit = (CONSTRAINTS[req.table] ?? []).find((c) =>
          c.cols.every((col) => r[col] != null) && rows.some((x) => c.cols.every((col) => String(x[col]) === String(r[col]))));
        if (hit) {
          if (ignore && [...hit.cols].sort().join(",") === onConflict) { log.push(`POST ${req.table} ignored (${hit.name})`); continue; }
          log.push(`POST ${req.table} 23505 (${hit.name})`);
          return { status: 409, body: { code: "23505", message: `duplicate key value violates unique constraint "${hit.name}"`, details: null, hint: null } };
        }
        const row = { id: `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`, created_at: new Date(0).toISOString(), ...r };
        rows.push(row);
        inserted.push(row);
        log.push(`POST ${req.table} +1`);
      }
      return { status: 201, body: /return=representation/.test(prefer) ? inserted : undefined };
    }
    return { status: 405 };
  }

  /** A fetch for supabase-js (tests). Throws LostAnswer after committing when told to. */
  async function fetchImpl(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = (init?.method ?? "GET").toUpperCase();
    const table = url.pathname.replace(/^\/rest\/v1\//, "");
    let body: unknown;
    if (typeof init?.body === "string") body = JSON.parse(init.body);
    const reply = handle({ method, table, params: url.searchParams, headers: new Headers(init?.headers), body });
    if (method !== "GET" && lose > 0) { lose--; throw new LostAnswer(); }
    return toResponse(reply, new Headers(init?.headers));
  }

  return {
    tables,
    log,
    handle,
    fetch: fetchImpl,
    /** The next n writes commit, then their answer is lost. */
    loseAnswers(count: number) { lose = count; },
    get pendingLosses() { return lose; },
    consumeLoss() { if (lose > 0) { lose--; return true; } return false; },
    rows(table: string) { return tables.get(table) ?? []; },
  };
}
export type FakeTables = ReturnType<typeof createFakeTables>;

export function toResponse(reply: TableReply, reqHeaders?: Headers): Response {
  let body = reply.body;
  // supabase-js .single()/.maybeSingle() on a GET ask for one object.
  if (reqHeaders?.get("accept")?.includes("vnd.pgrst.object") && Array.isArray(body)) {
    if (body.length !== 1) {
      return new Response(JSON.stringify({ code: "PGRST116", message: `${body.length} rows` }), { status: 406, headers: { "content-type": "application/json" } });
    }
    body = body[0];
  }
  if (reply.status === 204 || body === undefined) return new Response(null, { status: reply.status === 201 ? 201 : reply.status });
  return new Response(JSON.stringify(body), { status: reply.status, headers: { "content-type": "application/json" } });
}
