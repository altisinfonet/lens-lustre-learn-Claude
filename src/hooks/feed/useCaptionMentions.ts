/**
 * MENTIONS IN POST CAPTIONS — composer-side state (1053 headline item).
 *
 * Owner: "typing @name in a post caption tags a member, like comments do."
 *
 * Comments use react-mentions, which swaps the field for its own textarea.
 * The post composer's textarea CANNOT be swapped: its over-limit highlight
 * overlay and auto-grow are owner-approved behavior tied to the plain
 * <Textarea> ("never break what works"). So captions keep the plain textarea
 * and this hook adds the Instagram-style part on top:
 *
 *   type "@par…"  → member dropdown appears under the box
 *   pick a member → "@Partha Dalal " is inserted as plain visible text and
 *                   the member's id is remembered
 *   press Post    → convert() turns every picked "@Name" into the same
 *                   `@[Name](id)` markup comments store, which Caption.tsx /
 *                   RichContentRenderer already renders as a profile link
 *
 * Only PICKED names convert — a hand-typed "@Partha Dalal" stays plain text,
 * because guessing which member was meant could tag the wrong person.
 * (Rule and edge cases live in src/lib/captionMentions.ts with tests.)
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { profilesPublic } from "@/lib/profilesPublic";
import {
  activeMentionQuery,
  applyCaptionMentions,
  type PickedMention,
} from "@/lib/captionMentions";

export interface MentionSuggestion {
  id: string;
  display: string;
  avatar_url: string | null;
}

interface Options {
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  value: string;
  setValue: (v: string) => void;
  /** Composer caps auto-grow at 440px; keep the splice consistent with it. */
  maxAutoGrowPx?: number;
}

export function useCaptionMentions({ textareaRef, value, setValue, maxAutoGrowPx = 440 }: Options) {
  const [active, setActive] = useState<{ query: string; start: number } | null>(null);
  const [suggestions, setSuggestions] = useState<MentionSuggestion[]>([]);
  const [focusIdx, setFocusIdx] = useState(0);
  const pickedRef = useRef<PickedMention[]>([]);

  /** Re-read the caret and decide whether an "@query" is being typed. */
  const refresh = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    setActive(activeMentionQuery(el.value, el.selectionStart ?? el.value.length));
  }, [textareaRef]);

  // Fetch suggestions for the active query — debounced, stale-proof, and only
  // for a non-empty query (same behavior as the comment box: nothing shows
  // until you start typing a name).
  useEffect(() => {
    const q = active?.query?.trim() ?? "";
    if (!q) {
      setSuggestions([]);
      setFocusIdx(0);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      const { data } = await profilesPublic()
        .select("id, full_name, avatar_url")
        .ilike("full_name", `%${q}%`)
        .limit(6);
      if (cancelled) return;
      setSuggestions(
        ((data as any[]) || []).map((u) => ({
          id: u.id,
          display: u.full_name || "Photographer",
          avatar_url: u.avatar_url,
        })),
      );
      setFocusIdx(0);
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [active?.query]);

  const open = active !== null && suggestions.length > 0;

  /** Insert the picked member's name at the "@query" and remember the id. */
  const pick = useCallback(
    (s: MentionSuggestion) => {
      const el = textareaRef.current;
      if (!el || !active) return;
      const caret = el.selectionStart ?? value.length;
      const before = value.slice(0, active.start);
      const after = value.slice(caret);
      const inserted = `@${s.display} `;
      const next = before + inserted + after;
      setValue(next);
      pickedRef.current = [...pickedRef.current, { display: s.display, id: s.id }];
      setActive(null);
      setSuggestions([]);
      requestAnimationFrame(() => {
        const node = textareaRef.current;
        if (!node) return;
        node.focus();
        const pos = (before + inserted).length;
        node.setSelectionRange(pos, pos);
        node.style.height = "auto";
        node.style.height = Math.min(node.scrollHeight, maxAutoGrowPx) + "px";
      });
    },
    [textareaRef, active, value, setValue, maxAutoGrowPx],
  );

  /** Keyboard on the textarea while the dropdown is open. */
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

  /** Visible text → stored markup. Call at submit time. */
  const convert = useCallback(
    (text: string) => applyCaptionMentions(text, pickedRef.current),
    [],
  );

  /** After a successful post: forget the picks with the cleared caption. */
  const reset = useCallback(() => {
    pickedRef.current = [];
    setActive(null);
    setSuggestions([]);
    setFocusIdx(0);
  }, []);

  return { open, suggestions, focusIdx, setFocusIdx, refresh, pick, onKeyDown, convert, reset };
}
