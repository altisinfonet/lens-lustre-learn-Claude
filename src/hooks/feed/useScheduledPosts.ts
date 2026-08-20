// Phase 3B — Scheduled Posts hooks (list + mutations).
// All CRUD paths are RLS-gated by policies from Phase 1 migration:
//   sp_select_own, sp_insert_own, sp_update_own_pending, sp_delete_own_pending.
// UI never bypasses RLS; the service_role publisher (Phase 2 edge fn) is
// the ONLY other writer.

import { useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/core/useAuth";

export type ScheduledPostStatus =
  | "pending"
  | "publishing"
  | "published"
  | "failed"
  | "cancelled";

export interface ScheduledPost {
  id: string;
  user_id: string;
  content: string | null;
  image_urls: string[];
  /**
   * B3c. NULL on rows scheduled before 2026-08-14. Optional (not just
   * nullable) because the generated DB types lag the migration until the
   * column is applied and types are regenerated — consumers must handle
   * absence either way.
   */
  thumbnail_urls?: string[] | null;
  image_url: string | null;
  tagged_user_ids: string[];
  scheduled_for: string;
  original_scheduled_for: string;
  status: ScheduledPostStatus;
  attempt_count: number;
  shifted_count: number;
  last_shift_reason: string | null;
  last_error: string | null;
  published_post_id: string | null;
  created_at: string;
  updated_at: string;
  /**
   * Phase B — copied onto posts.categories by the publisher.
   *
   * OPTIONAL, and deliberately so until Phase B is applied to production. The
   * column does not exist on the live database yet, so the generated
   * `types.ts` does not carry it; declaring it required would make the casts
   * below fail to compile against reality rather than against intent. It
   * becomes required when the migration lands and the types are regenerated.
   */
  categories?: string[];

  /* ──────────────────────────────────────────────────────────────────────────
     ⚠ THE FOUR FIELDS BELOW ARE WHY RED-2 EXISTED.

     `useScheduledPosts` selects `*`, so every one of these has ALWAYS been
     present on the row. They were simply absent from this interface — so
     `ScheduledPostsList.handleDuplicate` could not reference them even if its
     author had thought to. The copy silently dropped all four and the database
     defaults filled in: `privacy` → 'public', `indexing_disabled` → false,
     `categories` → '{}', `media_ids` → NULL.

     Duplicating a PRIVATE, search-excluded, categorised post therefore
     published it PUBLIC, indexable, uncategorised and legacy-only. The privacy
     downgrade is a disclosure defect, not a tidiness one.

     ⚠ DO NOT MAKE THESE OPTIONAL AGAIN to silence a compile error at a new
     call site. The compile error IS the feature — see CreateScheduledPostInput.
     ────────────────────────────────────────────────────────────────────────── */

  /** 'public' | 'friends' | 'private'. NOT NULL DEFAULT 'public' on the table. */
  privacy: string;
  /** The member's SEO opt-out. NOT NULL DEFAULT false on the table. */
  indexing_disabled: boolean;
  /**
   * media_objects registered when the photographs were uploaded. NULL on rows
   * created before the media write path, and on legacy-only rows.
   */
  media_ids: string[] | null;
}

export function useScheduledPosts() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["scheduled-posts", user?.id],
    enabled: !!user?.id,
    queryFn: async (): Promise<ScheduledPost[]> => {
      const { data, error } = await supabase
        .from("scheduled_posts")
        .select("*")
        .order("scheduled_for", { ascending: true });
      if (error) throw error;
      return (data ?? []) as ScheduledPost[];
    },
  });
}

/**
 * ⚠ EVERY FIELD HERE IS REQUIRED, AND THAT IS THE POINT.
 *
 * `privacy`, `indexing_disabled`, `categories`, `media_ids`, `thumbnail_urls`
 * and `tagged_user_ids` used to be optional, each with a sensible-looking
 * default applied below. For the COMPOSER — which is creating something new —
 * a default is reasonable. For a DUPLICATE it is a data-loss bug wearing a
 * default's clothes: `ScheduledPostsList.handleDuplicate` omitted four of them,
 * TypeScript said nothing, and a private post's copy published to the world.
 *
 * Making them required does not stop anyone writing `privacy: "public"`. It
 * stops anyone writing nothing at all and getting "public" anyway. A caller
 * that genuinely has no value must now say so out loud (`media_ids: null`,
 * `categories: []`), which is a decision a reviewer can see.
 *
 * ⚠ DO NOT ADD `?` BACK to any of these to make a new call site compile.
 */
