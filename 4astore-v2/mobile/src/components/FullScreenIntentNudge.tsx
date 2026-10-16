import React, { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { colors, radius, shadow } from '../theme';
import { Button } from './ui';
import { useAuth, isOrderStaff } from '../store/auth';
import { openFullScreenIntentSettings, shouldShowFullScreenNudge } from '../notifPermission';

// Persisted ONE-TIME flag (matches the 4astore_* AsyncStorage naming in push.ts/StaffOrderWatcher).
const DISMISSED_KEY = '4astore_fsi_nudge_dismissed';

// Bilingual (romanized Hindi + English) copy.
const TITLE = '📞 Full-screen order alert';
const BODY =
  'Naye order ka caller-style full-screen alarm lock screen par dikhane ke liye "Full screen intent" allow karein. (Allow full-screen alerts so new orders ring like a call.)';
const OPEN = 'Settings kholein / Open settings';
const LATER = 'Baad mein / Later';

/**
 * Android-14+ full-screen-intent enable nudge, shown ONLY to order staff (who receive the
 * caller-card alarm) and ONLY once (persisted dismissal). There is no runtime read of the
 * USE_FULL_SCREEN_INTENT grant and no request dialog — it is a Settings special-access toggle —
 * so this one-time card deep-links to MANAGE_APP_USE_FULL_SCREEN_INTENT (Linking fallback).
 * Regular customers, older Android, and iOS never see it. Every call is no-throw.
 */
export default function FullScreenIntentNudge() {
  const insets = useSafeAreaInsets();
  const user = useAuth((s) => s.user);
  const staff = isOrderStaff(user);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      let alreadyDismissed = true;
      try {
        alreadyDismissed = (await AsyncStorage.getItem(DISMISSED_KEY)) === '1';
      } catch {
        alreadyDismissed = true; // on error, err toward NOT nagging
      }
      if (!alive) return;
      setVisible(
        shouldShowFullScreenNudge({
          platformOS: Platform.OS,
          platformVersion: Number(Platform.Version),
          isOrderStaff: staff,
          alreadyDismissed,
        }),
      );
    })();
    return () => {
      alive = false;
    };
  }, [staff]);

  // One-time: both "Open settings" and "Later" persist the dismissal so we never nag again.
  async function dismiss() {
    setVisible(false);
    try {
      await AsyncStorage.setItem(DISMISSED_KEY, '1');
    } catch {
      /* non-fatal — worst case it shows once more next launch */
    }
  }

  if (!visible) return null;

  return (
    <View pointerEvents="box-none" style={[styles.wrap, { bottom: insets.bottom + 12 }]}>
      <View style={styles.card} accessibilityRole="alert" accessibilityLiveRegion="polite">
        <View style={styles.row}>
          <Text style={styles.title}>{TITLE}</Text>
          <Pressable onPress={() => void dismiss()} hitSlop={10} accessibilityRole="button" accessibilityLabel="Dismiss">
            <Text style={styles.close}>×</Text>
          </Pressable>
        </View>
        <Text style={styles.body}>{BODY}</Text>
        <View style={styles.actions}>
          <Button
            title={OPEN}
            small
            onPress={() => {
              void openFullScreenIntentSettings();
              void dismiss();
            }}
            style={{ flex: 1 }}
          />
          <Button title={LATER} small outline color={colors.gray} onPress={() => void dismiss()} style={{ flex: 1 }} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 12, right: 12, zIndex: 9990 },
  card: { backgroundColor: '#fff', borderRadius: radius.md, padding: 14, borderLeftWidth: 4, borderLeftColor: colors.admin, ...shadow, elevation: 8 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { flex: 1, fontSize: 15, fontWeight: '800', color: colors.dark },
  close: { fontSize: 22, lineHeight: 22, color: colors.gray, paddingHorizontal: 4 },
  body: { fontSize: 13, color: colors.gray, lineHeight: 19, marginTop: 6 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 12 },
});
