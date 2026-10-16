import React, { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { openLink } from '../../src/links';

/**
 * Customer full-screen promo image (in-app, NOT an OS full-screen intent — Play-policy safe).
 * Opened when a promo push with an absolute https image is TAPPED. Renders the whole 9:16 image
 * with resizeMode="contain" on a black background so nothing is cropped or needs scrolling.
 *  - top-right ✕ and tap-anywhere on the backdrop dismiss it
 *  - an optional CTA (shown only when a `link` param is present) follows the promo link
 *  - a load error shows a plain fallback with a close button — it never crashes
 */
export default function PromoImage() {
  const { image: raw, link } = useLocalSearchParams<{ image?: string; link?: string }>();
  const router = useRouter();
  const [failed, setFailed] = useState(false);

  let imageUrl = '';
  try {
    imageUrl = raw ? decodeURIComponent(String(raw)) : '';
  } catch {
    imageUrl = String(raw || '');
  }
  const ctaLink = link ? String(link) : '';

  const dismiss = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };

  return (
    <View style={styles.root}>
      {/* Tap-anywhere-to-dismiss backdrop (image/CTA sit above it). */}
      <Pressable style={StyleSheet.absoluteFill} onPress={dismiss} accessibilityLabel="Close promo" />

      {failed || !imageUrl ? (
        <View style={styles.fallback} pointerEvents="none">
          <Text style={styles.fallbackText}>Image load nahi hua</Text>
        </View>
      ) : (
        <Image
          source={{ uri: imageUrl }}
          style={StyleSheet.absoluteFill}
          resizeMode="contain"
          onError={() => setFailed(true)}
        />
      )}

      <Pressable style={styles.close} onPress={dismiss} hitSlop={12} accessibilityLabel="Close">
        <Text style={styles.closeText}>✕</Text>
      </Pressable>

      {!!ctaLink && (
        <Pressable style={styles.cta} onPress={() => openLink(router, ctaLink)}>
          <Text style={styles.ctaText}>View Offer</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  close: {
    position: 'absolute',
    top: 44,
    right: 18,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeText: { color: '#fff', fontSize: 22, lineHeight: 24, fontWeight: '600' },
  cta: {
    position: 'absolute',
    bottom: 40,
    alignSelf: 'center',
    backgroundColor: '#FF7A00',
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 28,
  },
  ctaText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  fallback: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  fallbackText: { color: '#fff', fontSize: 16 },
});
