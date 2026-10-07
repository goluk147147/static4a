import React, { useEffect, useState } from 'react';
import { Image, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { GoogleSignin, isSuccessResponse, statusCodes } from '@react-native-google-signin/google-signin';
import StoreHeader from '../src/components/StoreHeader';
import { AnimatedGradient, Button, Card, Field, GradientButton, PasswordField, Screen, styles as ui } from '../src/components/ui';
import { useAuth, isOrderStaff, isRider } from '../src/store/auth';
import { api, apiError } from '../src/api';
import { registerForPush } from '../src/push';
import { showToast } from '../src/store/ui';
import { GOOGLE_WEB_CLIENT_ID } from '../src/config';
import { colors, offerGradient, radius, space } from '../src/theme';

// Facebook/Instagram login is hidden until their OAuth setup is complete — re-enable later.
const SOCIAL_FB_IG_ENABLED = false;

export default function Login() {
  const router = useRouter();
  const { next } = useLocalSearchParams<{ next?: string }>();
  const { login, socialLogin, register } = useAuth();
  const [mode, setMode] = useState<'login' | 'register' | 'forgot'>('login');
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
  // Forgot-password form: identifier = username / mobile / email
  const [resetId, setResetId] = useState('');
  const [resetPassword, setResetPassword] = useState('');

  // Configure native Google Sign-In once. The WEB client id is required to populate idToken;
  // with no web id provisioned the button stays on its "setup pending" toast (build-safe fallback).
  useEffect(() => {
    if (GOOGLE_WEB_CLIENT_ID) {
      GoogleSignin.configure({ webClientId: GOOGLE_WEB_CLIENT_ID });
    }
  }, []);

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

  // --- Forgot password (item 12) ---------------------------------------------
  // Real end-to-end reset via the PUBLIC endpoints:
  //   POST /users/forgot-password/send { identifier }  → emails a 6-digit code
  //   POST /users/reset-password { identifier, otp, newPassword }
  // identifier = username / mobile / email. The server is enumeration-safe and
  // always returns a generic success for the send step.
  function switchMode(m: 'login' | 'register' | 'forgot') {
    setMode(m);
    setError('');
    setOtpSent(false);
    setOtp('');
    setResetId('');
    setResetPassword('');
  }
  async function sendResetOtp() {
    setBusy(true);
    setError('');
    try {
      await api.post('/users/forgot-password/send', { identifier: resetId.trim() });
      setOtpSent(true);
      setOtp('');
      showToast('Reset code aapke registered email par bheja gaya. / Reset code sent to your registered email.', 'info');
    } catch (e) {
      setError(apiError(e));
    } finally {
      setBusy(false);
    }
  }
  async function submitReset() {
    setBusy(true);
    setError('');
    try {
      await api.post('/users/reset-password', { identifier: resetId.trim(), otp: otp.trim(), newPassword: resetPassword });
      showToast('Password reset ✅ — ab naye password se login karein. / Log in with your new password.', 'success');
      // Return to login prefilled with the identifier the user just reset.
      setUsername(resetId.trim());
      switchMode('login');
    } catch (e) {
      setError(apiError(e));
    } finally {
      setBusy(false);
    }
  }

  // --- Social login (item 13) ------------------------------------------------
  // Real Google Sign-In via @react-native-google-signin/google-signin. Tapping the button runs the
  // native sign-in sheet; the WEB-client idToken it returns is passed unchanged to socialLogin —
  // the SAME session path as login() (socialLogin → setAccessToken + saveRefreshToken + user), then
  // done(). With no web client ID provisioned the button stays on its "setup pending" toast.
  async function startGoogle() {
    if (!GOOGLE_WEB_CLIENT_ID) {
      showToast('Google login setup pending — admin se contact karein. / Google login setup pending — please contact admin.', 'info');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
      const res = await GoogleSignin.signIn();
      if (isSuccessResponse(res)) {
        const idToken = res.data.idToken;
        if (!idToken) {
          showToast('Google login failed — token missing. / Google login viphal — token nahi mila.', 'error');
          return;
        }
        const user = await socialLogin(idToken);
        done(user);
      }
    } catch (e) {
      // User dismissed the native sheet — not an error, no toast.
      if ((e as { code?: string })?.code === statusCodes.SIGN_IN_CANCELLED) return;
      showToast(apiError(e), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen header={<StoreHeader back hideSearch />}>
        {/* Branded gradient hero — same warm gradient family as buttons/header. */}
        <AnimatedGradient style={styles.hero}>
          <View style={styles.heroInner}>
            <Image source={require('../assets/images/icon.png')} style={styles.heroLogo} resizeMode="contain" accessibilityLabel="4A Store" />
            <Text style={styles.heroTitle}>
              {mode === 'login' ? 'Welcome back 👋' : mode === 'register' ? 'Create your account' : 'Reset password'}
            </Text>
            <Text style={styles.heroSub}>
              {mode === 'login'
                ? 'Login karein / Login to continue'
                : mode === 'register'
                ? 'Naya account banayein / Join 4A Store'
                : 'Email se password reset karein / Reset via email'}
            </Text>
          </View>
        </AnimatedGradient>

        <Card style={styles.card}>
          {!!error && (
            <View style={styles.errorBox} accessibilityRole="alert">
              <Text style={{ color: '#b42318' }}>{error}</Text>
            </View>
          )}

          {mode === 'login' ? (
            <>
              <Field label="Username, Mobile or Email" value={username} onChangeText={setUsername} autoCapitalize="none" autoComplete="username" keyboardType="email-address" />
              <PasswordField label="Password" value={password} onChangeText={setPassword} autoComplete="password" onSubmitEditing={doLogin} />
              <Pressable onPress={() => switchMode('forgot')} style={styles.forgotLink} accessibilityRole="button">
                <Text style={[ui.muted, { color: colors.primary, fontWeight: '700' }]}>Forgot password? / पासवर्ड भूल गए?</Text>
              </Pressable>
              <GradientButton title={busy ? 'Please wait…' : 'Login'} onPress={doLogin} loading={busy} disabled={!username || !password} />

              <SocialBlock onGoogle={startGoogle} googleDisabled={busy} />

              <Pressable onPress={() => switchMode('register')} style={styles.switchLink} accessibilityRole="button">
                <Text style={ui.muted}>New here? <Text style={styles.linkStrong}>Create account</Text></Text>
              </Pressable>
            </>
          ) : mode === 'register' ? (
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
              <Pressable onPress={() => switchMode('login')} style={styles.switchLink} accessibilityRole="button">
                <Text style={ui.muted}>Already have an account? <Text style={styles.linkStrong}>Login</Text></Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={[ui.muted, { marginBottom: 10 }]}>
                Username, mobile ya email daalein — reset code aapke registered email par aayega. / Enter your username, mobile or
                email — the reset code goes to your registered email.
              </Text>
              <Field
                label="Username / Mobile / Email"
                value={resetId}
                onChangeText={setResetId}
                autoCapitalize="none"
                autoComplete="username"
                editable={!otpSent}
              />
              <Button title={otpSent ? 'Resend code' : 'Send reset code'} outline onPress={sendResetOtp} disabled={busy || !resetId} style={{ marginBottom: space.md }} />
              {otpSent && (
                <>
                  <Text style={[ui.muted, { marginBottom: 6 }]}>📧 6 ankon ka code email check karke daalein. / Enter the 6-digit code from your email.</Text>
                  <Field label="Reset code" value={otp} onChangeText={(t) => setOtp(t.replace(/\D/g, ''))} keyboardType="number-pad" maxLength={6} textContentType="oneTimeCode" autoComplete="sms-otp" />
                  <PasswordField label="New Password (4+ chars) / नया पासवर्ड" value={resetPassword} onChangeText={setResetPassword} />
                  <GradientButton
                    title={busy ? 'Please wait…' : 'Reset Password'}
                    onPress={submitReset}
                    loading={busy}
                    disabled={!otp || !resetPassword}
                    style={{ marginTop: space.sm }}
                  />
                </>
              )}
              <Text style={[ui.muted, { marginTop: 12, textAlign: 'center' }]}>
                Email nahi hai? Store se contact karein: 7543888698
              </Text>
              <Pressable onPress={() => switchMode('login')} style={styles.switchLink} accessibilityRole="button">
                <Text style={ui.muted}>Back to <Text style={styles.linkStrong}>Login</Text></Text>
              </Pressable>
            </>
          )}
        </Card>
      </Screen>
    </KeyboardAvoidingView>
  );
}

/**
 * Social sign-in block. Only the Google button renders — Facebook/Instagram stay hidden behind
 * SOCIAL_FB_IG_ENABLED until their OAuth setup is complete (see FEAT-003). The Google button uses
 * the native @react-native-google-signin/google-signin flow (text/emoji only — no icon font).
 */
function SocialBlock({ onGoogle, googleDisabled }: { onGoogle: () => void; googleDisabled?: boolean }) {
  return (
    <View style={styles.social}>
      <View style={styles.dividerRow}>
        <View style={styles.dividerLine} />
        <Text style={styles.dividerText}>or continue with / या इसके साथ जारी रखें</Text>
        <View style={styles.dividerLine} />
      </View>

      <Pressable
        onPress={onGoogle}
        disabled={googleDisabled}
        style={({ pressed }) => [styles.socialBtn, styles.googleBtn, (pressed || googleDisabled) && { opacity: 0.85 }]}
        accessibilityRole="button"
        accessibilityState={{ disabled: !!googleDisabled }}
        accessibilityLabel="Continue with Google"
      >
        <Text style={styles.googleG}>G</Text>
        <Text style={styles.socialTextDark}>Continue with Google</Text>
      </Pressable>

      {/* Facebook/Instagram sign-in — hidden until their OAuth setup is complete (FEAT-003). The
          plumbing stays so re-enabling is a one-line flip of SOCIAL_FB_IG_ENABLED above. */}
      {SOCIAL_FB_IG_ENABLED && (
        <>
          <Pressable
            onPress={() => showToast('Facebook login setup pending — admin se contact karein. / Facebook login setup pending — please contact admin.', 'info')}
            style={({ pressed }) => [styles.socialBtn, styles.facebookBtn, pressed && { opacity: 0.85 }]}
            accessibilityRole="button"
            accessibilityLabel="Continue with Facebook"
          >
            <Text style={styles.socialTextLight}>f   Continue with Facebook</Text>
          </Pressable>

          <Pressable
            onPress={() => showToast('Instagram login setup pending — admin se contact karein. / Instagram login setup pending — please contact admin.', 'info')}
            style={({ pressed }) => [styles.socialBtn, { padding: 0, overflow: 'hidden' }, pressed && { opacity: 0.85 }]}
            accessibilityRole="button"
            accessibilityLabel="Continue with Instagram"
          >
            <AnimatedGradient colors={offerGradient} animated={false} style={styles.instaGrad}>
              <Text style={styles.socialTextLight}>📷  Continue with Instagram</Text>
            </AnimatedGradient>
          </Pressable>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { borderRadius: radius.lg, overflow: 'hidden', marginBottom: space.md },
  heroInner: { alignItems: 'center', paddingVertical: space.xl, paddingHorizontal: space.lg },
  heroLogo: { width: 72, height: 72, borderRadius: radius.md, marginBottom: space.md, backgroundColor: 'rgba(255,255,255,0.9)' },
  heroTitle: { fontSize: 22, fontWeight: '800', color: '#fff', textAlign: 'center' },
  heroSub: { fontSize: 13, fontWeight: '600', color: 'rgba(255,255,255,0.95)', textAlign: 'center', marginTop: 4 },
  card: { padding: 20 },
  errorBox: { backgroundColor: '#fdecea', padding: 10, borderRadius: 8, marginBottom: 12 },
  forgotLink: { alignSelf: 'flex-end', marginBottom: space.md, marginTop: -4 },
  switchLink: { marginTop: 14, alignItems: 'center' },
  linkStrong: { color: colors.primary, fontWeight: '700' },
  social: { marginTop: space.lg },
  dividerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: space.md },
  dividerLine: { flex: 1, height: 1, backgroundColor: colors.border },
  dividerText: { marginHorizontal: 8, fontSize: 11, color: colors.gray, fontWeight: '600' },
  socialBtn: { minHeight: 48, borderRadius: radius.pill, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: 10, paddingHorizontal: 16 },
  googleBtn: { backgroundColor: '#fff', borderWidth: 1.5, borderColor: colors.border },
  googleG: { fontSize: 18, fontWeight: '800', color: '#4285F4', marginRight: 10 },
  facebookBtn: { backgroundColor: '#1877F2' },
  instaGrad: { minHeight: 48, width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  socialTextDark: { fontSize: 15, fontWeight: '700', color: colors.dark },
  socialTextLight: { fontSize: 15, fontWeight: '700', color: '#fff' },
});
