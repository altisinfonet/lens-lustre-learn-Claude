// @ts-nocheck — Capacitor plugins are installed locally (see CAPACITOR_SETUP.md).
// Excluded from CI typecheck until deps are installed; remove this line afterward
// to get full typing back.
import { Capacitor } from '@capacitor/core';

/** True only inside the installed iOS/Android app (not web/PWA). */
export const isNativeApp = () => Capacitor.isNativePlatform();

/** 'ios' | 'android' | 'web' */
export const currentPlatform = () => Capacitor.getPlatform();
