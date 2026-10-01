import React, { useEffect, useState } from 'react';
import { Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fetchAnnouncement } from '../queries';
import { useAuth } from '../store/auth';
import { openLink } from '../links';
import { speakHindi } from '../native';
import { offerGradient } from '../theme';
import { productImageUri } from '../productImage';
import type { Announcement } from '../types';

const SPOKEN_KEY = '4astore_ann_spoken';

/** `*20% OFF*` → highlighted chip. */
function Highlighted({ text }: { text: string }) {
  const parts = text.split(/\*([^*]+)\*/g);
  return (
    <Text style={styles.text}>
      {parts.map((p, i) => (i % 2 ? <Text key={i} style={styles.hl}> {p} </Text> : p))}
    </Text>
  );
}

/** Web AnnouncementPopup: shown + spoken (Hindi TTS) once per announcement id; target all or a mobile. */
export default function AnnouncementPopup() {
  const { user, ready } = useAuth();
  const router = useRouter();
  const [ann, setAnn] = useState<Announcement | null>(null);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const a = await fetchAnnouncement();
        if (cancelled || !a || !a.enabled || (!a.text && !a.image)) return;
        const target = (a.target || 'all').trim();
        if (target !== 'all' && user?.mobile !== target) return;
        if ((await AsyncStorage.getItem(SPOKEN_KEY)) === String(a.id)) return;
        setAnn(a);
        await AsyncStorage.setItem(SPOKEN_KEY, String(a.id));
        if (a.text) speakHindi(a.text.replace(/\*/g, ''));
      } catch {
        /* optional */
      }
    }, 700);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [ready, user?.mobile]);

  if (!ann) return null;
  const close = () => setAnn(null);
  const hasCta = !!(ann.ctaText && ann.ctaLink);

  return (
    <Modal visible transparent animationType="fade" onRequestClose={close}>
      <Pressable style={styles.backdrop} onPress={close} accessibilityLabel="Close offer">
        <Pressable style={styles.sheet} onPress={() => null} accessibilityViewIsModal>
          <LinearGradient colors={offerGradient as unknown as string[]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.head}>
            <Text style={styles.headText}>🎉 Special Offer</Text>
            <Pressable onPress={close} style={styles.close} accessibilityRole="button" accessibilityLabel="Close" hitSlop={8}>
              <Text style={{ color: '#fff', fontSize: 18 }}>×</Text>
            </Pressable>
          </LinearGradient>
          {!!ann.image && <Image source={{ uri: productImageUri(ann.image) }} style={styles.img} resizeMode="contain" />}
          <ScrollView style={{ maxHeight: 260 }} contentContainerStyle={{ padding: 18 }}>
            {!!ann.text && <Highlighted text={ann.text} />}
          </ScrollView>
          {hasCta && (
            <View style={{ padding: 14, borderTopWidth: 1, borderTopColor: '#eee' }}>
              <Pressable
                onPress={() => {
                  close();
                  openLink(router, ann.ctaLink);
                }}
                accessibilityRole="button"
              >
                <LinearGradient colors={offerGradient as unknown as string[]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.cta}>
                  <Text style={{ color: '#fff', fontWeight: '800', fontSize: 16 }}>{ann.ctaText} →</Text>
                </LinearGradient>
              </Pressable>
            </View>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', alignItems: 'center', justifyContent: 'center', padding: 16 },
  sheet: { backgroundColor: '#fff', borderRadius: 18, width: '100%', maxWidth: 420, overflow: 'hidden' },
  head: { paddingVertical: 14, paddingHorizontal: 44, alignItems: 'center' },
  headText: { color: '#fff', fontWeight: '800', fontSize: 16 },
  close: { position: 'absolute', right: 10, top: 9, width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.25)', alignItems: 'center', justifyContent: 'center' },
  img: { width: '100%', height: 220, marginTop: 14 },
  text: { fontSize: 15, color: '#333', lineHeight: 24, textAlign: 'center' },
  hl: { backgroundColor: '#fff3cd', color: '#e65100', fontWeight: '800' },
  cta: { padding: 14, borderRadius: 12, alignItems: 'center' },
});
