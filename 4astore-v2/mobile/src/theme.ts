// Same visual system as the web storefront (web/public/legacy/css/style.css "4A Store visual system").
export const colors = {
  primary: '#ff7a00',
  primaryDark: '#c62828',
  primaryLight: '#fff0d8',
  secondary: '#ffd166',
  secondaryLight: '#fff7d6',
  accent: '#E53935',
  dark: '#291b16',
  gray: '#76645c',
  lightGray: '#fffaf3',
  border: '#f1d8ba',
  white: '#ffffff',
  glass: 'rgba(255,255,255,0.92)',
  green: '#087a3d',
  whatsapp: '#25D366',
  track: '#0891b2',
  admin: '#2C6FAD',
};

/** Animated warm gradient used by .btn-primary / search button / top bar on the web. */
export const warmGradient = ['#ef233c', '#ff7a00', '#ffd166', '#ff7a00', '#ef233c'] as const;
export const topBarGradient = ['#ef233c', '#ff7a00', '#ffd166'] as const;
export const offerGradient = ['#ff6a00', '#f107a3'] as const;

export const radius = { sm: 8, md: 12, lg: 18, pill: 30 };

export const shadow = {
  shadowColor: '#743610',
  shadowOpacity: 0.09,
  shadowRadius: 12,
  shadowOffset: { width: 0, height: 6 },
  elevation: 3,
};

// Order status chip colours (web .status-* classes / admin STATUS_COLOR).
export const STATUS_STYLE: Record<string, { bg: string; fg: string }> = {
  'Order Placed': { bg: colors.secondaryLight, fg: '#b96500' },
  Confirmed: { bg: colors.primaryLight, fg: colors.primaryDark },
  Processing: { bg: colors.primaryLight, fg: colors.primaryDark },
  Packed: { bg: '#ede9fe', fg: '#6d28d9' },
  'Rider Assigned': { bg: '#e0f2fe', fg: '#0369a1' },
  'Out for Delivery': { bg: '#e8f5e9', fg: '#2e7d32' },
  Delivered: { bg: '#e8f5e9', fg: '#1b5e20' },
  Cancelled: { bg: '#fdecea', fg: '#dc2626' },
};
export const statusStyle = (s: string) => STATUS_STYLE[s] || STATUS_STYLE['Order Placed'];
