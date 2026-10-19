import nodemailer from 'nodemailer';
import { config } from '../config';

let transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter | null {
  if (!config.mail.host || !config.mail.user) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.mail.host,
      port: config.mail.port,
      secure: config.mail.port === 465,
      auth: { user: config.mail.user, pass: config.mail.pass },
    });
  }
  return transporter;
}

/** The message payload handed to the underlying transport. */
export type MailMessage = {
  from: string;
  to: string;
  subject: string;
  text: string;
  html?: string;
};

/**
 * Delivery outcome. `ok` is true ONLY when the transport actually accepted the
 * message. `reason` is for server-side logs only — never surface it to clients.
 */
export type MailResult = { ok: boolean; reason?: string };

/**
 * Pure, injectable delivery helper. Awaits `send(msg)` and reports the outcome
 * as a MailResult. NEVER throws: a transport error is caught, logged
 * server-side, and reported as `{ ok: false, reason }`. Exported so tests can
 * drive it with a fake transport (no real SMTP socket).
 */
export async function deliverWith(
  send: (msg: MailMessage) => Promise<unknown>,
  msg: MailMessage
): Promise<MailResult> {
  try {
    await send(msg);
    return { ok: true };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[mail] send failed', err);
    return { ok: false, reason: String(err) };
  }
}

/**
 * Send an email and REPORT whether it was delivered. Returns `{ ok: true }`
 * only when the configured transport accepts the message. Returns
 * `{ ok: false }` when mail is not configured (no host/user) or when the
 * transport throws. NEVER throws to the caller.
 */
export async function sendMail(
  to: string,
  subject: string,
  text: string,
  html?: string
): Promise<MailResult> {
  const t = getTransporter();
  if (!t) {
    // Mail not configured (dev) — log instead of throwing, and report NOT delivered.
    // eslint-disable-next-line no-console
    console.log(`[mail:dev] to=${to} subject="${subject}" text="${text}"`);
    return { ok: false, reason: 'not-configured' };
  }
  return deliverWith((m) => t.sendMail(m), { from: config.mail.from, to, subject, text, html });
}
