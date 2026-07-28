// In-app update support (Google Play In-App Updates) for the Capacitor
// Android app, via @capawesome/capacitor-app-update.
//
// IMPORTANT: this file must NOT import any @capacitor/* or @capawesome/*
// package. Those npm packages are only installed in the Android CI build
// (see .github/workflows/android-build.yml), not in the web deploy — so we
// talk to the native bridge exclusively through the `window.Capacitor`
// runtime globals that exist only inside the installed app. On the web/PWA
// every function here is a silent no-op. (Same pattern as authDeepLink.ts.)

type AppUpdatePlugin = {
  getAppUpdateInfo: () => Promise<{
    updateAvailability?: number; // 2 = UPDATE_AVAILABLE (AppUpdateAvailability enum)
    immediateUpdateAllowed?: boolean;
    flexibleUpdateAllowed?: boolean;
    currentVersionCode?: string;
    availableVersionCode?: string;
    currentVersionName?: string;
    availableVersionName?: string;
  }>;
  performImmediateUpdate: () => Promise<{ code?: number }>;
  openAppStore: () => Promise<void>;
};

type CapGlobal = {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
  Plugins?: Record<string, unknown>;
};

const cap = (): CapGlobal | undefined =>
  (window as unknown as { Capacitor?: CapGlobal }).Capacitor;

const plugin = (): AppUpdatePlugin | undefined =>
  cap()?.Plugins?.AppUpdate as AppUpdatePlugin | undefined;

/** True only inside the installed Android app with the plugin present. */
export const appUpdateSupported = (): boolean =>
  !!cap()?.isNativePlatform?.() && cap()?.getPlatform?.() === "android" && !!plugin();

export interface UpdateStatus {
  available: boolean;
  immediateAllowed: boolean;
  availableVersion?: string;
}

/** Ask Google Play whether a newer version of the app exists. */
export async function checkForAppUpdate(): Promise<UpdateStatus | null> {
  if (!appUpdateSupported()) return null;
  try {
    const info = await plugin()!.getAppUpdateInfo();
    return {
      available: info.updateAvailability === 2, // UPDATE_AVAILABLE
      immediateAllowed: !!info.immediateUpdateAllowed,
      availableVersion: info.availableVersionName ?? info.availableVersionCode,
    };
  } catch (err) {
    console.warn("[appUpdate] check failed", err);
    return null;
  }
}

/**
 * Run the update. Prefers Google Play's IMMEDIATE in-app flow (fullscreen
 * Play sheet, downloads + installs without leaving the app); falls back to
 * opening the Play Store listing.
 */
export async function startAppUpdate(immediateAllowed: boolean): Promise<void> {
  const p = plugin();
  if (!p) return;
  try {
    if (immediateAllowed) {
      await p.performImmediateUpdate();
      return;
    }
  } catch (err) {
    console.warn("[appUpdate] immediate flow failed, falling back to store", err);
  }
  try {
    await p.openAppStore();
  } catch (err) {
    console.warn("[appUpdate] openAppStore failed", err);
  }
}
