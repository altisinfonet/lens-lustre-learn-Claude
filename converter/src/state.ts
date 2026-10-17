/**
 * The claim the worker holds right now, on disk (0600, design §6): a restart
 * ends it at once with `finish fail internal` (requeued while attempts remain)
 * instead of leaving the only converter stalled until the 30-min lease runs
 * out. The claim token is a secret of the job — never logged.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { UUID_RE } from "./launcher";

export interface SavedClaim { source_id: string; claim_token: string; claimed_at: string }

export class ClaimStateStore {
  constructor(private readonly file: string) {}

  async load(): Promise<SavedClaim | null> {
    let text: string;
    try {
      text = await fs.readFile(this.file, "utf8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
    try {
      const s = JSON.parse(text) as Partial<SavedClaim>;
      if (typeof s.source_id === "string" && UUID_RE.test(s.source_id) && typeof s.claim_token === "string" && UUID_RE.test(s.claim_token)) {
        return { source_id: s.source_id, claim_token: s.claim_token, claimed_at: String(s.claimed_at ?? "") };
      }
    } catch { /* unreadable: treated as none */ }
    await this.clear();
    return null;
  }

  /** Atomic: written to a temporary file (0600) and renamed over the old one. */
  async save(s: SavedClaim): Promise<void> {
    await fs.mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const tmp = `${this.file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(s), { mode: 0o600 });
    await fs.chmod(tmp, 0o600);
    await fs.rename(tmp, this.file);
  }

  async clear(): Promise<void> {
    await fs.rm(this.file, { force: true });
  }
}
