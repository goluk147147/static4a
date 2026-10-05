// Native replacements for the old WebView "AndroidApp" JS bridge
// (speak, openPaymentApp, saveBase64File, openMapDirections, getAppVersion).
import { Linking, Platform } from 'react-native';
import * as Speech from 'expo-speech';
import * as IntentLauncher from 'expo-intent-launcher';
import * as MediaLibrary from 'expo-media-library';
import * as Application from 'expo-application';
import { showToast } from './store/ui';

/** Hindi voice guide (native TTS, hi-IN). */
export function speakHindi(message: string) {
  if (!message) return;
  Speech.stop();
  Speech.speak(message, { language: 'hi-IN', rate: 0.9, pitch: 1 });
}
export const stopSpeaking = () => Speech.stop();

export const PAYMENT_APPS = {
  phonepe: { pkg: 'com.phonepe.app', name: 'PhonePe' },
  gpay: { pkg: 'com.google.android.apps.nbu.paisa.user', name: 'Google Pay' },
  paytm: { pkg: 'net.one97.paytm', name: 'Paytm' },
} as const;

/**
 * Open PhonePe / Google Pay (same as the original app — just launches the app).
 *
 * NOTE: We deliberately do NOT fire a `upi://pay?...` deep-link intent here.
 * UPI now blocks link/intent-based collect to a merchant (P2M) VPA — the app
 * shows "payment through a link is not allowed for this merchant, please scan
 * the merchant's QR code to pay" and the amount cannot go through. So we open
 * the app and the user scans the branded QR we already generated (which has the
 * amount embedded), which IS allowed. `_upiLink` is accepted but unused so
 * callers don't need to change.
 */
export async function openPaymentApp(app: keyof typeof PAYMENT_APPS, _upiLink?: string): Promise<boolean> {
  const { pkg, name } = PAYMENT_APPS[app];
  if (Platform.OS !== 'android') return false;

  try {
    await IntentLauncher.openApplication(pkg);
    return true;
  } catch {
    showToast(`${name} installed nahi hai. Play Store khul raha hai.`, 'info');
    await Linking.openURL(`market://details?id=${pkg}`).catch(() =>
      Linking.openURL(`https://play.google.com/store/apps/details?id=${pkg}`)
    );
    return false;
  }
}

// Deep links that jump STRAIGHT to the in-app QR scanner (saves the "find Scan QR" step).
// These are the public scan schemes the apps register; if one isn't honoured we fall
// back to just opening the app. (This is a scanner link, NOT a upi://pay link, so it is
// not affected by the merchant link-pay restriction.)
const SCANNER_LINKS: Partial<Record<keyof typeof PAYMENT_APPS, string[]>> = {
  phonepe: ['phonepe://scan', 'phonepe://pay'],
  gpay: ['tez://upi/scan', 'gpay://upi/scan'],
};

/**
 * Open the UPI app directly on its QR-scanner screen so the user only has to pick
 * the saved QR from the gallery (one tap less than opening the app and hunting for
 * "Scan QR"). Falls back to launching the app, then the Play Store.
 */
export async function openUpiScanner(app: keyof typeof PAYMENT_APPS): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  const { pkg } = PAYMENT_APPS[app];
  for (const link of SCANNER_LINKS[app] || []) {
    try {
      // Target the specific package so the right app's scanner opens.
      await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
        data: link,
        packageName: pkg,
        flags: 0x10000000, // FLAG_ACTIVITY_NEW_TASK
      });
      return true;
    } catch {
      try {
        await Linking.openURL(link);
        return true;
      } catch {
        /* try next scheme */
      }
    }
  }
  // No scanner scheme worked — just open the app (user taps Scan QR manually).
  return openPaymentApp(app);
}

/**
 * Open ANY installed UPI app's scanner via the system chooser (no fixed package),
 * so users who pay with Paytm / BHIM / Amazon Pay / Cred / their bank app can also
 * scan the saved QR. Tries the common scan schemes WITHOUT a packageName, which lets
 * Android show the app picker. If nothing handles it, shows a hint toast.
 */
export async function openAnyUpiScanner(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  // 'upi://' with no path makes most UPI apps open their scanner/home; the chooser
  // appears when more than one app can handle it. (This is NOT a upi://pay link.)
  const schemes = ['upi://scan', 'upi://', 'upi://pay'];
  for (const link of schemes) {
    try {
      const can = await Linking.canOpenURL(link);
      if (!can) continue;
      await Linking.openURL(link);
      return true;
    } catch {
      /* try next scheme */
    }
  }
  showToast('कोई UPI ऐप नहीं मिली। PhonePe या Google Pay इस्तेमाल करें, या ऐप में Scan QR खोलें।', 'info');
  return false;
}

/** Save a local image file (e.g. the branded UPI QR) to the phone gallery. */
export async function saveImageToGallery(fileUri: string): Promise<boolean> {
  const perm = await MediaLibrary.requestPermissionsAsync(true);
  if (!perm.granted) {
    showToast('Gallery permission chahiye QR save karne ke liye / गैलरी की अनुमति दें।', 'error');
    return false;
  }
  const asset = await MediaLibrary.createAssetAsync(fileUri);
  try {
    const album = await MediaLibrary.getAlbumAsync('4A Store');
    if (album) await MediaLibrary.addAssetsToAlbumAsync([asset], album, false);
    else await MediaLibrary.createAlbumAsync('4A Store', asset, false);
  } catch {
    /* album is optional; the asset is already in the gallery */
  }
  return true;
}

/** Turn-by-turn navigation in Google Maps (rider) — same as AndroidApp.openMapDirections. */
export function openMapDirections(lat: number, lng: number, label = 'Delivery') {
  const nav = `google.navigation:q=${lat},${lng}&mode=d`;
  Linking.openURL(nav).catch(() =>
    Linking.openURL(`geo:${lat},${lng}?q=${lat},${lng}(${encodeURIComponent(label)})`).catch(() =>
      Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`)
    )
  );
}

export const callNumber = (phone?: string | null) => phone && Linking.openURL(`tel:${String(phone).replace(/[^\d+]/g, '')}`);

export function openWhatsApp(phone: string, text: string) {
  const digits = String(phone).replace(/\D/g, '');
  const number = digits.length === 10 ? `91${digits}` : digits;
  const encoded = encodeURIComponent(text);
  Linking.openURL(`whatsapp://send?phone=${number}&text=${encoded}`).catch(() =>
    Linking.openURL(`https://wa.me/${number}?text=${encoded}`)
  );
}

export const appVersion = () => ({
  versionName: Application.nativeApplicationVersion || '',
  versionCode: Number(Application.nativeBuildVersion || 0),
});
