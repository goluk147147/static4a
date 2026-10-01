// Expo config plugin: sign Android release builds with the original 4AStore upload key.
// Passwords are NEVER written to the repo — they are read at build time from a Gradle
// property (~/.gradle/gradle.properties) or an environment variable:
//   STORE4A_KEYSTORE_PASSWORD, STORE4A_KEY_PASSWORD   (optional: STORE4A_KEYSTORE_FILE)
const path = require('path');
const { withAppBuildGradle } = require('expo/config-plugins');

const MARKER = '// @4astore-release-signing';

module.exports = function withReleaseSigning(config, { keystorePath, keyAlias = '4astore' } = {}) {
  return withAppBuildGradle(config, (cfg) => {
    let gradle = cfg.modResults.contents;
    if (gradle.includes(MARKER)) return cfg;

    const defaultStore = path.resolve(cfg.modRequest.projectRoot, keystorePath).replace(/\\/g, '/');

    const releaseSigning = `
        ${MARKER}
        release {
            def ksFile = findProperty('STORE4A_KEYSTORE_FILE') ?: System.getenv('STORE4A_KEYSTORE_FILE') ?: '${defaultStore}'
            storeFile file(ksFile)
            storePassword findProperty('STORE4A_KEYSTORE_PASSWORD') ?: System.getenv('STORE4A_KEYSTORE_PASSWORD')
            keyAlias '${keyAlias}'
            keyPassword findProperty('STORE4A_KEY_PASSWORD') ?: System.getenv('STORE4A_KEY_PASSWORD')
        }`;

    // 1) add signingConfigs.release next to the debug config
    gradle = gradle.replace(/signingConfigs\s*\{/, (m) => `${m}${releaseSigning}`);

    // 2) point buildTypes.release at it (falls back to debug when no password is available)
    const btIndex = gradle.indexOf('buildTypes {');
    if (btIndex === -1) throw new Error('withReleaseSigning: buildTypes block not found');
    const head = gradle.slice(0, btIndex);
    let tail = gradle.slice(btIndex);
    tail = tail.replace(
      /(release\s*\{[\s\S]*?)signingConfig\s+signingConfigs\.debug/,
      `$1signingConfig (signingConfigs.release.storePassword ? signingConfigs.release : signingConfigs.debug)`
    );
    cfg.modResults.contents = head + tail;
    return cfg;
  });
};
