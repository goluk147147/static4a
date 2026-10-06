// Expo config plugin: copy notification-large-icon.png into Android drawable
// resources (res/drawable-xxhdpi) and set it as the default FCM large icon via
// AndroidManifest.xml metadata. This makes OS-drawn (background) notifications
// show the colour 4A logo as the large icon on the right, similar to how
// Flipkart shows its yellow "f" icon.
//
// The small status-bar icon (monochrome silhouette) is handled separately by
// expo-notifications' `icon` field in app.config.ts.
const { withAndroidManifest } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

const RESOURCE_NAME = 'notification_large_icon';
const SOURCE_FILE = 'assets/images/notification-large-icon.png';

module.exports = function withNotificationLargeIcon(config) {
  return withAndroidManifest(config, (cfg) => {
    const projectRoot = cfg.modRequest.projectRoot;
    const platformRoot = cfg.modRequest.platformProjectRoot; // android/

    // Copy the 256×256 colour logo into res/drawable-xxhdpi (the recommended
    // density for notification large icons at 96×96dp). Using drawable-xxhdpi
    // keeps the image sharp on most modern devices while letting Android down-
    // scale for lower densities.
    const targetDir = path.join(platformRoot, 'app/src/main/res/drawable-xxhdpi');
    const targetFile = path.join(targetDir, `${RESOURCE_NAME}.png`);
    const sourceFile = path.join(projectRoot, SOURCE_FILE);

    if (fs.existsSync(sourceFile)) {
      fs.mkdirSync(targetDir, { recursive: true });
      fs.copyFileSync(sourceFile, targetFile);
    }

    // For large icon, expo-notifications' native NotificationBuilder reads:
    //   expo.modules.notifications.large_notification_icon
    // and applies it as the large icon for all incoming notifications (both
    // foreground and background). This is confirmed in ExpoNotificationBuilder.kt.
    const manifest = cfg.modResults.manifest;
    const app = manifest.application?.[0];
    if (!app) return cfg;

    app['meta-data'] = app['meta-data'] || [];

    const META_KEY = 'expo.modules.notifications.large_notification_icon';
    // Remove any existing entry to avoid duplicates on re-prebuild.
    app['meta-data'] = app['meta-data'].filter(
      (m) => m.$?.['android:name'] !== META_KEY
    );
    app['meta-data'].push({
      $: {
        'android:name': META_KEY,
        'android:resource': `@drawable/${RESOURCE_NAME}`,
      },
    });

    return cfg;
  });
};
