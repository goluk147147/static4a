import { Link } from 'react-router-dom';
import { useConfig, useSettings } from '../lib/queries';
import { usePages } from '../lib/pages';
import { resolveFooter, FooterConfig } from '../lib/footer';

/** Internal paths stay in the SPA; tel:/mailto:/https open normally. */
function FooterLink({ url, children }: { url: string; children: React.ReactNode }) {
  if (url.startsWith('/') && !url.startsWith('//')) return <Link to={url}>{children}</Link>;
  const external = /^https?:/i.test(url);
  return <a href={url} {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>{children}</a>;
}

/** "{{upiId}}" → bold UPI ID from admin Settings (original [data-upi-id]). */
function DeliveryLine({ text, upiId }: { text: string; upiId: string }) {
  const parts = text.split('{{upiId}}');
  return <>{parts.map((p, i) => <span key={i}>{p}{i < parts.length - 1 && <strong>{upiId}</strong>}</span>)}</>;
}

/**
 * The one common footer shown on every storefront page (rendered by Layout).
 * Content: Admin → Settings → Footer (config.footer). Legal links: Admin → Pages.
 */
export function FooterView({ footer, legal, upiId }: { footer: FooterConfig; legal: { slug: string; title: string }[]; upiId: string }) {
  const f = footer;
  const lines = f.deliveryLines.filter(Boolean);
  const phone = f.phone.replace(/[^0-9+]/g, '');
  return (
    <footer className="site-footer">
      <div className="footer-grid">
        <div className="footer-col">
          <h4>{f.aboutTitle}</h4>
          <p>{f.aboutText}</p>
        </div>
        <div className="footer-col">
          <h4>{f.addressTitle}</h4>
          <p style={{ whiteSpace: 'pre-line' }}>{f.addressText}</p>
          {phone && <p className="store-phone"><a href={`tel:${phone}`}>📞 {f.phone}</a></p>}
        </div>
        <div className="footer-col">
          <h4>{f.linksTitle}</h4>
          {f.links.map((l, i) => <FooterLink key={`${l.url}-${i}`} url={l.url}>{l.label}</FooterLink>)}
        </div>
        <div className="footer-col">
          <h4>{f.legalTitle}</h4>
          {legal.map((p) => <Link key={p.slug} to={`/page/${p.slug}`}>{p.title}</Link>)}
        </div>
        <div className="footer-col">
          <h4>{f.deliveryTitle}</h4>
          {lines.map((line, i) => {
            // Original styling: small grey last line ("More locations coming soon 🚀").
            const muted = lines.length >= 3 && i === lines.length - 1;
            return (
              <p key={i} style={i === 0 ? undefined : muted ? { marginTop: 8, fontSize: 12, color: '#aaa' } : { marginTop: 4 }}>
                <DeliveryLine text={line} upiId={upiId} />
              </p>
            );
          })}
        </div>
      </div>
      <div className="footer-bottom">{f.copyright.replace(/\{\{year\}\}/g, String(new Date().getFullYear()))}</div>
    </footer>
  );
}

export default function SiteFooter() {
  const config = useConfig().data;
  const upiId = useSettings().data?.upiId || 'Q623952089@ybl';
  const legal = (usePages().data ?? []).filter((p) => p.showInFooter);
  return <FooterView footer={resolveFooter(config?.footer)} legal={legal} upiId={upiId} />;
}
