/**
 * "See translation" under a post — shown only when the post's writing system
 * differs from the reader's app language. Tap → translated text appears below
 * with "See original" to flip back. Signed-out readers don't get the link
 * (the translate endpoint is members-only).
 */
import { useState } from "react";
import { useI18n } from "@/i18n/I18nContext";
import { useAuth } from "@/hooks/core/useAuth";
import { needsTranslation, translateText } from "@/lib/translate";

interface Props {
  text: string;
  className?: string;
}

const TranslateBar = ({ text, className = "" }: Props) => {
  const { lang, t } = useI18n();
  const { user } = useAuth();
  const [translated, setTranslated] = useState<string | null>(null);
  const [showing, setShowing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  if (!user || !text || failed || !needsTranslation(text, lang)) return null;

  const toggle = async () => {
    if (showing) {
      setShowing(false);
      return;
    }
    if (translated) {
      setShowing(true);
      return;
    }
    setLoading(true);
    try {
      const result = await translateText(text, lang);
      setTranslated(result);
      setShowing(true);
    } catch {
      // Quietly drop the affordance rather than surfacing an error state.
      setFailed(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={className}>
      <button
        onClick={toggle}
        disabled={loading}
        className="text-xs text-muted-foreground hover:text-foreground mt-0.5 font-medium disabled:opacity-60"
      >
        {loading
          ? t("post_translating", "Translating…")
          : showing
          ? t("post_see_original", "See original")
          : t("post_see_translation", "See translation")}
      </button>
      {showing && translated && (
        <p
          className="text-[13px] leading-relaxed whitespace-pre-wrap mt-1 text-foreground/90"
          style={{ fontFamily: "var(--font-body)" }}
        >
          {translated}
        </p>
      )}
    </div>
  );
};

export default TranslateBar;
