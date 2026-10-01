import { api } from './api';

// Admin → Ads & Social → Video Ads (api-node/src/routes/videos.ts)
export type Template = 'festival' | 'daily' | 'general';
export type VideoFormat = 'reel' | 'square';
export type MusicStyle = 'festive' | 'calm' | 'upbeat';
export interface Colors { primary: string; secondary: string; accent: string }

export interface VideoRequest {
  template: Template;
  festivalId?: string;
  title?: string;
  festivalName?: string;
  greeting?: string;
  subText?: string;
  offerText?: string;
  couponCode?: string;
  productIds?: number[];
  colors?: Colors;
  emojis?: string[];
  durationSec?: 15 | 24 | 30;
  format?: VideoFormat | 'both';
  musicStyle?: MusicStyle;
}

export interface VideoJob {
  id: number;
  status: 'queued' | 'rendering' | 'done' | 'failed';
  progress: number;
  source: 'manual' | 'auto';
  title: string;
  template: Template;
  format: VideoFormat;
  durationSec: number;
  festivalName: string;
  offerText: string;
  couponCode: string;
  musicStyle: string;
  sizeBytes: number | null;
  caption: string;
  error: string;
  createdBy: string;
  createdAt: string;
  finishedAt: string | null;
  hasFile: boolean;
}

export interface Festival {
  id: string;
  name: string;
  date: string | null;
  dateVerified: boolean;
  greeting: string;
  subText: string;
  emojis: string[];
  colors: Colors | null;
  musicStyle: MusicStyle;
  defaultOffer: string;
  active: boolean;
  daysAway?: number;
}

export interface VideoSettings {
  store: {
    name: string; tagline: string; phone: string; whatsapp: string; address: string; area: string;
    deliveryCharge: number; freeAbove: number; payment: string;
    theme: { primary: string; dark: string; light: string; accent: string; ink: string };
  };
  auto: { enabled: boolean; time: string; leadDays: number; formats: VideoFormat[]; durationSec: 15 | 24 | 30; keepLast: number; notify: boolean };
}
export interface MetaStatus { enabled: boolean; configured: boolean; missing: string[]; note: string }

const base = '/admin/videos';
export const videoFileUrl = (id: number, download = false) => `/api${base}/${id}/file${download ? '?download=1' : ''}`;
export const videoThumbUrl = (id: number, v = '') => `/api${base}/${id}/thumb${v ? `?v=${encodeURIComponent(v)}` : ''}`;

export const fetchVideos = async () => (await api.get(base)).data.videos as VideoJob[];
export const fetchHealth = async () => (await api.get(`${base}/health`)).data as { ready: boolean; problems: string[]; meta: MetaStatus };
export const fetchToday = async () =>
  (await api.get(`${base}/today`)).data as { today: string; upcoming: Festival[]; needsVerification: number; auto: VideoSettings['auto'] };
export const generateVideo = async (req: VideoRequest) => (await api.post(`${base}/generate`, req)).data as { message: string; videos: VideoJob[] };
export const previewVideo = async (req: VideoRequest) =>
  (await api.post(`${base}/preview`, req, { timeout: 120000 })).data as { format: VideoFormat; frames: { t: number; src: string }[]; caption: string; title: string };
export const saveCaption = async (id: number, caption: string) => (await api.patch(`${base}/${id}/caption`, { caption })).data;
export const deleteVideo = async (id: number) => (await api.delete(`${base}/${id}`)).data;

export const fetchFestivals = async () => (await api.get(`${base}/festivals`)).data.festivals as Festival[];
export const saveFestival = async (action: 'add' | 'update', festival: Festival) => (await api.post(`${base}/festivals`, { action, festival })).data;
export const deleteFestival = async (id: string) => (await api.post(`${base}/festivals`, { action: 'delete', id })).data;

export const fetchVideoSettings = async () => (await api.get(`${base}/settings`)).data as { settings: VideoSettings; meta: MetaStatus };
export const saveVideoSettings = async (settings: VideoSettings) => (await api.post(`${base}/settings`, { settings })).data as { message: string; removed: number };
export const runAutoNow = async () => (await api.post(`${base}/auto/run-now`, {})).data as { message: string; kind?: string; festival?: string; videos?: VideoJob[]; jobs: VideoJob[] };

export const fmtSize = (b: number | null) => (b == null ? '—' : b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`);

/** Copy to clipboard with a fallback for http:// (no Clipboard API). */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}
