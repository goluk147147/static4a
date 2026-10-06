import React, { useEffect, useRef } from 'react';
import { Stack, useRouter } from 'expo-router';
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
import { ensureChannels, listenForeground, listenNotificationTaps, listenTokenRotation, registerForPush } from '../src/push';
import { legacyToRoute } from '../src/links';
import { showToast } from '../src/store/ui';
import OfflineGate from '../src/components/OfflineGate';
import Overlays from '../src/components/Overlays';
import UpdateCheck from '../src/components/UpdateCheck';
import StaffOrderWatcher from '../src/components/StaffOrderWatcher';

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
  const userId = useAuth((s) => s.user?.id);
  const role = useAuth((s) => s.user?.role);

  useEffect(() => {
    void ensureChannels();
    void bootstrap();
  }, [bootstrap]);

  // Restore the last storefront snapshot (instant warm start), then keep persisting it.
  useEffect(() => {
    let stop: (() => void) | undefined;
    void restoreCache(queryClient).finally(() => { stop = startPersisting(queryClient); });
    return () => stop?.();
  }, []);

  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => null);
  }, [ready]);

  // (Re)register the device token whenever the user or role changes → correct topics
  // (admins / riders / customers) so role changes made by the owner take effect.
  useEffect(() => {
    if (userId) void registerForPush();
  }, [userId, role]);

  useEffect(() => listenTokenRotation(), []);

  // Coming back to the app: refresh session (picks up a newly assigned role) and data.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active' && useAuth.getState().user) {
        void reloadSession();
        void queryClient.invalidateQueries({ queryKey: ['all-orders'] });
      }
    });
    return () => sub.remove();
  }, [reloadSession]);

  // Tap on a push → deep link (new order → admin order detail, status → tracking, …).
  // A cold-start tap can arrive BEFORE auth bootstrap + the navigator are mounted; navigating
  // then is a no-op and the app sits on the splash/loader. So we stash the target and only
  // navigate once `ready` is true, and use replace() so there's no dangling loading route.
  const pendingLink = useRef<string | null>(null);
  const navigateToLink = (link: string) => {
    const to = legacyToRoute(link, '/');
    if (/^[a-z]+:/i.test(to)) return; // external scheme — ignore here
    if (!useAuth.getState().ready) {
      pendingLink.current = to;
      return;
    }
    setTimeout(() => router.replace(to as never), 150);
  };
  useEffect(() => listenNotificationTaps((link) => navigateToLink(link)), []); // eslint-disable-line react-hooks/exhaustive-deps

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
          <Overlays />
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
