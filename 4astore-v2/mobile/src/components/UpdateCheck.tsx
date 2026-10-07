import React, { useEffect, useState } from 'react';
import { Linking, Modal, Text, View } from 'react-native';
import { api } from '../api';
import { appVersion } from '../native';
import { colors } from '../theme';
import { shouldShowUpdate, type VersionInfo } from '../updatePolicy';
import { Button } from './ui';

const PLAY_URL = 'market://details?id=com.store4a.app';

/** Update channel (old app's version.json check): Play Store first, self-hosted APK as fallback. */
export default function UpdateCheck() {
  const [info, setInfo] = useState<VersionInfo | null>(null);

  useEffect(() => {
    const t = setTimeout(async () => {
      try {
        const v = (await api.get('/version')) as VersionInfo;
        const current = appVersion().versionCode;
        if (shouldShowUpdate(v, current)) setInfo(v);
      } catch {
        /* ignore */
      }
    }, 3000);
    return () => clearTimeout(t);
  }, []);

  if (!info) return null;
  const update = () =>
    Linking.openURL(PLAY_URL).catch(() => (info.url ? Linking.openURL(info.url) : Linking.openURL('https://play.google.com/store/apps/details?id=com.store4a.app')));

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => !info.forceUpdate && setInfo(null)}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <View style={{ backgroundColor: '#fff', borderRadius: 18, padding: 22, width: '100%', maxWidth: 400 }}>
          <Text style={{ fontSize: 18, fontWeight: '800', color: colors.dark }}>🚀 Update available ({info.versionName})</Text>
          <Text style={{ color: colors.gray, marginTop: 8, lineHeight: 20 }}>{info.message || 'A new update is available.'}</Text>
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 18 }}>
            {!info.forceUpdate && <Button title="Later" outline color={colors.gray} onPress={() => setInfo(null)} style={{ flex: 1 }} />}
            <Button title="Update" onPress={update} style={{ flex: 1 }} />
          </View>
        </View>
      </View>
    </Modal>
  );
}
