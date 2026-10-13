/**
 * VID-1 · the first step of a server conversion, shared by the post composer
 * and the ad video button (CONVERTER-DESIGN.md v2 §3 step 1).
 *
 * Makes the server job (the picked file stays on the device until it is up),
 * asks video_source_begin while the member's screen is still open — so a
 * refusal is said where they are looking, not later in a corner — and then
 * lets the upload run on its own (uploadJobs.ts). VID-SRC-001 (an admin
 * switched server conversion off after this screen read the setting) is its
 * own answer: the caller offers the device path instead.
 */
import { createServerJob, dismissServerJob, runServerJob, startServerJob, type JobDeps } from "./uploadJobs";
import { invalidateSiteSetting } from "@/lib/siteSettingsCache";
import { VIDEO_CONVERSION_KEY } from "./conversionMode";

export type ServerStart =
  /**
   * Uploading now — or as soon as the link allows; the job retries by itself.
   * `running` settles when this first run stops (uploaded, offline, or
   * refused); a screen need not wait for it — the corner card follows the job.
   */
  | { kind: "started"; jobId: string; running: Promise<void> }
  /** VID-SRC-001: server conversion is off — prepare it on this device instead. */
  | { kind: "switched_off" }
  /** Any other refusal (daily limit, two already waiting, switched off for this member…), in plain words. */
  | { kind: "refused"; message: string };

/** "VID-LIM-003: 10 video uploads in 24 hours is the limit" → "10 video uploads in 24 hours is the limit". */
export const withoutCode = (message: string | undefined) => (message ?? "").replace(/^VID-[A-Z]+-\d+: /, "");

export async function startOnServer(input: Parameters<typeof createServerJob>[0], deps: JobDeps): Promise<ServerStart> {
  const job = await createServerJob(input);
  const begun = await startServerJob(job, deps);
  if (begun.step === "failed") {
    // Said on this screen; the job is not kept for the corner card to say again.
    await dismissServerJob(begun.id);
    if (begun.errorCode === "VID-SRC-001") {
      invalidateSiteSetting(VIDEO_CONVERSION_KEY); // the next read asks again
      return { kind: "switched_off" };
    }
    return { kind: "refused", message: withoutCode(begun.lastError) };
  }
  return { kind: "started", jobId: begun.id, running: runServerJob(begun.id, deps) };
}
