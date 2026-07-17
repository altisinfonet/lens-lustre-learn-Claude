import { Link, useNavigate } from "react-router-dom";
import { CheckCircle, Loader2, Lock, AlertTriangle, Eye, EyeOff, LogOut } from "lucide-react";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { z } from "zod";
import {
  validatePasswordStrength,
  isPasswordReused,
  recordPasswordUsage,
} from "@/lib/passwordSecurity";

const passwordSchema = z.string().min(8, "Password must be at least 8 characters").max(72);

const ResetPassword = () => {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isRecovery, setIsRecovery] = useState(false);
  const [success, setSuccess] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [pendingToken, setPendingToken] = useState<string | null>(null);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [verifyingToken, setVerifyingToken] = useState(false);

  useEffect(() => {
    // Check if recovery was already detected globally (AuthProvider fires first)
    if ((window as any).__passwordRecoveryActive || sessionStorage.getItem("password_recovery_active") === "true") {
      setIsRecovery(true);
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY") {
        setIsRecovery(true);
        setPendingToken(null);
        setPendingEmail(null);
        sessionStorage.setItem("password_recovery_active", "true");
        if (session?.user?.id) setUserId(session.user.id);
      }
    });

    // Check URL hash and search params
    const hash = window.location.hash;
    const hashParams = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
    const params = new URLSearchParams(window.location.search);

    const typeFromHash = hashParams.get("type");
    const typeFromQuery = params.get("type");
    const hasAccessToken = hashParams.has("access_token") || hashParams.has("refresh_token");

    if (typeFromHash === "recovery" || typeFromQuery === "recovery" || hasAccessToken) {
      setIsRecovery(true);
    }

    // Scanner-safe recovery path from custom template: verify token only on explicit user action
    const recoveryToken = params.get("recovery_token");
    const recoveryEmail = params.get("recovery_email");
    if (recoveryToken && recoveryEmail) {
      setPendingToken(recoveryToken);
      setPendingEmail(recoveryEmail);
    }

    // BUG-051: a plain authenticated session must NOT grant password-reset access.
    // Recovery is entered ONLY via a real recovery signal (PASSWORD_RECOVERY event,
    // a verified recovery_token, or a recovery-type / access_token hash from the
    // email link) — all handled above. Here we only populate userId for the
    // reuse/history checks; we do NOT set isRecovery just because a session exists,
    // otherwise anyone on a shared logged-in browser could reset the password with
    // no old password or emailed token.
    supabase.auth.getUser().then(({ data }) => {
      if (data.user?.id) {
        setUserId(data.user.id);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const passwordValidation = password.length > 0 ? validatePasswordStrength(password) : null;

  const handleVerifyRecoveryToken = async () => {
    if (!pendingToken || !pendingEmail) return;

    setVerifyingToken(true);
    setError(null);

    const { error } = await supabase.auth.verifyOtp({
      email: pendingEmail,
      token: pendingToken,
      type: "recovery",
    });

    if (error) {
      setError("This reset link is invalid or has expired. Please request a new one.");
      setVerifyingToken(false);
      return;
    }

    sessionStorage.setItem("password_recovery_active", "true");
    (window as any).__passwordRecoveryActive = true;

    const { data } = await supabase.auth.getUser();
    if (data.user?.id) {
      setUserId(data.user.id);
    }

    setPendingToken(null);
    setPendingEmail(null);
    setIsRecovery(true);
    setVerifyingToken(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const result = passwordSchema.safeParse(password);
    if (!result.success) {
      setError(result.error.errors[0].message);
      return;
    }

    // Validate password strength
    const strength = validatePasswordStrength(password);
    if (!strength.valid) {
      setError(strength.errors[0]);
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    // Check password reuse
    if (userId) {
      const reused = await isPasswordReused(userId, password);
      if (reused) {
        setError("You cannot reuse a recent password. Please choose a new one.");
        return;
      }
    }

    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setError(error.message);
    } else {
      // Record the password in history
      if (userId) {
        await recordPasswordUsage(userId, password);
      }
      // Clean up recovery flags
      sessionStorage.removeItem("password_recovery_active");
      delete (window as any).__passwordRecoveryActive;
      setSuccess(true);
    }
    setLoading(false);
  };

  if (!isRecovery) {
    return (
      <main className="min-h-screen bg-background text-foreground flex items-center justify-center px-6">
        <div className="max-w-md text-center">
          <Lock className="h-10 w-10 text-muted-foreground mx-auto mb-6" />
          <h1 className="text-2xl font-light tracking-tight mb-4" style={{ fontFamily: "var(--font-display)" }}>
            {pendingToken && pendingEmail ? "Confirm Reset Request" : "Invalid Reset Link"}
          </h1>
          <p className="text-sm text-muted-foreground mb-8" style={{ fontFamily: "var(--font-body)" }}>
            {pendingToken && pendingEmail
              ? "Tap below to continue securely and set your new password."
              : "This link is invalid or has expired. Please request a new password reset."}
          </p>

          {error ? (
            <div className="mb-6 text-sm text-destructive border border-destructive/30 px-4 py-3" style={{ fontFamily: "var(--font-body)" }}>
              {error}
            </div>
          ) : null}

          {pendingToken && pendingEmail ? (
            <button
              type="button"
              onClick={handleVerifyRecoveryToken}
              disabled={verifyingToken}
              className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-primary text-primary-foreground text-xs tracking-[0.12em] uppercase hover:opacity-90 transition-opacity duration-500 disabled:opacity-50"
              style={{ fontFamily: "var(--font-heading)" }}
            >
              {verifyingToken ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Continue Reset
            </button>
          ) : (
            <Link to="/forgot-password" className="text-xs tracking-[0.15em] uppercase text-primary hover:underline" style={{ fontFamily: "var(--font-heading)" }}>
              Request New Link
            </Link>
          )}
        </div>
      </main>
    );
  }

  if (success) {

    const handleGlobalSignOut = async () => {
      setSigningOut(true);
      await supabase.auth.signOut({ scope: "global" });
      navigate("/login", { replace: true });
    };

    return (
      <main className="min-h-screen bg-background text-foreground flex items-center justify-center px-6">
        <div className="max-w-md text-center">
          <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-8">
            <CheckCircle className="h-8 w-8 text-primary" />
          </div>
          <h1 className="text-3xl md:text-4xl font-light tracking-tight mb-4" style={{ fontFamily: "var(--font-display)" }}>
            Password <em className="italic text-primary">Updated</em>
          </h1>
          <p className="text-sm text-muted-foreground mb-6 leading-relaxed" style={{ fontFamily: "var(--font-body)" }}>
            Your password has been successfully changed. For security, we recommend signing out from all devices so every session uses the new password.
          </p>

          <button
            onClick={handleGlobalSignOut}
            disabled={signingOut}
            className="w-full inline-flex items-center justify-center gap-2.5 px-8 py-3.5 bg-primary text-primary-foreground text-xs tracking-[0.2em] uppercase hover:opacity-90 transition-opacity duration-500 disabled:opacity-50"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            {signingOut ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
            Sign Out From All Devices
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background text-foreground flex items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <Lock className="h-8 w-8 text-primary mb-8" />

        <h1 className="text-3xl md:text-4xl font-light tracking-tight mb-3" style={{ fontFamily: "var(--font-display)" }}>
          Set New <em className="italic text-primary">Password</em>
        </h1>
        <p className="text-sm text-muted-foreground mb-8" style={{ fontFamily: "var(--font-body)" }}>
          Choose a strong password for your account.
        </p>

        {error && (
          <div className="mb-6 text-sm text-destructive border border-destructive/30 px-4 py-3" style={{ fontFamily: "var(--font-body)" }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-[10px] tracking-[0.2em] uppercase text-muted-foreground block mb-1.5" style={{ fontFamily: "var(--font-heading)" }}>
              New Password
            </label>
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Min 8 characters"
                required
                maxLength={72}
                className="w-full py-3 px-4 pr-11 bg-transparent border border-border text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary transition-colors"
                style={{ fontFamily: "var(--font-body)" }}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                tabIndex={-1}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {/* Password requirements */}
            {passwordValidation && (
              <div className="mt-2 space-y-1.5">
                {/* Strength bar */}
                <div className="flex gap-1">
                  {Array.from({ length: 5 }).map((_, i) => {
                    const colors = ["bg-destructive", "bg-destructive", "bg-yellow-500", "bg-primary", "bg-green-500"];
                    return (
                      <div
                        key={i}
                        className={`h-1 flex-1 rounded-full transition-all duration-500 ${
                          i < passwordValidation.score ? colors[passwordValidation.score - 1] : "bg-border"
                        }`}
                      />
                    );
                  })}
                </div>
                {/* Requirements list */}
                {!passwordValidation.valid && (
                  <div className="space-y-0.5">
                    {passwordValidation.errors.map((err, i) => (
                      <div key={i} className="flex items-start gap-1.5 text-[9px] text-destructive" style={{ fontFamily: "var(--font-heading)" }}>
                        <AlertTriangle className="h-3 w-3 flex-shrink-0 mt-0.5" />
                        <span>{err}</span>
                      </div>
                    ))}
                  </div>
                )}
                {passwordValidation.valid && (
                  <div className="flex items-center gap-1.5 text-[9px] text-green-500" style={{ fontFamily: "var(--font-heading)" }}>
                    <CheckCircle className="h-3 w-3" />
                    <span>Strong password</span>
                  </div>
                )}
              </div>
            )}
          </div>
          <div>
            <label className="text-[10px] tracking-[0.2em] uppercase text-muted-foreground block mb-1.5" style={{ fontFamily: "var(--font-heading)" }}>
              Confirm Password
            </label>
            <div className="relative">
              <input
                type={showConfirm ? "text" : "password"}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Re-enter password"
                required
                maxLength={72}
                className="w-full py-3 px-4 pr-11 bg-transparent border border-border text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary transition-colors"
                style={{ fontFamily: "var(--font-body)" }}
              />
              <button
                type="button"
                onClick={() => setShowConfirm((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                tabIndex={-1}
              >
                {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {confirmPassword.length > 0 && password !== confirmPassword && (
              <p className="mt-1.5 text-[9px] text-destructive" style={{ fontFamily: "var(--font-heading)" }}>
                Passwords do not match
              </p>
            )}
          </div>

          {/* Reuse warning */}
          <div className="flex items-start gap-2 text-[10px] text-muted-foreground px-3 py-2 border border-border rounded" style={{ fontFamily: "var(--font-body)" }}>
            <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5 text-yellow-500" />
            <span>You cannot reuse your last password.</span>
          </div>

          <button
            type="submit"
            disabled={loading || (passwordValidation !== null && !passwordValidation.valid)}
            className="w-full py-3.5 bg-primary text-primary-foreground text-xs tracking-[0.15em] uppercase hover:opacity-90 transition-opacity duration-500 disabled:opacity-50 flex items-center justify-center gap-3"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Update Password
          </button>
        </form>
      </div>
    </main>
  );
};

export default ResetPassword;
