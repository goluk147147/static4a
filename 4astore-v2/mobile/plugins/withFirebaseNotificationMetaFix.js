// Expo config plugin: resolve the Android manifest-merger conflict on the three
// com.google.firebase.messaging.default_notification_* meta-data entries.
//
// Two sources declare these entries with different values and the merger has no
// merge rule, so :app:processReleaseMainManifest FAILS:
//   1. expo-notifications' config plugin writes them into the MAIN manifest
//      (channel_id="default", color=@color/notification_icon_color,
//       icon=@drawable/notification_icon).
//   2. @react-native-firebase/messaging's library AndroidManifest.xml declares
//      default_notification_channel_id and default_notification_color via its
//      own manifest placeholders (${firebaseJsonNotificationChannelId} / Color).
//
// Fix (prebuild-safe): keep exactly ONE entry each in the MAIN manifest with the
// intended values and add tools:replace so the main-manifest value wins the
// merge against the library's declaration. Notifee still draws the rich tray;
// these meta-data only configure the OS-drawn fallback, so the values are kept
// consistent with expo-notifications.
const { withAndroidManifest, AndroidConfig } = require('expo/config-plugins');

// Each entry: the meta-data name, which attribute it carries, and the value.
const ENTRIES = [
  { name: 'com.google.firebase.messaging.default_notification_channel_id', attr: 'android:value', value: 'default' },
  { name: 'com.google.firebase.messaging.default_notification_color', attr: 'android:resource', value: '@color/notification_icon_color' },
  { name: 'com.google.firebase.messaging.default_notification_icon', attr: 'android:resource', value: '@drawable/notification_icon' },
];

module.exports = function withFirebaseNotificationMetaFix(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;

    // Ensure the tools namespace is on <manifest> so tools:replace resolves.
    manifest.$ = manifest.$ || {};
    if (!manifest.$['xmlns:tools']) {
      manifest.$['xmlns:tools'] = 'http://schemas.android.com/tools';
    }

    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(cfg.modResults);
    app['meta-data'] = app['meta-data'] || [];

    for (const entry of ENTRIES) {
      // Drop any existing declaration(s) to avoid duplicates on re-prebuild.
      app['meta-data'] = app['meta-data'].filter((m) => m.$?.['android:name'] !== entry.name);
      // Re-add a single canonical entry that overrides the library value.
      app['meta-data'].push({
        $: {
          'android:name': entry.name,
          [entry.attr]: entry.value,
          'tools:replace': entry.attr,
        },
      });
    }

    return cfg;
  });
};
