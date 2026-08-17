/**
 * HASHTAGS IN POST CAPTIONS — composer-side state.
 *
 * Owner, 2026-08-16. Deliberately built as a sibling of useCaptionMentions
 * rather than an extension of it: the two share a textarea but almost nothing
 * else. Mentions must convert picked text into `@[Name](id)` markup at submit
 * time and must never guess; a hashtag is already its own storage format, so
 * this hook ends at "insert the text". Folding them together would put a rule
 * that exists to prevent tagging the wrong PERSON into a code path where no
 * person is involved.
 *
 * ── WHERE THE NUMBERS COME FROM ───────────────────────────────────────────
 * `suggest_hashtags(prefix, max)` — a prefix-only, index-backed RPC. It ranks
 * by UNIQUE USERS, not post count. Measured on production the day it was
 * written: #50mmretinaworld had 11 posts from exactly ONE person, which by post
 * count made it the second most popular hashtag on the platform. Ranking by
 * posts would have taught every new member to use one person's private tag.
 *
 * ── WHAT HAPPENS WHEN IT FAILS ────────────────────────────────────────────
 * Nothing visible except an empty list. A member can always type "#street"
 * themselves and it will be stored, rendered and counted identically. This is
 * a shortcut, never a gate — the composer must not care whether it worked.
 */
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { activeHashtagQuery, applyHashtagPick } from "@/lib/captionHashtags";
import { logger } from "@/lib/logger";

export interface HashtagSuggestion {
  /** Canonical, lowercase, no leading "#". The key. */
  tag: string;
  /** How it was first written by a member — what the list shows. */
  display_tag: string;
  /** THE ranking signal: distinct authors. */
  unique_user_count: number;
  /** Supporting information only. */
  post_count: number;
}

interface Options {
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  value: string;
  setValue: (v: string) => void;
  /** Match the host composer's auto-grow ceiling so a pick cannot jump it. */
  maxAutoGrowPx?: number;
  /**
   * Set false to keep the list shut — used where a sibling dropdown (the
   * @mention list) is already open, so two lists can never stack.
   */
  enabled?: boolean;
}

/**
 * `suggest_hashtags` was added after src/integrations/supabase/types.ts was
 * last generated, so the client does not know it exists. The rest of the
 * codebase reaches for `rpc("name" as any, …)` here; this states the real
 * shape instead, so the returned rows stay typed and a change to the RPC's
 * columns shows up as a compile error rather than as an empty dropdown.
 */
type SuggestHashtagsRpc = (
  fn: "suggest_hashtags",
  args: { prefix: string; max_results: number },
) => Promise<{
  data: HashtagSuggestion[] | null;
  error: { message: string; code?: string } | null;
}>;

/** Same debounce as the mention list, so the two feel like one control. */
const DEBOUNCE_MS = 200;

/** The RPC caps at 10 regardless; asking for 5 keeps the list glanceable. */
const MAX_SUGGESTIONS = 5;

export function useCaptionHashtags({
  textareaRef,
  value,
  setValue,
  maxAutoGrowPx = 440,
  enabled = true,
}: Options) {
  const [active, setActive] = useState<{ query: string; start: number } | null>(null);
  const [suggestions, setSuggestions] = useState<HashtagSuggestion[]>([]);
  const [focusIdx, setFocusIdx] = useState(0);

  /** Re-read the caret and decide whether a "#query" is being typed. */
  const refresh = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    setActive(activeHashtagQuery(el.value, el.selectionStart ?? el.value.length));
  }, [textareaRef]);

  useEffect(() => {
    const q = active?.query?.trim() ?? "";
    // An empty query means the member has typed "#" and nothing else. The RPC
    // deliberately returns nothing for it (normalize_hashtag('') is null), so
    // asking would be a guaranteed-empty round trip on every "#" ever typed.
    if (!q) {
      setSuggestions([]);
      setFocusIdx(0);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      const startedAt = Date.now();
      const { data, error } = await (supabase.rpc as unknown as SuggestHashtagsRpc)(
        "suggest_hashtags",
        { prefix: q, max_results: MAX_SUGGESTIONS },
      );
      // A slower earlier keystroke must never overwrite a faster later one.
      if (cancelled) return;

      if (error) {
        logger.warn({
          code: "UI-8010",
          event: "HASHTAG_SUGGEST_FAILED",
          fn: "useCaptionHashtags.fetchSuggestions",
          file: "src/hooks/feed/useCaptionHashtags.ts",
          message: "Offering existing hashtags while a caption is being written.",
          reason: `The suggest_hashtags RPC failed: ${error.message}`,
          expected: `Up to ${MAX_SUGGESTIONS} tags starting with what was typed`,
          actual: `error ${error.code ?? "unknown"}`,
          nextStep:
            "Check suggest_hashtags is present and granted to authenticated. The composer stays fully usable — only the shortcut is gone.",
          durationMs: Date.now() - startedAt,
          // The query itself is member-typed content and is NOT logged; its
          // length is enough to tell "one character" from "a long tag".
          detail: { queryLength: q.length },
        });
        setSuggestions([]);
        setFocusIdx(0);
        return;
      }

      setSuggestions((data ?? []).filter((s) => !!s?.tag));
      setFocusIdx(0);
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [active?.query]);

  const open = enabled && active !== null && suggestions.length > 0;

  /** Insert the chosen tag over the "#query" the member was typing. */
  const pick = useCallback(
    (s: HashtagSuggestion) => {
      const el = textareaRef.current;
      if (!el || !active) return;
      const caret = el.selectionStart ?? value.length;
      // display_tag is how the tag was FIRST written by a member, so the
      // caption reads #StreetPhotography rather than shouting the canonical
      // lowercase form. Both store and count identically.
      const { next, caret: nextCaret } = applyHashtagPick(
        value,
        active.start,
        caret,
        s.display_tag || s.tag,
      );
      setValue(next);
      logger.debug({
        code: "UI-8011",
        event: "CAPTION_HASHTAG_PICKED",
        fn: "useCaptionHashtags.pick",
        file: "src/hooks/feed/useCaptionHashtags.ts",
        message: "Member chose an existing hashtag instead of inventing one.",
        reason: "Converging on one spelling is the entire point of the list.",
        expected: "The tag inserted at the caret",
        actual: `#${s.tag} (${s.unique_user_count} users)`,
      });
      setActive(null);
      setSuggestions([]);
      requestAnimationFrame(() => {
        const node = textareaRef.current;
        if (!node) return;
        node.focus();
        node.setSelectionRange(nextCaret, nextCaret);
        // Only auto-grow boxes have their height driven inline; leaving this
        // to the same rule the host composer uses keeps one behaviour.
        if (node.style.height) {
          node.style.height = "auto";
          node.style.height = Math.min(node.scrollHeight, maxAutoGrowPx) + "px";
        }
      });
    },
    [textareaRef, active, value, setValue, maxAutoGrowPx],
  );

  /** Keyboard on the textarea while the list is open. */
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!open) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setFocusIdx((i) => (i + 1) % suggestions.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setFocusIdx((i) => (i - 1 + suggestions.length) % suggestions.length);
      } else if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        pick(suggestions[focusIdx]);
      } else if (e.key === "Escape") {
        e.preventDefault();
        setActive(null);
        setSuggestions([]);
      }
    },
    [open, suggestions, focusIdx, pick],
  );

  /** After a successful post or a closed dialog: forget everything. */
  const reset = useCallback(() => {
    setActive(null);
    setSuggestions([]);
    setFocusIdx(0);
  }, []);

  return { open, suggestions, focusIdx, setFocusIdx, refresh, pick, onKeyDown, reset };
}
