import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { showToast } from '../../store/toast';
import { compressImage, extractUtr, speakHindi } from '../../lib/checkout';

interface Props {
  total: number;
  customerName: string;
  upiId: string;
  upiName: string;
  busy: boolean;
  /** Returns an error message, or null on success. */
  onConfirm: (utr: string, screenshot: string) => Promise<string | null>;
  onCancel: () => void;
}

type UtrState = '' | 'success' | 'error';

const isMobileDevice = () => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

interface AndroidBridge {
  openPaymentApp?: (app: string) => void;
  saveBase64File?: (data: string, name: string, mime: string) => void;
}
const androidApp = () => (window as unknown as { AndroidApp?: AndroidBridge }).AndroidApp;

export default function PaymentModal({ total, customerName, upiId, upiName, busy, onConfirm, onCancel }: Props) {
  const qrCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const qrSavedRef = useRef(false);
  const scanSeq = useRef(0);

  const [launchStatus, setLaunchStatus] = useState<{ text: string; fallback: boolean }>({ text: '', fallback: false });
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [utr, setUtr] = useState('');
  const [utrStatus, setUtrStatus] = useState<{ text: string; state: UtrState }>({
    text: 'स्क्रीनशॉट चुनने पर UTR अपने-आप खोजा जाएगा।',
    state: '',
  });
  const [progress, setProgress] = useState<{ visible: boolean; percent: number | null; label: string }>({ visible: false, percent: null, label: '' });
  const [scanning, setScanning] = useState(false);

  const amount = Number(total).toFixed(2);
  const upiLink = `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(upiName)}&am=${amount}&cu=INR&tn=Order%20Payment`;
  const ready = !!screenshot && /^\d{12}$/.test(utr) && !scanning;

  const guideMessage = () =>
    `प्रिय ${customerName || 'ग्राहक'}, आपको ${upiName} को ₹${Number(total).toFixed(0)} का भुगतान करना है। पहले QR कोड फ़ोन में सेव करें, फिर PhonePe या Google Pay खोलकर Scan QR में Gallery से सेव किया QR चुनें। भुगतान के बाद इसी स्क्रीन पर लौटकर स्क्रीनशॉट अपलोड करें और ऑर्डर पक्का करें।`;

  // Draw the UPI QR and play the Hindi voice guide on open (original showPaymentModal()).
  useEffect(() => {
    qrSavedRef.current = false;
    if (qrCanvasRef.current) {
      QRCode.toCanvas(qrCanvasRef.current, upiLink, { width: 180, margin: 1, color: { dark: '#1a1a2e', light: '#ffffff' }, errorCorrectionLevel: 'M' }).catch(() => null);
    }
    const t = setTimeout(() => speakHindi(guideMessage()), 450);
    return () => {
      clearTimeout(t);
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [upiLink]);

  /** Original createBrandedUpiQrImage(): 1000×1300 PNG with store name, QR, amount, UPI id. */
  function brandedQrImage(): string {
    const qr = qrCanvasRef.current;
    if (!qr) return '';
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 1000;
      canvas.height = 1300;
      const ctx = canvas.getContext('2d');
      if (!ctx) return '';
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, 1000, 1300);
      ctx.strokeStyle = '#0FA958';
      ctx.lineWidth = 12;
      ctx.strokeRect(12, 12, 976, 1276);
      ctx.fillStyle = '#F5A623';
      ctx.fillRect(30, 240, 12, 864);
      ctx.fillRect(958, 240, 12, 864);
      ctx.textAlign = 'center';
      ctx.fillStyle = '#111827';
      ctx.font = 'bold 58px system-ui, sans-serif';
      ctx.fillText(upiName || '4A Store', 500, 120);
      ctx.fillStyle = '#0FA958';
      ctx.font = 'bold 26px system-ui, sans-serif';
      ctx.fillText('UPI PAYMENT', 500, 170);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(qr, 68, 240, 864, 864);
      ctx.fillStyle = '#111827';
      ctx.font = 'bold 38px system-ui, sans-serif';
      ctx.fillText('Pay ' + new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Number(total) || 0), 500, 1170);
      ctx.fillStyle = '#6B7280';
      ctx.font = '24px system-ui, sans-serif';
      ctx.fillText(upiId, 500, 1220);
      return canvas.toDataURL('image/png');
    } catch {
      return '';
    }
  }

  function downloadUpiQr(): boolean {
    const imageData = brandedQrImage();
    if (!imageData) {
      showToast('QR save nahi ho saka. Internet check karke QR dobara kholen / QR सेव नहीं हुआ।', 'error');
      return false;
    }
    const fileName = `4A-Store-UPI-QR-${Math.round(total)}-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
    const android = androidApp();
    if (android?.saveBase64File) {
      try {
        android.saveBase64File(imageData, fileName, 'image/png');
        qrSavedRef.current = true;
        showToast('QR सेव हुआ। PhonePe/GPay में Scan QR → Gallery/Downloads चुनें।');
        return true;
      } catch {
        /* fall back to browser download */
      }
    }
    const link = document.createElement('a');
    link.href = imageData;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    qrSavedRef.current = true;
    showToast('UPI QR डाउनलोड हो गया / QR saved to Downloads.', 'success');
    return true;
  }

  function scrollToQr() {
    qrCanvasRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  /** Original launchUpiPayment(): save QR first, then open PhonePe / Google Pay. */
  function launchUpiPayment(app: 'phonepe' | 'gpay') {
    const android = androidApp();
    if (!android && !isMobileDevice()) {
      setLaunchStatus({ text: 'कंप्यूटर पर UPI App नहीं खुलेगा। QR सेव करके दूसरे फ़ोन से स्कैन करें।', fallback: true });
      scrollToQr();
      return;
    }
    if (!qrSavedRef.current && !downloadUpiQr()) {
      setLaunchStatus({ text: 'QR सेव नहीं हुआ। पहले QR दोबारा सेव करें, फिर UPI App खोलें।', fallback: true });
      scrollToQr();
      return;
    }
    const appName = app === 'gpay' ? 'Google Pay' : 'PhonePe';
    setLaunchStatus({ text: `QR सेव हो गया। ${appName} खुलने पर Scan QR → Gallery से QR चुनें।`, fallback: false });

    if (android?.openPaymentApp) {
      try {
        android.openPaymentApp(app);
        setLaunchStatus({ text: `${appName} खोल रहे हैं। खुलने के बाद Scan QR → Gallery से सेव किया QR चुनें।`, fallback: false });
        return;
      } catch {
        /* fall back to the intent URL */
      }
    }

    let appOpened = false;
    const onVisibility = () => {
      if (document.hidden) {
        appOpened = true;
        setLaunchStatus({ text: `${appName} खुल गया है। सेव किया QR Gallery से चुनकर भुगतान करें।`, fallback: false });
        return;
      }
      if (appOpened) {
        setLaunchStatus({ text: 'वापस आ गए हैं। भुगतान का स्क्रीनशॉट चुनें; UTR अपने-आप पढ़ा जाएगा।', fallback: false });
        speakHindi(`प्रिय ${customerName || 'ग्राहक'}, भुगतान के बाद वापस आने के लिए धन्यवाद। अब भुगतान का स्क्रीनशॉट चुनें। UTR अपने-आप पढ़ने के बाद ऑर्डर पक्का करें।`);
        document.removeEventListener('visibilitychange', onVisibility);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    setTimeout(() => {
      if (!document.hidden && !appOpened) {
        setLaunchStatus({ text: `${appName} नहीं खुला? फ़ोन में App खोलकर Scan QR → Gallery से सेव किया QR चुनें।`, fallback: true });
        scrollToQr();
        document.removeEventListener('visibilitychange', onVisibility);
      }
    }, 1800);

    const pkg = app === 'gpay' ? 'com.google.android.apps.nbu.paisa.user' : 'com.phonepe.app';
    const fallbackUrl = `https://play.google.com/store/apps/details?id=${pkg}`;
    window.location.href = `intent://launch#Intent;action=android.intent.action.MAIN;category=android.intent.category.LAUNCHER;package=${pkg};S.browser_fallback_url=${encodeURIComponent(fallbackUrl)};end`;
  }

  function copyUpiId() {
    const done = () => showToast(`✅ UPI ID copied: ${upiId} / यूपीआई आईडी कॉपी हुई।`, 'success');
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(upiId).then(done).catch(() => fallbackCopy());
    } else {
      fallbackCopy();
    }
    function fallbackCopy() {
      const ta = document.createElement('textarea');
      ta.value = upiId;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
        done();
      } catch {
        /* ignore */
      }
      ta.remove();
    }
  }

  /** Original handleScreenshot() + detectScreenshotUtr(): compress, preview, OCR the 12-digit UTR. */
  function handleScreenshot(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const scanId = ++scanSeq.current;
    setUtr('');
    setScanning(true);
    setUtrStatus({ text: 'स्क्रीनशॉट से UTR पढ़ा जा रहा है। कृपया प्रतीक्षा करें...', state: '' });
    setProgress({ visible: true, percent: null, label: 'तस्वीर पढ़ी जा रही है...' });

    const reader = new FileReader();
    reader.onerror = () => {
      if (scanId !== scanSeq.current) return;
      setScanning(false);
      setProgress((p) => ({ ...p, visible: false }));
      setUtrStatus({ text: 'Image could not be read. Choose another screenshot / तस्वीर नहीं पढ़ी गई। दूसरा स्क्रीनशॉट चुनें।', state: 'error' });
    };
    reader.onload = async () => {
      const original = String(reader.result || '');
      const compressed = (await compressImage(original, 1000, 0.7)) || original;
      if (scanId !== scanSeq.current) return;
      setScreenshot(compressed);
      await detectUtr(compressed, scanId);
    };
    reader.readAsDataURL(file);
  }

  async function detectUtr(image: string, scanId: number) {
    try {
      // Loaded on demand — Tesseract fetches its worker + English model on first use.
      const { recognize } = await import('tesseract.js');
      const result = await recognize(image, 'eng', {
        logger: (m: { status: string; progress: number }) => {
          if (scanId === scanSeq.current && m.status === 'recognizing text') {
            const percent = Math.round((m.progress || 0) * 100);
            setProgress({ visible: true, percent, label: `UTR पढ़ा जा रहा है... ${percent}%` });
            setUtrStatus({ text: 'UTR पहचान रहे हैं। कृपया प्रतीक्षा करें...', state: '' });
          }
        },
      });
      if (scanId !== scanSeq.current) return;
      setProgress((p) => ({ ...p, visible: false }));
      const match = extractUtr(result.data.text || '');
      if (!match) {
        setUtrStatus({ text: 'UTR not found. Choose a clearer payment screenshot; do not type the number / UTR नहीं मिला। साफ़ स्क्रीनशॉट चुनें; नंबर टाइप न करें।', state: 'error' });
        return;
      }
      setUtr(match);
      setUtrStatus({ text: `✅ UTR मिल गया: ${match}`, state: 'success' });
      speakHindi('आपका पेमेंट नंबर मिल गया है। अब ऑर्डर पक्का करें।');
    } catch {
      if (scanId === scanSeq.current) {
        setProgress((p) => ({ ...p, visible: false }));
        setUtrStatus({ text: 'Could not read this image. Check internet and choose a clearer payment screenshot / तस्वीर पढ़ी नहीं जा सकी। इंटरनेट जाँचकर साफ़ स्क्रीनशॉट चुनें।', state: 'error' });
      }
    } finally {
      if (scanId === scanSeq.current) setScanning(false);
    }
  }

  async function confirm() {
    if (!screenshot) {
      showToast('📸 Please upload your payment screenshot first / कृपया पहले भुगतान का स्क्रीनशॉट अपलोड करें।', 'error');
      return;
    }
    if (!/^\d{12}$/.test(utr)) {
      setUtrStatus({ text: 'A valid 12-digit UTR is required. Choose a clearer screenshot / सही 12 अंकों का UTR ज़रूरी है। साफ़ स्क्रीनशॉट चुनें।', state: 'error' });
      return;
    }
    const error = await onConfirm(utr, screenshot);
    if (error) {
      setUtrStatus({ text: error, state: 'error' });
      showToast(error, 'error');
    }
  }

  const confirmLabel = busy
    ? '⏳ Placing order… / ऑर्डर दर्ज हो रहा है…'
    : scanning
      ? '⏳ UTR पढ़ा जा रहा है...'
      : ready
        ? '✅ Confirm Order / ऑर्डर पक्का करें'
        : '⬆️ Screenshot से UTR की पुष्टि करें';

  return (
    <div className="upi-payment-overlay" role="dialog" aria-modal="true" aria-label="UPI Payment">
      <div className="payment-modal-sheet">
        <h2 style={{ color: '#111827', margin: '0 0 4px' }}>{upiName}</h2>
        <p style={{ color: '#64748b', fontSize: 12, margin: '0 0 12px' }}>📍 Chandargarh (824301)</p>
        <div style={{ color: '#64748b', fontSize: 13 }}>Payable Amount / देय राशि</div>
        <div style={{ color: '#087a3d', fontSize: 30, fontWeight: 850, marginBottom: 10 }}>₹{total}</div>

        <button className="upi-audio-button" type="button" onClick={() => speakHindi(guideMessage())}>🔊 निर्देश दोबारा सुनें</button>
        <div className="upi-app-actions">
          <button className="upi-pay-button" type="button" onClick={() => launchUpiPayment('phonepe')}>🟣 PhonePe खोलें</button>
          <button className="upi-pay-button upi-gpay-button" type="button" onClick={() => launchUpiPayment('gpay')}>🟢 Google Pay खोलें</button>
        </div>
        <p className={`upi-launch-status${launchStatus.fallback ? ' fallback' : ''}`} role="status" aria-live="polite">{launchStatus.text}</p>
        <p style={{ color: '#64748b', fontSize: 12, margin: '0 0 12px' }}>पहले QR सेव करें, फिर UPI App में Scan QR → Gallery चुनें। कंप्यूटर पर दूसरे फ़ोन से QR स्कैन करें।</p>

        <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 12, padding: 12, marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 8 }}>
            <canvas ref={qrCanvasRef} aria-label="UPI QR Code" style={{ borderRadius: 8 }} />
          </div>
          <p style={{ fontSize: 12, color: '#64748b', margin: 0 }}>Merchant QR / दुकानदार का QR</p>
          <button type="button" onClick={downloadUpiQr} style={{ minHeight: 44, marginTop: 10, padding: '8px 14px', border: '1px solid #cbd5e1', borderRadius: 8, background: '#fff', color: '#334155', fontWeight: 700, cursor: 'pointer' }}>
            ⬇️ Save QR to Phone / QR फ़ोन में सेव करें
          </button>
        </div>

        <div style={{ background: 'var(--primary-light)', padding: 10, borderRadius: 8, marginBottom: 10 }}>
          <p style={{ fontSize: 11, color: '#666' }}>UPI ID / यूपीआई आईडी</p>
          <p style={{ fontSize: 15, fontWeight: 700, color: 'var(--primary-dark)' }}>{upiId}</p>
          <p style={{ fontSize: 11, color: '#666', marginTop: 2 }}>Name / नाम: <strong>{upiName}</strong></p>
        </div>

        <button type="button" onClick={copyUpiId} style={{ display: 'inline-block', padding: '10px 24px', background: 'var(--primary)', color: 'white', border: 'none', borderRadius: 30, fontSize: 14, fontWeight: 600, marginBottom: 8, cursor: 'pointer' }}>
          📋 Copy UPI ID / यूपीआई आईडी कॉपी करें
        </button>
        <p style={{ fontSize: 11, color: '#888', marginBottom: 12 }}>Scan the QR or copy the UPI ID to pay / QR स्कैन करें या यूपीआई आईडी कॉपी करके भुगतान करें</p>

        <div style={{ borderTop: '2px solid var(--border)', paddingTop: 16, marginTop: 8 }}>
          <h4 style={{ color: 'var(--primary-dark)', marginBottom: 8 }}>📸 Upload Payment Screenshot / भुगतान का स्क्रीनशॉट अपलोड करें</h4>
          <p style={{ fontSize: 12, color: '#666', marginBottom: 10 }}>स्क्रीनशॉट से 12 अंकों का UTR अपने-आप पढ़ा जाएगा। नंबर टाइप न करें।</p>
          <div className={`screenshot-upload${screenshot ? ' has-image' : ''}`}>
            <input type="file" accept="image/*" onChange={handleScreenshot} aria-label="Payment screenshot" />
            {!screenshot && (
              <div>
                <span style={{ fontSize: '2.5rem' }}>📷</span>
                <p style={{ fontSize: 13, color: 'var(--primary)', fontWeight: 600, marginTop: 8 }}>Payment Screenshot Chunein (Auto UTR Detect) / भुगतान स्क्रीनशॉट चुनें (UTR अपने-आप पहचानें)</p>
                <p style={{ fontSize: 11, color: '#999' }}>JPG, PNG supported / JPG, PNG फ़ाइल स्वीकार हैं</p>
              </div>
            )}
            {screenshot && <img src={screenshot} className="preview-img" alt="Payment screenshot preview" />}
          </div>
        </div>

        <div className="form-group" style={{ margin: '10px 0', textAlign: 'left' }}>
          <label htmlFor="utrNumber" style={{ display: 'block', fontSize: 13, fontWeight: 700, marginBottom: 5 }}>Detected UTR / मिला हुआ UTR नंबर</label>
          <input id="utrNumber" type="text" inputMode="numeric" readOnly aria-readonly="true" value={utr} placeholder="12-digit UTR / 12 अंकों का UTR"
            style={{ width: '100%', minHeight: 46, padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 9, background: '#f1f5f9', fontSize: 17, fontWeight: 800, letterSpacing: 1, boxSizing: 'border-box' }} />
          <p className={`utr-status${utrStatus.state ? ` ${utrStatus.state}` : ''}`} role="status" aria-live="polite">{utrStatus.text}</p>
          <div className={`utr-progress${progress.visible ? ' visible' : ''}`} aria-live="polite">
            <div className={`utr-progress-track${progress.percent === null ? ' indeterminate' : ''}`} role="progressbar" aria-label="UTR पढ़ने की प्रगति" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.percent ?? undefined}>
              <div className="utr-progress-fill" style={progress.percent === null ? undefined : { width: `${progress.percent}%` }} />
            </div>
            <span>{progress.label || 'कृपया प्रतीक्षा करें...'}</span>
          </div>
        </div>

        <div className="payment-confirm-sticky">
          <button className="btn-checkout" onClick={confirm} disabled={!ready || busy}
            style={{ background: ready && !busy ? 'var(--primary)' : 'var(--gray)', cursor: ready && !busy ? 'pointer' : 'not-allowed' }}>
            {confirmLabel}
          </button>
          <button type="button" onClick={onCancel} disabled={busy} style={{ marginTop: 8, background: 'none', border: 0, color: 'var(--gray)', cursor: 'pointer', fontSize: 13 }}>
            ← Cancel / रद्द करें
          </button>
        </div>
      </div>
    </div>
  );
}
