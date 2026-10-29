/**
 * S3-b · shared bits of the derivative writer (claim / source / put).
 * Design: docs/evidence/d2/S3/DESIGN.md §2, §5.
 *
 * WHO: the worker (tools/media-derivatives/run.mjs) with the JWT of an admin or
 * the converter account. Every route calls a SQL function AS that JWT and the
 * SQL refuses everybody else (MEDIA-3001, 42501) — these routes hold no
 * service key and decide nothing about who may write.
 *
 * BINDINGS (Pages, per lane — Owner click, see the S3 report):
 *   PHOTOS  R2 binding → the lane's PHOTO bucket (the one behind the CDN host).
 *           Public-audience derivatives go here, under post-images/<owner>/d/.
 *   MEDIA   R2 binding → the lane's VIDEO bucket (exists for video). Private
 *           derivatives go here under photo/, a bucket with no public domain;
 *           only the media-authz Worker serves it, with a token (S3-d).
 * A missing binding is a 503 that names it; nothing is guessed.
 */
import { HttpError, type R2BucketLike, type VideoEnv } from "../../video/_lib";

export interface MediaEnv extends VideoEnv {
  PHOTOS?: R2BucketLike;
}

export function bucketFor(env: MediaEnv, target: "public" | "private"): R2BucketLike {
  const b = target === "public" ? env.PHOTOS : env.MEDIA;
  if (!b) throw new HttpError(503, "MEDIA-ENV-001", `${target === "public" ? "PHOTOS" : "MEDIA"} R2 binding is not set for this lane`);
  return b;
}

/** rpc(fn) path for asMember — POST with a JSON body. */
export function rpc(fn: string, args: Record<string, unknown>): [string, RequestInit] {
  return [`rpc/${fn}`, { method: "POST", body: JSON.stringify(args) }];
}
