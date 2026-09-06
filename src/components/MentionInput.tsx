import { useCallback, useEffect, forwardRef, useRef, useState } from "react";
import { Send } from "lucide-react";
import { MentionsInput, Mention, SuggestionDataItem } from "react-mentions";
import { profilesPublic } from "@/lib/profilesPublic";

interface MentionInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  placeholder?: string;
  disabled?: boolean;
  maxLength?: number;
  className?: string;
  showSendButton?: boolean;
  autoFocus?: boolean;
}

interface UserSuggestion extends SuggestionDataItem {
  avatar_url?: string | null;
}

const MentionInput = forwardRef<HTMLInputElement, MentionInputProps>(({
  value,
  onChange,
  onSubmit,
  placeholder = "Write a comment...",
  disabled = false,
  maxLength = 2200,
  className = "",
  showSendButton = true,
  autoFocus = false,
}: MentionInputProps, _forwardedRef) => {
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);

  const fetchUsers = useCallback(
    async (query: string, callback: (data: UserSuggestion[]) => void) => {
      if (!query) {
        callback([]);
        return;
      }
      const { data } = await profilesPublic()
        .select("id, full_name, avatar_url, custom_url")
        .ilike("full_name", `%${query}%`)
        .limit(6);
      const suggestions: UserSuggestion[] = (data || []).map((u: any) => ({
        id: u.id,
        display: u.full_name || "Photographer",
        avatar_url: u.avatar_url,
      }));
      callback(suggestions);
    },
    []
  );

  /**
   * AUTOFOCUS PUTS THE CARET AT 0 — WHICH MEANS TYPING PREPENDS.
   *
   * Reported by the owner on 2026-08-12: "on reply comment edit ... cursor is
   * moving front not end". This is NOT the remount bug that reversed characters
   * in the comment list (that one is fixed; the deployed bundle was checked).
   * It is a second, narrower fault that only shows on a box that opens with
   * text ALREADY IN IT — i.e. Edit.
   *
   * The browser's `autofocus` gives an element focus but does not place the
   * caret; for a pre-filled field it lands at index 0. The new-comment and
   * reply boxes open empty, so 0 and "end" are the same position and nobody
   * ever saw it. Open Edit on an existing comment and every character you type
   * is inserted in FRONT of the text that was already there.
   *
   * So: whenever this field is the one taking focus, put the caret after the
   * last character, the way every editor on earth behaves.
   *
   * WHY A FRAME LATER, NOT SYNCHRONOUSLY: react-mentions renders the textarea
   * and writes `value` onto the DOM node in its own commit. Setting the range
   * in the same tick reads value.length as 0 and does nothing. One animation
   * frame after mount the node is populated, so `el.value.length` is the real
   * end of the text.
   *
   * Depending on `value` here would be wrong — it would drag the caret to the
   * end on every keystroke, which is the same disease with the sign flipped.
   * The effect must run for the FOCUS event only, so `autoFocus` is the only
   * dependency.
   */
  useEffect(() => {
    if (!autoFocus) return;
    let frame = 0;
    frame = requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el || typeof el.setSelectionRange !== "function") return;
      // Do not steal the caret from a member who has already clicked into the
      // middle of the text before this frame ran.
      if (document.activeElement !== el) return;
      const end = el.value.length;
      if (el.selectionStart === 0 && el.selectionEnd === 0 && end > 0) {
        el.setSelectionRange(end, end);
        /**
         * ⚠ THIS FLAG IS AN ARTEFACT MARKER. REMOVING IT BREAKS A RELEASE GATE.
         *
         * `android-build.yml`'s "Prove the synced app is TODAY'S app" step greps
         * the BUILT bundle for six literal strings, one per feature it refuses
         * to ship without. `caretPlaced` is the one for this fix (2026-08-12: a
         * pre-filled edit box put the caret at index 0, so typing prepended).
         *
         * It used to live in AdComments.tsx as `el.dataset.caretPlaced`. The
         * 2026-08-31 promotion replaced that hand-rolled comment row with the
         * shared CommentThread, which renders THIS component — the behaviour
         * moved here and the marker string did not follow. Android Build #114
         * then refused to build:
         *
         *     MISSING from bundle: Edit-caret fix (2026-08-12) (marker
         *     'caretPlaced'). This AAB would NOT contain that feature.
         *
         * The gate was right to stop; the feature was never lost. The marker now
         * sits where the behaviour does. A `dataset` key is used deliberately:
         * minification renames locals but never a dataset property, so the
         * string genuinely reaches the artefact the gate reads.
         *
         * Predicted in this repository on 2026-08-13 —
         * POST_REMEDIATION_FORENSIC_AUDIT: the gate "greps for six hardcoded
         * feature strings from 2026-08-12 … it breaks on a copy change."
         */
        el.dataset.caretPlaced = "1";
      }
    });
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFocus]);

  const overLimit = value.length > maxLength;
  const submitBlocked = disabled || overLimit;

  /**
   * SENDING HAS TO SURVIVE THE ANDROID WEBVIEW.
   *
   * Measured on production 2026-08-03: the old button was a 24x24 px tap target
   * (16 px icon + 4 px padding). Android's minimum is 48 dp and iOS's is 44 pt,
   * so it was HALF the required size, sitting 8 px from the edge of a 36 px
   * pill. A thumb is roughly 45 px wide — people were missing it and hitting the
   * input instead. It is now a 44x44 target; the icon is unchanged at 16 px, so
   * nothing looks different, there is simply something to hit.
   *
   * It also fires on `pointerdown`, not only `click`, for the reason already
   * recorded in this codebase (GlobalSearch.tsx does the same): the Android
   * WebView sometimes never delivers the click after a tap that dismisses the
   * keyboard. `preventDefault` keeps focus in the field so the keyboard does not
   * flicker shut between the two events.
   *
   * `sentRef` makes the pair idempotent — whichever event arrives first wins and
   * the other is ignored, so a comment can never be posted twice.
   */
  const sentRef = useRef(0);

  const fire = () => {
    if (submitBlocked) return;
    const now = Date.now();
    if (now - sentRef.current < 500) return; // the other event already handled it
    sentRef.current = now;
    onSubmit();
  };

  const handleSendPointerDown = (e: React.PointerEvent) => {
    e.preventDefault(); // keep focus in the input; stops the keyboard closing first
    fire();
  };

  const handleSendClick = () => fire();

  /**
   * ENTER BEHAVES DIFFERENTLY ON A PHONE AND ON A DESKTOP — ON PURPOSE.
   *
   * This is what Instagram actually does, and the owner chose it deliberately
   * on 2026-08-03:
   *
   *   touch device   Enter inserts a NEW LINE. The 44px send button posts.
   *   desktop        Enter POSTS. Shift+Enter inserts a new line.
   *
   * The reason it has to differ: a phone keyboard has no Shift, so if Enter
   * posted on touch, a member could never write a second line — which is the
   * entire point of making this box multi-line. On a desktop the opposite is
   * true: everyone expects Enter to send, and Shift+Enter is the universal
   * escape hatch.
   *
   * `(pointer: coarse)` is the honest test — it asks whether the primary input
   * device is a finger, rather than sniffing the user agent, which lies.
   */
  const isTouch = () =>
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(pointer: coarse)").matches;

  /**
   * The same question, as STATE, because the keyboard's own key label has to be
   * RENDERED rather than answered at keypress time.
   *
   * It reads the identical media query `handleKeyDown` uses, so the label on
   * the key can never disagree with what Enter actually does. Live, not once at
   * mount: a Surface or an iPad with a keyboard attached flips
   * `(pointer: coarse)` mid-session.
   *
   * It briefly also drove a one-line hint under the box ("Enter to post ·
   * Shift + Enter for a new line"). The owner had that removed on 2026-08-29
   * with no replacement — the visible text only. The conditional Enter handling
   * and the key label below are unchanged and deliberate.
   */
  const [coarse, setCoarse] = useState(isTouch);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(pointer: coarse)");
    const sync = () => setCoarse(mq.matches);
    sync();
    mq.addEventListener?.("change", sync);
    return () => mq.removeEventListener?.("change", sync);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "Enter") return;

    // react-mentions swallows Enter itself while its @suggestion list is open,
    // so a prevented event means "the member picked a name", never "send".
    if ((e as any).defaultPrevented) return;

    if (e.shiftKey) return; // Shift+Enter is always a new line, on every device
    if (isTouch()) return;  // phones: let Enter do what the keyboard says — new line

    e.preventDefault();
    fire();
  };

  return (
    <div className={`flex-1 mention-input-wrapper ${className}`}>
      {/*
        THE POSITIONING CONTEXT IS THIS BOX, NOT THE WRAPPER.

        The send button is absolutely positioned. While `relative` sat on the
        outer wrapper, `bottom-0` resolved to the bottom of the wrapper — which
        also contains the character counter — so the button hung outside the
        pill, below its bottom-right corner. Caught in a rendered screenshot
        before shipping, not by reading the code.

        This div wraps ONLY the field, so the button is anchored to the field.
      */}
      <div className="relative">
      <MentionsInput
        value={value}
        onChange={(_e, newValue) => onChange(newValue)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        autoFocus={autoFocus}
        /**
         * NO `singleLine` — this is what makes the box multi-line.
         *
         * react-mentions renders <input type="text"> when `singleLine` is set
         * and <textarea> when it is not. Instagram, Facebook and WhatsApp all
         * use a textarea for comments; we were the odd one out.
         *
         * In multi-line mode the library positions the textarea absolutely at
         * height:100% over the highlighter, and the HIGHLIGHTER — which is in
         * normal flow — is what actually sets the height. So the box grows on
         * its own as text wraps; no JavaScript resizing is needed. That only
         * holds while the two share identical typography, which is why
         * `lineHeight` is now pinned on both below.
         */
        allowSpaceInQuery
        /**
         * OPEN UPWARD, COMPUTED — not with a hand-written `bottom: 100%`.
         *
         * The comment box sits at the bottom of a thread, so a list dropping
         * downward lands off the screen. The library positions the overlay from
         * its measured height (`top - offsetHeight - caretHeight`), which stays
         * right as the box grows from one line to five; a fixed `bottom: 100%`
         * on the inner <ul> only looked right at one line, and took the <ul>
         * out of flow — which is what disarmed the right-edge guard. See the
         * long note on `suggestions` below.
         */
        forceSuggestionsAboveCursor
        /**
         * `autoCapitalize` was never set, so a comment started lowercase. Every
         * other social app capitalises the first letter.
         *
         * `enterKeyHint` NOW FOLLOWS WHAT ENTER ACTUALLY DOES, rather than being
         * absent. (2026-08-28.)
         *
         * It was left unset deliberately, and the reasoning still stands: Enter
         * inserts a NEW LINE on a touch device (see handleKeyDown — a phone
         * keyboard has no Shift, so if Enter posted, nobody could ever write a
         * second line). Labelling that key "Send" would be a lie told by the
         * keyboard itself, and it was asked for on the assumption that Enter
         * posts on mobile. It does not.
         *
         * Absent was not right either: the key then falls back to whatever the
         * platform picks. So it is now derived from the SAME media query the key
         * handler uses — "send" where Enter really does post, "enter" where it
         * really does insert a line. On a desktop the attribute is inert (there
         * is no soft keyboard to label), which costs nothing and keeps the two
         * branches honest side by side.
         */
        enterKeyHint={coarse ? "enter" : "send"}
        autoCapitalize="sentences"
        inputRef={(node: any) => {
          inputRef.current = node;
          if (typeof _forwardedRef === "function") _forwardedRef(node);
          else if (_forwardedRef) (_forwardedRef as React.MutableRefObject<any>).current = node;
        }}
        className="mention-input"
        style={{
          control: {
            backgroundColor: "hsl(var(--muted))",
            // 18px, not a pill. At one line it still looks round; at four lines
            // a 9999px radius would bow the sides out like a capsule.
            borderRadius: "18px",
            fontSize: "15px",
            // 15px text + 20px line + 8px padding top and bottom = 36px for a
            // single line, which is exactly the height the box had before. Each
            // further line adds exactly 20px.
            minHeight: "36px",
            // Instagram stops growing at roughly five lines and scrolls after
            // that. 20*5 + 16 = 116. Without a cap, a 2200-character comment
            // would push the composer off the screen.
            maxHeight: "116px",
          },
          input: {
            // Right padding must clear the 44px send button, or typed text runs
            // underneath it. Padding AND lineHeight MUST stay identical to
            // `highlighter` below — react-mentions overlays the two, and once
            // the box wraps, any difference misaligns every @mention pill and
            // makes the measured height wrong.
            padding: showSendButton ? "8px 44px 8px 16px" : "8px 16px",
            lineHeight: "20px",
            border: "none",
            outline: "none",
            borderRadius: "18px",
            color: "hsl(var(--foreground))",
            // The library's multi-line default is overflow:hidden. `auto` lets
            // a long comment scroll inside the capped box; react-mentions
            // mirrors this scroll onto the highlighter via its own onScroll
            // handler, so the two never drift apart.
            overflowY: "auto",
          },
          highlighter: {
            padding: showSendButton ? "8px 44px 8px 16px" : "8px 16px", // in step with `input`
            lineHeight: "20px", // in step with `input` — see the note above
            border: "none",
            borderRadius: "18px",
            color: "hsl(var(--foreground))",
            maxHeight: "116px",
          },
          /**
           * ── THE @NAME LIST ─────────────────────────────────────────────────
           *
           * Reported by the owner on 2026-08-31 with a screenshot: "during
           * tagging in a coments, options are hiding not coming in fornt".
           * Rendered in the harness at 360px (scene
           * `mention-list-over-comment-box`) it was two faults, and the second
           * one is the interesting one.
           *
           *  1. THE SEND BUTTON PAINTED OVER THE LIST. The button is `z-10`;
           *     react-mentions gives its suggestions overlay `z-index: 1`, so
           *     the list's bottom-right corner rendered UNDER the blue disc.
           *
           *  2. THE LIST RAN OFF THE RIGHT EDGE OF THE PHONE — and it did so
           *     BECAUSE OF HOW THIS BLOCK WAS WRITTEN, not despite it.
           *
           * ⚠ THE TRAP, WRITTEN DOWN SO IT IS NOT WALKED INTO AGAIN.
           *
           * react-mentions already guards its own right edge. From
           * `updateSuggestionsPosition`:
           *
           *     if (left + suggestions.offsetWidth > container.offsetWidth)
           *       position.right = 0            // snap to the field's edge
           *     else
           *       position.left = left          // sit under the caret
           *
           * It measures `suggestions` — THE OVERLAY. This block used to put
           * every sizing rule (`minWidth: 260px`, `width: max-content`,
           * `maxWidth: 320px`) plus `position: absolute` on `list`, the <ul>
           * INSIDE that overlay. An absolutely positioned child is out of flow,
           * so the overlay never grew: it stayed at the library's default
           * `minWidth: 100` and reported `offsetWidth` = 100 while 277px of
           * names were painted. The guard compared the wrong number, concluded
           * the list fitted, and set `left` to the caret. Measured at 360px:
           * left 92 + 277.3 = 369.3 against a 369px viewport, with "Ranjana
           * Bhattacharya Chowdhury" sliced in half at the screen edge.
           *
           * So the fix is not a wider guard — it is to STOP LYING TO THE ONE
           * THAT IS ALREADY THERE. Sizing belongs on the overlay; the <ul>
           * keeps only its looks and fills its parent. The library then does
           * its own job: under the caret when there is room, snapped to the
           * field's right edge when there is not, never off-screen.
           *
           * `forceSuggestionsAboveCursor` replaces the hand-written
           * `bottom: 100%`, for the same reason — it is the placement the
           * library computes from the real overlay height, so it stays correct
           * as the box grows to five lines.
           * ───────────────────────────────────────────────────────────────────
           */
          suggestions: {
            // Above the send button (z-10). ⚠ On the OVERLAY, which is the
            // element the library stacks — a zIndex on `list` below would land
            // on a child of a box that has already lost the comparison.
            zIndex: 50,
            // The library's default is `marginTop: 14`, which offsets the
            // computed position. The placement is now computed; the nudge is a
            // 4px breathing gap above the pill and nothing more.
            marginTop: 0,
            marginBottom: 4,
            // ⚠ THE SIZE LIVES HERE, NOT ON `list`. This is the whole fix:
            // these three lines are what the right-edge guard measures.
            width: "max-content",
            minWidth: 0,
            // The field's own width on a phone (so the list can never be wider
            // than the box it belongs to); 320px is the cap on a desktop, where
            // the field is much wider than a name needs.
            maxWidth: "min(320px, 100%)",
            backgroundColor: "transparent",
            list: {
              backgroundColor: "hsl(var(--popover))",
              border: "1px solid hsl(var(--border))",
              borderRadius: "8px",
              fontSize: "14px",
              boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
              maxHeight: "200px",
              overflowY: "auto",
              // ⚠ NO position/left/width/maxWidth HERE. See the note above:
              // taking this <ul> out of flow is what disarmed the guard.
              overflowX: "hidden",
            },
            item: {
              padding: "8px 12px",
              // A name longer than the box ends in an ellipsis rather than
              // widening the list.
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              "&focused": {
                backgroundColor: "hsl(var(--accent))",
              },
            },
          },
        }}
      >
        <Mention
          trigger="@"
          data={fetchUsers}
          markup="@[__display__](__id__)"
          displayTransform={(_id, display) => `@${display}`}
          appendSpaceOnAdd
          renderSuggestion={(suggestion: UserSuggestion, _search, highlightedDisplay) => (
            <div className="flex min-w-0 items-center gap-2.5">
              {suggestion.avatar_url ? (
                <img
                  src={suggestion.avatar_url}
                  alt=""
                  className="w-7 h-7 rounded-full object-cover"
                  loading="lazy"
                />
              ) : (
                <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center text-xs font-semibold text-muted-foreground">
                  {(suggestion.display || "?")[0]?.toUpperCase()}
                </div>
              )}
              {/* `min-w-0` above + `truncate` here is the pair that actually
                  clips: a flex item's default min-width is its content, so
                  without min-w-0 the row refuses to shrink and the ellipsis
                  never appears. */}
              <span className="truncate font-medium">{highlightedDisplay}</span>
            </div>
          )}
          style={{
            backgroundColor: "hsl(var(--primary) / 0.15)",
            color: "hsl(var(--primary))",
            borderRadius: "3px",
          }}
        />
      </MentionsInput>

      {showSendButton && value.trim() && (
        <button
          type="button"
          aria-label="Send"
          onPointerDown={handleSendPointerDown}
          onClick={handleSendClick}
          disabled={submitBlocked}
          /**
           * ANCHORED SO THE DISC IS CENTRED ON THE LAST LINE — exactly.
           *
           * The geometry, so nobody "improves" this by eye:
           *   pill      = 8px pad + 20px line + 8px pad = 36px at one line
           *   last-line centre = 8 + 10 = 18px from the pill's bottom, at
           *                      EVERY height (padding and line are constants)
           *   button    = 44px tall, so its centre sits at bottom + 22
           *
           * With `bottom-0` the disc centre lands at 22px — 4px too high, and
           * the disc's edge poked out of the pill's top at one line. The owner
           * saw it immediately ("alignment must be middle"). `bottom:-4px`
           * puts the button centre at -4 + 22 = 18px: dead centre of a
           * one-line pill, and dead centre of the LAST LINE when the box has
           * grown — which is what Instagram does. The 4px of button hanging
           * past each edge is the invisible tap zone, not the disc; the disc
           * (28px, centred) spans 4..32 inside a 0..36 pill.
           */
          className="group absolute right-0 bottom-[-4px] flex h-11 w-11 items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed z-10"
        >
          {/*
            The button is VISIBLE now — a filled circle, the way Instagram
            draws it.

            History, so this is never re-litigated: the original button was a
            bare 16px icon in a 24px target — half of what a thumb needs. The
            first fix (2026-08-03) grew the TARGET to 44px but deliberately
            left the picture identical, and the owner's verdict was blunt:
            "button size same as it was before." He was right that an
            invisible fix is indistinguishable from no fix. The affordance has
            to be seen to be believed.

            So: a 30px filled disc members can SEE, inside the 44px zone a
            thumb can HIT. The disc must never be the tap target itself —
            30px would be back below every platform minimum.
          */}
          {/* 28px, per the owner: "middle and compact". Fits 4..32 in a 36px pill. */}
          <span className="flex h-[28px] w-[28px] items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm transition-colors group-hover:bg-primary/85">
            <Send className="h-4 w-4 -translate-x-px" />
          </span>
        </button>
      )}
      </div>
      {/*
        NO RUNNING CHARACTER COUNTER — owner instruction, 2026-08-04:
        "on every text area you are showing 55/2200 … Don't show it anywhere."
        The big feeds show nothing while you type, and so do we now.

        The ONE exception is deliberate: past the limit the send button is
        disabled (submitBlocked), and a disabled button with no explanation is
        a silent dead control — the exact failure mode WORKING_RULES §6 bans.
        So the line appears ONLY when the member is actually over the limit,
        and tells them what to do.
      */}
      {overLimit && (
        <div className="text-[10px] mt-1 pr-2 text-right tabular-nums text-destructive font-semibold">
          {value.length - maxLength} over the {maxLength} limit — shorten to post · {value.length} / {maxLength}
        </div>
      )}

    </div>
  );
});

MentionInput.displayName = "MentionInput";

export default MentionInput;
