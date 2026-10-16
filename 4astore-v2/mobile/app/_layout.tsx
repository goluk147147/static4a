import React, { useEffect, useRef } from 'react';
import { Stack, useRouter, usePathname } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { AppState } from 'react-native';
import { setOnSessionExpired } from '../src/api';
import { queryClient } from '../src/queries';
import { restoreCache, startPersisting } from '../src/persistCache';
import { useAuth } from '../src/store/auth';
import { needsRealMobile } from '../src/profileGate';
import { ensureChannels, listenForeground, listenNotificationTaps, listenTokenRotation, registerForPush } from '../src/push';
import { legacyToRoute } from '../src/links';
import { promoRoute } from '../src/pushPayload';
import { logAppOpen, logScreenView } from '../src/analytics';
import { showToast } from '../src/store/ui';
import OfflineGate from '../src/components/OfflineGate';
import Overlays from '../src/components/Overlays';
import UpdateCheck from '../src/components/UpdateCheck';
import StaffOrderWatcher from '../src/components/StaffOrderWatcher';
import NotifPermissionGate from '../src/components/NotifPermissionGate';
import FullScreenIntentNudge from '../src/components/FullScreenIntentNudge';

SplashScreen.preventAutoHideAsync().catch(() => null);
SplashScreen.setOptions?.({ duration: 400, fade: true });

// Wire the auto-logout hook ONCE at module load (not per render): when a request's token is dead
// AND the silent refresh also fails, api.ts calls this so we clear the user state. The per-screen
// `if (ready && !user) router.replace('/login')` guards then bounce the user to Login instead of
// leaving a stale "logged-in" shell that can't load data. Manual logout already clears user itself,
// so a dead session and a manual logout both converge on the same clear with no double-clear issue.
setOnSessionExpired(() => useAuth.getState().setUser(null));

