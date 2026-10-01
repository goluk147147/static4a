// Shared types for the promo video generator (Admin → Ads & Social → Video Ads).

export type Template = 'festival' | 'daily' | 'general';
export type VideoFormat = 'reel' | 'square';
export type MusicStyle = 'festive' | 'calm' | 'upbeat';
/** Video + caption language. hinglish = Roman-script Hindi (original copy). */
export type Lang = 'hinglish' | 'hindi' | 'english';
export const LANGS: Lang[] = ['hinglish', 'hindi', 'english'];
export const DURATIONS = [15, 24, 30] as const;
export type Duration = (typeof DURATIONS)[number];

export interface Colors {
  primary: string;
  secondary: string;
  accent: string;
}

/** Store details shown in the video (editable in admin video settings). */
export interface StoreProfile {
  name: string;
  tagline: string;
  phone: string; // display, e.g. "82108 74123"
  whatsapp: string; // display
  address: string;
  area: string; // short, e.g. "Nabinagar, Aurangabad (Bihar)"
  deliveryCharge: number;
  freeAbove: number;
  payment: string; // e.g. "UPI (GPay/PhonePe/Paytm)"
  theme: { primary: string; dark: string; light: string; accent: string; ink: string };
}

export interface VideoProduct {
  id: number;
  name: string;
  weight: string;
  price: number;
  mrp: number;
  image: string; // http(s) URL or /api/uploads/... path; '' = none
  emoji: string; // category emoji fallback
}

/** Fully validated input for one render (one format). */
export interface RenderOptions {
  template: Template;
  title: string; // library title
  festivalName: string;
  greeting: string;
  subText: string;
  offerText: string;
  couponCode: string;
  featuredProducts: VideoProduct[];
  colors: Colors;
  emojis: string[];
  durationSec: Duration;
  format: VideoFormat;
  musicStyle: MusicStyle;
  lang: Lang;
  store: StoreProfile; // already localised for `lang`
}

export type ProgressFn = (percent: number) => void;
