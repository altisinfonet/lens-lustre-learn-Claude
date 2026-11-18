import { useI18n } from "@/i18n/I18nContext";
import { useSiteSetting } from "@/hooks/core/useSiteSetting";
import { readSuggestions, suggestionTexts, SUGGESTIONS_KEY } from "@/lib/comments/photoSuggestions";

/** The photography phrases for the comment box, in the member's language (src/lib/comments/photoSuggestions.ts). */
export function useCommentSuggestions(): string[] {
  const { lang } = useI18n();
  const { data } = useSiteSetting<unknown>(SUGGESTIONS_KEY);
  return suggestionTexts(readSuggestions(data), lang);
}