export default function RootLayout() {
  const router = useRouter();
  const bootstrap = useAuth((s) => s.bootstrap);
  const reloadSession = useAuth((s) => s.reloadSession);
  const ready = useAuth((s) => s.ready);
  const user = useAuth((s) => s.user);
  const userId = user?.id;
  const role = user?.role;
  const pathname = usePathname();

  useEffect(() => {
    void ensureChannels();
    void bootstrap();
  }, [bootstrap]);

  // Firebase Analytics (fire-and-forget). app_open once per JS launch (RNFirebase also auto-logs
  // the native app_open on cold start; they dedupe to the same event name, so an explicit call is
  // safe and covers JS warm starts). screen_view on every expo-router pathname change — the
  // pathname is the screen name (e.g. /products, /product/[id], /checkout). Additive listeners
  // only; routing is untouched.
  useEffect(() => {
    logAppOpen();
  }, []);
  useEffect(() => {
    if (pathname) logScreenView(pathname);
  }, [pathname]);

  // Restore the last storefront snapshot (instant warm start), then keep persisting it.
  useEffect(() => {
    let stop: (() => void) | undefined;
    void restoreCache(queryClient).finally(() => { stop = startPersisting(queryClient); });
    return () => stop?.();
  }, []);

  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => null);
  }, [ready]);

  // One-time "Complete your profile" gate (Issue 6): a Google user is minted with a `g<digits>`
  // placeholder mobile, so once bootstrap is `ready` and a user exists with no real 10-digit mobile
  // we send them to /complete-profile to set + verify one. gatedRef makes it fire at most ONCE per
  // app launch so it never loops; subscribing to `user` means a successful verify (reloadSession
  // sets a real mobile) makes needsRealMobile false and we never redirect again.
  const gatedRef = useRef(false);
  useEffect(() => {
    if (!ready || gatedRef.current) return;
    if (user && needsRealMobile(user)) {
      gatedRef.current = true;
      router.replace('/complete-profile');
    }
  }, [ready, user, router]);

  // (Re)register the device token on every launch once the session is ready, and whenever the
  // user or role changes. Depending on `ready` (not just userId) is the fix for "no push after an
  // app update": a lifelong-logged-in user keeps the SAME userId across an update, so a
  // userId-only effect never re-ran and the NEW build's fresh FCM token was never sent to the
  // server — the device kept getting pushes aimed at a stale token (or none). registerForPush is
  // idempotent, so re-running it is safe.
  // Register for a GUEST too: gate only on `ready` (not userId) so a freshly installed app
  // that hasn't logged in still registers its FCM token and receives broadcast/promo pushes.
  // Keeping userId/role in the deps means a later login re-runs this and the server
  // re-associates the same token to the user_id. registerForPush is idempotent, so re-running
  // it is safe.
  useEffect(() => {
    if (ready) void registerForPush();
  }, [ready, userId, role]);

  useEffect(() => listenTokenRotation(), []);

  // Coming back to the app: refresh session (picks up a newly assigned role) and data.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active') return;
      // Re-assert the FCM token on resume for a GUEST too — covers a token rotated/invalidated
      // while the app was backgrounded (a common cause of pushes silently stopping). This runs
      // regardless of login so a guest keeps receiving broadcast/promo pushes.
      void registerForPush();
      // Session reload + order/catalog invalidation stay gated on a logged-in user.
      if (useAuth.getState().user) {
        void reloadSession();
        void queryClient.invalidateQueries({ queryKey: ['all-orders'] });
        // refetchOnWindowFocus is inert on RN (focusManager not wired to AppState), so a reopened
        // app would otherwise keep showing a stale price/stock/image — invalidate the catalog here.
        void queryClient.invalidateQueries({ queryKey: ['products'] });
        void queryClient.invalidateQueries({ queryKey: ['categories'] });
      }
    });
    return () => sub.remove();
  }, [reloadSession]);

  // Tap on a push → deep link (new order → admin order detail, status → tracking, …).
  // A cold-start tap can arrive BEFORE auth bootstrap + the navigator are mounted; navigating
  // then is a no-op and the app sits on the splash/loader. So we stash the target and only
  // navigate once `ready` is true, and use replace() so there's no dangling loading route.
  const pendingLink = useRef<string | null>(null);
  // Navigate to an already-resolved in-app route (cold-start safe via pendingLink stashing).
  const navigateToRoute = (to: string) => {
    if (!useAuth.getState().ready) {
      pendingLink.current = to;
      return;
    }
    setTimeout(() => router.replace(to as never), 150);
  };
  const navigateToLink = (link: string) => {
    const to = legacyToRoute(link, '/');
    if (/^[a-z]+:/i.test(to)) return; // external scheme — ignore here
    navigateToRoute(to);
  };
  useEffect(
    () =>
      listenNotificationTaps((link, data) => {
        // A tapped promo push that carries an https image opens the full-screen in-app image;
        // order / status / rider taps (promoRoute === null) keep the existing deep-link routing.
        const promo = promoRoute(data);
        if (promo) {
          navigateToRoute(promo);
          return;
        }
        navigateToLink(link);
      }),
    [], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Once bootstrap finishes, flush any push tap that arrived during cold start.
  useEffect(() => {
    if (ready && pendingLink.current) {
      const to = pendingLink.current;
      pendingLink.current = null;
      setTimeout(() => router.replace(to as never), 150);
    }
  }, [ready, router]);

  // Foreground push → refresh lists + in-app toast.
  useEffect(
    () =>
      listenForeground((data, title) => {
        if (data.type === 'new_order' || data.type === 'order_reminder') {
          void queryClient.invalidateQueries({ queryKey: ['all-orders'] });
        }
        if (data.type === 'order_status' && data.orderId) {
          void queryClient.invalidateQueries({ queryKey: ['orders'] });
          void queryClient.invalidateQueries({ queryKey: ['track', data.orderId] });
        }
        if (data.type !== 'new_order_local') showToast(title, 'info');
      }),
    []
  );

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <StatusBar style="light" />
          <OfflineGate>
            <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#fffaf3' }, animation: 'slide_from_right' }} />
          </OfflineGate>
          <StaffOrderWatcher />
          <UpdateCheck />
          <NotifPermissionGate />
          <FullScreenIntentNudge />
          <Overlays />
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
