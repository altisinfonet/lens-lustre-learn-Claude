import { Link } from "react-router-dom";
import { ArrowLeft, Loader2, Mail } from "lucide-react";
import { useState } from "react";
import { useT } from "@/i18n/I18nContext";
import { supabase } from "@/integrations/supabase/client";
import { z } from "zod";
import { getCaptchaToken } from "@/lib/turnstile";

// Zod runs at module scope, outside the component, so it cannot call t().
// It stores a translation KEY instead; the render site translates it. Server
// messages from Supabase come through the same state and are not keys, so the
// render site passes them as their own fallback and they render unchanged.
const emailSchema = z.string().trim().email("auth.invalidEmail").max(255);

const ForgotPassword = () => {
  const t = useT();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotFound(false);

    const result = emailSchema.safeParse(email);
    if (!result.success) {
      setError(result.error.errors[0].message);
      return;
    }

    setLoading(true);

    // Direct existence check (owner's UX decision): tell the user plainly
    // whether the account exists instead of the generic "if an account
    // exists..." message. Fail-open: if the check itself errors, fall back to
    // the old behavior and just send the reset request.
    let exists: boolean | null = null;
    try {
      const { data, error: checkError } = await (supabase as any).rpc("email_exists", {
        _email: result.data,
      });
      if (!checkError && typeof data === "boolean") exists = data;
    } catch {
      exists = null; // check unavailable — behave like before
    }

    if (exists === false) {
      setNotFound(true);
      setLoading(false);
      return;
    }

    const captchaToken = await getCaptchaToken(); // BUG-043
    const { error } = await supabase.auth.resetPasswordForEmail(result.data, {
      redirectTo: `${window.location.origin}/reset-password`,
      captchaToken,
    });

    if (error) {
      setError(error.message);
    } else {
      setSent(true);
    }
    setLoading(false);
  };

  if (notFound) {
    return (
      <main className="min-h-screen bg-background text-foreground flex items-center justify-center px-6">
        <div className="max-w-md text-center">
          <Mail className="h-10 w-10 text-primary mx-auto mb-6" />
          <h1 className="text-3xl font-light tracking-tight mb-4" style={{ fontFamily: "var(--font-display)" }}>
            {t("fp.noAccountA")} <em className="italic text-primary">{t("fp.noAccountB")}</em>
          </h1>
          <p className="text-sm text-muted-foreground mb-8" style={{ fontFamily: "var(--font-body)" }}>
            {t("fp.noAccountBody1")} <strong className="text-foreground">{email}</strong>{t("fp.noAccountBody2")}
          </p>
          <div className="space-y-4">
            <Link
              to={`/signup?email=${encodeURIComponent(email)}`}
              className="block w-full py-3.5 bg-primary text-primary-foreground text-xs tracking-[0.15em] uppercase hover:opacity-90 transition-opacity duration-500"
              style={{ fontFamily: "var(--font-heading)" }}
            >
              {t("auth.createAccount")}
            </Link>
            <button
              type="button"
              onClick={() => setNotFound(false)}
              className="text-xs tracking-[0.15em] uppercase text-muted-foreground hover:text-foreground transition-colors"
              style={{ fontFamily: "var(--font-heading)" }}
            >
              {t("fp.tryDifferent")}
            </button>
          </div>
        </div>
      </main>
    );
  }

  if (sent) {
    return (
      <main className="min-h-screen bg-background text-foreground flex items-center justify-center px-6">
        <div className="max-w-md text-center">
          <Mail className="h-10 w-10 text-primary mx-auto mb-6" />
          <h1 className="text-3xl font-light tracking-tight mb-4" style={{ fontFamily: "var(--font-display)" }}>
            {t("fp.checkA")} <em className="italic text-primary">{t("fp.checkB")}</em>
          </h1>
          <p className="text-sm text-muted-foreground mb-8" style={{ fontFamily: "var(--font-body)" }}>
            {t("fp.sentBody1")} <strong className="text-foreground">{email}</strong>{t("fp.sentBody2")}
          </p>
          <Link to="/login" className="text-xs tracking-[0.15em] uppercase text-primary hover:underline" style={{ fontFamily: "var(--font-heading)" }}>
            {t("auth.backToLogin")}
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background text-foreground flex items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <Link to="/login" className="inline-flex items-center gap-2 text-xs tracking-[0.15em] uppercase text-muted-foreground hover:text-foreground transition-colors duration-500 mb-12" style={{ fontFamily: "var(--font-heading)" }}>
          <ArrowLeft className="h-3 w-3" /> {t("auth.backToLogin")}
        </Link>

        <h1 className="text-3xl md:text-4xl font-light tracking-tight mb-3" style={{ fontFamily: "var(--font-display)" }}>
          {t("fp.titleA")} <em className="italic text-primary">{t("fp.titleB")}</em>
        </h1>
        <p className="text-sm text-muted-foreground mb-8" style={{ fontFamily: "var(--font-body)" }}>
          {t("reset.forgotSubtitle")}
        </p>

        {error && (
          <div className="mb-6 text-sm text-destructive border border-destructive/30 px-4 py-3" style={{ fontFamily: "var(--font-body)" }}>
            {t(error, error)}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-[10px] tracking-[0.2em] uppercase text-muted-foreground block mb-1.5" style={{ fontFamily: "var(--font-heading)" }}>
              {t("auth.email")}
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              maxLength={255}
              className="w-full py-3 px-4 bg-transparent border border-border text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary transition-colors"
              style={{ fontFamily: "var(--font-body)" }}
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full py-3.5 bg-primary text-primary-foreground text-xs tracking-[0.15em] uppercase hover:opacity-90 transition-opacity duration-500 disabled:opacity-50 flex items-center justify-center gap-3"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {t("reset.sendResetLink")}
          </button>
        </form>
      </div>
    </main>
  );
};

export default ForgotPassword;
