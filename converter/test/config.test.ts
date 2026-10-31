// @vitest-environment node
/**
 * The worker's configuration (deploy/converter.env): the lane's R2 host AND
 * video bucket are required whenever the worker talks to the lane (re-review
 * N4) — a presigned URL is only ever used when it names exactly that host and
 * a path under /<bucket>/upload/.
 */
import { describe, it, expect } from "vitest";
import { loadConfig } from "../src/config";

const HOST = "0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com";
const env = (over: Record<string, string | undefined> = {}): NodeJS.ProcessEnv => ({
  CONVERTER_API_BASE: "https://lane.example.org",
  CONVERTER_SUPABASE_URL: "https://project.supabase.co",
  CONVERTER_SUPABASE_ANON_KEY: "public-anon-key-placeholder",
  CONVERTER_R2_HOST: HOST,
  CONVERTER_R2_BUCKET: "50mm-staging-video",
  CONVERTER_LAUNCHER: "direct",
  ...over,
});

describe("converter · configuration", () => {
  it("a complete env loads; the bucket is kept", () => {
    expect(loadConfig(env())).toMatchObject({ r2Host: HOST, r2Bucket: "50mm-staging-video", launcher: "direct" });
  });

  it("re-review N4: CONVERTER_R2_BUCKET is required with the network config, and must be a bucket name", () => {
    expect(() => loadConfig(env({ CONVERTER_R2_BUCKET: undefined }))).toThrow(/CONVERTER_R2_BUCKET/);
    expect(() => loadConfig(env({ CONVERTER_R2_BUCKET: "" }))).toThrow(/CONVERTER_R2_BUCKET/);
    expect(() => loadConfig(env({ CONVERTER_R2_BUCKET: "a/b" }))).toThrow(/CONVERTER_R2_BUCKET/);
    expect(() => loadConfig(env({ CONVERTER_R2_BUCKET: "Upper-Case" }))).toThrow(/CONVERTER_R2_BUCKET/);
  });

  it("CONVERTER_R2_HOST is required and must be an R2 account host", () => {
    expect(() => loadConfig(env({ CONVERTER_R2_HOST: undefined }))).toThrow(/CONVERTER_R2_HOST/);
    expect(() => loadConfig(env({ CONVERTER_R2_HOST: "example.com" }))).toThrow(/CONVERTER_R2_HOST/);
  });

  it("the self-test alone (no network) needs neither", () => {
    expect(loadConfig({ CONVERTER_LAUNCHER: "direct" }, { requireNetwork: false })).toMatchObject({ r2Host: "", r2Bucket: "" });
  });

  it("S7 live lane: the env overrides route credentials, secrets, state, jobs and the sandbox units to the live lane", () => {
    const c = loadConfig(env({
      CONVERTER_R2_BUCKET: "50mm-video",
      CONVERTER_CREDENTIALS_FILE: "/var/lib/converter-live/secrets/credentials.json",
      CONVERTER_SECRETS_DIR: "/var/lib/converter-live/secrets",
      CONVERTER_STATE_FILE: "/var/lib/converter-live/state/claim.json",
      CONVERTER_JOBS_DIR: "/var/lib/converter-live/jobs",
      CONVERTER_UNIT_PREFIX: "converter-live-ff",
    }));
    expect(c).toMatchObject({
      r2Bucket: "50mm-video",
      credentialsFile: "/var/lib/converter-live/secrets/credentials.json",
      secretsDir: "/var/lib/converter-live/secrets",
      stateFile: "/var/lib/converter-live/state/claim.json",
      jobsRoot: "/var/lib/converter-live/jobs",
      unitPrefix: "converter-live-ff",
    });
    // and without overrides: the staging lane, exactly as before
    expect(loadConfig(env())).toMatchObject({
      credentialsFile: "/var/lib/converter/secrets/credentials.json", stateFile: "/var/lib/converter/state/claim.json",
      jobsRoot: "/var/lib/converter/jobs", secretsDir: "/var/lib/converter/secrets", unitPrefix: "converter-ff",
    });
  });

  it("S7: CONVERTER_UNIT_PREFIX names a lane's sandbox template only", () => {
    for (const bad of ["systemd-journald", "converter", "converter-live", "converter-ff@x", "converter-ff.service", "Converter-ff", "converter--ff", "../converter-ff"]) {
      expect(() => loadConfig(env({ CONVERTER_UNIT_PREFIX: bad }))).toThrow(/CONVERTER_UNIT_PREFIX/);
    }
  });

  it("there is no security-updates marker setting any more (owner ruling R-VM-1: the pinned build)", () => {
    expect(Object.keys(loadConfig(env()))).not.toContain("noUpdatesMarker");
  });
});
