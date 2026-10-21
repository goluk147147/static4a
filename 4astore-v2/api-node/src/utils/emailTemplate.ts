/* ------------------------------------------------------------------ *
 * Branded email template helper (pure, no DB / no network).
 * ------------------------------------------------------------------ *
 * Every outgoing 4A Store email was plain text with no logo. This module
 * builds a small, EMAIL-CLIENT-SAFE HTML body (table layout + inline CSS only,
 * no <style> reliance, no flexbox/grid, no remote fonts, no tracking pixels)
 * that shows the 4A Store logo and the OTP, while ALWAYS returning the existing
 * plain-text body as a fallback so sendMail(to, subject, text, html) keeps a
 * text part for non-HTML clients and deliverability.
 *
 * The logo MUST be a PNG — Gmail/Outlook block inline SVG in email — so the
 * default points at the .png (overridable via EMAIL_LOGO_URL). The brand color
 * is the 4A Store primary orange (#ff7a00, from web/legacy css --primary).
 * ------------------------------------------------------------------ */

/**
 * The 4A Store logo URL used at the top of every branded email. PNG (NOT .svg)
 * because Gmail/Outlook block SVG in email. Overridable via EMAIL_LOGO_URL so
 * it is a one-env change if the asset path ever moves.
 */
export const EMAIL_LOGO_URL =
  (process.env.EMAIL_LOGO_URL || '').trim() || 'https://4astore.com/legacy/images/logo.png';

/** 4A Store primary brand color (web/legacy css `--primary: #ff7a00`). */
export const BRAND_COLOR = '#ff7a00';

/** Store name shown in the footer / alt text. */
const STORE_NAME = '4A Store';

/**
 * Minimal HTML-escape for the few dynamic values we interpolate (heading, note,
 * otp). Keeps the template safe even though today's callers only pass numeric
 * OTPs and static copy.
 */
function esc(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface BrandedEmailInput {
  /** Short heading shown under the logo (e.g. "Verify your email"). */
  heading: string;
  /** HTML for the message body (already escaped/trusted by the caller). */
  bodyHtml: string;
  /** Plain-text equivalent of the body, returned as the text fallback. */
  bodyText: string;
}

/**
 * Generic branded wrapper: a logo header bar in the brand color, a heading, the
 * caller's body, and a small plain footer. Returns BOTH the HTML and the
 * plain-text fallback so the caller can pass them straight to sendMail.
 */
export function renderBrandedEmail(input: BrandedEmailInput): { text: string; html: string } {
  const heading = esc(input.heading);
  const html =
    `<!DOCTYPE html>` +
    `<html lang="en"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1"></head>` +
    `<body style="margin:0;padding:0;background:#f4f4f5;">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f4f5;">` +
    `<tr><td align="center" style="padding:24px 12px;">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #eeeeee;">` +
    // Brand header bar with the logo.
    `<tr><td align="center" style="background:${BRAND_COLOR};padding:20px 24px;">` +
    `<img src="${EMAIL_LOGO_URL}" alt="${STORE_NAME}" width="120" style="display:block;border:0;outline:none;text-decoration:none;height:auto;max-width:120px;">` +
    `</td></tr>` +
    // Body.
    `<tr><td style="padding:28px 24px 24px 24px;font-family:Arial,Helvetica,sans-serif;color:#222222;">` +
    `<h1 style="margin:0 0 16px 0;font-size:20px;line-height:1.3;color:#222222;">${heading}</h1>` +
    input.bodyHtml +
    `</td></tr>` +
    // Footer.
    `<tr><td style="padding:16px 24px 24px 24px;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#999999;border-top:1px solid #eeeeee;">` +
    `${STORE_NAME}` +
    `</td></tr>` +
    `</table></td></tr></table></body></html>`;

  return { text: input.bodyText, html };
}

export interface OtpEmailInput {
  /** Heading shown under the logo (e.g. "Verify your email"). */
  title: string;
  /** The 6-digit OTP to display large and bold. */
  otp: string;
  /**
   * The full plain-text body to use as the text fallback. Kept identical to the
   * message we have always sent so deliverability + meaning are unchanged.
   */
  note: string;
}

/**
 * Build the branded OTP email: the OTP shown large, bold and letter-spaced, an
 * expiry/explanatory note, plus the plain-text fallback (the caller's `note`).
 */
export function renderOtpEmail(input: OtpEmailInput): { text: string; html: string } {
  const otp = esc(input.otp);
  const note = esc(input.note);
  const bodyHtml =
    `<div style="margin:0 0 20px 0;text-align:center;">` +
    `<span style="display:inline-block;font-family:'Courier New',Courier,monospace;font-size:32px;font-weight:bold;letter-spacing:8px;color:${BRAND_COLOR};">${otp}</span>` +
    `</div>` +
    `<p style="margin:0;font-size:14px;line-height:1.5;color:#555555;">${note}</p>`;

  return renderBrandedEmail({ heading: input.title, bodyHtml, bodyText: input.note });
}
