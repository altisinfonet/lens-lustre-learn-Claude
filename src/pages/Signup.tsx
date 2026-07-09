import { Link, useNavigate } from "react-router-dom";
import { useSiteLogo } from "@/hooks/core/useSiteLogo";
import { ArrowLeft, Loader2, Mail, Eye, EyeOff } from "lucide-react";
import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/hooks/core/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { signInWithOAuth } from "@/lib/oauthHelper";
import { GoogleSignInButton } from "@/components/auth/GoogleSignInButton";
import { z } from "zod";
import SimpleCaptcha from "@/components/SimpleCaptcha";
import { useCaptureReferral } from "@/hooks/notifications/useReferral";
import { useAuthPageSettings } from "@/hooks/core/useAuthPageSettings";
import { normalizeFullName } from "@/lib/nameNormalize";

const signupSchema = z.object({
  fullName: z.string().trim().min(2, "Name must be at least 2 characters").max(37, "Name must be 37 characters or less"),
  email: z.string().trim().email("Please enter a valid email").max(255),
  password: z.string().min(8, "Password must be at least 8 characters").max(72),
});

const friendlyError = (raw: string): string => {
  const lower = raw.toLowerCase();
  if (lower.includes("failed to fetch") || lower.includes("networkerror") || lower.includes("load failed"))
    return "Unable to connect to the server. Please check your internet connection and try again.";
  if (lower.includes("already registered") || lower.includes("already been registered"))
    return "This email is already registered. Try signing in instead.";
  if (lower.includes("too many requests") || lower.includes("rate limit"))
    return "Too many attempts. Please wait a moment before trying again.";
  return raw;
};

