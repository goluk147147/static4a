/* ------------------------------------------------------------------ *
 * WhatsApp Cloud API (Meta) — LIVE, SERVER-SIDE sender.
 * ------------------------------------------------------------------ *
 * Sends marketing/promotional TEMPLATE messages (image header + dynamic
 * text body) to customers who may NOT have saved the store number.
 *
 * The access token is SECRET: it lives only inside the admin-only
 * `settings.whatsapp_api` JSON blob and is read FRESH from the DB per
 * send batch (no module-global cache). It is NEVER exposed on any public
 * endpoint and never shipped to the browser.
 *
 * Pure helpers (sanitizeMsisdn / buildImageTextComponents) live in the
 * DB-free `whatsappFormat.ts` so unit tests can import them without a DB;
 * this module re-exports them for convenience.
 * ------------------------------------------------------------------ */
import { prisma } from '../db';
import { sanitizeMsisdn, buildImageTextComponents } from './whatsappFormat';

export { sanitizeMsisdn, buildImageTextComponents };

/** Default Meta Graph base. Used only when the stored baseUrl is empty. */
const DEFAULT_BASE_URL = 'https://graph.facebook.com/v20.0';

interface WhatsappApiConfig {
  provider: string;
  baseUrl: string;
  token: string;
  phoneNumberId: string;
  wabaId: string;
  enabled: boolean;
}

export type SendResult = {
  ok: boolean;
  messageId?: string;
  error?: string;
  code?: string | number;
};

/**
 * Read the live WhatsApp config FRESH from `settings.whatsapp_api`.
 * Tolerant parse mirroring admin.ts GET /settings; falls back to OFF
 * defaults on null/garbage so a missing/corrupt blob never throws.
 */
async function readWhatsappApiConfig(): Promise<WhatsappApiConfig> {
  const off: WhatsappApiConfig = {
    provider: 'none',
    baseUrl: '',
    token: '',
    phoneNumberId: '',
    wabaId: '',
    enabled: false,
  };
  try {
    const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
      'SELECT whatsapp_api FROM settings WHERE id = 1'
    );
    const raw = rows?.[0]?.whatsapp_api;
    if (typeof raw !== 'string' || raw.trim().length === 0) return off;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      provider: ['none', 'cloud_api', 'custom'].includes(String(parsed.provider))
        ? String(parsed.provider)
        : 'none',
      baseUrl: typeof parsed.baseUrl === 'string' ? parsed.baseUrl : '',
      token: typeof parsed.token === 'string' ? parsed.token : '',
      phoneNumberId: typeof parsed.phoneNumberId === 'string' ? parsed.phoneNumberId : '',
      wabaId: typeof parsed.wabaId === 'string' ? parsed.wabaId : '',
      enabled: !!parsed.enabled,
    };
  } catch {
    return off;
  }
}

/**
 * Send ONE template message via the Meta Cloud API. Reads live config per
 * call, sanitizes the recipient, POSTs to
 * `${baseUrl}/${phoneNumberId}/messages` with a Bearer token.
 *
 * NEVER throws — always resolves a SendResult. A network error, a "not
 * configured" state, an invalid number, or a Meta error are all surfaced
 * via `{ ok:false, error, code? }`.
 */
export async function sendWhatsAppTemplateMessage(opts: {
  recipientPhone: string;
  templateName: string;
  languageCode: string;
  components: unknown[];
}): Promise<SendResult> {
  const cfg = await readWhatsappApiConfig();

  // (a) Must be the Meta Cloud API, turned ON, with credentials present.
  if (cfg.provider !== 'cloud_api' || !cfg.enabled || !cfg.token || !cfg.phoneNumberId) {
    return { ok: false, error: 'WhatsApp Cloud API not configured' };
  }

  // (b) Validate + normalise the destination number.
  const to = sanitizeMsisdn(opts.recipientPhone);
  if (!to) return { ok: false, error: 'Invalid mobile number' };

  // (c) POST the template payload.
  const base = cfg.baseUrl.trim() || DEFAULT_BASE_URL;
  const url = `${base}/${cfg.phoneNumberId}/messages`;
  const body = {
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name: opts.templateName,
      language: { code: opts.languageCode },
      components: opts.components,
    },
  };

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    let json: Record<string, unknown> = {};
    try {
      json = (await resp.json()) as Record<string, unknown>;
    } catch {
      /* non-JSON body — handled by the !resp.ok branch below */
    }

    // (d) Interpret Meta's response.
    const messages = json.messages as Array<{ id?: string }> | undefined;
    if (resp.ok && Array.isArray(messages) && messages[0]?.id) {
      return { ok: true, messageId: messages[0].id };
    }

    const err = (json.error || {}) as { message?: string; code?: string | number };
    const message = err.message || `WhatsApp send failed (HTTP ${resp.status})`;
    // Common Meta error codes for the operator's reference:
    //   #132001 template name/language mismatch, #190 invalid/expired token,
    //   #80007 / #131048 rate limit / spam throttle.
    console.error('[whatsapp] send failed', { to, code: err.code, message });
    return { ok: false, error: message, code: err.code };
  } catch (e) {
    const message = e instanceof Error ? e.message : 'WhatsApp network error';
    console.error('[whatsapp] network error', { to, message });
    return { ok: false, error: message };
  }
}
