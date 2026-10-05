import { useMemo } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { usePage, usePages, sanitizePageHtml } from '../lib/pages';
import { useConfig } from '../lib/queries';
import { isFeatureOn } from '../lib/features';
import { buildCanonical, breadcrumbJsonLd, localBusinessJsonLd } from '../lib/seo';
import './legal.css';

/** Dynamic CMS page (/page/:slug) — content comes from Admin → Pages (MySQL `pages`). */
export default function Page({ slug: fixedSlug }: { slug?: string }) {
  const params = useParams();
  const slug = fixedSlug || params.slug;
  const navigate = useNavigate();
  const { data: page, isLoading, isError } = usePage(slug);
  const config = useConfig().data;
  const others = (usePages().data ?? []).filter((p) => p.showInFooter && p.slug !== slug);
  const html = useMemo(() => sanitizePageHtml(page?.content || ''), [page?.content]);

  // Internal links inside the content (/products, /page/terms ...) stay in the SPA.
  function onContentClick(e: React.MouseEvent<HTMLDivElement>) {
    const a = (e.target as HTMLElement).closest('a');
    const href = a?.getAttribute('href') || '';
    if (!a || a.target === '_blank' || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (href.startsWith('/') && !href.startsWith('//') && !href.startsWith('/api/')) {
      e.preventDefault();
      navigate(href);
    }
  }

  if (isLoading) {
    return (
      <div className="legal-wrap" aria-busy="true">
        <div className="legal-card">
          <div className="skeleton-text shimmer" style={{ height: 28, width: '60%', borderRadius: 6, marginBottom: 16 }} />
          {[95, 88, 92, 70, 85].map((w) => <div key={w} className="skeleton-text shimmer" style={{ height: 14, width: `${w}%`, borderRadius: 4, marginBottom: 10 }} />)}
        </div>
      </div>
    );
  }

  if (isError || !page) {
    return (
      <div className="legal-wrap">
        <Helmet><title>Page not found | 4A Store</title><meta name="robots" content="noindex" /></Helmet>
        <Link to="/" className="legal-back">← Back to Home</Link>
        <div className="legal-card"><h1>Page not found</h1><p>Ye page maujood nahi hai ya abhi published nahi hai.</p></div>
      </div>
    );
  }

  const canonical = buildCanonical(`/page/${page.slug}`);
  const seoOn = isFeatureOn(config?.features, 'seoModule');
  const pageJsonLd = [
    breadcrumbJsonLd([
      { name: 'Home', url: buildCanonical('/') },
      { name: page.title, url: canonical },
    ]),
    localBusinessJsonLd(config?.seo),
  ];

  return (
    <div className="legal-wrap">
      <Helmet>
        <title>{`${page.title} - 4A Store`}</title>
        {page.metaDescription && <meta name="description" content={page.metaDescription} />}
        {page.metaKeywords && <meta name="keywords" content={page.metaKeywords} />}
        <meta property="og:title" content={`${page.title} - 4A Store`} />
        {page.metaDescription && <meta property="og:description" content={page.metaDescription} />}
        <link rel="canonical" href={canonical} />
        {seoOn && pageJsonLd.map((entry, i) => (
          <script key={i} type="application/ld+json">{JSON.stringify(entry)}</script>
        ))}
      </Helmet>
      <Link to="/" className="legal-back">← Back to Home</Link>
      {/* Sanitised with DOMPurify (lib/pages.ts) before rendering. */}
      <div className="legal-body" onClick={onContentClick} dangerouslySetInnerHTML={{ __html: html }} />
      {others.length > 0 && (
        <div className="legal-next">
          {others.map((p) => <Link key={p.slug} to={`/page/${p.slug}`} className="legal-back">{p.title} →</Link>)}
        </div>
      )}
    </div>
  );
}
