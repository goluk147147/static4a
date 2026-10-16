import React, { useEffect, useRef, useState } from 'react';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radius, shadow } from '../theme';
import { Button } from './ui';
import { getNotifStatus, requestNotif, openNotifSettings, shouldShowPermissionBanner } from '../notifPermission';
import type { NotifStatus } from '../notifPermission';
import { registerForPush } from '../push';

// Bilingual (romanized Hindi + English) copy — same voice as the rest of the app.
const TITLE = '🔔 Notification on karein';
const BODY =
  'Naye order, offer aur delivery update turant paane ke liye notification allow karein. (Enable notifications to get order, offer & delivery alerts instantly.)';
const ENABLE = 'Chalu karein / Enable';

/**
 * Launch notification-permission nudge (Zepto/Blinkit style, policy-safe).
 *   • On mount: if status is 'undetermined' → request once (OS dialog). If that grants,
 *     re-run registerForPush() so the device token is sent immediately.
 *   • If status is 'denied' → show a dismissible top banner with a deep-link to app
 *     notification settings (we CANNOT force the OS dialog again after denial).
 *   • On AppState resume: re-check; if now 'granted' hide the banner + registerForPush().
 *   • Dismissal is SESSION-ONLY (React state) so the banner reappears next launch while denied.
 * Non-modal, never hard-blocks browsing, every helper is no-throw. This is ADDITIVE to the
 * existing registerForPush() launch/resume effects in app/_layout.tsx (they stay as-is).
 */
export default function NotifPermissionGate() {
  const insets = useSafeAreaInsets();
  const [status, setStatus] = useState<NotifStatus>('granted');
  const [dismissed, setDismissed] = useState(false);
  const requestedRef = useRef(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const s = await getNotifStatus();
      if (!alive) return;
      if (s === 'undetermined' && !requestedRef.current) {
        requestedRef.current = true;
        const next = await requestNotif();
        if (!alive) return;
        setStatus(next);
        if (next === 'granted') void registerForPush();
      } else {
        setStatus(s);
      }
    })();

    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      (async () => {
        const s = await getNotifStatus();
        setStatus(s);
        // A user who flipped the toggle in Settings is now granted → register immediately.
        if (s === 'granted') void registerForPush();
      })();
    });

    return () => {
      alive = false;
      sub.remove();
    };
  }, []);

  if (!shouldShowPermissionBanner({ status, dismissedThisSession: dismissed })) return null;

  return (
    <View pointerEvents="box-none" style={[styles.wrap, { top: insets.top + 8 }]}>
      <View style={styles.card} accessibilityRole="alert" accessibilityLiveRegion="polite">
        <View style={styles.row}>
          <Text style={styles.title}>{TITLE}</Text>
          <Pressable onPress={() => setDismissed(true)} hitSlop={10} accessibilityRole="button" accessibilityLabel="Dismiss">
            <Text style={styles.close}>×</Text>
          </Pressable>
        </View>
        <Text style={styles.body}>{BODY}</Text>
        <Button title={ENABLE} small onPress={() => void openNotifSettings()} style={{ marginTop: 10, alignSelf: 'flex-start' }} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // zIndex 9990 keeps the toast stack (9999 in Overlays) above this banner.
  wrap: { position: 'absolute', left: 12, right: 12, zIndex: 9990 },
  card: { backgroundColor: '#fff', borderRadius: radius.md, padding: 14, borderLeftWidth: 4, borderLeftColor: colors.primary, ...shadow, elevation: 8 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { flex: 1, fontSize: 15, fontWeight: '800', color: colors.dark },
  close: { fontSize: 22, lineHeight: 22, color: colors.gray, paddingHorizontal: 4 },
  body: { fontSize: 13, color: colors.gray, lineHeight: 19, marginTop: 6 },
});
