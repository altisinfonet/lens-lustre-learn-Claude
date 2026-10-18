/**
 * The converter's own Supabase session (CONVERTER-DESIGN.md v2 §3 step 4, §4
 * [R9]): the dedicated converter account, email + password from a 0600 file
 * the worker's user owns (provisioned by a separate, Owner-run step — the
 * worker never prints it).
 *
 * The refresh token is kept in memory AND in this lane's session file
 * (CONVERTER_SESSION_FILE, in the worker's own 0700 state directory, 0600):
 *
 *   • at start the saved refresh token is tried first (grant_type=refresh_token,
 *     which Supabase Auth never CAPTCHA-gates), so a lane whose project enforces
 *     CAPTCHA on password sign-in (live) still signs in after a restart;
 *   • Supabase rotates the refresh token on every grant. The new one is written
 *     to the file (temp file + fsync + rename) BEFORE the access token is handed
 *     out, so a crash can leave the file at most ONE rotation behind — the case
 *     Supabase allows on purpose ("the client was not able to store the result"):
 *     the parent of the active token gets the active one back. If the write
 *     fails, nothing is handed out and no further grant is made until it is on
 *     disk (two behind would be refused as reuse and end the session);
 *   • a refused refresh (revoked, expired, reused — the theft alarm of §2) falls
 *     back to the password. If THAT answers CAPTCHA (live), no person is there
 *     to solve it: `onReseedRequired` (the worker logs `auth.reseed_required`),
 *     and no further network sign-in for 1, 2, 4 … min (at most 1 h) — unless a
 *     NEW refresh token appears in the session file (the Owner's seed step),
 *     which is tried at once. Staging (no CAPTCHA) signs in with the password
 *     exactly as before; the file only saves it a password grant per restart.
 *
 * No token is ever logged or put in an error message (only Supabase's short
 * error code is kept).
 */
import { promises as fs } from "node:fs";
import path from "node:path";

export interface Credentials { email: string; password: string }

export interface ReseedInfo {
  status: number;
  /** Supabase's short error code (e.g. captcha_failed) */
  code: string;
  /** network sign-ins in a row that needed a person */
  attempt: number;
  /** no further network sign-in before this many ms (unless a new token is seeded) */
  retryInMs: number;
}

export interface SessionOptions {
  supabaseUrl: string;
  anonKey: string;
  credentials: () => Promise<Credentials>;
  /** this lane's session file (0600, its own state dir); absent → memory only (as before) */
  sessionFile?: string;
  fetch?: typeof fetch;
  now?: () => number;
  /** refresh when fewer than this many ms are left (default 5 min) */
  refreshMarginMs?: number;
  /** told when Supabase refuses the refresh token (revoked, expired — or REUSED: possible theft) before the password sign-in */
  onRefreshRefused?: (status: number, message: string) => void;
  /** told when the password sign-in answered CAPTCHA: a person must seed a session (converter/tools/seed-session.mjs) */
  onReseedRequired?: (info: ReseedInfo) => void;
  /** told when the session file could not be read or written (never with its content) */
  onSessionFileProblem?: (message: string) => void;
  /** the first wait after a CAPTCHA answer (default 60 s) and its ceiling (default 1 h) */
  reseedBackoffMs?: number;
  reseedBackoffMaxMs?: number;
}

export class AuthError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    /** Supabase's short error code, letters and _ only */
    public readonly code = "",
    /** the answer said CAPTCHA (captcha_failed, or a 400 whose body names it) */
    public readonly captcha = false,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

/**
 * No sign-in is possible without a person: the refresh token is gone and the
 * project wants a CAPTCHA for the password. `attempted` is false when this was
 * answered from the back-off alone (no network call was made).
 */
export class ReseedRequired extends AuthError {
  constructor(message: string, status: number, code: string, public readonly retryInMs: number, public readonly attempted: boolean) {
    super(message, status, code, true);
    this.name = "ReseedRequired";
  }
}

/** The rotated refresh token could not be written to the session file: nothing is handed out until it is. */
export class SessionPersistError extends AuthError {
  constructor(message: string) {
    super(message, 503, "session_file");
    this.name = "SessionPersistError";
  }
}

/** 60 s, 2, 4, 8 … min for the 1st, 2nd, 3rd … CAPTCHA answer in a row; at most `max`. */
export function reseedBackoff(attempt: number, base = 60_000, max = 3_600_000): number {
  if (attempt <= 0) return 0;
  return Math.min(max, base * 2 ** Math.min(attempt - 1, 20));
}

/** A refresh token as Supabase issues them (legacy 12-char, or the longer encoded form). */
export const REFRESH_TOKEN_RE = /^[A-Za-z0-9_.-]{12,1024}$/;

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

/**
 * The session file: {"refresh_token": "…", "saved_at": "…"} — or, once that
 * token was refused, {"refused_at": "…"} (so a restart goes straight to the
 * password instead of presenting a dead token again).
 */
