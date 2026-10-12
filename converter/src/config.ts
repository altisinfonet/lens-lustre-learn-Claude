/**
 * The worker's configuration, from its environment (deploy/converter.env —
 * nothing secret in it: the Supabase URL and anon key are public; the
 * converter's password lives only in the 0600 credentials file).
 */
import { X264_PRESETS, type X264Preset } from "./encode";

export interface Config {
  apiBase: string;
  supabaseUrl: string;
  anonKey: string;
  credentialsFile: string;
  stateFile: string;
  jobsRoot: string;
  secretsDir: string;
  launcher: "systemd" | "direct";
  ffmpeg: string;
  ffprobe: string;
  pollMs: number;
  pollMaxMs: number;
  heartbeatMs: number;
  preset: X264Preset;
  startupSelfTest: boolean;
}

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
  return {
    apiBase: url("CONVERTER_API_BASE", env.CONVERTER_API_BASE, net),
    supabaseUrl: url("CONVERTER_SUPABASE_URL", env.CONVERTER_SUPABASE_URL, net),
    anonKey,
    credentialsFile: env.CONVERTER_CREDENTIALS_FILE ?? "/var/lib/converter/secrets/credentials.json",
    stateFile: env.CONVERTER_STATE_FILE ?? "/var/lib/converter/state/claim.json",
    jobsRoot: env.CONVERTER_JOBS_DIR ?? "/var/lib/converter/jobs",
    secretsDir: env.CONVERTER_SECRETS_DIR ?? "/var/lib/converter/secrets",
    launcher,
    ffmpeg: env.CONVERTER_FFMPEG ?? "ffmpeg",
    ffprobe: env.CONVERTER_FFPROBE ?? "ffprobe",
    pollMs: int("CONVERTER_POLL_MS", env.CONVERTER_POLL_MS, 10_000, 1000, 600_000),
    pollMaxMs: int("CONVERTER_POLL_MAX_MS", env.CONVERTER_POLL_MAX_MS, 60_000, 1000, 3_600_000),
    heartbeatMs: int("CONVERTER_HEARTBEAT_MS", env.CONVERTER_HEARTBEAT_MS, 120_000, 10_000, 600_000),
    preset,
    startupSelfTest: env.CONVERTER_STARTUP_SELFTEST !== "0",
  };
}