const Signup = () => {
  const [error, setError] = useState<string | null>(null);
  const siteLogo = useSiteLogo();
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState<"google" | "apple" | "email" | null>(null);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [captchaVerified, setCaptchaVerified] = useState(false);
  const [step, setStep] = useState<1 | 2>(1);
  const { user } = useAuth();
  const navigate = useNavigate();
  useCaptureReferral();
  const { settings: authSettings } = useAuthPageSettings();
  const cfg = authSettings.signup;

  useEffect(() => {
    if (user) navigate("/dashboard");
  }, [user, navigate]);

  const handleOAuth = async (provider: "google" | "apple") => {
    setError(null);
    setLoading(provider);
    try {
      const { error } = await signInWithOAuth(provider);
      if (error) {
        setError(friendlyError(error instanceof Error ? error.message : String(error)));
        setLoading(null);
      }
    } catch (err: any) {
      setError(friendlyError(err?.message || "Something went wrong. Please try again."));
      setLoading(null);
    }
  };

  const handleStep1 = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const trimmedName = fullName.trim();
    const trimmedEmail = email.trim();
    if (trimmedName.length < 2) {
      setError("Name must be at least 2 characters");
      return;
    }
    if (!z.string().email().safeParse(trimmedEmail).success) {
      setError("Please enter a valid email");
      return;
    }
    setFullName(trimmedName);
    setEmail(trimmedEmail);
    setStep(2);
  };

  const handleEmailSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const result = signupSchema.safeParse({ fullName, email, password });
    if (!result.success) {
      setError(result.error.errors[0].message);
      return;
    }

    if (!captchaVerified) {
      setError("Please complete the security check first.");
      return;
    }

    setLoading("email");
    try {
      const normalized = normalizeFullName(result.data.fullName);
      if (!normalized) {
        setError("Name cannot be empty.");
        setLoading(null);
        return;
      }
      const { error } = await supabase.auth.signUp({
        email: result.data.email,
        password: result.data.password,
        options: {
          data: { full_name: normalized },
          emailRedirectTo: window.location.origin,
        },
      });

      if (error) {
        setError(friendlyError(error.message));
      } else {
        setSuccess(true);
        // Auto-save registration email to newsletter subscribers
        supabase.from("newsletter_subscribers" as any).upsert(
          { email: result.data.email.toLowerCase().trim(), source: "registration" } as any,
          { onConflict: "email" }
        ).then(() => {});
      }
    } catch (err: any) {
      setError(friendlyError(err?.message || "Something went wrong."));
    }
    setLoading(null);
  };

  const onCaptchaVerified = useCallback((v: boolean) => setCaptchaVerified(v), []);

  if (success) {
    return (
      <main className="min-h-screen bg-background text-foreground flex items-center justify-center px-6">
        <div className="max-w-md text-center">
          <Mail className="h-10 w-10 text-primary mx-auto mb-6" />
          <h1 className="text-3xl font-light tracking-tight mb-4" style={{ fontFamily: "var(--font-display)" }}>
            Check Your <em className="italic text-primary">Email</em>
          </h1>
          <p className="text-sm text-muted-foreground mb-8" style={{ fontFamily: "var(--font-body)" }}>
            We've sent a verification link to <strong className="text-foreground">{email}</strong>. Click the link to activate your account.
          </p>
          <Link to="/login" className="text-xs tracking-[0.15em] uppercase text-primary hover:underline" style={{ fontFamily: "var(--font-heading)" }}>
            Back to Login
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="h-screen h-[100dvh] bg-background text-foreground flex overflow-hidden">
      {/* Left — Image */}
      <div className="hidden lg:block lg:w-1/2 relative overflow-hidden">
        {cfg.background_image ? (
          <img loading="eager" decoding="async" fetchPriority="high" src={cfg.background_image} alt="Photography by 50mm Retina World" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full bg-muted" />
        )}
        <div className="absolute inset-0 bg-gradient-to-r from-background/60 to-transparent" />
      </div>

      {/* Right — Content */}
      <div className="w-full lg:w-1/2 flex flex-col justify-center items-center px-6 md:px-12 lg:px-16">
        <Link to="/" className="self-start inline-flex items-center gap-1.5 text-[10px] tracking-[0.15em] uppercase text-muted-foreground hover:text-foreground transition-colors mb-3" style={{ fontFamily: "var(--font-heading)" }}>
          <ArrowLeft className="h-3 w-3" /> Back
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
            {error}
          </div>
        )}

        <div className="space-y-2.5 max-w-sm w-full">
          {/* OAuth — only on step 1 */}
          {step === 1 && (
            <>
              <GoogleSignInButton
                onClick={() => handleOAuth("google")}
                loading={loading === "google"}
                size="sm"
              />

              {cfg.show_apple && (
                <button
                  onClick={() => handleOAuth("apple")}
                  disabled={!!loading}
                  className="w-full py-2.5 border border-foreground/30 text-foreground text-[10px] tracking-[0.15em] uppercase hover:bg-foreground hover:text-background transition-all duration-500 disabled:opacity-50 flex items-center justify-center gap-2.5"
                  style={{ fontFamily: "var(--font-heading)" }}
                >
                  {loading === "apple" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/>
                    </svg>
                  )}
                  Continue with Apple
                </button>
              )}

              <div className="flex items-center gap-3 py-1">
                <div className="flex-1 h-px bg-border" />
                <span className="text-[9px] tracking-[0.2em] uppercase text-muted-foreground" style={{ fontFamily: "var(--font-heading)" }}>
                  Or sign up with email
                </span>
                <div className="flex-1 h-px bg-border" />
              </div>
            </>
          )}

          {/* Step 1: Name + Email */}
          {step === 1 && (
            <form onSubmit={handleStep1} className="space-y-2.5">
              <div>
                <label htmlFor="signup-fullname" className="text-[9px] tracking-[0.2em] uppercase text-muted-foreground block mb-1" style={{ fontFamily: "var(--font-heading)" }}>
                  Full Name
                </label>
                <input
                  id="signup-fullname"
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Your name"
                  required
                  maxLength={37}
                  autoFocus
                  className="w-full py-2 px-3 bg-transparent border border-border text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary transition-colors"
                  style={{ fontFamily: "var(--font-body)" }}
                />
              </div>
              <div>
                <label htmlFor="signup-email" className="text-[9px] tracking-[0.2em] uppercase text-muted-foreground block mb-1" style={{ fontFamily: "var(--font-heading)" }}>
                  Email
                </label>
                <input
                  id="signup-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                  maxLength={255}
                  className="w-full py-2 px-3 bg-transparent border border-border text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary transition-colors"
                  style={{ fontFamily: "var(--font-body)" }}
                />
              </div>
              <button
                type="submit"
                className="w-full py-2.5 bg-primary text-primary-foreground text-[10px] tracking-[0.15em] uppercase hover:opacity-90 transition-opacity duration-500 flex items-center justify-center gap-2.5"
                style={{ fontFamily: "var(--font-heading)" }}
              >
                <Mail className="h-3.5 w-3.5" /> Proceed
              </button>
            </form>
          )}

          {/* Step 2: Password + Captcha */}
          {step === 2 && (
            <form onSubmit={handleEmailSignup} className="space-y-2.5">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs text-muted-foreground truncate" style={{ fontFamily: "var(--font-body)" }}>{fullName} · {email}</span>
                <button type="button" onClick={() => { setStep(1); setPassword(""); setError(null); setCaptchaVerified(false); }} className="text-[10px] tracking-[0.15em] uppercase text-primary hover:underline shrink-0" style={{ fontFamily: "var(--font-heading)" }}>
                  Change
                </button>
              </div>
              <div>
                <label htmlFor="signup-password" className="text-[9px] tracking-[0.2em] uppercase text-muted-foreground block mb-1" style={{ fontFamily: "var(--font-heading)" }}>
                  Password
                </label>
                <div className="relative">
                  <input
                    id="signup-password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Min 8 characters"
                    required
                    maxLength={72}
                    autoFocus
                    className="w-full py-2 px-3 pr-10 bg-transparent border border-border text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary transition-colors"
                    style={{ fontFamily: "var(--font-body)" }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                </div>
                {password.length > 0 && (() => {
                  let score = 0;
                  if (password.length >= 8) score++;
                  if (password.length >= 12) score++;
                  if (/[A-Z]/.test(password)) score++;
                  if (/[0-9]/.test(password)) score++;
                  if (/[^A-Za-z0-9]/.test(password)) score++;
                  const label = score <= 1 ? "Weak" : score <= 2 ? "Fair" : score <= 3 ? "Good" : "Strong";
                  const colors = ["bg-destructive", "bg-destructive", "bg-yellow-500", "bg-primary", "bg-green-500"];
                  const textColors = ["text-destructive", "text-destructive", "text-yellow-500", "text-primary", "text-green-500"];
                  return (
                    <div className="mt-1 flex items-center gap-2">
                      <div className="flex gap-0.5 flex-1">
                        {Array.from({ length: 5 }).map((_, i) => (
                          <div key={i} className={`h-0.5 flex-1 rounded-full transition-all duration-500 ${i < score ? colors[score - 1] : "bg-border"}`} />
                        ))}
                      </div>
                      <span className={`text-[8px] tracking-[0.1em] uppercase ${textColors[score - 1] || "text-muted-foreground"}`} style={{ fontFamily: "var(--font-heading)" }}>
                        {label}
                      </span>
                    </div>
                  );
                })()}
              </div>

              <SimpleCaptcha onVerified={onCaptchaVerified} />

              <button
                type="submit"
                disabled={!!loading || !captchaVerified}
                className="w-full py-2.5 bg-primary text-primary-foreground text-[10px] tracking-[0.15em] uppercase hover:opacity-90 transition-opacity duration-500 disabled:opacity-50 flex items-center justify-center gap-2.5"
                style={{ fontFamily: "var(--font-heading)" }}
              >
                {loading === "email" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Mail className="h-3.5 w-3.5" />}
                Create Account
              </button>
            </form>
          )}
        </div>

        <p className="text-[10px] text-muted-foreground mt-4 text-center" style={{ fontFamily: "var(--font-body)" }}>
          Already have an account?{" "}
          <Link to="/login" className="text-primary hover:underline">Sign in</Link>
        </p>

        <p className="text-[8px] text-muted-foreground/60 mt-1.5 text-center" style={{ fontFamily: "var(--font-body)" }}>
          By continuing, you agree to our terms of service and privacy policy.
        </p>
      </div>
    </main>
  );
};

export default Signup;
