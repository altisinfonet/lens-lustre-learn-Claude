/**
 * Everything the VM says to the outside world, with its converter JWT:
 *   Pages:     POST /api/video/convert/claim · /convert/finish · /upload-urls · /complete
 *   PostgREST: rpc video_source_heartbeat · video_converter_begin_version
 * (functions/api/video/*, supabase/migrations/20261012_0002). No R2 key, no
 * service role, no attestation key is ever on the VM (design §2.1).
 */
import { Session } from "./auth";

export interface ClaimedJob {
  source_id: string;
  owner_id: string;
  purpose: "post" | "ad";
  source_bytes: number;
  source_etag: string;
  claim_token: string;
  lease_until: string;
  attempt: number;
}

export interface ClaimedSource {
  url: string;
  headers: Record<string, string>;
  bytes: number;
  expires_in: number;
}

export interface Claim { job: ClaimedJob; source: ClaimedSource }

/** An HTTP answer that was not a success. `code` is the server's VID-… code when it gave one. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly body: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "ApiError";
  }
  /** Worth trying again: no answer, a server error, throttling. */
  get transient(): boolean {
    return this.status === 0 || this.status >= 500 || this.status === 408 || this.status === 429;
  }
}

export interface ApiOptions {
  apiBase: string;
  supabaseUrl: string;
  anonKey: string;
  session: Session;
  fetch?: typeof fetch;
  requestTimeoutMs?: number;
}

export interface Answer { status: number; body: Record<string, unknown> }

export class Api {
  private readonly f: typeof fetch;
  constructor(private readonly o: ApiOptions) {
    this.f = o.fetch ?? fetch;
  }

  private async send(url: string, init: { body: unknown; headers?: Record<string, string> }, retried = false): Promise<Answer> {
    const jwt = await this.o.session.token();
    let res: Response;
    try {
      res = await this.f(url, {
        method: "POST",
        headers: { authorization: `Bearer ${jwt}`, "content-type": "application/json", accept: "application/json", ...(init.headers ?? {}) },
        body: JSON.stringify(init.body),
        signal: AbortSignal.timeout(this.o.requestTimeoutMs ?? 90_000),
      });
    } catch (e) {
      throw new ApiError(0, "NETWORK", `${new URL(url).pathname}: ${(e as Error)?.message ?? String(e)}`);
    }
    const text = await res.text();
    let body: unknown = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = { message: text.slice(0, 200) }; }
    if (res.status === 401 && !retried) {
      this.o.session.invalidate();
      return this.send(url, init, true);
    }
    const obj = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : { value: body };
    return { status: res.status, body: obj };
  }

  /** POST to a Pages endpoint; the raw answer (callers decide what 202/409 mean). */
  async pages(path: string, body: unknown): Promise<Answer> {
    return this.send(`${this.o.apiBase}${path}`, { body });
  }

  private static fail(path: string, a: Answer): ApiError {
    const code = String(a.body.error ?? a.body.code ?? "");
    const message = String(a.body.message ?? `HTTP ${a.status}`);
    return new ApiError(a.status, code, `${path} ${a.status}${code ? ` ${code}` : ""}: ${message.slice(0, 300)}`, a.body);
  }

  /** The next job, or null when the queue is empty. */
  async claim(): Promise<Claim | null> {
    const a = await this.pages("/api/video/convert/claim", {});
    if (a.status !== 200) throw Api.fail("/convert/claim", a);
    if (!a.body.job) return null;
    const job = a.body.job as ClaimedJob;
    const source = a.body.source as ClaimedSource;
    if (!job.source_id || !job.claim_token || !source?.url) throw new ApiError(502, "VID-CONV-BAD", "/convert/claim answered without a job or source");
    return { job: { ...job, source_bytes: Number(job.source_bytes), attempt: Number(job.attempt) }, source: { ...source, bytes: Number(source.bytes) } };
  }

  /** End the job: done, or fail with a fixed code. Returns the source's status ("done" | "failed" | "queued"). */
  async finish(sourceId: string, claimToken: string, outcome: { done: true } | { code: string; detail: string }): Promise<string> {
    const body = "done" in outcome
      ? { source_id: sourceId, claim_token: claimToken, outcome: "done" }
      : { source_id: sourceId, claim_token: claimToken, outcome: "fail", code: outcome.code, detail: outcome.detail.slice(0, 250) };
    const a = await this.pages("/api/video/convert/finish", body);
    if (a.status !== 200) throw Api.fail("/convert/finish", a);
    return String(a.body.status ?? "");
  }

  /** PostgREST rpc as the converter. */
  async rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
    const a = await this.send(`${this.o.supabaseUrl}/rest/v1/rpc/${fn}`, { body: args, headers: { apikey: this.o.anonKey } });
    if (a.status < 200 || a.status >= 300) {
      const message = String(a.body.message ?? `HTTP ${a.status}`);
      const code = /\b(VID-[A-Z0-9]+-\d{3})\b/.exec(message)?.[1] ?? String(a.body.code ?? "");
      throw new ApiError(a.status, code, `rpc ${fn} ${a.status}: ${message.slice(0, 300)}`, a.body);
    }
    return ("value" in a.body && Object.keys(a.body).length === 1 ? a.body.value : a.body) as T;
  }

  /** Extend the lease while working. Returns the new lease end (ms). */
  async heartbeat(sourceId: string, claimToken: string): Promise<number> {
    const lease = await this.rpc<string>("video_source_heartbeat", { _source_id: sourceId, _claim_token: claimToken });
    const ms = Date.parse(String(lease));
    if (!Number.isFinite(ms)) throw new ApiError(502, "VID-CONV-BAD", "heartbeat answered without a lease");
    return ms;
  }
}
