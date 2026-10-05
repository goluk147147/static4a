import React, { ReactNode, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { colors } from '../theme';
import { Button } from './ui';
import { queryClient } from '../queries';

/** Old app's "No Internet Connection" screen with Retry. */
export default function OfflineGate({ children }: { children: ReactNode }) {
  const [offline, setOffline] = useState(false);

  useEffect(
    () =>
      NetInfo.addEventListener((s) => {
        const off = s.isConnected === false || s.isInternetReachable === false;
        setOffline((was) => {
          if (was && !off) void queryClient.invalidateQueries();
          return off;
        });
      }),
    []
  );

  const retry = async () => {
    const s = await NetInfo.refresh();
    if (s.isConnected && s.isInternetReachable !== false) {
      setOffline(false);
      void queryClient.invalidateQueries();
    }
  };

  return (
    <View style={{ flex: 1 }}>
      {children}
      {offline && (
        <View style={{ position: 'absolute', inset: 0, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', padding: 30 }} accessibilityViewIsModal>
          <Text style={{ fontSize: 64, marginBottom: 12 }}>📡</Text>
          <Text style={{ fontSize: 20, fontWeight: '800', color: colors.dark, marginBottom: 6 }}>No Internet Connection</Text>
          <Text style={{ color: colors.gray, textAlign: 'center', marginBottom: 20 }}>Please check your internet connection and try again.{'\n'}इंटरनेट कनेक्शन जाँचें।</Text>
          <Button title="Retry" onPress={retry} style={{ minWidth: 160 }} />
        </View>
      )}
    </View>
  );
}
