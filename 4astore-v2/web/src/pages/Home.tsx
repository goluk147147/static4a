import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { useConfig, useCategories, useProducts, useSettings } from '../lib/queries';
import ProductCard from '../components/ProductCard';
import AnnouncementPopup from '../components/AnnouncementPopup';
import { SkeletonBanner, SkeletonAds, SkeletonCategories, SkeletonCards } from '../components/Skeleton';
import { legacyToRoute, fillDeliveryPlaceholders } from '../lib/links';
import { isFeatureOn } from '../lib/features';
import { applyTitleTemplate, buildCanonical, organizationJsonLd, localBusinessJsonLd } from '../lib/seo';
import './home.css';

/** Banner images are stored as "data/banners/x.webp" (served from web/public/data). */
const bannerImage = (src: string) => (/^(https?:|data:|\/)/.test(src) ? src : `/${src}`);

export default function Home() {
  const configQ = useConfig();
  const config = configQ.data;
  const settings = useSettings().data;
  const categoriesQ = useCategories();
  const allCategories = categoriesQ.data ?? [];
  const categories = allCategories.filter((c) => !c.hidden); // hidden (18+) categories stay off the homepage
  const productsQ = useProducts();
  const products = productsQ.data ?? [];

  // Feature flags (default ON when the API has no `features`).
  const features = config?.features;
  const socialProofOn = isFeatureOn(features, 'socialProof');
  const animatedBannersOn = isFeatureOn(features, 'animatedBanners');
  const seoOn = isFeatureOn(features, 'seoModule');

  // Original renderBanners(): general banners + the current festival's banners.
  const festival = config?.currentFestival || '';
  const allBanners = config?.banners ?? [];
  let banners = allBanners.filter((b) => b.active !== false && (!b.festival || b.festival === festival));
  if (!banners.length) banners = allBanners.filter((b) => b.active !== false && !b.festival);
  const ads = (config?.ads ?? []).filter((a) => a.active !== false);
  const fda = Number(settings?.freeDeliveryAbove ?? 500);
  const dc = Number(settings?.deliveryCharge ?? 0);
  const deliveryArea = config?.seo?.business.areaServed?.[0] || 'Chandargarh';
  // Original: first 12 products, excluding hidden / age-restricted categories.
  const restricted = new Set(allCategories.filter((c) => c.hidden || c.age_restricted).map((c) => c.slug));
  const popular = products.filter((p) => !restricted.has(p.category)).slice(0, 12);

  const [slide, setSlide] = useState(0);
  useEffect(() => {
    // `animatedBanners` off → keep the first banner static (no auto-advance).
    if (!animatedBannersOn || banners.length < 2) return;
    const t = setInterval(() => setSlide((s) => (s + 1) % banners.length), 4000);
    return () => clearInterval(t);
  }, [banners.length, animatedBannersOn]);

  return (
    <>
      <Helmet>
        <title>{applyTitleTemplate('Online Grocery Delivery in Chandargarh', config?.seo)}</title>
        <meta name="description" content={config?.seo?.defaultDescription || 'Fresh fruits, vegetables & daily essentials delivered fast in Chandargarh, Nabinagar, Bihar - 824301.'} />
        <meta name="keywords" content={config?.seo?.defaultKeywords || 'grocery delivery, kirana, online grocery, Chandargarh, Nabinagar, Bihar'} />
        <link rel="canonical" href={buildCanonical('/')} />
        {seoOn && [organizationJsonLd(config?.seo), localBusinessJsonLd(config?.seo)].map((entry, i) => (
          <script key={i} type="application/ld+json">{JSON.stringify(entry)}</script>
        ))}
      </Helmet>
      {socialProofOn && <AnnouncementPopup />}

      {/* Hero Slider */}
      <section className="hero-slider">
        <div className="slider-track" style={{ transform: `translateX(-${slide * 100}%)` }}>
          {configQ.isLoading && <SkeletonBanner />}
          {banners.map((b, i) => {
            const btn = b.btnText && b.btnLink ? <Link to={legacyToRoute(b.btnLink)} className="btn-shop">{b.btnText}</Link> : null;
            if (b.image) {
              // Image banner: text + button over a dark left-to-right overlay (original layout).
              const hasText = !!(b.title || b.subtitle || btn);
              const overlay = hasText ? 'linear-gradient(90deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.25) 55%, rgba(0,0,0,0) 100%), ' : '';
              return (
                <div key={i} className="slide" style={{ background: `${overlay}url('${bannerImage(b.image)}') center/cover no-repeat` }}>
                  {hasText && (
                    <div className="slide-content" style={{ textAlign: 'left', margin: 0, marginRight: 'auto' }}>
                      {b.title && <h1>{b.title}</h1>}
                      {b.subtitle && <p>{b.subtitle}</p>}
                      {btn}
                    </div>
                  )}
                </div>
              );
            }
            const g = Array.isArray(b.gradient) ? b.gradient : ['#ff6600', '#ff9800'];
            return (
              <div key={i} className="slide" style={{ background: `linear-gradient(135deg, ${g[0]}, ${g[1]})` }}>
                <div className="slide-content">
                  <h1>{b.title || ''}</h1>
                  <p>{b.subtitle || ''}</p>
                  {btn}
                </div>
              </div>
            );
          })}
        </div>
        {banners.length > 1 && (
          <div className="slider-dots">
            {banners.map((_, i) => (
              <span key={i} className={`dot ${i === slide ? 'active' : ''}`} onClick={() => setSlide(i)} />
            ))}
          </div>
        )}
      </section>

      {/* P2: value proposition + delivery eligibility, visible immediately below the hero so a
          first-time visitor instantly sees what the store is, where it delivers, and the free-
          delivery rule. Plain text (crawlable) + internal links to products/track. */}
      <section className="value-strip" aria-label="Why 4A Store" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, padding: '14px 12px', maxWidth: 1100, margin: '0 auto' }}>
        <div className="value-item" style={{ background: '#e8f5e9', borderRadius: 10, padding: '10px 12px' }}>
          <strong style={{ display: 'block', color: '#1b5e20' }}>🚚 Fast local delivery</strong>
          <span style={{ fontSize: 13, color: '#33691e' }}>Fresh groceries delivered in {deliveryArea}</span>
        </div>
        <div className="value-item" style={{ background: '#fff3e0', borderRadius: 10, padding: '10px 12px' }}>
          <strong style={{ display: 'block', color: '#e65100' }}>📍 Delivery area</strong>
          <span style={{ fontSize: 13, color: '#bf360c' }}>PIN 824301 — {deliveryArea}, Nabinagar, Bihar</span>
        </div>
        <div className="value-item" style={{ background: '#e3f2fd', borderRadius: 10, padding: '10px 12px' }}>
          <strong style={{ display: 'block', color: '#0d47a1' }}>🆓 Free delivery</strong>
          <span style={{ fontSize: 13, color: '#1565c0' }}>{fda > 0 ? `On orders above ₹${fda}` : 'On eligible orders'}</span>
        </div>
        <Link to="/track" className="value-item" style={{ background: '#f3e5f5', borderRadius: 10, padding: '10px 12px', textDecoration: 'none' }}>
          <strong style={{ display: 'block', color: '#6a1b9a' }}>📦 Track your order</strong>
          <span style={{ fontSize: 13, color: '#8e24aa' }}>Live status &amp; rider location</span>
        </Link>
      </section>

      {/* Ads / Offers */}
      {(configQ.isLoading || ads.length > 0) && (
        <section className="ads-section">
          <div className="ads-grid">
            {configQ.isLoading && <SkeletonAds />}
            {ads.map((ad) => (
              <Link key={ad.id} to={legacyToRoute(ad.link)} className="ad-card" style={{ background: ad.bgColor, borderColor: ad.borderColor }}>
                <div className="ad-icon">{ad.icon}</div>
                <div className="ad-content">
                  <h4 style={{ color: ad.borderColor }}>{fillDeliveryPlaceholders(ad.title, fda, dc)}</h4>
                  <p>{fillDeliveryPlaceholders(ad.description, fda, dc)}</p>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Categories */}
      <section className="categories-section">
        <h2 className="section-title">🛍️ Shop by Category</h2>
        <div className="categories-grid">
          {categoriesQ.isLoading && <SkeletonCategories />}
          {categories.map((c) => (
            <Link key={c.id} to={`/products?category=${c.slug}`} className="category-card">
              <div className="cat-icon">
                {c.image ? <img src={c.image} alt={c.name} /> : <span>{c.icon}</span>}
              </div>
              <div className="cat-name">{c.name}</div>
            </Link>
          ))}
        </div>
      </section>

      {/* Popular Products */}
      <section className="products-section">
        <h2 className="section-title">🔥 Popular Products</h2>
        <div className="products-grid">
          {(productsQ.isLoading || categoriesQ.isLoading) ? <SkeletonCards count={6} /> : popular.map((p) => <ProductCard key={p.id} product={p} />)}
        </div>
        <div className="text-center mt-20">
          <Link to="/products" className="btn-primary">View All Products →</Link>
        </div>
      </section>
    </>
  );
}
