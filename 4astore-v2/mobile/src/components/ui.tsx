import React, { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleProp,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  TextStyle,
  View,
  ViewStyle,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, radius, shadow, statusStyle, warmGradient } from '../theme';

/** Warm animated-gradient button (.btn-primary on the web). */
export function GradientButton({
  title,
  onPress,
  disabled,
  loading,
  style,
  textStyle,
  accessibilityLabel,
}: {
  title: string;
  onPress?: () => void;
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  accessibilityLabel?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || title}
      accessibilityState={{ disabled: !!(disabled || loading) }}
      style={({ pressed }) => [{ opacity: disabled ? 0.55 : pressed ? 0.85 : 1, borderRadius: radius.pill, overflow: 'hidden' }, style]}
    >
      <LinearGradient colors={warmGradient as unknown as string[]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.gradBtn}>
        {loading ? <ActivityIndicator color="#fff" /> : <Text style={[styles.gradText, textStyle]}>{title}</Text>}
      </LinearGradient>
    </Pressable>
  );
}

/** Solid button. */
export function Button({
  title,
  onPress,
  color = colors.primary,
  textColor = '#fff',
  outline,
  small,
  disabled,
  loading,
  style,
  accessibilityLabel,
}: {
  title: string;
  onPress?: () => void;
  color?: string;
  textColor?: string;
  outline?: boolean;
  small?: boolean;
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || title}
      accessibilityState={{ disabled: !!(disabled || loading) }}
      style={({ pressed }) => [
        styles.btn,
        small && styles.btnSmall,
        outline ? { backgroundColor: '#fff', borderWidth: 1.5, borderColor: color } : { backgroundColor: color },
        { opacity: disabled ? 0.5 : pressed ? 0.85 : 1 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={outline ? color : textColor} />
      ) : (
        <Text style={[styles.btnText, small && { fontSize: 12 }, { color: outline ? color : textColor }]}>{title}</Text>
      )}
    </Pressable>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Screen({
  children,
  refreshing,
  onRefresh,
  contentStyle,
  header,
}: {
  children: ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
  contentStyle?: StyleProp<ViewStyle>;
  header?: ReactNode;
}) {
  return (
    <View style={{ flex: 1, backgroundColor: colors.lightGray }}>
      {header}
      <ScrollView
        contentContainerStyle={[{ padding: 14, paddingBottom: 32 }, contentStyle]}
        keyboardShouldPersistTaps="handled"
        refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} colors={[colors.primary]} /> : undefined}
      >
        {children}
      </ScrollView>
    </View>
  );
}

export function Stepper({ qty, onMinus, onPlus, label }: { qty: number; onMinus: () => void; onPlus: () => void; label?: string }) {
  return (
    <View style={styles.stepper}>
      <Pressable onPress={onMinus} style={styles.stepBtn} accessibilityRole="button" accessibilityLabel={`Decrease ${label || 'quantity'}`} hitSlop={6}>
        <Text style={styles.stepBtnText}>−</Text>
      </Pressable>
      <Text style={styles.stepQty} accessibilityLabel={`Quantity ${qty}`}>{qty}</Text>
      <Pressable onPress={onPlus} style={styles.stepBtn} accessibilityRole="button" accessibilityLabel={`Increase ${label || 'quantity'}`} hitSlop={6}>
        <Text style={styles.stepBtnText}>+</Text>
      </Pressable>
    </View>
  );
}

export function EmptyState({ icon, title, text, action }: { icon: string; title: string; text?: string; action?: ReactNode }) {
  return (
    <Card style={{ alignItems: 'center', paddingVertical: 36 }}>
      <Text style={{ fontSize: 56, marginBottom: 8 }}>{icon}</Text>
      <Text style={styles.h3}>{title}</Text>
      {!!text && <Text style={[styles.muted, { textAlign: 'center', marginTop: 6, marginBottom: 14 }]}>{text}</Text>}
      {action}
    </Card>
  );
}

export function Field({
  label,
  error,
  errorText,
  style,
  ...props
}: TextInputProps & { label: string; error?: boolean; errorText?: string }) {
  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        placeholderTextColor="#a3928a"
        accessibilityLabel={label}
        {...props}
        style={[styles.input, error && { borderColor: colors.accent }, props.multiline && { minHeight: 80, textAlignVertical: 'top' }, style]}
      />
      {error && !!errorText && <Text style={styles.errorText}>{errorText}</Text>}
    </View>
  );
}

export function StatusChip({ status }: { status: string }) {
  const s = statusStyle(status);
  return (
    <View style={{ backgroundColor: s.bg, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 }}>
      <Text style={{ color: s.fg, fontSize: 12, fontWeight: '700' }}>{status}</Text>
    </View>
  );
}

export function SummaryRow({ label, value, bold, color }: { label: string; value: string; bold?: boolean; color?: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 }}>
      <Text style={[bold ? styles.totalText : styles.muted, color ? { color } : null]}>{label}</Text>
      <Text style={[bold ? styles.totalText : { color: colors.dark }, color ? { color } : null]}>{value}</Text>
    </View>
  );
}

export function Loading({ text = 'Loading...' }: { text?: string }) {
  return (
    <View style={{ padding: 40, alignItems: 'center' }}>
      <ActivityIndicator color={colors.primary} size="large" />
      <Text style={[styles.muted, { marginTop: 10 }]}>{text}</Text>
    </View>
  );
}

export const styles = StyleSheet.create({
  gradBtn: { minHeight: 48, paddingHorizontal: 22, paddingVertical: 12, alignItems: 'center', justifyContent: 'center' },
  gradText: { color: '#fff', fontWeight: '800', fontSize: 15, textAlign: 'center' },
  btn: { minHeight: 44, paddingHorizontal: 16, paddingVertical: 10, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  btnSmall: { minHeight: 34, paddingHorizontal: 10, paddingVertical: 6 },
  btnText: { fontWeight: '700', fontSize: 14, textAlign: 'center' },
  card: { backgroundColor: colors.glass, borderRadius: radius.md, padding: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.78)', ...shadow },
  stepper: { flexDirection: 'row', alignItems: 'center', borderWidth: 2, borderColor: colors.primary, borderRadius: radius.sm, overflow: 'hidden' },
  stepBtn: { backgroundColor: colors.primary, width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  stepBtnText: { color: '#fff', fontSize: 18, fontWeight: '800' },
  stepQty: { minWidth: 34, textAlign: 'center', fontWeight: '800', fontSize: 15, color: colors.primary },
  h2: { fontSize: 20, fontWeight: '800', color: colors.dark },
  h3: { fontSize: 16, fontWeight: '800', color: colors.dark },
  sectionTitle: { fontSize: 18, fontWeight: '800', color: colors.primaryDark, marginBottom: 12 },
  muted: { color: colors.gray, fontSize: 13 },
  label: { fontSize: 13, fontWeight: '700', color: colors.dark, marginBottom: 5 },
  input: {
    minHeight: 46,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: 'rgba(255,255,255,0.95)',
    fontSize: 15,
    color: colors.dark,
  },
  errorText: { color: colors.accent, fontSize: 12, marginTop: 4 },
  totalText: { fontSize: 18, fontWeight: '800', color: colors.primaryDark },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: 10 },
});
