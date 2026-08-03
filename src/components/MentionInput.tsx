import { useCallback, forwardRef, useRef } from "react";
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
        .select("id, full_name, avatar_url")
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
         * `autoCapitalize` was never set, so a comment started lowercase. Every
         * other social app capitalises the first letter.
         *
         * `enterKeyHint` is deliberately ABSENT. It was "send" while the box was
         * single-line, because the keyboard was the only usable way to post past
         * a 24px button. Now that Enter inserts a new line on touch (see
         * handleKeyDown) a key labelled "Send" would lie about what it does.
         * The 44px button is the send route on a phone, exactly as on Instagram.
         */
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
          suggestions: {
            list: {
              backgroundColor: "hsl(var(--popover))",
              border: "1px solid hsl(var(--border))",
              borderRadius: "8px",
              fontSize: "14px",
              boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
              maxHeight: "200px",
              overflowY: "auto",
              bottom: "100%",
              marginBottom: "4px",
              position: "absolute",
              minWidth: "260px",
              width: "max-content",
              maxWidth: "320px",
            },
            item: {
              padding: "8px 12px",
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
            <div className="flex items-center gap-2.5">
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
              <span className="font-medium">{highlightedDisplay}</span>
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
      {value.length > 0 && (
        <div className={`text-[10px] mt-1 pr-2 text-right tabular-nums ${overLimit ? "text-destructive font-semibold" : "text-muted-foreground/60"}`}>
          {value.length} / {maxLength}{overLimit ? ` · ${value.length - maxLength} over limit` : ""}
        </div>
      )}
    </div>
  );
});

MentionInput.displayName = "MentionInput";

export default MentionInput;
