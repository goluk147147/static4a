import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import StoreHeader from '../src/components/StoreHeader';
import { Button, Card, Field, GradientButton, Screen, styles as ui } from '../src/components/ui';
import { useAuth } from '../src/store/auth';
import { api, apiError } from '../src/api';
import { radius, space } from '../src/theme';

// "Complete your profile" gate (Issue 6, mobile half). A Google user is created with a `g<digits>`
// placeholder mobile; this one-time screen collects a real 10-digit mobile and verifies it via the
// FEAT-001 email-OTP endpoints (/users/mobile/send + /users/mobile/verify), then refreshes the
// session so the gate (needsRealMobile) stops firing. The redirect that lands the user here lives
// in app/_layout.tsx. Mirrors login.tsx's email-OTP interaction: a "Send code" button, then an OTP
// Field + verify button, and the OTP is never auto-filled (the user reads it from their email).
export default function CompleteProfile() {
  const router = useRouter();
  const reloadSession = useAuth((s) => s.reloadSession);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [mobile, setMobile] = useState('');
  const [otp, setOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);

  async function sendCode() {
    setBusy(true);
    setError('');
    try {
      await api.post('/users/mobile/send', {});
      setOtpSent(true);
      setOtp('');
      // Email OTP is never auto-filled — the user reads it from their email and types it
      // (same policy as login.tsx; the server's devOtp is ignored on real builds).
    } catch (e) {
      setError(apiError(e));
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    setBusy(true);
    setError('');
    try {
      await api.post('/users/mobile/verify', { mobile: mobile.trim(), otp: otp.trim() });
      await reloadSession();
      router.replace('/');
    } catch (e) {
      setError(apiError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen header={<StoreHeader back hideSearch />}>
        <Card style={styles.card}>
          <Text style={styles.title}>Complete your profile</Text>
          <Text style={[ui.muted, { marginBottom: space.md }]}>
            Apna 10-digit mobile number verify karein — code aapke registered email par aayega. / Verify your 10-digit mobile
            — the code goes to your registered email.
          </Text>

          {!!error && (
            <View style={styles.errorBox} accessibilityRole="alert">
              <Text style={{ color: '#b42318' }}>{error}</Text>
            </View>
          )}

          <Field
            label="Mobile (10-digit)"
            value={mobile}
            onChangeText={(t) => setMobile(t.replace(/\D/g, ''))}
            keyboardType="phone-pad"
            maxLength={10}
          />
          <Button
            title={otpSent ? 'Resend code' : 'Send code'}
            outline
            onPress={sendCode}
            disabled={busy || mobile.length !== 10}
            style={{ marginBottom: space.md }}
          />
          {otpSent && (
            <>
              <Text style={[ui.muted, { marginBottom: 6 }]}>📧 6 ankon ka code email check karke daalein. / Enter the 6-digit code from your email.</Text>
              <Field
                label="Email OTP"
                value={otp}
                onChangeText={(t) => setOtp(t.replace(/\D/g, ''))}
                keyboardType="number-pad"
                maxLength={6}
                textContentType="oneTimeCode"
                autoComplete="sms-otp"
              />
              <GradientButton
                title={busy ? 'Please wait…' : 'Verify & Continue'}
                onPress={verify}
                loading={busy}
                disabled={mobile.length !== 10 || otp.length !== 6}
                style={{ marginTop: space.sm }}
              />
            </>
          )}
        </Card>
      </Screen>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  card: { padding: 20 },
  title: { fontSize: 20, fontWeight: '800', color: '#2a1a12', marginBottom: 6 },
  errorBox: { backgroundColor: '#fdecea', padding: 10, borderRadius: radius.sm, marginBottom: 12 },
});
