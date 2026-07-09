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

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      // react-mentions sets a flag while suggestion list is active by intercepting Enter itself.
      // If default was prevented (selection in dropdown), we won't reach this; otherwise submit.
      if (!(e as any).defaultPrevented) {
        e.preventDefault();
        if (!submitBlocked) onSubmit();
      }
    }
  };

  return (
    <div className={`relative flex-1 mention-input-wrapper ${className}`}>
      <MentionsInput
        value={value}
        onChange={(_e, newValue) => onChange(newValue)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        autoFocus={autoFocus}
        singleLine
        allowSpaceInQuery
        inputRef={(node: any) => {
          inputRef.current = node;
          if (typeof _forwardedRef === "function") _forwardedRef(node);
          else if (_forwardedRef) (_forwardedRef as React.MutableRefObject<any>).current = node;
        }}
        className="mention-input"
        style={{
          control: {
            backgroundColor: "hsl(var(--muted))",
            borderRadius: "9999px",
            fontSize: "15px",
            minHeight: "36px",
          },
          input: {
            padding: showSendButton ? "8px 36px 8px 16px" : "8px 16px",
            border: "none",
            outline: "none",
            borderRadius: "9999px",
            color: "hsl(var(--foreground))",
          },
          highlighter: {
            padding: showSendButton ? "8px 36px 8px 16px" : "8px 16px",
            border: "none",
            borderRadius: "9999px",
            color: "hsl(var(--foreground))",
            lineHeight: "1.2",
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
          onClick={() => { if (!submitBlocked) onSubmit(); }}
          disabled={submitBlocked}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-primary hover:text-primary/80 disabled:opacity-40 disabled:cursor-not-allowed transition-colors z-10"
        >
          <Send className="h-4 w-4" />
        </button>
      )}
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
