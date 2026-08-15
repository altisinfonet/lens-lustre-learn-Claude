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
import {
  claimSessionLoss,
  declareSignOut,
  installVisibilityObserver,
  resetForNewSession,
} from "@/lib/sessionLossRecorder";

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
      // Declared, so the recorder does not report this as a mystery. This guard
      // was the FIRST hypothesis for the owner's random sign-outs and the data
      // cleared it — all ten firings were genuinely deleted accounts. It stays
      // declared so it can be cleared again without re-running that analysis.
      declareSignOut("account_deleted", "useAuth.checkRestricted");
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

      // ─────────────────────────────────────────────────────────────────────
      // TWO OPPOSITE CONDITIONS. CONFLATING THEM IS WHAT LET A DELETED ACCOUNT
      // KEEP USING THE APP.
      //
      // Until 2026-08-06 this was one line — `if (error || !data) return false;`
      // — and the comment said "do NOT logout, keep user logged in". That is
      // right for ONE of the two cases and badly wrong for the other:
      //
      //   error          → the LOOKUP failed. Transient (connection, RLS hiccup).
      //                    Signing the member out over a dropped request would
      //                    be its own bug. Keep them in.
      //
      //   !data && !error → the ROW IS GONE. maybeSingle() returns null with no
      //                    error when the profile does not exist. That is not
      //                    transient — the account has been deleted, and every
      //                    app open was answering "nothing wrong here".
      //
      // Owner report, 2026-08-06: an admin deleted an account and the person
      // stayed signed in, kept browsing, and typed a comment. Measured against
      // production: auth.users and profiles both returned 0 rows for that
      // e-mail, and NOTHING they typed was ever written. The account really was
      // gone; only the session did not know.
      // ─────────────────────────────────────────────────────────────────────
      if (error) {
        logger.warn({
          code: "DB-3001",
          event: "RESTRICTION_CHECK_LOOKUP_FAILED",
          fn: "checkRestricted",
          file: "src/hooks/core/useAuth.tsx",
          message: "Could not read the member's profile to check for a ban or suspension.",
          reason: error.message,
          expected: "The member's restriction flags",
          actual: "The query returned an error",
          nextStep:
            "Deliberately keeps the member signed in — a dropped request must never sign anyone out. If this repeats for one member, check the profiles policies.",
          userId: u.id,
        });
        return false;
      }

      if (!data) {
        logger.error({
          code: "AUTH-1005",
          event: "ACCOUNT_NO_LONGER_EXISTS",
          fn: "checkRestricted",
          file: "src/hooks/core/useAuth.tsx",
          message: "A signed-in member has no profile row; the account has been removed.",
          reason: "maybeSingle() returned no row and no error, so the profile does not exist.",
          expected: "One profile row for the signed-in member",
          actual: "No row",
          nextStep:
            "Expected right after an admin deletes an account. INVESTIGATE ONLY IF the account still exists in auth.users — that would mean a live member was signed out for no reason.",
          userId: u.id,
        });
        sessionStorage.setItem(
          "suspension_message",
          "This account has been removed. Please contact us if you believe this is a mistake.",
        );
        return true;
      }

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
            // "*" NOT "UPDATE" — and the difference is the whole bug.
            //
            // This channel exists to eject a member the moment an admin acts on
            // them. Until 2026-08-06 it listened for UPDATE only, so it caught a
            // ban and a suspension — and was completely BLIND to a DELETE, the
            // most severe action an admin can take. The one mechanism built for
            // instant ejection could not see the one event that matters most.
            //
            // Verified against production before making this change:
            //   * supabase_realtime has pubdelete = true and publishes profiles,
            //     so a DELETE does reach the client.
            //   * profiles has REPLICA IDENTITY FULL, so payload.old carries
            //     every column on a DELETE and the id filter below still
            //     matches. (With the default replica identity it would not
            //     reliably, and this fix would have silently done nothing.)
            event: "*",
            schema: "public",
            table: "profiles",
            filter: `id=eq.${userId}`,
          },
          (payload) => {
            // The account itself is gone. Nothing to evaluate — end the session.
            if (payload.eventType === "DELETE") {
              logger.error({
                code: "AUTH-1005",
                event: "ACCOUNT_DELETED_WHILE_SIGNED_IN",
                fn: "setupRealtimeGuard",
                file: "src/hooks/core/useAuth.tsx",
                message: "The member's profile was deleted while they were using the app.",
                reason: "A realtime DELETE arrived for this member's own profile row.",
                expected: "The account to exist for as long as the session does",
                actual: "The row was deleted; signing out now",
                nextStep:
                  "This is the instant sign-out the owner asked for. If it fires for a member nobody deleted, check what else deletes profile rows.",
                userId,
              });
              sessionStorage.setItem(
                "suspension_message",
                "This account has been removed. Please contact us if you believe this is a mistake.",
              );
              setAccountRestricted(true);
              return;
            }

            // Everything below is the original ban/suspension handling, which
            // only makes sense for an UPDATE. An INSERT has no prior state to
            // compare against.
            if (payload.eventType !== "UPDATE") return;

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

    // Backgrounding is one of the three suspects for the owner's random
    // sign-outs (an Android WebView can be reclaimed while hidden), so start
    // watching it here — the same place the auth subscription lives, mounted
    // once, high in the tree.
    installVisibilityObserver();

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

      if (_event === "SIGNED_OUT") {
        /**
         * THE SESSION JUST ENDED. Write down why, before the evidence is gone.
         *
         * Owner, 2026-08-15: *"dont know sometimes logged off home screen
         * opening automatically"* and *"during commenting logging off"*. Until
         * now this branch knew only THAT a session ended, never why, so a
         * stalled token refresh, a WebView dropping localStorage, and the
         * member tapping Log out all left identical evidence: none.
         *
         * `claimSessionLoss()` returns the facts once and null forever after,
         * so a retry loop cannot turn one lost session into hundreds of rows.
         *
         * The level is deliberate. A deliberate sign-out is DEBUG — it is not a
         * fault, and persisting 84 members' logouts would bury the ones that
         * matter. An undeclared one is ERROR, because nobody asked for it.
         * `log_app_event` is callable by `anon` (verified on production
         * 2026-08-15), which is what lets this reach the database at the one
         * moment the member no longer has a session.
         */
        const facts = claimSessionLoss();
        if (facts) {
          const involuntary = facts.cause === "involuntary";
          const line = {
            code: "AUTH-1010",
            event: "SESSION_ENDED",
            fn: "AuthProvider.onAuthStateChange",
            file: "src/hooks/core/useAuth.tsx",
            message: involuntary
              ? "A member's session ended and nothing in the app asked for it."
              : `A member's session ended because ${facts.cause}.`,
            reason: involuntary
              ? "No sign-out was declared within 5s of the session ending."
              : `Declared by ${facts.declaredBy}.`,
            expected: "Every session ends because something asked it to.",
            actual: facts.cause,
            nextStep: involuntary
              ? "Read refreshFailuresInARow, lastRequestWasTimeout and storedSessionPresent in detail: a failed refresh, our own 25s abort, and lost WebView storage are the three open suspects."
              : "None — this is the app working.",
            detail: facts as unknown as Record<string, unknown>,
          };
          if (involuntary) logger.error(line);
          else logger.debug(line);
        }
      }

      if (session?.user) {
        if (!(isInitialEvent && alreadyInitialized)) {
          hasInitializedRef.current = true;
          setupRealtimeGuard(session.user.id);
          void checkRestricted(session.user).then((restricted) => {
            if (restricted) setAccountRestricted(true);
          }).catch(() => {});
        }

        if (_event === "SIGNED_IN") {
          // A new session means the NEXT loss is a new event. Without this, a
          // member signed out twice reports once — and "it keeps happening to
          // the same person" is the pattern most worth seeing.
          resetForNewSession();
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
    // The member asked for this. Everything NOT declared is the bug.
    declareSignOut("member_action", "useAuth.signOut");
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
