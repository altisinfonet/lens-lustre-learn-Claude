import { Link, useNavigate } from "react-router-dom";
import { useSiteLogo } from "@/hooks/core/useSiteLogo";
import { useT } from "@/i18n/I18nContext";
import { ArrowLeft, Loader2, Mail, Eye, EyeOff, ShieldCheck, ShieldX, Timer } from "lucide-react";
import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/hooks/core/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { signInWithOAuth } from "@/lib/oauthHelper";
import { GoogleSignInButton } from "@/components/auth/GoogleSignInButton";
import { z } from "zod";
import SimpleCaptcha from "@/components/SimpleCaptcha";
import { useTrustedDevice } from "@/hooks/core/useTrustedDevice";
import { useAuthPageSettings } from "@/hooks/core/useAuthPageSettings";
import { getCaptchaToken } from "@/lib/turnstile";
import {
  getLockedOutSeconds,
  getFailedAttempts,
  recordFailedAttempt,
  resetLockout,
} from "@/lib/passwordSecurity";

const loginSchema = z.object({
  email: z.string().trim().email("Please enter a valid email").max(255),
  password: z.string().min(1, "Password is required").max(72),
});

const isNetworkError = (msg: string): boolean => {
  const lower = msg.toLowerCase();
  return lower.includes("failed to fetch") || lower.includes("networkerror") || lower.includes("load failed");
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const withNetworkRetry = async <T,>(operation: () => Promise<T>, retries = 2): Promise<T> => {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await operation();
    } catch (error: any) {
      const message = error?.message || "";
      if (!isNetworkError(message) || attempt === retries) {
        throw error;
      }
      await wait(800 * (attempt + 1));
    }
  }
  throw new Error("Network retry exhausted");
};

/**
 * Maps a raw Supabase error to a translation KEY, not to English text.
 * This function sits at module scope so it cannot call t(); the render site
 * translates whatever lands in `error` state. A raw message we do not
 * recognise is returned unchanged and t(raw, raw) passes it through, so
 * unmapped server errors still display exactly as before.
 */
const friendlyError = (raw: string): string => {
  const lower = raw.toLowerCase();
  if (isNetworkError(raw)) return "login.errNetwork";
  if (lower.includes("invalid login credentials")) return "login.errCredentials";
  if (lower.includes("email not confirmed")) return "login.errUnverified";
  if (lower.includes("too many requests") || lower.includes("rate limit")) return "login.errRateLimit";
  return raw;
};

