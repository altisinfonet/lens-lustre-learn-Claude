/**
 * Server-video jobs for the harness (CONVERTER-DESIGN.md v2 §8): a job exactly
 * as the job store keeps it, fixed so two runs draw the same pixels. Shared by
 * the component scenes (scenes.tsx) and the real-screen scenes
 * (realScreens.tsx), which cannot import each other.
 */
import type { VideoJob } from "@/lib/video/uploadJobs";

/** Each scene states only what differs from this one. */
export function serverJob(id: string, over: Partial<VideoJob> = {}): VideoJob {
  return {
    id, userId: "harness", purpose: "post", createdAt: 1, step: "converting", mode: "server",
    source: { id: "55555555-5555-4555-8555-555555555555", bytes: 91_000_000, name: "IMG_4412.MOV" }, uploaded: [],
    post: { content: "Evening light over the Hooghly — shot handheld on the ferry back from Belur.", categories: ["street", "documentary"], privacy: "public", idempotencyKey: "k" },
    attempts: 0, nextAt: 0, ...over,
  };
}
