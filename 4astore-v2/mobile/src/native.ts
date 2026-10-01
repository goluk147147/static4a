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

/** Launch PhonePe / Google Pay directly (same as AndroidApp.openPaymentApp); Play Store if missing. */
export async function openPaymentApp(app: keyof typeof PAYMENT_APPS): Promise<boolean> {
  const { pkg, name } = PAYMENT_APPS[app];
  if (Platform.OS === 'android') {
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
