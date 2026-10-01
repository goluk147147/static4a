import React, { useState } from 'react';
import { Image, StyleProp, Text, View, ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { placeholderStyle, productImageUri } from '../productImage';

interface Props {
  name: string;
  weight?: string;
  category?: string;
  image?: string;
  size?: number | '100%';
  height?: number;
  style?: StyleProp<ViewStyle>;
  compact?: boolean;
}

/** Product photo with the web's generated emoji placeholder as fallback. */
export default function ProductImage({ name, weight, category, image, height = 120, style, compact }: Props) {
  const uri = productImageUri(image);
  const [failed, setFailed] = useState(false);

  if (uri && !failed) {
    return (
      <View style={[{ height, borderRadius: 10, overflow: 'hidden', backgroundColor: '#fff' }, style]}>
        <Image
          source={{ uri }}
          style={{ width: '100%', height: '100%' }}
          resizeMode="contain"
          onError={() => setFailed(true)}
          accessibilityLabel={name}
        />
      </View>
    );
  }

  const p = placeholderStyle(name, category);
  return (
    <LinearGradient colors={[p.bg, p.accent] as const} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[{ height, borderRadius: 12, alignItems: 'center', justifyContent: 'center', padding: 6 }, style]}>
      <View style={{ backgroundColor: 'rgba(255,255,255,0.6)', borderRadius: 999, width: height * 0.45, height: height * 0.45, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontSize: height * 0.24 }} accessibilityLabel={name}>{p.emoji}</Text>
      </View>
      {!compact && (
        <View style={{ backgroundColor: 'rgba(255,255,255,0.7)', borderRadius: 8, marginTop: 6, paddingHorizontal: 6, paddingVertical: 2, alignSelf: 'stretch' }}>
          <Text numberOfLines={1} style={{ fontSize: 11, fontWeight: '700', color: p.color, textAlign: 'center' }}>{name}</Text>
          {!!weight && <Text numberOfLines={1} style={{ fontSize: 10, color: '#666', textAlign: 'center' }}>{weight}</Text>}
        </View>
      )}
    </LinearGradient>
  );
}
