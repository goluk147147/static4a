import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import StoreHeader from '../src/components/StoreHeader';
import { Button, Card, Field, GradientButton, PasswordField, Screen, styles as ui } from '../src/components/ui';
import { useAuth, isOrderStaff, isRider } from '../src/store/auth';
import { api, apiError } from '../src/api';
import { registerForPush } from '../src/push';
import { colors, space } from '../src/theme';

export default function Login() {
  const router = useRouter();
  const { next } = useLocalSearchParams<{ next?: string }>();
  const { login, register } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');
  const [email, setEmail] = useState('');
  const [regUser, setRegUser] = useState('');
  const [otp, setOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);

  function done(user: import('../src/types').User) {
    void registerForPush(); // subscribe to role topics (admins / riders / customers)
    const dest = next || (isOrderStaff(user) ? '/admin/orders' : isRider(user) ? '/rider' : '/');
    router.replace(dest as never);
  }

  async function doLogin() {
    setBusy(true);
    setError('');
    try {
      done(await login(username, password));
    } catch (e) {
      setError(apiError(e));
    } finally {
      setBusy(false);
    }
  }
  async function sendOtp() {
    setBusy(true);
    setError('');
    try {
      await api.post('/otp/send', { email: email.trim() });
      setOtpSent(true);
      setOtp('');
      // Email OTP is never auto-filled: the user reads it from their email and types it.
      // (The server's `devOtp` is for backend testing only; we deliberately ignore it so
      //  the field is never pre-filled with a static/leaked code on a real build.)
    } catch (e) {
      setError(apiError(e));
    } finally {
      setBusy(false);
    }
  }
  async function doRegister() {
    setBusy(true);
    setError('');
    try {
      done(await register({ name: name.trim(), mobile: mobile.trim(), username: regUser.trim(), email: email.trim(), password, otp: otp.trim() }));
    } catch (e) {
      setError(apiError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen header={<StoreHeader back hideSearch />}>
        <Card style={{ padding: 20 }}>
          <Text style={[ui.h2, { marginBottom: 14 }]}>{mode === 'login' ? 'Welcome back 👋' : 'Create your account'}</Text>
          {!!error && (
            <View style={{ backgroundColor: '#fdecea', padding: 10, borderRadius: 8, marginBottom: 12 }} accessibilityRole="alert">
              <Text style={{ color: '#b42318' }}>{error}</Text>
            </View>
          )}
          {mode === 'login' ? (
            <>
              <Field label="Username or Mobile" value={username} onChangeText={setUsername} autoCapitalize="none" autoComplete="username" />
              <PasswordField label="Password" value={password} onChangeText={setPassword} autoComplete="password" onSubmitEditing={doLogin} />
              <GradientButton title={busy ? 'Please wait…' : 'Login'} onPress={doLogin} loading={busy} disabled={!username || !password} />
              <Pressable onPress={() => { setMode('register'); setError(''); }} style={{ marginTop: 14, alignItems: 'center' }} accessibilityRole="button">
                <Text style={ui.muted}>New here? <Text style={{ color: colors.primary, fontWeight: '700' }}>Create account</Text></Text>
              </Pressable>
            </>
          ) : (
            <>
              <Field label="Full Name" value={name} onChangeText={setName} />
              <Field label="Mobile (10-digit)" value={mobile} onChangeText={(t) => setMobile(t.replace(/\D/g, ''))} keyboardType="phone-pad" maxLength={10} />
              <Field label="Username" value={regUser} onChangeText={setRegUser} autoCapitalize="none" />
              <PasswordField label="Password (4+ chars)" value={password} onChangeText={setPassword} />
              <Field label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
              <Button title={otpSent ? 'Resend OTP' : 'Send OTP'} outline onPress={sendOtp} disabled={busy || !email} style={{ marginBottom: space.md }} />
              {otpSent && (
                <>
                  <Text style={[ui.muted, { marginBottom: 6 }]}>📧 OTP aapke email par bheja gaya hai. Email check karke 6 ankon ka code daalein.</Text>
                  <Field label="Email OTP" value={otp} onChangeText={(t) => setOtp(t.replace(/\D/g, ''))} keyboardType="number-pad" maxLength={6} textContentType="oneTimeCode" autoComplete="sms-otp" />
                </>
              )}
              <GradientButton title={busy ? 'Please wait…' : 'Create Account'} onPress={doRegister} loading={busy} disabled={!otpSent} style={{ marginTop: space.sm }} />
              <Pressable onPress={() => { setMode('login'); setError(''); }} style={{ marginTop: 14, alignItems: 'center' }} accessibilityRole="button">
                <Text style={ui.muted}>Already have an account? <Text style={{ color: colors.primary, fontWeight: '700' }}>Login</Text></Text>
              </Pressable>
            </>
          )}
        </Card>
      </Screen>
    </KeyboardAvoidingView>
  );
}
