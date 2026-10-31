// Types for seed-session.mjs (the tool itself is plain Node, no build step — it runs on the Owner's PC).
export declare const CONVERTER_EMAIL: string;
export declare class SeedRefused extends Error {}
export declare function seed(o: {
  supabaseUrl: string;
  serviceKey: string;
  email?: string;
  revokeOthers?: boolean;
  fetch?: typeof fetch;
}): Promise<{ refresh_token: string; user_id: string }>;
export declare function main(o?: {
  argv?: string[];
  env?: Record<string, string | undefined>;
  readStdin?: () => Promise<string>;
  stdout?: (s: string) => void;
  stderr?: (s: string) => void;
  stdoutIsTTY?: boolean;
  fetch?: typeof fetch;
}): Promise<number>;