export interface CreateScheduledPostInput {
  content: string;
  /**
   * media_objects registered when these photographs were uploaded. Registered
   * NOW because the publisher runs hours later with no member and no session,
   * so there is no auth.uid() from which to re-derive ownership then.
   * `null` means the scheduled post publishes legacy-only — say it explicitly.
   */
  media_ids: string[] | null;
  image_urls: string[];
  /**
   * B3c: thumbnails are GENERATED at compose time (the upload path writes a
   * `-thumb.webp` beside every original) but were thrown away here because
   * scheduled_posts had no column for them. The publisher then inserted posts
   * with no thumbnails, and 9 production posts ended up serving a full-size
   * original wherever a thumbnail belongs. Index-aligned with image_urls.
   */
  thumbnail_urls: string[];
  image_url: string | null;
  tagged_user_ids: string[];
  scheduled_for: string; // ISO UTC
  /** BUG-024: carry the composer's privacy choice. Required — see the note above. */
  privacy: string;
  /** BUG-024: carry the SEO opt-out choice. Required — see the note above. */
  indexing_disabled: boolean;
  /**
   * Phase B: the category slugs chosen at COMPOSE time.
   *
   * A scheduled post is an ordinary member post that happens to be published
   * later, so it needs its 1–5 categories like any other. They have to be
   * stored on `scheduled_posts` at compose time because the publisher runs
   * hours later with no member and no UI — there is nobody to ask then.
   *
   * Required, and an empty array is a legitimate value until the Create UI
   * that fills it ships in Phase C — which is exactly why Phase B's minimum
   * cannot be enabled before Phase C, see the migration header. What is NOT
   * legitimate is omitting it on a duplicate of a categorised post.
   */
  categories: string[];
}

/**
 * Build the payload for a DUPLICATE of an existing scheduled post.
 *
 * ⚠ THE ONLY PLACE A DUPLICATE IS DEFINED. RED-2 happened because the copy was
 * written inline in a component as an object literal: six fields listed, four
 * forgotten, and nothing anywhere that could notice. A pure function has three
 * properties that the literal did not — it can be tested without a DOM, the
 * exhaustiveness check below runs against the real row shape, and there is
 * exactly one of it to review.
 *
 * WHAT A DUPLICATE IS. Everything the member chose, carried over verbatim, at a
 * NEW TIME. Nothing is defaulted, nothing is "sensible" — a private post's copy
 * is private, a search-excluded post's copy is excluded, a categorised post's
 * copy keeps its categories, and a post with registered media keeps the same
 * media_objects because the copy shows the same photographs.
 *
 * WHAT IS DELIBERATELY NOT CARRIED: status, attempt_count, shifted_count,
 * last_error, published_post_id, original_scheduled_for. Those describe what
 * happened to the ORIGINAL. A copy that inherited `attempt_count: 3` would
 * start three-quarters of the way to max_shifts_exceeded.
 */
export function duplicateScheduledPostInput(
  source: ScheduledPost,
  scheduledFor: string,
): CreateScheduledPostInput {
  return {
    content: source.content ?? "",
    // The copy shows the SAME photographs, so it reuses the SAME verified
    // media_objects. Re-registering would create duplicate rows for identical
    // bytes, which UNIQUE(owner, sha256) refuses anyway.
    media_ids: source.media_ids ?? null,
    image_urls: source.image_urls ?? [],
    // B3c: a duplicate reuses the same objects, so it reuses their thumbnails
    // too — otherwise the copy publishes heavy.
    thumbnail_urls: source.thumbnail_urls ?? [],
    image_url: source.image_url,
    tagged_user_ids: source.tagged_user_ids ?? [],
    scheduled_for: scheduledFor,
    // ⚠ THE FOUR THAT RED-2 DROPPED. Never default these from a source row.
    privacy: source.privacy,
    indexing_disabled: source.indexing_disabled,
    categories: source.categories ?? [],
  };
}

/**
 * Refuse a payload that would let the DATABASE decide a member's privacy.
 *
 * ⚠ THE TYPE IS NOT ENOUGH ON ITS OWN. `CreateScheduledPostInput` makes
 * omission a compile error, which stops the RED-2 shape being written again in
 * TypeScript. It does not stop an `as any` cast, an untyped JS caller, or a row
 * read from a source that genuinely lacks the column. In every one of those the
 * field arrives as `undefined`, the insert omits it, and the table default
 * silently publishes a private post to the world.
 *
 * So the last line of defence THROWS. A failed duplicate that says why is
 * strictly better than a successful one that discloses a photograph.
 */
