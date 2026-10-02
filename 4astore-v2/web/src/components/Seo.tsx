import { Helmet } from 'react-helmet-async';
import type { SeoConfig } from '../types';
import { applyTitleTemplate, type JsonLd } from '../lib/seo';
import { isFeatureOn } from '../lib/features';

export interface SeoProps {
  /** Raw page/product title; cfg.titleTemplate ('%s | 4A Store') is applied. */
  title: string;
  description: string;
  keywords?: string;
  canonical?: string;
  robots?: string;
  image?: string;
  /** Extra schema.org JSON-LD — gated behind the seoModule flag. */
  jsonLd?: JsonLd[];
  cfg?: SeoConfig;
  features?: Record<string, boolean>;
}

/**
 * Shared SEO head. ALWAYS emits title (via titleTemplate) + description + canonical so
 * basic SEO works even when seoModule is OFF; the richer JSON-LD + OG/Twitter cards are
 * gated behind isFeatureOn(features, 'seoModule').
 */
export default function Seo({ title, description, keywords, canonical, robots, image, jsonLd, cfg, features }: SeoProps) {
  const fullTitle = applyTitleTemplate(title, cfg);
  const seoOn = isFeatureOn(features, 'seoModule');
  const ogImage = image || cfg?.defaultOgImage;

  return (
    <Helmet>
      <title>{fullTitle}</title>
      {description && <meta name="description" content={description} />}
      {keywords && <meta name="keywords" content={keywords} />}
      {canonical && <link rel="canonical" href={canonical} />}
      <meta name="robots" content={robots || 'index,follow'} />

      {/* Open Graph / Twitter cards */}
      <meta property="og:title" content={fullTitle} />
      {description && <meta property="og:description" content={description} />}
      {canonical && <meta property="og:url" content={canonical} />}
      {ogImage && <meta property="og:image" content={ogImage} />}
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={fullTitle} />
      {description && <meta name="twitter:description" content={description} />}
      {ogImage && <meta name="twitter:image" content={ogImage} />}

      {/* Extra JSON-LD only when the SEO module is ON. */}
      {seoOn && (jsonLd || []).map((entry, i) => (
        <script key={i} type="application/ld+json">{JSON.stringify(entry)}</script>
      ))}
    </Helmet>
  );
}
