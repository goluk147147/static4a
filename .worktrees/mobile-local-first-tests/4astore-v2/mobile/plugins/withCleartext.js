// Force android:usesCleartextTraffic="true" on the <application> tag when STORE4A_ALLOW_HTTP=1,
// so the app can talk to a plain http:// LAN/localhost API during testing. Not applied for
// https:// (production) builds.
const { withAndroidManifest } = require('expo/config-plugins');

module.exports = function withCleartext(config) {
  if (process.env.STORE4A_ALLOW_HTTP !== '1') return config;
  return withAndroidManifest(config, (cfg) => {
    const app = cfg.modResults.manifest.application?.[0];
    if (app) app.$['android:usesCleartextTraffic'] = 'true';
    return cfg;
  });
};
