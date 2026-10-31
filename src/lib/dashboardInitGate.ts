/**
 * U-04 — Dashboard-init bootstrap gate.
 *
 * `dashboard-init` is the canonical batched call that pre-seeds site_settings,
 * user_roles, profiles_public_data, etc. for the current user. Without a gate,
 * leaf hooks (`useSiteLogo`, `useSiteSetting`, `useIsAdmin`, `useUserRoles`,
 * `useNavigationMenu`, `fetchAdSlots`, …) fire their own DB queries
 * immediately on mount and race ahead of the seed — observed as 7 concurrent
 * `site_settings?key=...` requests + duplicate `user_roles` / `profiles_public_data`
 * fetches per page load.
 *
 * This gate exposes a single in-flight Promise that leaf hooks can `await`
 * inside their queryFn. After it resolves, they re-check the React Query
 * cache (which was seeded by `preSeedCaches`) and only fall through to a DB
 * query when the seed truly didn't include their key (e.g. anonymous viewer
 * or a setting not bundled into dashboard-init).
 *
 * No public API change for consumers — the bootstrap is started by
 * `DashboardProvider` (already mounted at app root), so leaf hooks always
 * see a live Promise.
 */

let bootstrapPromise: Promise<void> | null = null;
let bootstrapResolved = false;
let pendingResolve: (() => void) | null = null;
let pendingReject: (() => void) | null = null;

/**
 * Eagerly create the gate at module-load time so any leaf hook that mounts
 * BEFORE DashboardProvider's queryFn fires (very possible with lazy routes
 * + concurrent rendering) still sees a live promise and waits for the seed
 * instead of racing to its own DB fetch.
 */
function ensureGate() {
  if (bootstrapPromise) return;
  bootstrapResolved = false;
  bootstrapPromise = new Promise<void>((res, rej) => {
    pendingResolve = () => {
      bootstrapResolved = true;
      res();
    };
    pendingReject = () => {
      bootstrapResolved = true;
      rej();
    };
  });
}
ensureGate();

/**
 * Called by useDashboardInit's queryFn (start) and afterwards by preSeedCaches
 * (resolve) to fan out completion to every awaiter.
 */
export function beginDashboardBootstrap(): { resolve: () => void; reject: () => void } {
  ensureGate();
  if (bootstrapResolved) {
    // Gate was already resolved (e.g. cache hit); next bootstrap is a no-op
    return { resolve: () => {}, reject: () => {} };
  }
  return {
    resolve: () => pendingResolve?.(),
    reject: () => pendingReject?.(),
  };
}

/**
 * Reset (used by useAuth on sign-out so the next session starts clean).
 */
export function resetDashboardBootstrapGate() {
  bootstrapPromise = null;
  bootstrapResolved = false;
  pendingResolve = null;
  pendingReject = null;
  ensureGate();
}

/**
 * Awaited by leaf hooks. Resolves immediately if no bootstrap is in flight
 * (e.g. anonymous user with no dashboard-init), otherwise blocks until the
 * shared dashboard-init request finishes and pre-seeds caches.
 *
 * Capped at 3500ms so a slow edge function can't deadlock the UI — the
 * leaf hook will then proceed with its own fetch (graceful degradation).
 */
export async function awaitDashboardBootstrap(timeoutMs = 3500): Promise<void> {
  if (!bootstrapPromise || bootstrapResolved) return;
  await Promise.race([
    bootstrapPromise.catch(() => {}),
    new Promise<void>((res) => setTimeout(res, timeoutMs)),
  ]);
}

export function isDashboardBootstrapResolved(): boolean {
  return bootstrapResolved;
}
