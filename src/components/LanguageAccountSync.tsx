/**
 * LanguageAccountSync — makes the chosen language a per-account preference,
 * the way Facebook/Instagram do, so it follows the user across devices and
 * logins (not just per-browser).
 *
 *  • On login: load profiles.preferred_language and apply it — the account
 *    setting wins over the device/browser default.
 *  • When a logged-in user changes language: save it to their profile.
 *
 * Purely additive and fail-safe: if the profile has no language, or the write
 * fails, the device/browser default from I18nProvider stays in effect. Renders
 * nothing. Mounted once inside the auth context.
 */
import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/core/useAuth";
import { useI18n } from "@/i18n/I18nContext";
import { LANGS, type Lang } from "@/i18n/translations";

const SUPPORTED = LANGS.map((l) => l.code);
const isLang = (v: unknown): v is Lang => typeof v === "string" && SUPPORTED.includes(v as Lang);

const LanguageAccountSync = () => {
  const { user } = useAuth();
  const { lang, setLang } = useI18n();
  const syncedFor = useRef<string | null>(null);
  const profileLang = useRef<Lang | null>(null);

  // On login, pull the saved preference and apply it (account wins).
  useEffect(() => {
    if (!user?.id) { syncedFor.current = null; profileLang.current = null; return; }
    if (syncedFor.current === user.id) return;
    let alive = true;
    (async () => {
      try {
        const { data } = await supabase
          .from("profiles")
          .select("preferred_language")
          .eq("id", user.id)
          .maybeSingle();
        if (!alive) return;
        const pl = (data as { preferred_language?: unknown } | null)?.preferred_language;
        if (isLang(pl)) {
          profileLang.current = pl;
          setLang(pl);
        } else {
          profileLang.current = null;
        }
      } catch {
        /* keep device default */
      } finally {
        if (alive && user?.id) syncedFor.current = user.id;
      }
    })();
    return () => { alive = false; };
  }, [user?.id, setLang]);

  // When the logged-in user changes language, persist it to their profile.
  useEffect(() => {
    if (!user?.id) return;
    if (syncedFor.current !== user.id) return;       // wait until initial load finished
    if (profileLang.current === lang) return;        // no change to save
    profileLang.current = lang;
    supabase.from("profiles").update({ preferred_language: lang }).eq("id", user.id).then(
      () => {},
      () => {},
    );
  }, [lang, user?.id]);

  return null;
};

export default LanguageAccountSync;
