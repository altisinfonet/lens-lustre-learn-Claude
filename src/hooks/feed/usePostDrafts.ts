/**
 * POST DRAFTS — the data layer for the Stage C composer.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A DRAFT EXISTS ONLY AFTER AN EXPLICIT SAVE.
 *
 * Nothing here is called while a member is merely typing or picking photos.
 * That is deliberate and it is the whole reason storage stays bounded: combine
 * autosave-from-the-first-keystroke with upload-on-save and every abandoned
 * compose session becomes a draft with uploaded images. Someone opens Create,
 * picks four photos, changes their mind, and you have paid for four uploads and
 * put junk in their drafts list.
 *
 * So: `createDraft` is called by the Save button and nothing else.
 * `updateDraft` — the autosave path — only ever updates a draft that already
 * exists. It never creates one.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PUBLISHING GOES THROUGH THE RPC, NEVER THROUGH TWO CALLS.
 *
 * Publishing means "create the post AND delete the draft". supabase-js cannot
 * span a transaction — proved during the Phase B architecture work, and the
 * reason posts.categories is an array rather than a join table. Two client
 * statements can half-fail and leave the same content both published and still
 * sitting in Drafts. `publish_post_draft()` does both server-side or neither.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TYPES. The generated `types.ts` has no `post_drafts` — the migration is not
 * applied to production yet — so the queries narrow through `unknown` in one
 * documented place rather than scattering `as any` at call sites, where it
 * would also silence a genuine column-name mistake. Same pattern as
 * `useCategories`.
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/core/useAuth";
import { queryKeys } from "@/lib/queryKeys";
import { logger } from "@/lib/logger";

const FILE = "src/hooks/feed/usePostDrafts.ts";

/** One row of `public.post_drafts`. */
export interface PostDraft {
  id: string;
  user_id: string;
  content: string;
  image_url: string | null;
  image_urls: string[];
  thumbnail_urls: string[] | null;
  privacy: string;
  indexing_disabled: boolean;
  categories: string[];
  /** {taggedUserId, taggedUserName, taggedUserAvatar, photoIndex, xPosition, yPosition}[] */
  pending_tags: unknown[];
  scheduled_for: string | null;
  created_at: string;
  updated_at: string;
}

/** What Save sends. Everything optional except the owner. */
export interface DraftInput {
  content?: string;
  image_url?: string | null;
  image_urls?: string[];
  thumbnail_urls?: string[] | null;
  privacy?: string;
  indexing_disabled?: boolean;
  categories?: string[];
  pending_tags?: unknown[];
  scheduled_for?: string | null;
}

type UntypedFrom = (table: string) => any;
type UntypedRpc = (fn: string, args: Record<string, unknown>) => PromiseLike<{
  data: unknown;
  error: { message: string; code?: string } | null;
}>;

const from = (t: string) => (supabase.from as unknown as UntypedFrom)(t);
const rpc = supabase.rpc as unknown as UntypedRpc;

/**
 * How many days a draft survives after its last edit. Mirrors
 * `mark_expiring_post_drafts(7)`. Shown to the member so a 7-day window never
 * takes anyone by surprise — the deletion is real and there is no undo.
 */
export const DRAFT_EXPIRY_DAYS = 7;

/** Whole days left before this draft is swept. Never negative. */
export const draftDaysLeft = (updatedAt: string, now: number = Date.now()): number => {
  const elapsedMs = now - new Date(updatedAt).getTime();
  const left = DRAFT_EXPIRY_DAYS - Math.floor(elapsedMs / 86_400_000);
  return left > 0 ? left : 0;
};

/**
 * The member's drafts, newest first.
 *
 * Expiring rows are already invisible — the RLS SELECT policy carries
 * `expiring_at IS NULL` — so a draft on its way out disappears from this list
 * BEFORE its images are deleted. Nobody ever opens a draft to find blank
 * photos.
 */
export function usePostDrafts() {
  const { user } = useAuth();
  return useQuery<PostDraft[]>({
    queryKey: queryKeys.postDrafts(user?.id ?? "anon"),
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await from("post_drafts")
        .select("*")
        .order("updated_at", { ascending: false });
      if (error || !Array.isArray(data)) return [];
      return data as PostDraft[];
    },
    staleTime: 30_000,
  });
}

export function useCreateDraft() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: DraftInput): Promise<PostDraft> => {
      if (!user?.id) throw new Error("Not authenticated");
      const { data, error } = await from("post_drafts")
        .insert({ ...input, user_id: user.id })
        .select("*")
        .single();
      if (error) throw error;
      return data as PostDraft;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.postDrafts(user?.id ?? "anon") });
    },
    onError: (e: any) => {
      // DRAFT-002 is the 20-draft cap and is a normal, expected refusal — the
      // member needs to hear it as "you have too many drafts", not as a crash.
      logger.warn({
        code: "DRAFT-2001",
        event: "DRAFT_CREATE_FAILED",
        fn: "useCreateDraft",
        file: FILE,
        message: "Saving a draft was refused.",
        reason: e?.message ?? String(e),
        expected: "One draft row",
        actual: "The insert was refused",
        nextStep:
          /DRAFT-002/.test(e?.message ?? "")
            ? "The member is at the 20-draft cap. Tell them to delete one; this is not a fault."
            : "Check the post_drafts policies and that the Stage C migration is applied.",
        userId: user?.id,
      });
    },
  });
}

/**
 * Autosave. Updates an EXISTING draft only.
 *
 * If the row has gone — swept, or deleted in another tab — this resolves
 * quietly rather than recreating it. Resurrecting a draft the member (or the
 * cleanup) already removed would be worse than losing the edit.
 */
export function useUpdateDraft() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async ({ id, ...patch }: DraftInput & { id: string }) => {
      const { data, error } = await from("post_drafts")
        .update(patch)
        .eq("id", id)
        .select("*")
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as PostDraft | null;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.postDrafts(user?.id ?? "anon") });
    },
  });
}

export function useDeleteDraft() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await from("post_drafts").delete().eq("id", id);
      if (error) throw error;
      return id;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.postDrafts(user?.id ?? "anon") });
    },
  });
}

/**
 * Publish a draft. One server-side transaction; returns the new post id.
 *
 * On failure NOTHING is committed — the draft is still there and the member can
 * try again. That is the property worth protecting: a half-published draft is
 * the one outcome that produces a duplicate nobody can explain.
 */
export function usePublishDraft() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (draftId: string): Promise<string> => {
      const { data, error } = await rpc("publish_post_draft", { _draft_id: draftId });
      if (error) throw error;
      if (typeof data !== "string") throw new Error("publish_post_draft returned no id");
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.postDrafts(user?.id ?? "anon") });
      // Prefix key — every cached category variant of the feed, not just "All".
      qc.invalidateQueries({ queryKey: queryKeys.feedAll() });
    },
    onError: (e: any) => {
      logger.error({
        code: "DRAFT-2002",
        event: "DRAFT_PUBLISH_FAILED",
        fn: "usePublishDraft",
        file: FILE,
        message: "Publishing a draft failed.",
        reason: e?.message ?? String(e),
        expected: "A post created and the draft removed, atomically",
        actual: "Neither happened",
        nextStep:
          "THE DRAFT IS INTACT — the member has lost nothing and can retry. Check the Postgres message: rate limit, duplicate and moderation triggers all fire inside publish_post_draft.",
        userId: user?.id,
      });
    },
  });
}