const Login = () => {
  const t = useT();
  const [error, setError] = useState<string | null>(null);
  const siteLogo = useSiteLogo();
  const [loading, setLoading] = useState<"google" | "apple" | "email" | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [step, setStep] = useState<1 | 2>(1);
  const [failedAttempts, setFailedAttempts] = useState(() => getFailedAttempts());
  const [captchaVerified, setCaptchaVerified] = useState(false);
  const [showTrustPrompt, setShowTrustPrompt] = useState(false);
  const [lockoutSeconds, setLockoutSeconds] = useState(() => getLockedOutSeconds());
  const { user } = useAuth();
  const navigate = useNavigate();
  const { isDeviceTrusted, trustDevice } = useTrustedDevice();
  const { settings: authSettings } = useAuthPageSettings();
  const cfg = authSettings.login;

  const needsCaptcha = failedAttempts >= 3;

  // Show suspension message if redirected from forced sign-out
  useEffect(() => {
    const msg = sessionStorage.getItem("suspension_message");
    if (msg) {
      setError(msg);
      sessionStorage.removeItem("suspension_message");
    }
  }, []);
  // Countdown timer for lockout
  useEffect(() => {
    if (lockoutSeconds <= 0) return;
    const interval = setInterval(() => {
      const remaining = getLockedOutSeconds();
      setLockoutSeconds(remaining);
      if (remaining <= 0) clearInterval(interval);
    }, 1000);
    return () => clearInterval(interval);
  }, [lockoutSeconds]);

  useEffect(() => {
    if (user && !showTrustPrompt) {
      if (isDeviceTrusted(user.id)) {
        navigate("/feed");
      } else {
        setShowTrustPrompt(true);
      }
    }
  }, [user, navigate, isDeviceTrusted, showTrustPrompt]);

  const handleTrustDecision = (trust: boolean) => {
    if (trust && user) {
      trustDevice(user.id);
    }
    setShowTrustPrompt(false);
    navigate("/feed");
  };

  const handleOAuth = async (provider: "google" | "apple") => {
    setError(null);
    setLoading(provider);
    try {
      try {
        await supabase.auth.signOut({ scope: 'local' });
      } catch {
        // Ignore
      }
      const { error } = await signInWithOAuth(provider);
      if (error) {
        setError(friendlyError(error instanceof Error ? error.message : String(error)));
        setLoading(null);
      }
    } catch (err: any) {
      setError(friendlyError(err?.message || "common.somethingWrongRetry"));
      setLoading(null);
    }
  };

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Check lockout
    const remaining = getLockedOutSeconds();
    if (remaining > 0) {
      setLockoutSeconds(remaining);
      setError(t("login.tempLocked").replace("{t}", formatTime(remaining, t)));
      return;
    }

    const result = loginSchema.safeParse({ email, password });
    if (!result.success) {
      setError(result.error.errors[0].message);
      return;
    }

    if (needsCaptcha && !captchaVerified) {
      setError("Please complete the security check first.");
      return;
    }

    setLoading("email");

    try {
      await supabase.auth.signOut({ scope: 'local' });
    } catch {
      // Ignore
    }

    try {
      // BUG-043: Supabase Auth enforces Turnstile server-side; a fresh
      // single-use token is required for every password attempt.
      const captchaToken = await getCaptchaToken();
      const res = await withNetworkRetry(
        () =>
          supabase.auth.signInWithPassword({
            email: result.data.email,
            password: result.data.password,
            options: { captchaToken },
          }),
        2
      );

      if (res.error) {
        if (!isNetworkError(res.error.message)) {
          const lockoutDuration = recordFailedAttempt();
          const attempts = getFailedAttempts();
          setFailedAttempts(attempts);
          setCaptchaVerified(false);

          if (lockoutDuration > 0) {
            setLockoutSeconds(lockoutDuration);
            setError(t("login.lockedFor").replace("{t}", formatTime(lockoutDuration, t)));
          } else {
            setError(friendlyError(res.error.message));
          }
        } else {
          setError(friendlyError(res.error.message));
        }
      } else {
        // Success — reset lockout
        resetLockout();
        setFailedAttempts(0);
      }
    } catch (err: any) {
      const message = err?.message || "common.somethingWrong";
      setError(friendlyError(message));
      if (!isNetworkError(message)) {
        const lockoutDuration = recordFailedAttempt();
        setFailedAttempts(getFailedAttempts());
        setCaptchaVerified(false);
        if (lockoutDuration > 0) setLockoutSeconds(lockoutDuration);
      }
    }
    setLoading(null);
  };

  const onCaptchaVerified = useCallback((v: boolean) => setCaptchaVerified(v), []);

  const isLockedOut = lockoutSeconds > 0;

  // Trust this device prompt
  if (showTrustPrompt) {
    return (
      <main className="min-h-screen bg-background text-foreground flex items-center justify-center px-6">
        <div className="max-w-sm w-full text-center space-y-8">
          <ShieldCheck className="h-12 w-12 text-primary mx-auto" />
          <h1 className="text-2xl font-light tracking-tight" style={{ fontFamily: "var(--font-display)" }}>
            {t("login.trustA")} <em className="italic text-primary">{t("login.trustB")}</em>?
          </h1>
          <p className="text-sm text-muted-foreground leading-relaxed" style={{ fontFamily: "var(--font-body)" }}>
            {t("login.trustBody")}
          </p>
          <div className="space-y-3">
            <button
              onClick={() => handleTrustDecision(true)}
              className="w-full py-3.5 bg-primary text-primary-foreground text-xs tracking-[0.15em] uppercase hover:opacity-90 transition-opacity duration-500 flex items-center justify-center gap-2"
              style={{ fontFamily: "var(--font-heading)" }}
            >
              <ShieldCheck className="h-4 w-4" /> {t("login.trustYes")}
            </button>
            <button
              onClick={() => handleTrustDecision(false)}
              className="w-full py-3.5 border border-border text-foreground text-xs tracking-[0.15em] uppercase hover:bg-muted transition-colors duration-500 flex items-center justify-center gap-2"
              style={{ fontFamily: "var(--font-heading)" }}
            >
              <ShieldX className="h-4 w-4" /> {t("login.trustNo")}
            </button>
          </div>
          <p className="text-[10px] text-muted-foreground/60" style={{ fontFamily: "var(--font-body)" }}>
            {t("login.trustHint")}
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="h-screen h-[100dvh] bg-background text-foreground flex overflow-hidden">
      {/* Left — Image */}
      <div className="hidden lg:block lg:w-1/2 relative overflow-hidden">
        {cfg.background_image ? (
          <img loading="eager" decoding="async" fetchPriority="high" src={cfg.background_image} alt={t("login.altBackground")} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full bg-muted" />
        )}
        <div className="absolute inset-0 bg-gradient-to-r from-background/60 to-transparent" />
      </div>

      {/* Right — Content */}
      <div className="w-full lg:w-1/2 flex flex-col justify-center items-center px-6 md:px-12 lg:px-16">
        <Link to="/" className="self-start inline-flex items-center gap-1.5 text-[10px] tracking-[0.15em] uppercase text-muted-foreground hover:text-foreground transition-colors mb-3" style={{ fontFamily: "var(--font-heading)" }}>
          <ArrowLeft className="h-3 w-3" /> {t("common.back")}
        </Link>

        <div className="flex flex-col items-center text-center mb-3">
          {cfg.show_logo && (
            <img loading="eager" decoding="async" fetchPriority="high" src={siteLogo} alt="50mm Retina World" style={{ height: 128, width: 128 }} className="object-contain mb-2" />
          )}
          <h1 className="text-2xl md:text-3xl font-light tracking-tight" style={{ fontFamily: "var(--font-display)" }}>
            {cfg.heading} <em className="italic text-primary">{cfg.heading_accent}</em>
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5" style={{ fontFamily: "var(--font-body)" }}>{cfg.subtitle}</p>
        </div>

        {error && (
          <div className="mb-3 text-xs text-destructive border border-destructive/30 px-3 py-2 max-w-sm w-full text-center" style={{ fontFamily: "var(--font-body)" }}>
            {t(error, error)}
          </div>
        )}

        {/* Lockout timer */}
        {isLockedOut && (
          <div className="mb-6 flex items-center gap-3 text-sm text-destructive border border-destructive/30 px-4 py-3 max-w-sm w-full" style={{ fontFamily: "var(--font-body)" }}>
            <Timer className="h-5 w-5 flex-shrink-0 animate-pulse" />
            <div>
              <span className="font-medium">{t("login.accountLocked")}</span>
              <span className="block text-xs text-muted-foreground mt-0.5">
                {t("login.tryAgainIn").replace("{t}", formatTime(lockoutSeconds, t))}
              </span>
            </div>
          </div>
        )}

        {!isLockedOut && failedAttempts > 0 && failedAttempts < 3 && (
          <div className="mb-4 text-[10px] tracking-[0.15em] uppercase text-muted-foreground max-w-sm w-full text-center" style={{ fontFamily: "var(--font-heading)" }}>
            {t(3 - failedAttempts > 1 ? "login.attemptsRemaining" : "login.attemptRemainingOne").replace("{n}", String(3 - failedAttempts))}
          </div>
        )}

        <div className="space-y-4 max-w-sm w-full">
          {/* OAuth buttons */}
          <GoogleSignInButton
            onClick={() => handleOAuth("google")}
            loading={loading === "google"}
            disabled={isLockedOut}
          />

          {cfg.show_apple && (
            <button
              onClick={() => handleOAuth("apple")}
              disabled={!!loading || isLockedOut}
              className="w-full py-3.5 border border-foreground/30 text-foreground text-xs tracking-[0.15em] uppercase hover:bg-foreground hover:text-background transition-all duration-500 disabled:opacity-50 flex items-center justify-center gap-3"
              style={{ fontFamily: "var(--font-heading)" }}
            >
              {loading === "apple" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/>
                </svg>
              )}
              {t("auth.continueApple")}
            </button>
          )}

          {/* Divider */}
          <div className="flex items-center gap-4 py-2">
            <div className="flex-1 h-px bg-border" />
            <span className="text-[10px] tracking-[0.2em] uppercase text-muted-foreground" style={{ fontFamily: "var(--font-heading)" }}>
              {t("auth.orSignInEmail")}
            </span>
            <div className="flex-1 h-px bg-border" />
          </div>

          {/* Email/Password form — two-step */}
          <form onSubmit={step === 1 ? (e) => { e.preventDefault(); setError(null); const trimmed = email.trim(); if (!z.string().email().safeParse(trimmed).success) { setError("auth.invalidEmail"); return; } setEmail(trimmed); setStep(2); } : handleEmailLogin} className="space-y-4">
            {step === 1 ? (
              <>
                <div>
                  <label htmlFor="login-email" className="text-[10px] tracking-[0.2em] uppercase text-muted-foreground block mb-1.5" style={{ fontFamily: "var(--font-heading)" }}>
                    {t("auth.email")}
                  </label>
                  <input
                    id="login-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    required
                    maxLength={255}
                    disabled={isLockedOut}
                    autoFocus
                    className="w-full py-3 px-4 bg-transparent border border-border text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary transition-colors disabled:opacity-50"
                    style={{ fontFamily: "var(--font-body)" }}
                  />
                </div>
                <button
                  type="submit"
                  disabled={isLockedOut}
                  className="w-full py-3.5 bg-primary text-primary-foreground text-xs tracking-[0.15em] uppercase hover:opacity-90 transition-opacity duration-500 disabled:opacity-50 flex items-center justify-center gap-3"
                  style={{ fontFamily: "var(--font-heading)" }}
                >
                  <Mail className="h-4 w-4" /> {t("auth.proceed")}
                </button>
              </>
            ) : (
              <>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs text-muted-foreground truncate" style={{ fontFamily: "var(--font-body)" }}>{email}</span>
                  <button type="button" onClick={() => { setStep(1); setPassword(""); setError(null); }} className="text-[10px] tracking-[0.15em] uppercase text-primary hover:underline shrink-0" style={{ fontFamily: "var(--font-heading)" }}>
                    {t("auth.change")}
                  </button>
                </div>
                <div>
                  <label htmlFor="login-password" className="text-[10px] tracking-[0.2em] uppercase text-muted-foreground block mb-1.5" style={{ fontFamily: "var(--font-heading)" }}>
                    {t("auth.password")}
                  </label>
                  <div className="relative">
                    <input
                      id="login-password"
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={t("auth.phPassword")}
                      required
                      maxLength={72}
                      disabled={isLockedOut}
                      autoFocus
                      className="w-full py-3 px-4 pr-12 bg-transparent border border-border text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary transition-colors disabled:opacity-50"
                      style={{ fontFamily: "var(--font-body)" }}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-foreground/70 hover:text-foreground transition-colors"
                      aria-label={showPassword ? t("auth.hidePassword") : t("auth.showPassword")}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                {needsCaptcha && !isLockedOut && (
                  <SimpleCaptcha onVerified={onCaptchaVerified} />
                )}

                <button
                  type="submit"
                  disabled={!!loading || (needsCaptcha && !captchaVerified) || isLockedOut}
                  className="w-full py-3.5 bg-primary text-primary-foreground text-xs tracking-[0.15em] uppercase hover:opacity-90 transition-opacity duration-500 disabled:opacity-50 flex items-center justify-center gap-3"
                  style={{ fontFamily: "var(--font-heading)" }}
                >
                  {loading === "email" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
                  {isLockedOut ? t("auth.locked") : t("auth.signIn")}
                </button>

                <div className="text-center">
                  <Link to="/forgot-password" className="text-[10px] tracking-[0.15em] uppercase text-primary hover:underline" style={{ fontFamily: "var(--font-heading)" }}>
                    {t("auth.forgotPassword")}
                  </Link>
                </div>
              </>
            )}
          </form>
        </div>

        <p className="text-[10px] text-muted-foreground mt-4 text-center" style={{ fontFamily: "var(--font-body)" }}>
          {t("auth.noAccount")}{" "}
          <Link to="/signup" className="text-primary hover:underline">{t("auth.createOne")}</Link>
        </p>

        <p className="text-[8px] text-muted-foreground/60 mt-1.5 text-center" style={{ fontFamily: "var(--font-body)" }}>
          {t("auth.terms")}
        </p>
      </div>
    </main>
  );
};

// Takes t so the minute/second abbreviations render in the chosen language.
// Digits stay Western Arabic, which is what all seven locales use in practice.
function formatTime(seconds: number, t: (key: string, fallback?: string) => string): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  const mu = t("common.minShort", "m");
  const su = t("common.secShort", "s");
  if (m > 0) return `${m}${mu} ${s}${su}`;
  return `${s}${su}`;
}

export default Login;
