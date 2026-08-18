// ============================================
// 4astore App Configuration
// Change BASE_URL to your CDN when deploying
// ============================================

// For local development (run website server on port 8000)
// export const BASE_URL = 'http://10.0.2.2:8000'; // Android emulator
// export const BASE_URL = 'http://localhost:8000'; // iOS simulator

// For CDN/Production - replace with your hosted JSON URLs
export const BASE_URL = 'http://10.91.3.249:8000'; // Your local network IP

export const API = {
  products: `${BASE_URL}/data/products.json`,
  categories: `${BASE_URL}/data/categories.json`,
  config: `${BASE_URL}/data/config.json`,
};

export const STORE_CONFIG = {
  name: '4astore',
  mobile: '8210874123',
  address: 'Gajana Road, Chandargarh, Nabinagar, Aurangabad, Bihar – 824301',
  pincode: '824301',
  deliveryCharge: 30,
  freeDeliveryAbove: 500,
  whatsappNumber: '918210874123',
  upiId: 'goluk147147@ybl',
  upiName: '4astore',
  adminPassword: '4astore@admin',
};

export const COLORS = {
  primary: '#ff6600',
  primaryDark: '#e55b00',
  primaryLight: '#fff3e0',
  secondary: '#ff9800',
  accent: '#d32f2f',
  dark: '#1a1a2e',
  gray: '#6c757d',
  lightGray: '#fffaf5',
  border: '#ffe0b2',
  white: '#ffffff',
  bg: '#fffaf5',
};
