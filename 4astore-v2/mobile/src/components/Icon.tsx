import React from 'react';
import { Text, TextStyle } from 'react-native';

/**
 * One consistent icon surface for the whole app.
 *
 * The app uses emoji as functional icons (cart, back, call, eye, filters…). Rendered ad-hoc
 * with different inline font sizes they looked uneven across screens. This component gives every
 * functional icon ONE named key + ONE size scale so they line up and match everywhere. It stays
 * dependency-free (no @expo/vector-icons / extra font to bundle), so it never affects the native
 * build — swap the glyph table for a vector set later without touching call sites.
 *
 * Usage: <Icon name="cart" size="md" />   <Icon name="eye" />   <Icon name="back" size="lg" color="#fff" />
 */

export type IconName =
  | 'cart' | 'back' | 'search' | 'home' | 'orders' | 'profile' | 'categories'
  | 'eye' | 'eyeOff' | 'phone' | 'navigate' | 'location' | 'filter' | 'sort' | 'price'
  | 'plus' | 'minus' | 'close' | 'check' | 'star' | 'bell' | 'camera' | 'image'
  | 'whatsapp' | 'share' | 'copy' | 'speaker' | 'rider' | 'store' | 'brand'
  | 'phonepe' | 'gpay' | 'upi' | 'track' | 'edit' | 'delete' | 'success' | 'info' | 'warn' | 'reset';

const GLYPH: Record<IconName, string> = {
  cart: '🛒', back: '←', search: '🔍', home: '🏠', orders: '📋', profile: '👤', categories: '📂',
  eye: '👁️', eyeOff: '🙈', phone: '📞', navigate: '🧭', location: '📍', filter: '⚙️', sort: '↕️', price: '💰',
  plus: '＋', minus: '−', close: '✕', check: '✓', star: '⭐', bell: '🔔', camera: '📷', image: '🖼️',
  whatsapp: '💬', share: '🔗', copy: '📋', speaker: '🔊', rider: '🛵', store: '🏪', brand: '🏷️',
  phonepe: '🟣', gpay: '🟢', upi: '📲', track: '📦', edit: '✏️', delete: '🗑️', success: '✅', info: 'ℹ️', warn: '⚠️', reset: '↺',
};

const SIZE: Record<'xs' | 'sm' | 'md' | 'lg' | 'xl', number> = { xs: 12, sm: 15, md: 18, lg: 22, xl: 28 };

export default function Icon({
  name,
  size = 'md',
  color,
  style,
}: {
  name: IconName;
  size?: keyof typeof SIZE | number;
  color?: string;
  style?: TextStyle;
}) {
  const fontSize = typeof size === 'number' ? size : SIZE[size];
  return (
    <Text
      allowFontScaling={false}
      style={[{ fontSize, lineHeight: fontSize + 2, textAlign: 'center' }, color ? { color } : null, style]}
      accessibilityElementsHidden
      importantForAccessibility="no"
    >
      {GLYPH[name]}
    </Text>
  );
}
