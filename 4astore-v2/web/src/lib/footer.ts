import { api } from './api';

/** Common site footer, edited in Admin → Settings → Footer (config.footer in MySQL). */
export interface FooterConfig {
  aboutTitle: string;
  aboutText: string;
  addressTitle: string;
  addressText: string; // one line per address row
  phone: string;
  linksTitle: string;
  links: { label: string; url: string }[];
  legalTitle: string; // links themselves come from Admin → Pages
  deliveryTitle: string;
  deliveryLines: string[]; // "{{upiId}}" is replaced with the admin UPI ID
  copyright: string;
}

// The original index.html footer — used until the admin saves one.
export const DEFAULT_FOOTER: FooterConfig = {
  aboutTitle: 'About 4astore',
  aboutText: '4astore is your local online grocery and daily essentials store serving Chandargarh and nearby areas. We bring quality products at best prices to your doorstep.',
  addressTitle: 'Store Address',
  addressText: '4astore\nGajana Road, Chandargarh\nNabinagar, Aurangabad\nBihar – 824301, India',
  phone: '8210874123',
  linksTitle: 'Quick Links',
  links: [
    { label: 'Home', url: '/' },
    { label: 'Products', url: '/products' },
    { label: 'My Cart', url: '/cart' },
    { label: 'My Orders', url: '/orders' },
    { label: 'Track Order', url: '/track' },
  ],
  legalTitle: 'Legal & Support',
  deliveryTitle: 'Delivery & Payment',
  deliveryLines: ['📍 Delivering in PIN 824301 only', '💳 UPI: {{upiId}}', 'More locations coming soon 🚀'],
  copyright: '© {{year}} 4astore. All Rights Reserved.',
};

/** Saved footer merged over the defaults (so a partially saved footer never breaks the page). */
export const resolveFooter = (f: Partial<FooterConfig> | null | undefined): FooterConfig => ({ ...DEFAULT_FOOTER, ...(f || {}) });

export async function saveFooter(footer: FooterConfig) {
  return (await api.post('/admin/footer', { footer })).data;
}
export async function resetFooter() {
  return (await api.post('/admin/footer', { reset: true })).data;
}
