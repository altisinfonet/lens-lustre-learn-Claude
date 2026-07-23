/**
 * LanguagePicker — switches the app's own language via the free i18n layer.
 *
 * The old Google Translate website widget it used before was discontinued by
 * Google (it loaded but returned zero languages, so nothing ever translated).
 * That entire dependency is gone. This now flips the app between the languages
 * we actually ship translations for, instantly, on web and in the app.
 */
import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/i18n/I18nContext";
import { LANGS } from "@/i18n/translations";

interface Props {
  compact?: boolean;
  className?: string;
}

const LanguagePicker = ({ compact = false, className = "" }: Props) => {
  const { lang, setLang } = useI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const currentEntry = LANGS.find((l) => l.code === lang) || LANGS[0];

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-2 py-1.5 rounded border border-border hover:border-primary transition-colors text-xs"
        aria-label="Change language"
      >
        <span className="text-sm leading-none">{currentEntry.flag}</span>
        {!compact && (
          <span className="tracking-wide text-[10px] max-w-[70px] truncate hidden sm:inline" style={{ fontFamily: "var(--font-heading)" }}>
            {currentEntry.label}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 z-[100] bg-card border border-border shadow-lg rounded-md p-2 w-52">
          {LANGS.map((l) => (
            <button
              key={l.code}
              onClick={() => { setLang(l.code); setOpen(false); }}
              className={`w-full text-left text-xs px-2 py-2 rounded transition-colors flex items-center gap-2 ${
                lang === l.code ? "bg-primary text-primary-foreground" : "hover:bg-muted text-foreground"
              }`}
            >
              <span className="text-sm leading-none shrink-0">{l.flag}</span>
              <span className="truncate">{l.label}{l.code === "en" ? " (Original)" : ""}</span>
            </button>
          ))}
          <p className="text-[9px] text-muted-foreground px-2 pt-2 pb-1 leading-snug" style={{ fontFamily: "var(--font-body)" }}>
            More languages are being added.
          </p>
        </div>
      )}
    </div>
  );
};

export default LanguagePicker;
