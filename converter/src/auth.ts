/**
 * The converter's own Supabase session (CONVERTER-DESIGN.md v2 §3 step 4, §4
 * [R9]): the dedicated converter account, email + password from a 0600 file
 * the worker's user owns (provisioned by a separate, Owner-run step — the
 * worker never prints it). The session is kept in memory only and refreshed
 * before it expires; Supabase rotates the refresh token on every refresh
 * (with reuse detection, the theft alarm of §2), and a refused refresh falls
 * back to signing in again with the password.
 */
import { promises as fs } from "node:fs";

export interface Credentials { email: string; password: string }

export interface SessionOptions {
  supabaseUrl: string;
  anonKey: string;
  credentials: () => Promise<Credentials>;
  fetch?: typeof fetch;
  now?: () => number;
  /** refresh when fewer than this many ms are left (default 5 min) */
  refreshMarginMs?: number;
}

export class AuthError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "AuthError";
  }
}

/**
 * Read the credentials file. On POSIX it must be a regular file owned by this
 * process's user with no group/other permission bits (0600 or 0400) — a
 * looser file is refused rather than used.
 */
export async function readCredentialsFile(file: string): Promise<Credentials> {
  const st = await fs.lstat(file);
  if (!st.isFile()) throw new Error("the credentials path is not a regular file");
  if (process.platform !== "win32") {
    if ((st.mode & 0o077) !== 0) throw new Error(`the credentials file must be mode 0600 (it is ${(st.mode & 0o777).toString(8)})`);
    if (typeof process.getuid === "function" && st.uid !== process.getuid()) throw new Error("the credentials file is not owned by this user");
  }
  let parsed: Partial<Credentials>;
  try {
    parsed = JSON.parse(await fs.readFile(file, "utf8")) as Partial<Credentials>;
  } catch {
    throw new Error("the credentials file is not JSON"); // never echo its content
  }
  if (typeof parsed.email !== "string" || !parsed.email.includes("@") || typeof parsed.password !== "string" || parsed.password.length < 8) {
    throw new Error("the credentials file needs {\"email\", \"password\"}");
  }
  return { email: parsed.email, password: parsed.password };
}

interface TokenResponse { access_token?: string; refresh_token?: string; expires_in?: number; expires_at?: number }

export class Session {
  private access: string | null = null;
  private refresh: string | null = null;
  private expiresAt = 0;
  private inflight: Promise<string> | null = null;
  private readonly f: typeof fetch;
  private readonly now: () => number;

  constructor(private readonly o: SessionOptions) {
    this.f = o.fetch ?? fetch;
    this.now = o.now ?? Date.now;
  }

  /** A valid access token (signs in or refreshes as needed). Single-flight. */
  async token(): Promise<string> {
    if (this.access && this.expiresAt - this.now() > (this.o.refreshMarginMs ?? 300_000)) return this.access;
    if (!this.inflight) this.inflight = this.renew().finally(() => { this.inflight = null; });
    return this.inflight;
  }

  /** The API said 401: forget the access token (the refresh token is kept and tried first). */
  invalidate(): void {
    this.access = null;
    this.expiresAt = 0;
  }

  private async renew(): Promise<string> {
    if (this.refresh) {
      try {
        return await this.grant("refresh_token", { refresh_token: this.refresh });
      } catch (e) {
        // A refused refresh (revoked, reused, expired) → password sign-in. A network error is just thrown.
        if (!(e instanceof AuthError) || e.status >= 500) throw e;
        this.refresh = null;
      }
    }
    const c = await this.o.credentials();
    return this.grant("password", { email: c.email, password: c.password });
  }

  private async grant(type: "password" | "refresh_token", body: Record<string, string>): Promise<string> {
    const res = await this.f(`${this.o.supabaseUrl}/auth/v1/token?grant_type=${type}`, {
      method: "POST",
      headers: { apikey: this.o.anonKey, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    const text = await res.text();
    if (!res.ok) {
      // Only Supabase's short error code is kept — never the body (it could echo what was sent).
      let code = "";
      try {
        const b = JSON.parse(text) as { error_code?: string; error?: string };
        code = String(b.error_code ?? b.error ?? "").replace(/[^a-z_]/gi, "").slice(0, 60);
      } catch { /* not JSON */ }
      throw new AuthError(`sign-in (${type}) refused: HTTP ${res.status}${code ? ` ${code}` : ""}`, res.status);
    }
    let t: TokenResponse;
    try { t = JSON.parse(text) as TokenResponse; } catch { throw new AuthError(`sign-in (${type}) answered with something that is not JSON`, 502); }
    if (!t.access_token || !t.refresh_token) throw new AuthError(`sign-in (${type}) answered without a session`, 502);
    this.access = t.access_token;
    this.refresh = t.refresh_token;
    // expires_in is relative, so a VM clock that is off does not matter; expires_at only as a fallback.
    this.expiresAt = Number(t.expires_in) > 0 ? this.now() + Number(t.expires_in) * 1000
      : typeof t.expires_at === "number" ? t.expires_at * 1000 : this.now() + 3_600_000;
    return this.access;
  }
}
