import { useState } from "react";
import RichContentRenderer from "@/components/RichContentRenderer";

interface CaptionProps {
  content: string;
  maxLines?: number;
}

const Caption = ({ content, maxLines = 2 }: CaptionProps) => {
  const [expanded, setExpanded] = useState(false);

  if (!content) return null;

  return (
    <div className="px-3 py-2">
      <div className={expanded ? "" : `line-clamp-${maxLines}`}>
        <p className="text-[13px] leading-relaxed whitespace-pre-wrap" style={{ fontFamily: "var(--font-body)" }}>
          <RichContentRenderer content={content} />
        </p>
      </div>
      {content.length > 120 && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-xs text-muted-foreground hover:text-foreground mt-0.5 font-medium"
        >
          {expanded ? "See less" : "See more"}
        </button>
      )}
    </div>
  );
};

export default Caption;
