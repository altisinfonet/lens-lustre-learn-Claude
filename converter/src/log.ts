/**
 * One JSON line per event on stdout (journald keeps it). Every string field
 * goes through scrub(): no presigned URL, token, JWT or password is ever
 * written — and the code never passes one in the first place.
 */
import { scrub } from "./failures";

export type Log = (event: string, fields?: Record<string, unknown>) => void;

export function jsonLogger(write: (line: string) => void = (l) => process.stdout.write(`${l}\n`)): Log {
  return (event, fields = {}) => {
    const clean: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(fields)) {
      clean[k] = typeof v === "string" ? scrub(v) : Array.isArray(v) ? v.map((x) => (typeof x === "string" ? scrub(x) : x)) : v;
    }
    write(JSON.stringify({ t: new Date().toISOString(), event, ...clean }));
  };
}
