// Adds <queries> entries for UPI apps + the upi: scheme so that on Android 11+
// the app can detect/launch PhonePe, Google Pay, Paytm, BHIM, Amazon Pay and
// generic UPI scanners (Linking.canOpenURL / package-targeted intents). Without
// this, package visibility rules make those launches silently fail.
const { withAndroidManifest } = require('expo/config-plugins');

const UPI_PACKAGES = [
  'com.phonepe.app',
  'com.google.android.apps.nbu.paisa.user',
  'net.one97.paytm',
  'in.org.npci.upiapp', // BHIM
  'in.amazon.mShop.android.shopping', // Amazon Pay
];

module.exports = function withUpiQueries(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    manifest.queries = manifest.queries || [];
    // One queries block that holds our scheme intent + explicit packages.
    const block = { intent: [], package: [] };

    // upi: scheme (scanner / chooser)
    block.intent.push({
      action: [{ $: { 'android:name': 'android.intent.action.VIEW' } }],
      data: [{ $: { 'android:scheme': 'upi' } }],
    });

    for (const pkg of UPI_PACKAGES) {
      block.package.push({ $: { 'android:name': pkg } });
    }

    manifest.queries.push(block);
    return cfg;
  });
};
