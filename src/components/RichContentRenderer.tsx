import { Fragment } from "react";
import { Link } from "react-router-dom";
import { memberPath } from "@/lib/urlHelpers";
import { useMemberHandles } from "@/hooks/profile/useMemberHandles";
import { sanitizeUserContent } from "@/lib/htmlSanitizer";

/**
 * Renders text content with:
 * - @[Name](userId) → clickable profile link
 * - #hashtag → clickable hashtag link
 */

interface Props {
  content: string;
  className?: string;
}

// Matches @[Display Name](uuid) or #word
const TOKEN_REGEX = /@\[([^\]]+)\]\(([^)]+)\)|#(\w+)/g;

const RichContentRenderer = ({ content, className = "" }: Props) => {
  if (!content) return null;
  const safeContent = sanitizeUserContent(content);

  /*
   * Every mentioned id in this block, resolved in ONE batched lookup before the
   * parse loop runs. Collected with its own regex instance because the loop
   * below advances lastIndex on the shared one.
   */
  const mentionIds: string[] = [];
  {
    const scan = new RegExp(TOKEN_REGEX.source, "g");
    let m: RegExpExecArray | null;
    while ((m = scan.exec(content)) !== null) {
      if (m[1] && m[2]) mentionIds.push(m[2]);
    }
  }
  const mentionHandles = useMemberHandles(mentionIds);

  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  const regex = new RegExp(TOKEN_REGEX.source, "g");

  while ((match = regex.exec(content)) !== null) {
    // Text before match
    if (match.index > lastIndex) {
      parts.push(<Fragment key={`t-${lastIndex}`}>{content.slice(lastIndex, match.index)}</Fragment>);
    }

    if (match[1] && match[2]) {
      /*
       * @mention: @[Name](userId).
       *
       * F-95 — THE ONLY PLACE IN THE APP THAT HAS AN ID AND NOTHING ELSE. A
       * mention is stored as a name and an id in the post's own text; there is
       * no profile row alongside it to carry a handle, so the handle has to be
       * looked up. useMemberHandles does that in ONE batched call for every
       * mention in the block, not one per mention.
       *
       * Until it resolves — and for a mention of a member with no handle, or
       * one the lookup could not find — the mention renders as TEXT. It still
       * reads as "@Name" and still says who was mentioned; what it does not do
       * is offer an id address.
       */
      const mentionHref = memberPath(mentionHandles.get(match[2]));
      parts.push(
        mentionHref ? (
          <Link
            key={`m-${match.index}`}
            to={mentionHref}
            className="text-primary font-semibold hover:underline"
          >
            @{match[1]}
          </Link>
        ) : (
          <span key={`m-${match.index}`} className="text-primary font-semibold">
            @{match[1]}
          </span>
        )
      );
    } else if (match[3]) {
      // #hashtag
      parts.push(
        <Link
          key={`h-${match.index}`}
          to={`/hashtag/${match[3]}`}
          className="text-primary font-medium hover:underline"
        >
          #{match[3]}
        </Link>
      );
    }

    lastIndex = match.index + match[0].length;
  }

  // Remaining text
  if (lastIndex < content.length) {
    parts.push(<Fragment key={`t-${lastIndex}`}>{content.slice(lastIndex)}</Fragment>);
  }

  return <span className={className}>{parts}</span>;
};

export default RichContentRenderer;
