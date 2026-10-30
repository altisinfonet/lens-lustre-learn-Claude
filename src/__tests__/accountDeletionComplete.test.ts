/**
 * FOUNDATION FIX U2 — ACCOUNT DELETION IS ALL-OR-NOTHING AND REMOVES FILES.
 *
 * Gaps measured in the foundation audit (#622, area 9) on
 * supabase/functions/delete-my-account/index.ts:
 *   G1 the login (auth user) was deleted FIRST — any later failure left a
 *      half-deleted member who could no longer sign in to retry;
 *   G2 ~40 table deletes ran in Promise.all and their errors were never read —
 *      the function answered success:true over a partial delete;
 *   G3 no stored photo/video file was removed.
 * The source tests below FAIL on that file; the behaviour tests pin the new
 * module (supabase/functions/_shared/accountDeletion.ts).
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { deleteMemberAccount, type DeletionDeps, type QueuedFile } from "../../supabase/functions/_shared/accountDeletion";
import { extractPath } from "../../supabase/functions/_shared/referenceSet";

const src = readFileSync(join(__dirname, "../../supabase/functions/delete-my-account/index.ts"), "utf8");

describe("delete-my-account source (fails on the pre-fix file)", () => {
  it("G1: never deletes the login before the data — no separate admin_delete_auth_user call", () => {
    expect(src).not.toMatch(/rpc\(\s*["']admin_delete_auth_user["']/);
    expect(src).toMatch(/deleteMemberAccount\(/);
  });
  it("G2: runs no per-table deletes whose errors could be ignored", () => {
    expect(src).not.toMatch(/\.delete\(\)/);
    expect(src).not.toMatch(/Promise\.all\(/);
  });
  it("G3: removes stored files from Supabase Storage and the S3/CDN store", () => {
    expect(src).toMatch(/\.remove\(/);
    expect(src).toMatch(/deleteS3Objects\(/);
  });
});

function fakeDeps(over: Partial<DeletionDeps> & { files?: QueuedFile[]; rpcError?: string } = {}) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const removed: [string, string[]][] = [];
  const s3: string[][] = [];
  const deps: DeletionDeps = {
    rpc: async <T,>(fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      if (fn === "delete_member_account") {
        if (over.rpcError) return { data: null, error: { message: over.rpcError } };
        return { data: { deleted: true, files: over.files ?? [] } as T, error: null };
      }
      return { data: 0 as T, error: null };
    },
    removeFromStorage: over.removeFromStorage ?? (async (b, p) => { removed.push([b, p]); return { error: null }; }),
    deleteFromS3: over.deleteFromS3 === undefined ? async (p) => { s3.push(p); } : over.deleteFromS3,
    extractPath,
  };
  return { deps, calls, removed, s3 };
}

const CDN = "https://cdn.example.test";
const files: QueuedFile[] = [
  { id: 1, ref: `${CDN}/post-images/u1/media/m1/original.webp` },
  { id: 2, ref: "https://x.supabase.co/storage/v1/object/public/avatars/u1/a.jpg?t=1" },
  { id: 3, ref: "https://elsewhere.example.org/not-ours.jpg" },
];

describe("deleteMemberAccount behaviour", () => {
  it("a database failure deletes nothing, touches no file and asks the member to retry", async () => {
    const f = fakeDeps({ rpcError: "deadlock detected", files });
    const r = await deleteMemberAccount("u1", f.deps);
    expect(r).toMatchObject({ ok: false, status: 500, retry: true });
    expect(f.removed).toEqual([]);
    expect(f.s3).toEqual([]);
  });

  it("removes each queued file from storage and S3, and records them done", async () => {
    const f = fakeDeps({ files });
    const r = await deleteMemberAccount("u1", f.deps);
    expect(r).toEqual({ ok: true, filesDeleted: 3, filesPending: 0 });
    expect(f.removed).toEqual([["post-images", ["u1/media/m1/original.webp"]], ["avatars", ["u1/a.jpg"]]]);
    expect(f.s3.flat()).toEqual(["post-images/u1/media/m1/original.webp", "avatars/u1/a.jpg"]);
    const mark = f.calls.find((c) => c.fn === "member_file_purge_mark")!;
    expect(mark.args._done).toEqual([3, 1, 2]);
    expect(mark.args._failed).toEqual([]);
  });

  it("a storage failure keeps the file queued and is reported as pending, not success", async () => {
    const f = fakeDeps({ files, removeFromStorage: async (b) => ({ error: b === "avatars" ? { message: "503" } : null }) });
    const r = await deleteMemberAccount("u1", f.deps);
    expect(r).toEqual({ ok: true, filesDeleted: 2, filesPending: 1 });
    const mark = f.calls.find((c) => c.fn === "member_file_purge_mark")!;
    expect(mark.args._failed).toEqual([2]);
    expect(String(mark.args._error)).toContain("storage");
  });

  it("an S3 failure keeps the files queued", async () => {
    const f = fakeDeps({ files, deleteFromS3: vi.fn(async () => { throw new Error("S3 down"); }) });
    const r = await deleteMemberAccount("u1", f.deps);
    expect(r).toEqual({ ok: true, filesDeleted: 1, filesPending: 2 });
  });
});
