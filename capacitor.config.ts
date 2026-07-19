import type { CapacitorConfig } from '@capacitor/cli';

// NOTE: appId is your permanent bundle identifier once published — change it now
// if you want a different one (must be reverse-domain; no segment may start with a
// digit, which is why it's not "com.50mmretina"). appName shows under the icon.
const config: CapacitorConfig = {
  appId: 'com.fiftymmretina.app',
  appName: '50mm Retina World',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
  plugins: {
    // FCM presentation while the app is foregrounded
    FirebaseMessaging: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
    SplashScreen: {
      launchShowDuration: 800,
      backgroundColor: '#0b1020',
      showSpinner: false,
    },
  },
};

export default config;
