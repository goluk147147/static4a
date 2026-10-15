// -----------------------------------------------------------------------------
// waSender.ts — DORMANT provider-agnostic WhatsApp API sender (PREP ONLY).
//
// This module is intentionally inert: it makes NO network request today. The
// free wa.me flow in lib/whatsapp.ts remains the ONLY active send path. The
// single commented TODO fetch below documents the WhatsApp Cloud API request
// shape and is the only remaining work to turn this on later. Do NOT call
// sendViaApi() from any component yet.
// -----------------------------------------------------------------------------
import type { WhatsappApiConfig } from './admin';

export type WaMessage = { to: string; text: string };
export type WaSendResult = { ok: boolean; error?: string; detail?: unknown };

/**
 * Send a WhatsApp message through the configured API provider.
 *
 * DORMANT: returns a clear "not configured / not implemented" result and never
 * performs a real network request. Enabling this is a deliberate future step.
 */
export async function sendViaApi(msg: WaMessage, cfg: WhatsappApiConfig): Promise<WaSendResult> {
  if (!cfg || cfg.provider === 'none' || !cfg.enabled) {
    return { ok: false, error: 'WhatsApp API not configured yet' };
  }

  // `msg` is intentionally unused until the TODO fetch below is wired; it will
  // carry the recipient + text into the real request. Reference it so the
  // dormant signature stays honest without performing any work.
  void msg;

  // TODO (future, when API is live): perform the real WhatsApp Cloud API call.
  // return fetch(`${cfg.baseUrl}/${cfg.phoneNumberId}/messages`, {
  //   method: 'POST',
  //   headers: {
  //     Authorization: `Bearer ${cfg.token}`,
  //     'Content-Type': 'application/json',
  //   },
  //   body: JSON.stringify({
  //     messaging_product: 'whatsapp',
  //     to: msg.to,
  //     type: 'text',
  //     text: { body: msg.text },
  //   }),
  // }).then(async (r) => ({ ok: r.ok, detail: await r.json().catch(() => undefined) }));

  // Until the TODO above is wired, make NO request and report clearly.
  return { ok: false, error: 'WhatsApp API send not implemented yet' };
}
