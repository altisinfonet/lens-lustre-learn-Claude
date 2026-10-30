/**
 * The worker's configuration, from its environment (deploy/converter.env —
 * nothing secret in it: the Supabase URL and anon key are public; the
 * converter's password lives only in the 0600 credentials file, its refresh
 * token only in the 0600 session file in the lane's state directory).
 */
import { X264_PRESETS, type X264Preset } from "./encode";

export interface Config {
  apiBase: string;
  supabaseUrl: string;
  anonKey: string;
  credentialsFile: string;
  /** the persisted Supabase session (refresh token, 0600) — in this lane's own state dir, hidden from the other lane and from FFmpeg */
  sessionFile: string;
  stateFile: string;
  jobsRoot: string;
  secretsDir: string;
  /** this lane's sandbox template: converter-ff (staging) or converter-live-ff (live) — polkit lets each worker start only its own */
  unitPrefix: string;
  launcher: "systemd" | "direct";
  ffmpeg: string;
  ffprobe: string;
  pollMs: number;
  pollMaxMs: number;
  heartbeatMs: number;
  preset: X264Preset;
  startupSelfTest: boolean;
  /** S7-f: drain POST /api/video/purge at most this often (ms); 0 = off. Default 1 h. */
  purgeEveryMs: number;
  /** this lane's R2 S3 endpoint host (<account>.r2.cloudflarestorage.com): the only host presigned URLs may name */
  r2Host: string;
  /** this lane's video bucket: presigned paths must start /<bucket>/upload/ (required with the network config — re-review N4) */
  r2Bucket: string;
}

const R2_HOST = /^[0-9a-f]{32}\.r2\.cloudflarestorage\.com$/;
const UNIT_PREFIX = /^converter(-[a-z]{1,16})?-ff$/;
const BUCKET = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;

function url(name: string, v: string | undefined, required: boolean): string {
  const s = String(v ?? "").trim().replace(/\/+$/, "");
  if (!s) {
    if (required) throw new Error(`${name} is not set`);
    return "";
  }
  let u: URL;
  try { u = new URL(s); } catch { throw new Error(`${name} is not a URL`); }
  if (u.protocol !== "https:" && !(u.protocol === "http:" && (u.hostname === "127.0.0.1" || u.hostname === "localhost"))) {
    throw new Error(`${name} must be https`);
  }
  if (u.search || u.hash || (u.pathname !== "/" && u.pathname !== "")) throw new Error(`${name} must be an origin only (no path or query)`);
  return `${u.protocol}//${u.host}`;
}

function int(name: string, v: string | undefined, def: number, min: number, max: number): number {
  if (v === undefined || v === "") return def;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${name} must be an integer ${min}..${max}`);
  return n;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, opts: { requireNetwork?: boolean } = {}): Config {
  const net = opts.requireNetwork !== false;
  const launcher = (env.CONVERTER_LAUNCHER ?? (process.platform === "linux" ? "systemd" : "direct")) as Config["launcher"];
  if (launcher !== "systemd" && launcher !== "direct") throw new Error("CONVERTER_LAUNCHER must be systemd or direct");
  const preset = (env.CONVERTER_X264_PRESET ?? "veryfast") as X264Preset;
  if (!X264_PRESETS.includes(preset)) throw new Error(`CONVERTER_X264_PRESET must be one of ${X264_PRESETS.join(", ")}`);
  const anonKey = String(env.CONVERTER_SUPABASE_ANON_KEY ?? "").trim();
  if (net && !anonKey) throw new Error("CONVERTER_SUPABASE_ANON_KEY is not set");
  const r2Host = String(env.CONVERTER_R2_HOST ?? "").trim().toLowerCase();
  if (net && !R2_HOST.test(r2Host)) throw new Error("CONVERTER_R2_HOST must be this lane's <account id>.r2.cloudflarestorage.com");
  const r2Bucket = String(env.CONVERTER_R2_BUCKET ?? "").trim();
  if ((net || r2Bucket) && !BUCKET.test(r2Bucket)) throw new Error("CONVERTER_R2_BUCKET must be this lane's video bucket (presigned paths must start /<bucket>/upload/)");
  const unitPrefix = env.CONVERTER_UNIT_PREFIX ?? "converter-ff";
  if (!UNIT_PREFIX.test(unitPrefix)) throw new Error("CONVERTER_UNIT_PREFIX must be this lane's sandbox template (converter-ff or converter-live-ff)");
  return {
    apiBase: url("CONVERTER_API_BASE", env.CONVERTER_API_BASE, net),
    supabaseUrl: url("CONVERTER_SUPABASE_URL", env.CONVERTER_SUPABASE_URL, net),
    anonKey,
    credentialsFile: env.CONVERTER_CREDENTIALS_FILE ?? "/var/lib/converter/secrets/credentials.json",
    sessionFile: env.CONVERTER_SESSION_FILE ?? "/var/lib/converter/state/session.json",
    stateFile: env.CONVERTER_STATE_FILE ?? "/var/lib/converter/state/claim.json",
    jobsRoot: env.CONVERTER_JOBS_DIR ?? "/var/lib/converter/jobs",
    secretsDir: env.CONVERTER_SECRETS_DIR ?? "/var/lib/converter/secrets",
    unitPrefix,
    launcher,
    ffmpeg: env.CONVERTER_FFMPEG ?? "ffmpeg",
    ffprobe: env.CONVERTER_FFPROBE ?? "ffprobe",
    pollMs: int("CONVERTER_POLL_MS", env.CONVERTER_POLL_MS, 10_000, 1000, 600_000),
    pollMaxMs: int("CONVERTER_POLL_MAX_MS", env.CONVERTER_POLL_MAX_MS, 60_000, 1000, 3_600_000),
    heartbeatMs: int("CONVERTER_HEARTBEAT_MS", env.CONVERTER_HEARTBEAT_MS, 120_000, 10_000, 600_000),
    preset,
    startupSelfTest: env.CONVERTER_STARTUP_SELFTEST !== "0",
    purgeEveryMs: env.CONVERTER_PURGE_EVERY_MS === "0" ? 0 : int("CONVERTER_PURGE_EVERY_MS (0 = off, else ms)", env.CONVERTER_PURGE_EVERY_MS, 3_600_000, 60_000, 86_400_000),
    r2Host,
    r2Bucket,
  };
}
