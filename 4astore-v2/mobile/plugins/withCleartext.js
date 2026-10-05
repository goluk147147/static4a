// Force android:usesCleartextTraffic="true" on the <application> tag when STORE4A_ALLOW_HTTP=1
// OR when the API base is a plain http:// URL, so the app can talk to a LAN/localhost API during
// testing. Not applied for https:// (production) builds.
const { withAndroidManifest } = require('expo/config-plugins');

module.exports = function withCleartext(config) {
  const apiBase = process.env.STORE4A_API_BASE || '';
  const allow = process.env.STORE4A_ALLOW_HTTP === '1' || /^http:\/\//i.test(apiBase);
  if (!allow) return config;
  return withAndroidManifest(config, (cfg) => {
    const app = cfg.modResults.manifest.application?.[0];
    if (app) app.$['android:usesCleartextTraffic'] = 'true';
    return cfg;
  });
};
