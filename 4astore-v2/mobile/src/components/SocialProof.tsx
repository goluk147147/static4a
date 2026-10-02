import React, { useEffect, useState } from 'react';
import { Animated, Text } from 'react-native';
import { useConfig } from '../queries';
import { colors, shadow } from '../theme';

/** Live social-proof toast on the home screen ("Rahul from Chandargarh just ordered…"). */
export default function SocialProof() {
  const cfg = useConfig().data;
  const [msg, setMsg] = useState('');
  const [opacity] = useState(() => new Animated.Value(0));

  useEffect(() => {
    const messages = cfg?.socialProofMessages ?? [];
    const names = cfg?.socialProofNames ?? [];
    if (!messages.length) return;
    let hide: ReturnType<typeof setTimeout>;
    const show = () => {
      const m = messages[Math.floor(Math.random() * messages.length)];
      const n = names.length ? names[Math.floor(Math.random() * names.length)] : 'Someone';
      // Fake-but-believable order value for the {amount} placeholder (₹120–₹960, rounded to ₹10).
      const amount = (Math.floor(Math.random() * 85) + 12) * 10;
      setMsg(
        m
          .replace(/\{\{\s*name\s*\}\}|\{name\}/gi, n)
          .replace(/\{\{\s*amount\s*\}\}|\{amount\}/gi, String(amount))
      );
      Animated.timing(opacity, { toValue: 1, duration: 300, useNativeDriver: true }).start();
      hide = setTimeout(() => Animated.timing(opacity, { toValue: 0, duration: 300, useNativeDriver: true }).start(), 4500);
    };
    const first = setTimeout(show, 8000);
    const iv = setInterval(show, 25000);
    return () => {
      clearTimeout(first);
      clearTimeout(hide);
      clearInterval(iv);
    };
  }, [cfg, opacity]);

  if (!msg) return null;
  return (
    <Animated.View
      pointerEvents="none"
      style={{ position: 'absolute', left: 12, bottom: 12, right: 60, opacity, backgroundColor: '#fff', borderRadius: 12, padding: 12, borderLeftWidth: 4, borderLeftColor: colors.primary, ...shadow, elevation: 6 }}
    >
      <Text style={{ fontSize: 13, color: colors.dark }}>🛍️ {msg}</Text>
    </Animated.View>
  );
}
