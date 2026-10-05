import React, { ReactNode } from 'react';
import {
  ActivityIndicator,
  Animated,
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
  size,
  accessibilityLabel,
}: {
  title: string;
  onPress?: () => void;
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  size?: 'sm';
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
      <LinearGradient colors={warmGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.gradBtn, size === 'sm' && styles.gradBtnSm]}>
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={[styles.gradText, textStyle]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>
            {title}
          </Text>
        )}
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

/** Password input with a show/hide (eye) toggle. Same label/error styling as Field. */
export function PasswordField({
  label,
  error,
  errorText,
  style,
  ...props
}: Omit<TextInputProps, 'secureTextEntry'> & { label: string; error?: boolean; errorText?: string }) {
  const [show, setShow] = React.useState(false);
  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.pwdWrap}>
        <TextInput
          placeholderTextColor="#a3928a"
          accessibilityLabel={label}
          secureTextEntry={!show}
          autoCapitalize="none"
          autoCorrect={false}
          {...props}
          style={[styles.input, styles.pwdInput, error && { borderColor: colors.accent }, style]}
        />
        <Pressable
          onPress={() => setShow((s) => !s)}
          style={styles.pwdEye}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={show ? 'Hide password' : 'Show password'}
        >
          <Text style={{ fontSize: 20 }}>{show ? '🙈' : '👁️'}</Text>
        </Pressable>
      </View>
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

/**
 * App-wide animated warm gradient (same colour family as buttons/header via `warmGradient`).
 * The gradient endpoints slowly sweep back and forth for a subtle living shimmer. Use it as a
 * banner/section background so every gradient surface in the app matches and animates the same way.
 */
export function AnimatedGradient({
  children,
  style,
  colors: colorsOverride,
  animated = true,
}: {
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  colors?: readonly [string, string, ...string[]];
  /** When false, render a single static gradient (same colours) with no looping sweep.
   *  Driven by the `animatedBanners` feature flag so the owner can calm it from admin. */
  animated?: boolean;
}) {
  const t = React.useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    if (!animated) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(t, { toValue: 1, duration: 3500, useNativeDriver: false }),
        Animated.timing(t, { toValue: 0, duration: 3500, useNativeDriver: false }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [t, animated]);
  const start = { x: 0, y: 0 };
  const end = { x: 1, y: 1 };
  // Animate by cross-fading two gradients at different diagonal angles.
  const topOpacity = t.interpolate({ inputRange: [0, 1], outputRange: [1, 0] });
  const g = colorsOverride || warmGradient;
  if (!animated) {
    // Static single gradient — identical colours, no shimmer.
    return (
      <View style={style}>
        <LinearGradient colors={g} start={start} end={end} style={StyleSheet.absoluteFill} />
        {children}
      </View>
    );
  }
  return (
    <View style={style}>
      <LinearGradient colors={g} start={start} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill} />
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: topOpacity }]}>
        <LinearGradient colors={g} start={start} end={end} style={StyleSheet.absoluteFill} />
      </Animated.View>
      {children}
    </View>
  );
}

/** A single shimmering block — a looping opacity pulse (no extra deps). */
export function Shimmer({ style }: { style?: StyleProp<ViewStyle> }) {
  const anim = React.useRef(new Animated.Value(0.3)).current;
  React.useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(anim, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(anim, { toValue: 0.3, duration: 700, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [anim]);
  return <Animated.View style={[{ backgroundColor: '#e9ddcb', borderRadius: 8, opacity: anim }, style]} />;
}

/** Skeleton product card matching ProductCard's shape, shown while products load. */
export function ProductCardSkeleton({ width }: { width?: number }) {
  return (
    <View style={[styles.card, width ? { width } : { flex: 1 }, { margin: 5 }]}>
      <Shimmer style={{ height: 110, borderRadius: radius.sm, marginBottom: 10 }} />
      <Shimmer style={{ height: 11, width: '45%', marginBottom: 8 }} />
      <Shimmer style={{ height: 13, width: '90%', marginBottom: 6 }} />
      <Shimmer style={{ height: 13, width: '70%', marginBottom: 10 }} />
      <Shimmer style={{ height: 16, width: '40%', marginBottom: 10 }} />
      <Shimmer style={{ height: 38, borderRadius: radius.sm }} />
    </View>
  );
}

/** A grid of skeleton product cards (2 columns), for the products list loading state. */
export function ProductGridSkeleton({ cardWidth, count = 6 }: { cardWidth?: number; count?: number }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 4 }}>
      {Array.from({ length: count }).map((_, i) => (
        <ProductCardSkeleton key={i} width={cardWidth} />
      ))}
    </View>
  );
}

export const styles = StyleSheet.create({
  gradBtn: { minHeight: 48, paddingHorizontal: 22, paddingVertical: 12, alignItems: 'center', justifyContent: 'center' },
  gradBtnSm: { minHeight: 44, paddingHorizontal: 16, paddingVertical: 10 },
  gradText: { color: '#fff', fontWeight: '800', fontSize: 15, textAlign: 'center' },
  btn: { minHeight: 44, paddingHorizontal: 16, paddingVertical: 10, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  btnSmall: { minHeight: 34, paddingHorizontal: 10, paddingVertical: 6 },
  btnText: { fontWeight: '700', fontSize: 14, textAlign: 'center' },
  card: { backgroundColor: colors.glass, borderRadius: radius.md, padding: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.78)', ...shadow },
  stepper: { flexDirection: 'row', alignItems: 'center', minHeight: 44, borderWidth: 1.5, borderColor: colors.primary, borderRadius: radius.sm, overflow: 'hidden' },
  stepBtn: { backgroundColor: colors.primary, width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  stepBtnText: { color: '#fff', fontSize: 18, fontWeight: '800' },
  stepQty: { minWidth: 34, textAlign: 'center', fontWeight: '800', fontSize: 15, color: colors.primary },
  h2: { fontSize: 20, fontWeight: '800', color: colors.dark },
  h3: { fontSize: 16, fontWeight: '800', color: colors.dark },
  sectionTitle: { fontSize: 18, fontWeight: '800', color: colors.primaryDark, marginBottom: 12 },
  muted: { color: colors.gray, fontSize: 13 },
  body: { fontSize: 14, color: colors.dark },
  bodyStrong: { fontSize: 14, fontWeight: '700', color: colors.dark },
  price: { fontSize: 16, fontWeight: '800', color: colors.primaryDark },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: '#fff', borderWidth: 1.5, borderColor: colors.border },
  pillActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  pillText: { fontSize: 13, fontWeight: '700', color: colors.dark },
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
  pwdWrap: { position: 'relative', justifyContent: 'center' },
  pwdInput: { paddingRight: 48 },
  pwdEye: { position: 'absolute', right: 6, top: 0, bottom: 0, width: 40, alignItems: 'center', justifyContent: 'center' },
  errorText: { color: colors.accent, fontSize: 12, marginTop: 4 },
  totalText: { fontSize: 18, fontWeight: '800', color: colors.primaryDark },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: 10 },
});