export function assertCarriesMemberChoices(input: CreateScheduledPostInput): void {
  const missing: string[] = [];
  if (typeof input.privacy !== "string" || input.privacy.length === 0) missing.push("privacy");
  if (typeof input.indexing_disabled !== "boolean") missing.push("indexing_disabled");
  if (!Array.isArray(input.categories)) missing.push("categories");
  if (!Array.isArray(input.image_urls)) missing.push("image_urls");
  if (!Array.isArray(input.thumbnail_urls)) missing.push("thumbnail_urls");
  if (!Array.isArray(input.tagged_user_ids)) missing.push("tagged_user_ids");
  if (input.media_ids !== null && !Array.isArray(input.media_ids)) missing.push("media_ids");
  if (missing.length > 0) {
    throw new Error(
      `A scheduled post may not be created without the member's own choices: ${missing.join(", ")}. ` +
        "Falling back to the table defaults here is what published a private post publicly (RED-2).",
    );
  }
}

export function useCreateScheduledPost() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: CreateScheduledPostInput) => {
      if (!user?.id) throw new Error("Not authenticated");
      assertCarriesMemberChoices(input);
      const { data, error } = await supabase
        .from("scheduled_posts")
        .insert({
          user_id: user.id,
          content: input.content,
          image_urls: input.image_urls,
          thumbnail_urls: input.thumbnail_urls,
          image_url: input.image_url,
          tagged_user_ids: input.tagged_user_ids,
          scheduled_for: input.scheduled_for,
          original_scheduled_for: input.scheduled_for,
          // ⚠ NO `??` DEFAULTS. A default here is indistinguishable from a
          // choice, which is precisely how RED-2 turned a private post public.
          // assertCarriesMemberChoices above has already refused undefined.
          privacy: input.privacy,
          indexing_disabled: input.indexing_disabled,
          categories: input.categories,
          // Registered at upload time because the publisher runs hours later
          // with no member and no session. post_attach_media re-checks that
          // every one of them resolves to a photograph this post shows.
          media_ids: input.media_ids ?? null,
        } as any)
        .select("*")
        .single();
      if (error) throw error;
      return data as ScheduledPost;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["scheduled-posts", user?.id] });
    },
  });
}

export function useRescheduleScheduledPost() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (args: { id: string; scheduled_for: string }) => {
      const { data, error } = await supabase
        .from("scheduled_posts")
        .update({ scheduled_for: args.scheduled_for } as any)
        .eq("id", args.id)
        .eq("status", "pending") // client guard; RLS enforces server-side
        .select("*")
        .single();
      if (error) throw error;
      return data as ScheduledPost;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["scheduled-posts", user?.id] });
    },
  });
}

export function useCancelScheduledPost() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (id: string) => {
      // Hard delete (status=pending only, enforced by RLS sp_delete_own_pending).
      const { error } = await supabase
        .from("scheduled_posts")
        .delete()
        .eq("id", id);
      if (error) throw error;
      return id;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["scheduled-posts", user?.id] });
    },
  });
}

// Phase 5 — Combined update mutation (content and/or scheduled_for).
// RLS `sp_update_own_pending` enforces server-side that only owner + status='pending' rows can be updated.
export interface UpdateScheduledPostInput {
  id: string;
  content?: string;
  scheduled_for?: string; // ISO UTC
}

export function useUpdateScheduledPost() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: UpdateScheduledPostInput) => {
      const patch: Record<string, unknown> = {};
      if (typeof input.content === "string") patch.content = input.content;
      if (typeof input.scheduled_for === "string") patch.scheduled_for = input.scheduled_for;
      if (Object.keys(patch).length === 0) throw new Error("Nothing to update");
      const { data, error } = await supabase
        .from("scheduled_posts")
        .update(patch as any)
        .eq("id", input.id)
        .eq("status", "pending") // client guard; RLS enforces server-side
        .select("*")
        .single();
      if (error) throw error;
      return data as ScheduledPost;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["scheduled-posts", user?.id] });
    },
  });
}

// Phase 5 — Realtime subscription hook (filtered server-side by user_id).
// Invalidates the scheduled-posts query on any change so status flips, shifts,
// and publisher writes reflect live without refresh.
export function useScheduledPostsRealtime() {
  const qc = useQueryClient();
  const { user } = useAuth();
  useEffect(() => {
    if (!user?.id) return;
    const channel = supabase
      .channel(`scheduled_posts:${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "scheduled_posts",
          filter: `user_id=eq.${user.id}`,
        },
        () => {
          qc.invalidateQueries({ queryKey: ["scheduled-posts", user.id] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id, qc]);
}

