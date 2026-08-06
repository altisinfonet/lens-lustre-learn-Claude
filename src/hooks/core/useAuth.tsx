import { createContext, useContext, useEffect, useState, useRef, ReactNode } from "react";
import { resetDashboardBootstrap } from "@/hooks/core/useDashboardInit";
import { clearFeedCache } from "@/lib/feedCache";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { getStoredReferralCode, clearStoredReferralCode } from "@/hooks/notifications/useReferral";
import { logAuthEvent } from "@/lib/activityLog";
import { normalizeFullName } from "@/lib/nameNormalize";
import { logDeviceSignIn } from "@/hooks/profile/useUserDevices";
import { logger, setLogUser } from "@/lib/logger";

interface AuthContextType {
  session: Session | null;
  user: User | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const fallbackAuthContext: AuthContextType = {
  session: null,
  user: null,
  loading: true,
  signOut: async () => {},
};

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [accountRestricted, setAccountRestricted] = useState(false);
  const signOutTriggeredRef = useRef(false);
  const hasInitializedRef = useRef(false);

  /**
   * TELL THE LOGGER WHO IS SIGNED IN.
   *
   * Owner standard, 2026-08-06: every log must answer "which user?". Passing
   * the member through hundreds of call sites would guarantee that some of
   * them forget, so the logger keeps one ambient value and this is the single
   * place that sets it. Cleared on sign-out, so a log written after signing
   * out can never be attributed to the member who just left.
   *
   * The id only. Never the e-mail — see the redaction rule in src/lib/logger.ts.
   */
  useEffect(() => {
    setLogUser(user?.id ?? null);
  }, [user?.id]);

  // Effect: sign out once when account is restricted
  useEffect(() => {
    if (accountRestricted && session && !signOutTriggeredRef.current) {
      signOutTriggeredRef.current = true;
      void supabase.auth.signOut();
    }
  }, [accountRestricted, session]);

  useEffect(() => {
    const linkReferral = async (user: User) => {
      const code = getStoredReferralCode();
      if (!code) return;
      try {
        const { data: codeRow } = await (supabase
          .from("referral_codes" as any)
          .select("id, user_id")
          .eq("code", code)
          .maybeSingle() as any);
        if (codeRow && codeRow.user_id !== user.id) {
          await (supabase.from("referrals" as any).insert({
            referrer_id: codeRow.user_id,
            referred_id: user.id,
            referral_code_id: codeRow.id,
          } as any) as any);
        }
      } catch {} finally {
        clearStoredReferralCode();
      }
    };

    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    let isMounted = true;

    /** Check if user is suspended or banned. Returns true if restricted. */
    const checkRestricted = async (u: User): Promise<boolean> => {
      const { data, error } = await supabase
        .from("profiles")
        .select("is_suspended, suspended_until, suspension_reason, is_banned")
        .eq("id", u.id)
        .maybeSingle();

      // If query fails or no data, do NOT logout — keep user logged in
      if (error || !data) return false;

      // Auto-lift expired suspension
      if (data.is_suspended && data.suspended_until && new Date(data.suspended_until) < new Date()) {
        await supabase
          .from("profiles")
          .update({ is_suspended: false, suspended_until: null, suspension_reason: null })
          .eq("id", u.id);
        return false;
      }

      if (data.is_suspended) {
        const reason = data.suspension_reason || "Your account has been suspended.";
        const until = data.suspended_until
          ? ` Suspended until ${new Date(data.suspended_until).toLocaleDateString()}.`
          : " This suspension is permanent.";
        sessionStorage.setItem("suspension_message", reason + until);
        return true;
      }

      if (data.is_banned) {
        sessionStorage.setItem("suspension_message", "Your account has been banned.");
        return true;
      }

      return false;
    };

    let realtimeChannel: ReturnType<typeof supabase.channel> | null = null;

    const setupRealtimeGuard = (userId: string) => {
      if (realtimeChannel) {
        supabase.removeChannel(realtimeChannel);
      }

      realtimeChannel = supabase
        .channel(`profile-guard-${userId}`)
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "profiles",
            filter: `id=eq.${userId}`,
          },
          (payload) => {
            const updated = payload.new as any;
            // Only trigger restriction if BOTH the flag is set AND the value actually changed
            const wasRestricted = (payload.old as any)?.is_suspended || (payload.old as any)?.is_banned;
            const isNowRestricted = updated.is_suspended || updated.is_banned;
            if (isNowRestricted && !wasRestricted) {
              const reason = updated.is_banned
                ? "Your account has been banned."
                : updated.suspension_reason || "Your account has been suspended.";
              const until = updated.suspended_until && !updated.is_banned
                ? ` Suspended until ${new Date(updated.suspended_until).toLocaleDateString()}.`
                : updated.is_banned ? "" : " This suspension is permanent.";
              sessionStorage.setItem("suspension_message", reason + until);
              setAccountRestricted(true);
            }
          }
        )
        .subscribe();
    };

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      // Was `console.log("AUTH EVENT:", …)` until 2026-08-06 — untraceable in
      // production, unfilterable, and it named nothing that could be searched.
      // Debug level, so it prints in development and is never persisted: a
      // session change is not a failure and 84 members' sign-ins would bury
      // the failures that are.
      logger.debug({
        code: "AUTH-1001",
        event: "AUTH_STATE_CHANGED",
        fn: "AuthProvider.onAuthStateChange",
        file: "src/hooks/core/useAuth.tsx",
        message: "Supabase reported an authentication state change.",
        reason: `Auth event: ${_event}`,
        expected: "A session for every event except SIGNED_OUT",
        actual: session ? "session present" : "no session",
        detail: { authEvent: _event, mounted: isMounted },
      });
      if (!isMounted) return;

      setSession(session);
      setUser(session?.user ?? null);

