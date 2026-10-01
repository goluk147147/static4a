import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { captureRef } from 'react-native-view-shot';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as Clipboard from 'expo-clipboard';
import TextRecognition from '@react-native-ml-kit/text-recognition';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppState } from 'react-native';
import { extractUtr } from '../checkout';
import { openPaymentApp, saveImageToGallery, speakHindi, stopSpeaking } from '../native';
import { showToast } from '../store/ui';
import { colors, radius } from '../theme';
import { Button, GradientButton } from './ui';

interface Props {
  total: number;
  customerName: string;
  upiId: string;
  upiName: string;
  busy: boolean;
  onConfirm: (utr: string, screenshotDataUri: string) => Promise<string | null>;
  onCancel: () => void;
}

/** UPI payment step (web PaymentModal): QR + save, PhonePe/GPay launch, Hindi voice guide, screenshot → auto UTR (on-device OCR). */
export default function PaymentSheet({ total, customerName, upiId, upiName, busy, onConfirm, onCancel }: Props) {
  const insets = useSafeAreaInsets();
  const qrCard = useRef<View>(null);
  const qrSaved = useRef(false);
  const launched = useRef(false);
  const [launchStatus, setLaunchStatus] = useState<{ text: string; fallback: boolean }>({ text: '', fallback: false });
  const [shot, setShot] = useState<{ uri: string; base64: string } | null>(null);
  const [utr, setUtr] = useState('');
  const [utrStatus, setUtrStatus] = useState<{ text: string; state: '' | 'success' | 'error' }>({ text: 'स्क्रीनशॉट चुनने पर UTR अपने-आप खोजा जाएगा।', state: '' });
  const [scanning, setScanning] = useState(false);

  const amount = Number(total).toFixed(2);
  const upiLink = `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(upiName)}&am=${amount}&cu=INR&tn=Order%20Payment`;
  const ready = !!shot && /^\d{12}$/.test(utr) && !scanning;
  const guide = () =>
    `प्रिय ${customerName || 'ग्राहक'}, आपको ${upiName} को ₹${Number(total).toFixed(0)} का भुगतान करना है। पहले QR कोड फ़ोन में सेव करें, फिर PhonePe या Google Pay खोलकर Scan QR में Gallery से सेव किया QR चुनें। भुगतान के बाद इसी स्क्रीन पर लौटकर स्क्रीनशॉट अपलोड करें और ऑर्डर पक्का करें।`;

  useEffect(() => {
    const t = setTimeout(() => speakHindi(guide()), 450);
    // Returning from the UPI app → prompt for the screenshot (web visibilitychange logic).
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active' && launched.current) {
        launched.current = false;
        setLaunchStatus({ text: 'वापस आ गए हैं। भुगतान का स्क्रीनशॉट चुनें; UTR अपने-आप पढ़ा जाएगा।', fallback: false });
        speakHindi(`प्रिय ${customerName || 'ग्राहक'}, भुगतान के बाद वापस आने के लिए धन्यवाद। अब भुगतान का स्क्रीनशॉट चुनें। UTR अपने-आप पढ़ने के बाद ऑर्डर पक्का करें।`);
      }
    });
    return () => {
      clearTimeout(t);
      sub.remove();
      stopSpeaking();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function saveQr(): Promise<boolean> {
    try {
      const uri = await captureRef(qrCard, { format: 'png', quality: 1, result: 'tmpfile' });
      const ok = await saveImageToGallery(uri);
      if (ok) {
        qrSaved.current = true;
        showToast('QR सेव हुआ। PhonePe/GPay में Scan QR → Gallery चुनें।', 'success');
      }
      return ok;
    } catch {
      showToast('QR save nahi ho saka / QR सेव नहीं हुआ।', 'error');
      return false;
    }
  }

  async function launch(app: 'phonepe' | 'gpay') {
    if (!qrSaved.current && !(await saveQr())) {
      setLaunchStatus({ text: 'QR सेव नहीं हुआ। पहले QR दोबारा सेव करें, फिर UPI App खोलें।', fallback: true });
      return;
    }
    const appName = app === 'gpay' ? 'Google Pay' : 'PhonePe';
    launched.current = true;
    const ok = await openPaymentApp(app);
    setLaunchStatus(
      ok
        ? { text: `${appName} खोल रहे हैं। खुलने के बाद Scan QR → Gallery से सेव किया QR चुनें।`, fallback: false }
        : { text: `${appName} नहीं खुला? फ़ोन में App खोलकर Scan QR → Gallery से सेव किया QR चुनें।`, fallback: true }
    );
  }

  async function copyUpi() {
    await Clipboard.setStringAsync(upiId);
    showToast(`✅ UPI ID copied: ${upiId} / यूपीआई आईडी कॉपी हुई।`, 'success');
  }

  async function pick(camera = false) {
    const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 1 };
    const res = camera ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
    if (res.canceled || !res.assets?.[0]) return;
    const asset = res.assets[0];
    setUtr('');
    setScanning(true);
    setUtrStatus({ text: 'स्क्रीनशॉट से UTR पढ़ा जा रहा है। कृपया प्रतीक्षा करें...', state: '' });
    try {
      // OCR on the full-resolution image (better accuracy), upload a compressed 1000px JPEG.
      const ocr = await TextRecognition.recognize(asset.uri);
      const w = asset.width || 1000;
      const h = asset.height || 1000;
      const resize = w >= h ? { width: Math.min(1000, w) } : { height: Math.min(1000, h) };
      const small = await ImageManipulator.manipulateAsync(asset.uri, [{ resize }], { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG, base64: true });
      setShot({ uri: small.uri, base64: small.base64 || '' });
      const match = extractUtr(ocr.text || '');
      if (!match) {
        setUtrStatus({ text: 'UTR not found. Choose a clearer payment screenshot; do not type the number / UTR नहीं मिला। साफ़ स्क्रीनशॉट चुनें।', state: 'error' });
        return;
      }
      setUtr(match);
      setUtrStatus({ text: `✅ UTR मिल गया: ${match}`, state: 'success' });
      speakHindi('आपका पेमेंट नंबर मिल गया है। अब ऑर्डर पक्का करें।');
    } catch {
      setUtrStatus({ text: 'Could not read this image. Choose a clearer payment screenshot / तस्वीर पढ़ी नहीं जा सकी।', state: 'error' });
    } finally {
      setScanning(false);
    }
  }

  async function confirm() {
    if (!shot) return showToast('📸 Please upload your payment screenshot first / कृपया पहले भुगतान का स्क्रीनशॉट अपलोड करें।', 'error');
    if (!/^\d{12}$/.test(utr)) return setUtrStatus({ text: 'A valid 12-digit UTR is required / सही 12 अंकों का UTR ज़रूरी है।', state: 'error' });
    const err = await onConfirm(utr, `data:image/jpeg;base64,${shot.base64}`);
    if (err) {
      setUtrStatus({ text: err, state: 'error' });
      showToast(err, 'error');
    }
  }

  const label = busy ? '⏳ Placing order… / ऑर्डर दर्ज हो रहा है…' : scanning ? '⏳ UTR पढ़ा जा रहा है...' : ready ? '✅ Confirm Order / ऑर्डर पक्का करें' : '⬆️ Screenshot से UTR की पुष्टि करें';

  return (
    <Modal visible animationType="slide" onRequestClose={() => !busy && onCancel()}>
      <ScrollView style={{ backgroundColor: '#fff' }} contentContainerStyle={{ padding: 18, paddingTop: insets.top + 14, paddingBottom: insets.bottom + 30, alignItems: 'center' }}>
        <Text style={{ fontSize: 22, fontWeight: '800', color: '#111827' }}>{upiName}</Text>
        <Text style={{ color: '#64748b', fontSize: 12, marginBottom: 10 }}>📍 Chandargarh (824301)</Text>
        <Text style={{ color: '#64748b', fontSize: 13 }}>Payable Amount / देय राशि</Text>
        <Text style={{ color: colors.green, fontSize: 32, fontWeight: '900', marginBottom: 10 }}>₹{total}</Text>

        <Button title="🔊 निर्देश दोबारा सुनें" outline color={colors.primary} onPress={() => speakHindi(guide())} style={{ alignSelf: 'stretch', marginBottom: 10 }} />
        <View style={{ flexDirection: 'row', gap: 10, alignSelf: 'stretch' }}>
          <Button title="🟣 PhonePe खोलें" color="#5f259f" onPress={() => launch('phonepe')} style={{ flex: 1 }} />
          <Button title="🟢 Google Pay खोलें" color="#1a73e8" onPress={() => launch('gpay')} style={{ flex: 1 }} />
        </View>
        {!!launchStatus.text && <Text style={[s.status, launchStatus.fallback && { color: '#b45309' }]} accessibilityLiveRegion="polite">{launchStatus.text}</Text>}
        <Text style={s.small}>पहले QR सेव करें, फिर UPI App में Scan QR → Gallery चुनें।</Text>

        {/* Branded QR card (captured to PNG for the gallery) */}
        <View ref={qrCard} collapsable={false} style={s.qrCard}>
          <Text style={{ fontSize: 22, fontWeight: '900', color: '#111827' }}>{upiName || '4A Store'}</Text>
          <Text style={{ color: '#0FA958', fontWeight: '800', fontSize: 12, marginBottom: 10 }}>UPI PAYMENT</Text>
          <QRCode value={upiLink} size={200} color="#1a1a2e" backgroundColor="#ffffff" ecl="M" />
          <Text style={{ fontWeight: '800', fontSize: 18, marginTop: 10, color: '#111827' }}>Pay ₹{Math.round(total)}</Text>
          <Text style={{ color: '#6B7280', fontSize: 12 }}>{upiId}</Text>
        </View>
        <Text style={s.small}>Merchant QR / दुकानदार का QR</Text>
        <Button title="⬇️ Save QR to Phone / QR फ़ोन में सेव करें" outline color="#334155" onPress={saveQr} style={{ alignSelf: 'stretch' }} />

        <View style={s.upiBox}>
          <Text style={{ fontSize: 11, color: '#666' }}>UPI ID / यूपीआई आईडी</Text>
          <Text style={{ fontSize: 16, fontWeight: '800', color: colors.primaryDark }} selectable>{upiId}</Text>
          <Text style={{ fontSize: 11, color: '#666' }}>Name / नाम: <Text style={{ fontWeight: '800' }}>{upiName}</Text></Text>
        </View>
        <Button title="📋 Copy UPI ID / यूपीआई आईडी कॉपी करें" onPress={copyUpi} style={{ alignSelf: 'stretch', borderRadius: 30 }} />

        <View style={s.uploadSection}>
          <Text style={{ color: colors.primaryDark, fontWeight: '800', fontSize: 15, marginBottom: 6 }}>📸 Upload Payment Screenshot / भुगतान का स्क्रीनशॉट अपलोड करें</Text>
          <Text style={[s.small, { textAlign: 'left' }]}>स्क्रीनशॉट से 12 अंकों का UTR अपने-आप पढ़ा जाएगा। नंबर टाइप न करें।</Text>
          <Pressable onPress={() => pick(false)} style={[s.drop, shot && { borderStyle: 'solid', borderColor: colors.primary }]} accessibilityRole="button" accessibilityLabel="Choose payment screenshot">
            {shot ? (
              <Image source={{ uri: shot.uri }} style={{ width: '100%', height: 260 }} resizeMode="contain" />
            ) : (
              <>
                <Text style={{ fontSize: 40 }}>📷</Text>
                <Text style={{ color: colors.primary, fontWeight: '700', textAlign: 'center', marginTop: 6 }}>Payment Screenshot Chunein (Auto UTR Detect) / भुगतान स्क्रीनशॉट चुनें</Text>
                <Text style={{ fontSize: 11, color: '#999' }}>JPG, PNG supported</Text>
              </>
            )}
          </Pressable>
          <Button title="📸 Camera se photo lein" small outline onPress={() => pick(true)} style={{ marginTop: 8 }} />

          <Text style={{ fontWeight: '700', marginTop: 12, marginBottom: 5, color: colors.dark }}>Detected UTR / मिला हुआ UTR नंबर</Text>
          <View style={s.utrBox} accessibilityLabel={`Detected UTR ${utr || 'none'}`}>
            {scanning ? <ActivityIndicator color={colors.primary} /> : <Text style={{ fontSize: 18, fontWeight: '900', letterSpacing: 1, color: utr ? colors.dark : '#94a3b8' }}>{utr || '12-digit UTR / 12 अंकों का UTR'}</Text>}
          </View>
          <Text style={[s.status, { textAlign: 'left' }, utrStatus.state === 'success' && { color: colors.green }, utrStatus.state === 'error' && { color: '#b42318' }]} accessibilityLiveRegion="polite">{utrStatus.text}</Text>
        </View>

        <GradientButton title={label} onPress={confirm} disabled={!ready || busy} loading={busy} style={{ alignSelf: 'stretch', marginTop: 10 }} />
        <Pressable onPress={onCancel} disabled={busy} style={{ padding: 12 }} accessibilityRole="button">
          <Text style={{ color: colors.gray }}>← Cancel / रद्द करें</Text>
        </Pressable>
      </ScrollView>
    </Modal>
  );
}

const s = StyleSheet.create({
  status: { color: colors.green, fontSize: 13, marginTop: 8, textAlign: 'center' },
  small: { color: '#64748b', fontSize: 12, marginVertical: 8, textAlign: 'center' },
  qrCard: { backgroundColor: '#fff', borderWidth: 6, borderColor: '#0FA958', borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 4 },
  upiBox: { backgroundColor: colors.primaryLight, padding: 10, borderRadius: 8, alignSelf: 'stretch', marginVertical: 10, alignItems: 'center' },
  uploadSection: { borderTopWidth: 2, borderTopColor: colors.border, paddingTop: 16, marginTop: 16, alignSelf: 'stretch' },
  drop: { borderWidth: 2, borderStyle: 'dashed', borderColor: colors.border, borderRadius: radius.md, padding: 16, alignItems: 'center', minHeight: 140, justifyContent: 'center' },
  utrBox: { minHeight: 48, borderWidth: 1, borderColor: colors.border, borderRadius: 9, backgroundColor: '#f1f5f9', justifyContent: 'center', paddingHorizontal: 12 },
});
