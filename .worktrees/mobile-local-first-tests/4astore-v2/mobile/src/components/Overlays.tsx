import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { closeConfirm, dismissToast, useUi } from '../store/ui';
import { colors, radius, shadow } from '../theme';
import { Button } from './ui';

const BORDER = { success: colors.primary, error: colors.accent, info: colors.secondary };
const ICON = { success: '✅', error: '❌', info: 'ℹ️' };

/** Toast stack + confirm dialog (web Toasts.tsx / ConfirmDialog.tsx). */
export default function Overlays() {
  const toasts = useUi((s) => s.toasts);
  const confirm = useUi((s) => s.confirm);
  const insets = useSafeAreaInsets();

  return (
    <>
      <View pointerEvents="box-none" style={[styles.toastWrap, { top: insets.top + 8 }]}>
        {toasts.map((t) => (
          <Pressable key={t.id} onPress={() => dismissToast(t.id)} style={[styles.toast, { borderLeftColor: BORDER[t.type] }]} accessibilityRole="alert" accessibilityLiveRegion="polite">
            <Text style={{ fontSize: 16 }}>{ICON[t.type]}</Text>
            <Text style={styles.toastText}>{t.message}</Text>
          </Pressable>
        ))}
      </View>

      <Modal visible={!!confirm} transparent animationType="fade" onRequestClose={() => closeConfirm(false)}>
        <View style={styles.backdrop}>
          <View style={styles.dialog} accessibilityViewIsModal>
            <Text style={styles.title}>{confirm?.title || 'Please confirm'}</Text>
            <Text style={styles.msg}>{confirm?.message}</Text>
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
              <Button title="Cancel" outline color={colors.gray} onPress={() => closeConfirm(false)} style={{ flex: 1 }} />
              <Button title={confirm?.confirmText || 'OK'} color={confirm?.danger ? '#c62828' : colors.primary} onPress={() => closeConfirm(true)} style={{ flex: 1 }} />
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  toastWrap: { position: 'absolute', left: 12, right: 12, zIndex: 9999, gap: 8 },
  toast: { flexDirection: 'row', gap: 10, alignItems: 'center', backgroundColor: '#fff', borderRadius: radius.sm, padding: 14, borderLeftWidth: 4, ...shadow, elevation: 8 },
  toastText: { flex: 1, color: colors.dark, fontSize: 13.5, lineHeight: 19 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  dialog: { backgroundColor: '#fff', borderRadius: radius.lg, padding: 20, width: '100%', maxWidth: 420 },
  title: { fontSize: 18, fontWeight: '800', color: colors.dark, marginBottom: 8 },
  msg: { fontSize: 14, color: colors.gray, lineHeight: 21 },
});
