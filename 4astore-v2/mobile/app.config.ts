import fs from 'fs';
import path from 'path';
import type { ExpoConfig } from 'expo/config';

/**
 * 4A Store native app (v2). Same Play Store identity as the old WebView app:
 *  - package  com.store4a.app
 *  - signed with the original upload key (4AStoreApp/4astore-key-new.jks, alias "4astore")
 *  - versionCode continues after the last WebView release (17 / 1.7.9)
 */
const SITE_HOST = process.env.STORE4A_SITE_HOST || '4astore.com';
const API_BASE = process.env.STORE4A_API_BASE || `https://${SITE_HOST}/api`;
const VERSION_CODE = Number(process.env.STORE4A_VERSION_CODE || 21);
const VERSION_NAME = process.env.STORE4A_VERSION_NAME || '2.0.0';

// FCM needs google-services.json (Firebase console → Project settings → Android app com.store4a.app).
const googleServices = path.join(__dirname, 'google-services.json');
const hasGoogleServices = fs.existsSync(googleServices);

const config: ExpoConfig = {
  name: '4A Store',
  slug: '4astore',
  scheme: 'fourastore',
  version: VERSION_NAME,
  orientation: 'portrait',
  userInterfaceStyle: 'light',
  icon: './assets/images/icon.png',
  newArchEnabled: true,
  ios: {
    bundleIdentifier: 'com.store4a.app',
    supportsTablet: false,
    associatedDomains: [`applinks:${SITE_HOST}`],
  },
  android: {
    package: 'com.store4a.app',
    versionCode: VERSION_CODE,
    // Allow http:// API only when explicitly testing against a LAN/localhost server
    // (set STORE4A_ALLOW_HTTP=1). Production (https) builds keep cleartext disabled.
    // The manifest flag is applied by the ./plugins/withCleartext config-plugin (gated on
    // STORE4A_ALLOW_HTTP=1); the top-level `android.usesCleartextTraffic` field was dropped from
    // @expo/config-types in SDK 54, so it lives in the plugin only.
    adaptiveIcon: { foregroundImage: './assets/images/adaptive-icon.png', backgroundColor: '#FFFFFF' },
    ...(hasGoogleServices ? { googleServicesFile: './google-services.json' } : {}),
    softwareKeyboardLayoutMode: 'resize',
    permissions: [
      'INTERNET',
      'ACCESS_NETWORK_STATE',
      'ACCESS_FINE_LOCATION',
      'ACCESS_COARSE_LOCATION',
      'CAMERA',
      'POST_NOTIFICATIONS',
      'VIBRATE',
    ],
    blockedPermissions: [
      'android.permission.RECORD_AUDIO',
      'android.permission.READ_EXTERNAL_STORAGE',
      'android.permission.WRITE_EXTERNAL_STORAGE',
      'android.permission.SYSTEM_ALERT_WINDOW',
    ],
    // Smart links (Android App Links) — host assetlinks.json with the signing SHA-256.
    intentFilters: [
      {
        action: 'VIEW',
        autoVerify: true,
        category: ['BROWSABLE', 'DEFAULT'],
        data: [
          { scheme: 'https', host: SITE_HOST, pathPrefix: '/product' },
          { scheme: 'https', host: SITE_HOST, pathPrefix: '/products' },
          { scheme: 'https', host: SITE_HOST, pathPrefix: '/track' },
          { scheme: 'https', host: SITE_HOST, pathPrefix: '/page' },
          { scheme: 'https', host: SITE_HOST, pathPrefix: '/orders' },
          { scheme: 'https', host: SITE_HOST, pathPrefix: '/cart' },
        ],
      },
    ],
  },
  plugins: [
    'expo-router',
    'expo-secure-store',
    'expo-web-browser',
    // Native Google Sign-In. Firebase config-plugin variant (google-services.json is already
    // wired via googleServicesFile above) — no iosUrlScheme (Android-only Play target).
    '@react-native-google-signin/google-signin',
    [
      'expo-splash-screen',
      { image: './assets/images/splash.png', imageWidth: 220, resizeMode: 'contain', backgroundColor: '#FFFFFF' },
    ],
    // `icon` = the Android small status-bar icon. It MUST be a white, transparent,
    // monochrome silhouette (Android tints/masks it to white) — a full-colour logo
    // renders as a white blob. The new icon only takes effect after an APK rebuild
    // (npm run prebuild && npm run build:apk). Large icon / app logo stay as-is.
    ['expo-notifications', { icon: './assets/images/notification-icon.png', color: '#FF7A00', defaultChannel: 'default' }],
    [
      'expo-location',
      { locationWhenInUsePermission: '4A Store uses your location for delivery tracking and to check the delivery area.' },
    ],
    [
      'expo-image-picker',
      {
        photosPermission: 'Payment screenshot upload ke liye photos ki permission chahiye.',
        cameraPermission: 'Payment screenshot lene ke liye camera ki permission chahiye.',
      },
    ],
    [
      'expo-media-library',
      { savePhotosPermission: 'UPI QR ko gallery me save karne ke liye permission chahiye.', isAccessMediaLocationEnabled: false },
    ],
    [
      'expo-build-properties',
      {
        android: {
          compileSdkVersion: 36,
          targetSdkVersion: 36,
          minSdkVersion: 24,
          enableProguardInReleaseBuilds: true,
          enableShrinkResourcesInReleaseBuilds: true,
        },
      },
    ],
    // Signs release builds with the ORIGINAL 4AStore key so the Play Store accepts it as an update.
    ['./plugins/withReleaseSigning', { keystorePath: '../../4AStoreApp/4astore-key-new.jks', keyAlias: '4astore' }],
    // No custom native C++ → don't require the NDK (keeps the build working without a 1 GB NDK install).
    './plugins/withNoNdk',
    // Allow http:// API during LAN/localhost testing (STORE4A_ALLOW_HTTP=1).
    './plugins/withCleartext',
    // UPI app visibility (PhonePe/GPay/Paytm/BHIM/Amazon Pay + upi: scheme) for Android 11+.
    './plugins/withUpiQueries',
    // Copy the colour 4A logo (256×256 transparent PNG) into Android drawable resources and
    // register it as the default notification large icon via AndroidManifest metadata. This is
    // the rounded colour icon shown on the right side of notifications (like Flipkart's yellow "f").
    './plugins/withNotificationLargeIcon',
  ],
  experiments: { typedRoutes: false },
  extra: {
    apiBase: API_BASE,
    siteUrl: `https://${SITE_HOST}`,
    hasPush: hasGoogleServices,
    // Social-login OAuth client IDs — empty until the owner provisions them.
    // Buttons render regardless; an empty id shows a "setup pending" toast.
    googleClientId: process.env.STORE4A_GOOGLE_CLIENT_ID || '',
    facebookAppId: process.env.STORE4A_FACEBOOK_APP_ID || '',
    instagramAppId: process.env.STORE4A_INSTAGRAM_APP_ID || '',
    // Google Sign-In via expo-auth-session needs BOTH OAuth client IDs (web token flow + android).
    // Not secrets — read from env first, fall back to the owner-provisioned project IDs.
    googleWebClientId:
      process.env.STORE4A_GOOGLE_WEB_CLIENT_ID || '707085023016-etp7au34rg3cd5eks6cdu0cs0vkj1svn.apps.googleusercontent.com',
    googleAndroidClientId:
      process.env.STORE4A_GOOGLE_ANDROID_CLIENT_ID || '707085023016-pc4gc5271kquti6recqo9juor3p44dn9.apps.googleusercontent.com',
  },
};

export default config;