export class SessionFile {
  constructor(private readonly file: string) {}

  get path(): string { return this.file; }

  /**
   * The saved refresh token, or null (no file, no token in it). A file that is
   * not this user's 0600 regular file, or not JSON, is refused (thrown) — never
   * echoed.
   */
  async load(): Promise<string | null> {
    let st;
    try {
      st = await fs.lstat(this.file);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw new Error(`the session file cannot be read (${(e as NodeJS.ErrnoException).code ?? "error"})`);
    }
    if (!st.isFile()) throw new Error("the session file is not a regular file");
    if (process.platform !== "win32") {
      if ((st.mode & 0o077) !== 0) throw new Error(`the session file must be mode 0600 (it is ${(st.mode & 0o777).toString(8)})`);
      if (typeof process.getuid === "function" && st.uid !== process.getuid()) throw new Error("the session file is not owned by this user");
    }
    let parsed: { refresh_token?: unknown };
    try {
      parsed = JSON.parse(await fs.readFile(this.file, "utf8")) as { refresh_token?: unknown };
    } catch {
      throw new Error("the session file is not JSON");
    }
    if (parsed.refresh_token === undefined || parsed.refresh_token === null) return null;
    if (typeof parsed.refresh_token !== "string" || !REFRESH_TOKEN_RE.test(parsed.refresh_token)) throw new Error("the session file's refresh_token is not a refresh token");
    return parsed.refresh_token;
  }

  /** Atomic and durable: a 0600 temp file in the same directory, fsync, rename over the old one, fsync the directory. */
  async save(content: { refresh_token: string } | { refused: true }): Promise<void> {
    const body = "refresh_token" in content
      ? { refresh_token: content.refresh_token, saved_at: new Date().toISOString() }
      : { refused_at: new Date().toISOString() };
    const dir = path.dirname(this.file);
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    const tmp = `${this.file}.${process.pid}.tmp`;
    let h: Awaited<ReturnType<typeof fs.open>> | null = null;
    try {
      h = await fs.open(tmp, "w", 0o600);
      await h.chmod(0o600);
      await h.writeFile(JSON.stringify(body), "utf8");
      await h.sync();
      await h.close();
      h = null;
      await fs.rename(tmp, this.file);
    } catch (e) {
      await h?.close().catch(() => undefined);
      await fs.rm(tmp, { force: true }).catch(() => undefined);
      throw e;
    }
    if (process.platform !== "win32") {
      // the rename itself is durable only once the directory is
      const d = await fs.open(dir, "r");
      try { await d.sync(); } finally { await d.close(); }
    }
  }
}

interface TokenResponse { access_token?: string; refresh_token?: string; expires_in?: number; expires_at?: number }

export class Session {
  private access: string | null = null;
  private refresh: string | null = null;
  private expiresAt = 0;
  /** the newest refresh token is in memory only: hand nothing out, grant nothing, until it is on disk */
  private unsaved = false;
  /** the last refresh token Supabase refused: never presented again, from memory or from the file */
  private refused: string | null = null;
  private reseedAttempt = 0;
  private reseedUntil = 0;
  private reseedCode = "";
  private inflight: Promise<string> | null = null;
  private readonly f: typeof fetch;
  private readonly now: () => number;
  private readonly file: SessionFile | null;

  constructor(private readonly o: SessionOptions) {
    this.f = o.fetch ?? fetch;
    this.now = o.now ?? Date.now;
    this.file = o.sessionFile ? new SessionFile(o.sessionFile) : null;
  }

  /** A valid access token (signs in or refreshes as needed). Single-flight. */
  async token(): Promise<string> {
    if (this.access && !this.unsaved && this.fresh()) return this.access;
    if (!this.inflight) this.inflight = this.renew().finally(() => { this.inflight = null; });
    return this.inflight;
  }

  /** The API said 401: forget the access token (the refresh token is kept and tried first). */
  invalidate(): void {
    this.access = null;
    this.expiresAt = 0;
  }

  private fresh(): boolean {
    return this.expiresAt - this.now() > (this.o.refreshMarginMs ?? 300_000);
  }

  private async persist(token: string): Promise<void> {
    if (!this.file) { this.unsaved = false; return; }
    try {
      await this.file.save({ refresh_token: token });
      this.unsaved = false;
    } catch (e) {
      const why = `the rotated refresh token could not be written to the session file (${(e as NodeJS.ErrnoException).code ?? "error"}); nothing is used until it is`;
      this.o.onSessionFileProblem?.(why);
      throw new SessionPersistError(why);
    }
  }

  /** The refresh token in the file, when it is one we may present (not the one refused). */
  private async fromFile(): Promise<string | null> {
    if (!this.file) return null;
    try {
      const t = await this.file.load();
      return t && t !== this.refused ? t : null;
    } catch (e) {
      this.o.onSessionFileProblem?.((e as Error).message);
      return null;
    }
  }

