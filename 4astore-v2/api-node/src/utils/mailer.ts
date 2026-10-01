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

export async function sendMail(to: string, subject: string, text: string, html?: string) {
  const t = getTransporter();
  if (!t) {
    // Mail not configured (dev) — log instead of throwing.
    // eslint-disable-next-line no-console
    console.log(`[mail:dev] to=${to} subject="${subject}" text="${text}"`);
    return;
  }
  await t.sendMail({ from: config.mail.from, to, subject, text, html });
}
