import { Capacitor } from '@capacitor/core';

/** True only inside the installed iOS/Android app (not web/PWA). */
export const isNativeApp = () => Capacitor.isNativePlatform();

/** 'ios' | 'android' | 'web' */
export const currentPlatform = () => Capacitor.getPlatform();
