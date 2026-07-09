import { Fragment } from "react";
import { Link } from "react-router-dom";
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
      // @mention: @[Name](userId)
      parts.push(
        <Link
          key={`m-${match.index}`}
          to={`/profile/${match[2]}`}
          className="text-primary font-semibold hover:underline"
        >
          @{match[1]}
        </Link>
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