  private async renew(): Promise<string> {
    // 0. A rotated token not yet on disk goes there first (and only then is its access token used).
    if (this.unsaved && this.refresh) {
      await this.persist(this.refresh);
      if (this.access && this.fresh()) return this.access;
    }
    // 1. The file wins over memory when it holds another token: every rotation is written at once,
    //    so a different one was put there since (the Owner's seed step, or another process of this lane).
    const saved = await this.fromFile();
    const seeded = saved !== null && saved !== this.refresh;
    if (seeded) this.refresh = saved;

    // 2. Waiting for a person (CAPTCHA): no network sign-in until the back-off ends — or a new token is seeded.
    const now = this.now();
    if (this.reseedUntil > now && !seeded) {
      throw new ReseedRequired(
        `sign-in needs a seeded session (the password sign-in answered CAPTCHA); next try in ${Math.ceil((this.reseedUntil - now) / 1000)} s`,
        400, this.reseedCode, this.reseedUntil - now, false,
      );
    }

    if (this.refresh) {
      try {
        return await this.grant("refresh_token", { refresh_token: this.refresh });
      } catch (e) {
        // A refused refresh (revoked, reused, expired) → password sign-in. A network error is just thrown.
        // A server error, a rate limit (429) or a timeout (408) is transient: try again later, keep the
        // refresh token, and do not call it theft (re-review N6g). A failed file write is not a refusal.
        if (!(e instanceof AuthError) || e instanceof SessionPersistError || e.status >= 500 || e.status === 429 || e.status === 408) throw e;
        this.o.onRefreshRefused?.(e.status, e.message);
        this.refused = this.refresh;
        this.refresh = null;
        // Forget it on disk too, so a restart does not present it again.
        if (this.file) {
          await this.file.save({ refused: true }).catch((x: NodeJS.ErrnoException) =>
            this.o.onSessionFileProblem?.(`the refused token could not be cleared from the session file (${x.code ?? "error"})`));
        }
      }
    }
    const c = await this.o.credentials();
    try {
      return await this.grant("password", { email: c.email, password: c.password });
    } catch (e) {
      if (!(e instanceof AuthError) || !e.captcha) throw e;
      this.reseedAttempt++;
      const wait = reseedBackoff(this.reseedAttempt, this.o.reseedBackoffMs ?? 60_000, this.o.reseedBackoffMaxMs ?? 3_600_000);
      this.reseedUntil = this.now() + wait;
      this.reseedCode = e.code;
      this.o.onReseedRequired?.({ status: e.status, code: e.code, attempt: this.reseedAttempt, retryInMs: wait });
      throw new ReseedRequired(`${e.message} — sign-in needs a seeded session; next try in ${Math.ceil(wait / 1000)} s`, e.status, e.code, wait, true);
    }
  }

  private async grant(type: "password" | "refresh_token", body: Record<string, string>): Promise<string> {
    const res = await this.f(`${this.o.supabaseUrl}/auth/v1/token?grant_type=${type}`, {
      method: "POST",
      headers: { apikey: this.o.anonKey, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
      redirect: "error",
    });
    const text = await res.text();
    if (!res.ok) {
      // Only Supabase's short error code is kept — never the body (it could echo what was sent).
      let code = "";
      try {
        const b = JSON.parse(text) as { error_code?: string; error?: string };
        code = String(b.error_code ?? b.error ?? "").replace(/[^a-z_]/gi, "").slice(0, 60);
      } catch { /* not JSON */ }
      const captcha = /captcha/i.test(code) || (res.status === 400 && /captcha/i.test(text));
      throw new AuthError(`sign-in (${type}) refused: HTTP ${res.status}${code ? ` ${code}` : ""}`, res.status, code, captcha);
    }
    let t: TokenResponse;
    try { t = JSON.parse(text) as TokenResponse; } catch { throw new AuthError(`sign-in (${type}) answered with something that is not JSON`, 502); }
    if (!t.access_token || !t.refresh_token) throw new AuthError(`sign-in (${type}) answered without a session`, 502);
    // The rotated refresh token is the only valid one now: memory first (never lost while we run),
    // then the file — and the access token is not handed out until that write is durable.
    this.refresh = t.refresh_token;
    this.unsaved = true;
    this.access = t.access_token;
    // expires_in is relative, so a VM clock that is off does not matter; expires_at only as a fallback.
    this.expiresAt = Number(t.expires_in) > 0 ? this.now() + Number(t.expires_in) * 1000
      : typeof t.expires_at === "number" ? t.expires_at * 1000 : this.now() + 3_600_000;
    this.reseedAttempt = 0;
    this.reseedUntil = 0;
    await this.persist(t.refresh_token);
    return this.access;
  }
}
