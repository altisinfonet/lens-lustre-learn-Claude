/**
 * ACCOUNT DELETION — ALL OR NOTHING, THEN THE FILES.
 *
 * Foundation fix unit 2 (2026-10-30). The old delete-my-account deleted the
 * login FIRST and then ran ~50 table deletes whose errors it never read, and it
 * removed no stored files. A failure after the first step left a half-deleted
 * member who could no longer sign in to retry, and the function still answered
 * `success: true`.
 *
 * Now:
 *   1. ONE database call, `delete_member_account(_uid)` (SECURITY DEFINER,
 *      service_role only). It deletes every personal row and the login LAST in
 *      a single transaction. Any error rolls the whole thing back: nothing is
 *      deleted, the member is still signed in, and the caller is told to retry.
 *      In the same transaction it queues the member's own files in
 *      `member_file_purge_queue` — only files no remaining row still points at
 *      (so a file shared with / used by another member is never queued).
 *   2. The queued files are removed from Supabase Storage AND the S3/CDN store.
 *      Both removals are idempotent. A file that fails stays queued (attempt
 *      count + error recorded) and is retried by the next drain; the response
 *      says how many are still pending instead of claiming success for them.
 */

export interface DbError { message: string }
export type RpcResult<T> = { data: T | null; error: DbError | null };

export interface QueuedFile { id: number; ref: string }

export interface DeletionDeps {
  rpc<T>(fn: string, args: Record<string, unknown>): Promise<RpcResult<T>>;
  /** Supabase Storage remove; resolves with an error object on failure. */
  removeFromStorage(bucket: string, paths: string[]): Promise<{ error: DbError | null }>;
  /** S3/CDN delete of normalised "<bucket>/<path>" keys; throws on failure. null = S3 not configured. */
  deleteFromS3: ((paths: string[]) => Promise<void>) | null;
  /** "<bucket>/<path>" for a stored URL or key, or null when it is not one of ours. */
  extractPath(ref: string): string | null;
}

export type DeletionOutcome =
  | { ok: true; filesDeleted: number; filesPending: number }
  | { ok: false; status: number; error: string; retry: boolean };

export async function purgeQueuedFiles(files: QueuedFile[], deps: DeletionDeps): Promise<{ done: number[]; failed: { id: number; error: string }[] }> {
  const done: number[] = [];
  const failed: { id: number; error: string }[] = [];
  const byBucket = new Map<string, { id: number; path: string; full: string }[]>();
  for (const f of files) {
    const full = deps.extractPath(f.ref);
    if (!full) {
      // Not a managed storage object (e.g. an external URL): nothing of ours to delete.
      done.push(f.id);
      continue;
    }
    const slash = full.indexOf("/");
    const bucket = full.slice(0, slash);
    const path = full.slice(slash + 1);
    if (!byBucket.has(bucket)) byBucket.set(bucket, []);
    byBucket.get(bucket)!.push({ id: f.id, path, full });
  }
  for (const [bucket, items] of byBucket) {
    let error: string | null = null;
    const st = await deps.removeFromStorage(bucket, items.map((i) => i.path));
    if (st.error) error = "storage: " + st.error.message;
    if (!error && deps.deleteFromS3) {
      try {
        await deps.deleteFromS3(items.map((i) => i.full));
      } catch (e) {
        error = "s3: " + (e as Error).message;
      }
    }
    for (const i of items) error ? failed.push({ id: i.id, error }) : done.push(i.id);
  }
  return { done, failed };
}

/** Delete one member: rows first (atomic, in SQL), then their files. */
export async function deleteMemberAccount(uid: string, deps: DeletionDeps): Promise<DeletionOutcome> {
  const del = await deps.rpc<{ deleted: boolean; files: QueuedFile[] }>("delete_member_account", { _uid: uid });
  if (del.error) {
    return {
      ok: false,
      status: 500,
      retry: true,
      error: "Your account was not deleted (nothing was removed). Please try again. Detail: " + del.error.message,
    };
  }
  if (!del.data?.deleted) return { ok: false, status: 404, retry: false, error: "Account not found" };
  return drainFiles(del.data.files ?? [], deps);
}

/** Remove queued files and record the result; failures stay queued for the next drain. */
export async function drainFiles(files: QueuedFile[], deps: DeletionDeps): Promise<DeletionOutcome> {
  const { done, failed } = await purgeQueuedFiles(files, deps);
  const mark = await deps.rpc<number>("member_file_purge_mark", {
    _done: done,
    _failed: failed.map((f) => f.id),
    _error: failed[0]?.error ?? null,
  });
  // The rows are already gone; a failed bookkeeping write only means the next
  // drain re-tries files that may already be deleted (idempotent), so report it
  // as pending rather than failing the deletion.
  return { ok: true, filesDeleted: done.length, filesPending: mark.error ? files.length : failed.length };
}
