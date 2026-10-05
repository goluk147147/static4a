// This app ships no custom native C++/JNI code, so the Android NDK is not needed to build it
// (React Native's prebuilt dependency AARs already contain their .so files). The RN Gradle plugin
// still declares `ndkVersion`, which makes Gradle try to resolve an NDK and fail on machines that
// don't have that exact NDK installed. This plugin removes that line from the generated
// android/app/build.gradle so release builds work without downloading a ~1 GB NDK.
const { withAppBuildGradle } = require('expo/config-plugins');

module.exports = function withNoNdk(config) {
  return withAppBuildGradle(config, (cfg) => {
    cfg.modResults.contents = cfg.modResults.contents.replace(/^\s*ndkVersion\s+rootProject\.ext\.ndkVersion\s*$/m, '    // ndkVersion removed by withNoNdk (no native C++ in this app)');
    return cfg;
  });
};
