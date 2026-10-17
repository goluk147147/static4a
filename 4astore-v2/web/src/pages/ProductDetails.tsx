import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useConfig, useProducts, useSettings } from '../lib/queries';
import { useCart } from '../store/cart';
import { productImageSrc, onProductImageError } from '../lib/productImage';
import { SkeletonDetail } from '../components/Skeleton';
import Seo from '../components/Seo';
import { buildCanonical, deriveProductSeo, productJsonLd, breadcrumbJsonLd, localBusinessJsonLd } from '../lib/seo';
import { fetchProductShortLink } from '../lib/admin';
import { waLink } from '../lib/whatsapp';
import { showToast } from '../store/toast';
import { qtyLimitCaption } from '../lib/qtyLimit';
import { validateCart } from '../lib/cart';

// Public site origin for shareable links. On production the SPA shares the store
// host; fall back to the canonical when on localhost. Mirrors AdminMarketing.SITE_ORIGIN.
const SITE_ORIGIN =
  (typeof window !== 'undefined' && window.location.origin && !/localhost|127\.0\.0\.1/.test(window.location.origin))
    ? window.location.origin
    : 'https://4astore.com';

export default function ProductDetails() {
  const { id } = useParams();
  const navigate = useNavigate();
  const productsQ = useProducts();
  const products = productsQ.data ?? [];
  const settings = useSettings().data;
  const config = useConfig().data;
  const product = products.find((p) => String(p.id) === id);
  const { add, items, setQty } = useCart();

  // Share state. These hooks MUST be declared before any early return below so
  // the hook order stays identical across renders (loading → loaded). Declaring
  // them after the `isLoading`/`!product` returns caused React error #310
  // ("rendered more hooks than during the previous render") and crashed the PDP.
  const [sharing, setSharing] = useState(false);
  const [waShareUrl, setWaShareUrl] = useState<string | null>(null);

  if (productsQ.isLoading) {
    return <div className="container" style={{ padding: 16 }}><div className="product-detail"><SkeletonDetail /></div></div>;
  }
  if (!product) {
    return (
      <div className="container" style={{ padding: 40, textAlign: 'center' }}>
        <p style={{ color: 'var(--gray)', marginBottom: 12 }}>Product not found.</p>
        <button type="button" className="btn-primary" onClick={() => navigate('/products')}>Browse Products</button>
      </div>
    );
  }
  const inCart = items.find((i) => i.id === product.id);
  const hideMrp = settings?.hideMrp;
  // Per-order purchase cap (null = unlimited). Disable + and show "Max N" at the cap.
  const max = typeof product.max_qty_per_order === 'number' && product.max_qty_per_order > 0 ? product.max_qty_per_order : null;
  const atMax = max != null && !!inCart && inCart.quantity >= max;

  // Add to cart with the instant client clamp (store), then confirm against the
  // AUTHORITATIVE server cap and surface its bilingual message if over the limit.
  function addToCart() {
    const nextQty = (inCart?.quantity ?? 0) + 1;
    add(product!);
    void validateCart([{ id: product!.id, quantity: nextQty }])
      .then((lines) => {
        const line = lines.find((l) => l.id === product!.id);
        if (line && !line.ok && line.message) showToast(line.message, 'error');
      })
      .catch(() => undefined);
  }

  // Share the product's SHORT link (/link/<code>) so crawlers get the OG preview
  // via FEAT-001's redirect route. Fall back to the canonical /product/:id when
  // no short code can be minted. navigator.share when available, else WhatsApp + Copy.
  // (sharing/waShareUrl state declared above, before the early returns.)
  const supportsShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  async function resolveShareUrl(): Promise<string> {
    try {
      const code = await fetchProductShortLink(product!.id);
      if (code) return `${SITE_ORIGIN}/link/${code}`;
    } catch {
      /* fall through to canonical */
    }
    return `${SITE_ORIGIN}/product/${product!.id}`;
  }

  function shareCaption(): string {
    return `${product!.name} — 4A Store`;
  }

  async function handleShare() {
    setSharing(true);
    try {
      const url = await resolveShareUrl();
      if (supportsShare) {
        try {
          await navigator.share({ title: product!.name, text: shareCaption(), url });
        } catch {
          /* user cancelled the share sheet — ignore */
        }
      } else {
        // No Web Share API — reveal WhatsApp + Copy fallbacks.
        setWaShareUrl(url);
      }
    } finally {
      setSharing(false);
    }
  }

  async function copyShareLink() {
    const url = waShareUrl || (await resolveShareUrl());
    try {
      await navigator.clipboard.writeText(url);
      showToast('✅ Link copied', 'success');
    } catch {
      showToast('Copy failed — please copy manually', 'error');
    }
  }

  const seoCfg = config?.seo;
  const deliveryArea = seoCfg?.business.areaServed?.[0] || 'Chandargarh';
  const freeAbove = Number(settings?.freeDeliveryAbove ?? 0);
  const derived = deriveProductSeo(product);
  const canonical = buildCanonical(`/product/${product.id}`);
  const seoImage = product.og_image || buildCanonical(productImageSrc(product));
  const jsonLd = [
    productJsonLd(product, seoCfg, canonical, seoImage),
    breadcrumbJsonLd([
      { name: 'Home', url: buildCanonical('/') },
      { name: 'Products', url: buildCanonical('/products') },
      { name: product.name, url: canonical },
    ]),
    localBusinessJsonLd(seoCfg),
  ];

  return (
    <div className="container" style={{ padding: 16 }}>
      <Seo
        title={product.seo_title || derived.title}
        description={product.seo_description || product.description || derived.description}
        keywords={product.seo_keywords || derived.keywords}
        canonical={canonical}
        image={seoImage}
        jsonLd={jsonLd}
        cfg={seoCfg}
        features={config?.features}
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 24 }}>
        <div style={{ background: '#fff', borderRadius: 12, padding: 20, textAlign: 'center' }}>
          <img src={productImageSrc(product)} alt={product.name} onError={onProductImageError(product)} style={{ maxHeight: 320, margin: '0 auto', objectFit: 'contain' }} />
        </div>
        <div>
          {product.brand && <div className="muted">{product.brand}</div>}
          {/* Single <h1> per product page (was <h2>) — the primary heading SEO/crawlers expect. */}
          <h1 style={{ fontSize: 22, margin: '4px 0' }}>{product.name}</h1>
          {product.weight && <p className="muted">{product.weight}</p>}
          <div className="price-row" style={{ margin: '12px 0' }}>
            <span className="price" style={{ fontSize: 24 }}>₹{product.price}</span>
            {!hideMrp && product.mrp > product.price && <span className="mrp">₹{product.mrp}</span>}
            {!hideMrp && product.discount > 0 && <span className="disc">{product.discount}% OFF</span>}
          </div>

          {/* P2: product-level delivery estimate + service-area so eligibility is obvious on the PDP. */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, margin: '10px 0' }}>
            <span style={{ background: '#e8f5e9', color: '#1b5e20', borderRadius: 8, padding: '6px 10px', fontSize: 13, fontWeight: 600 }}>
              🚚 {product.in_stock ? 'Same-day / fast delivery' : 'Currently unavailable'}
            </span>
            <span style={{ background: '#fff3e0', color: '#e65100', borderRadius: 8, padding: '6px 10px', fontSize: 13, fontWeight: 600 }}>
              📍 Delivers in {deliveryArea} — PIN 824301
            </span>
            {freeAbove > 0 && (
              <span style={{ background: '#e3f2fd', color: '#0d47a1', borderRadius: 8, padding: '6px 10px', fontSize: 13, fontWeight: 600 }}>
                🆓 Free delivery above ₹{freeAbove}
              </span>
            )}
          </div>

          {product.description && <p style={{ margin: '12px 0', lineHeight: 1.6 }}>{product.description}</p>}

          {!product.in_stock ? (
            <p className="out">Out of stock</p>
          ) : inCart ? (
            <div>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <div className="stepper">
                  <button onClick={() => setQty(product.id, inCart.quantity - 1)}>−</button>
                  <span>{inCart.quantity}</span>
                  <button onClick={() => setQty(product.id, inCart.quantity + 1)} disabled={atMax} style={atMax ? { opacity: 0.4, cursor: 'not-allowed' } : undefined}>+</button>
                </div>
                <button className="btn" onClick={() => navigate('/cart')}>Go to Cart →</button>
              </div>
              {atMax && (
                <div style={{ fontSize: 13, color: '#c62828', marginTop: 8, fontWeight: 600 }}>{qtyLimitCaption(max!, product.unit)}</div>
              )}
            </div>
          ) : (
            <button className="btn btn-block" onClick={addToCart}>Add to Cart</button>
          )}

          {/* Bilingual Share — shares the product SHORT link (OG preview via /link/<code>). */}
          <div style={{ marginTop: 16 }}>
            <button
              type="button"
              onClick={handleShare}
              disabled={sharing}
              style={{ padding: '10px 18px', background: 'var(--primary)', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
            >
              {sharing ? '⏳ …' : '🔗 Share / शेयर'}
            </button>

            {/* Web Share API unavailable → WhatsApp + Copy link fallbacks. */}
            {!supportsShare && waShareUrl && (
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 10 }}>
                <a
                  href={waLink(null, `${shareCaption()} ${waShareUrl}`)}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ padding: '9px 16px', background: '#25D366', color: '#fff', borderRadius: 8, fontSize: 13, fontWeight: 600, textDecoration: 'none' }}
                >
                  💬 Share on WhatsApp
                </a>
                <button
                  type="button"
                  onClick={copyShareLink}
                  style={{ padding: '9px 16px', background: '#f1f5f9', color: 'var(--primary-dark)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
                >
                  📋 Copy link
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
