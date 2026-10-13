/* ------------------------------------------------------------------ *
 * Auto-send / AI Marketing Text — HONEST "Coming soon" scaffold.
 * ------------------------------------------------------------------ *
 * - Automatic WhatsApp sending needs the PAID WhatsApp Business /
 *   Cloud API. The free wa.me click-to-share used elsewhere in this
 *   Marketing Center only OPENS a chat — it NEVER auto-sends.
 * - AI-generated marketing copy needs a paid AI text service.
 * Neither is implemented. Nothing here fakes auto-send or claims that
 * wa.me delivers messages on its own.
 * ------------------------------------------------------------------ */

export default function AutoSendComingSoon() {
  return (
    <div style={{ display: 'grid', gap: 16, maxWidth: 640 }}>
      <div style={banner}>
        <div style={{ fontSize: 34 }}>🤖</div>
        <strong style={{ fontSize: 16, color: '#8d5d00' }}>Coming soon — needs WhatsApp Business API / AI service</strong>
        <p style={{ margin: '8px 0 0', fontSize: 13, color: '#8d5d00', lineHeight: 1.5 }}>
          <strong>Auto-send</strong> aur <strong>AI-generated marketing text</strong> ke liye paid services chahiye jo abhi
          connected nahi hain. Jab tak ye add nahi hote, ye section sirf scaffold hai.
        </p>
      </div>

      <div style={card}>
        <strong style={cardTitle}>📤 Automatic WhatsApp send</strong>
        <p style={{ ...muted, margin: '6px 0 0', lineHeight: 1.5 }}>
          Messages apne aap bhejne ke liye official <strong>WhatsApp Business / Cloud API</strong> (paid, approved sender)
          chahiye. Is store me wahi <strong>free manual wa.me</strong> use hota hai — wo sirf chat <strong>kholta</strong> hai,
          Send aapko khud dabana padta hai. <strong>wa.me kabhi apne aap message nahi bhejta</strong> (link opened ≠ sent).
        </p>
      </div>

      <div style={card}>
        <strong style={cardTitle}>✨ AI marketing copy</strong>
        <p style={{ ...muted, margin: '6px 0 0', lineHeight: 1.5 }}>
          AI se apne aap promo text / captions banane ke liye ek paid AI text service chahiye. Abhi aap{' '}
          <strong>Templates</strong> aur <strong>Promo Message</strong> tabs me khud (ya tayaar templates se) message likh
          sakte hain — koi AI generation implement nahi hai.
        </p>
      </div>

      <p style={{ ...muted, fontSize: 11, textAlign: 'center' }}>
        Honest scaffold — koi feature fake nahi ki gayi. Paid API/AI add hone par hi ye enable honge.
      </p>
    </div>
  );
}

const banner: React.CSSProperties = { background: '#fff8e1', border: '1px solid #ffe082', borderRadius: 12, padding: 20, textAlign: 'center' };
const card: React.CSSProperties = { background: '#fff', border: '1px solid var(--border)', borderRadius: 12, padding: 16, boxShadow: 'var(--shadow)' };
const cardTitle: React.CSSProperties = { fontSize: 14, color: 'var(--primary-dark)', display: 'block' };
const muted: React.CSSProperties = { fontSize: 12, color: 'var(--gray)' };