      // Resolve loading for ALL events including INITIAL_SESSION
      setLoading(false);

      // Dedupe initial init: if initSession() already ran the first-time
      // side-effects (setupRealtimeGuard + checkRestricted), skip them here.
      const isInitialEvent = _event === "INITIAL_SESSION";
      const alreadyInitialized = hasInitializedRef.current;

      if (session?.user) {
        if (!(isInitialEvent && alreadyInitialized)) {
          hasInitializedRef.current = true;
          setupRealtimeGuard(session.user.id);
          void checkRestricted(session.user).then((restricted) => {
            if (restricted) setAccountRestricted(true);
          }).catch(() => {});
        }

        if (_event === "SIGNED_IN") {
          // Reset restriction flag on fresh sign-in
          signOutTriggeredRef.current = false;
          setAccountRestricted(false);

          const u = session.user;
          const metaName = normalizeFullName(u.user_metadata?.full_name || u.user_metadata?.name || null);
          if (metaName) {
            setTimeout(async () => {
              try {
                const { data: existing } = await supabase
                  .from("profiles")
                  .select("full_name")
                  .eq("id", u.id)
                  .maybeSingle();
                if (!existing) {
                  await supabase
                    .from("profiles")
                    .insert({ id: u.id, full_name: metaName } as any);
                } else if (!existing.full_name) {
                  await supabase
                    .from("profiles")
                    .update({ full_name: metaName } as any)
                    .eq("id", u.id);
                }
              } catch {}
            }, 200);
          }
          setTimeout(() => linkReferral(session.user), 100);
          setTimeout(() => logAuthEvent(session.user.id, "login"), 0);
          setTimeout(() => logDeviceSignIn(session.user.id), 50);
        }
        if (_event === "USER_UPDATED") {
          setTimeout(() => logAuthEvent(session.user.id, "profile_updated"), 0);
        }
        if (_event === "PASSWORD_RECOVERY") {
          (window as any).__passwordRecoveryActive = true;
          sessionStorage.setItem("password_recovery_active", "true");
          setTimeout(() => logAuthEvent(session.user.id, "password_recovery"), 0);
        }
      } else {
        hasInitializedRef.current = false;
        if (realtimeChannel) {
          supabase.removeChannel(realtimeChannel);
          realtimeChannel = null;
        }
      }
    });

    const initSession = async () => {
      const maxAttempts = 5;

      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const {
          data: { session },
          error,
        } = await supabase.auth.getSession();
        // A FAILED session restore is a real problem — it is the difference
        // between "signed out" and "the app could not tell", and it is the
        // shape behind blank-page-at-boot reports. So the error branch WARNS
        // (and is persisted), while the healthy branch only traces.
        if (error) {
          logger.warn({
            code: "AUTH-1001",
            event: "SESSION_RESTORE_FAILED",
            fn: "AuthProvider.restoreSession",
            file: "src/hooks/core/useAuth.tsx",
            message: "Restoring the member's session at app start.",
            reason: `getSession failed: ${error.message}`,
            expected: "A session, or a clean null for a signed-out visitor",
            actual: `error on attempt ${attempt} of ${maxAttempts}`,
            nextStep:
              "If this repeats at boot, suspect stored-token corruption or clock skew on the device before suspecting the server.",
            detail: { attempt, maxAttempts },
          });
        } else {
          logger.trace({
            code: "AUTH-1001",
            event: "SESSION_RESTORED",
            fn: "AuthProvider.restoreSession",
            file: "src/hooks/core/useAuth.tsx",
            message: "Restoring the member's session at app start.",
            reason: "getSession returned without error.",
            expected: "A session, or a clean null for a signed-out visitor",
            actual: session ? "session present" : "no session",
            detail: { attempt },
          });
        }

        if (!error) {
          // If onAuthStateChange(INITIAL_SESSION) already ran the first-time
          // side-effects, skip duplicate setSession/setUser/setLoading/
          // setupRealtimeGuard/checkRestricted here. Keep retry loop intact
          // for the case where this path resolves first.
          if (hasInitializedRef.current) return;

          setSession(session);
          setUser(session?.user ?? null);
          setLoading(false);

          if (session?.user) {
            hasInitializedRef.current = true;
            const restricted = await checkRestricted(session.user);
            if (restricted) {
              setAccountRestricted(true);
            } else {
              setupRealtimeGuard(session.user.id);
            }
          }
          return;
        }

        const lower = (error.message || "").toLowerCase();
        const isNetwork =
          lower.includes("failed to fetch") ||
          lower.includes("networkerror") ||
          lower.includes("load failed");

        const isTransientAuthBootError =
          lower.includes("session") ||
          lower.includes("token") ||
          lower.includes("jwt") ||
          lower.includes("refresh") ||
          lower.includes("invalid");

        if (attempt < maxAttempts && (isNetwork || isTransientAuthBootError)) {
          await sleep(250 * attempt);
          continue;
        }

        setLoading(false);
      }
    };

    void initSession();

    return () => {
      isMounted = false;
      subscription.unsubscribe();
      if (realtimeChannel) supabase.removeChannel(realtimeChannel);
    };
  }, []);

  const signOut = async () => {
    if (user) logAuthEvent(user.id, "logout");
    resetDashboardBootstrap();
    clearFeedCache();
    // Stop this device receiving the departing user's pushes (matters on a
    // shared phone). No-op on web; never allowed to block sign-out.
    try {
      const { unregisterPushNotifications } = await import("@/lib/native/push");
      await unregisterPushNotifications();
    } catch { /* best-effort */ }
    await supabase.auth.signOut();
  };

  return <AuthContext.Provider value={{ session, user, loading, signOut }}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  return useContext(AuthContext) ?? fallbackAuthContext;
};
