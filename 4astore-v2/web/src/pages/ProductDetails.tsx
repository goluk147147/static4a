import { useParams, useNavigate } from 'react-router-dom';
import { useConfig, useProducts, useSettings } from '../lib/queries';
import { useCart } from '../store/cart';
import { productImageSrc, onProductImageError } from '../lib/productImage';
import { SkeletonDetail } from '../components/Skeleton';
import Seo from '../components/Seo';
import { buildCanonical, deriveProductSeo, productJsonLd, breadcrumbJsonLd, localBusinessJsonLd } from '../lib/seo';

export default function ProductDetails() {
  const { id } = useParams();
  const navigate = useNavigate();
  const productsQ = useProducts();
  const products = productsQ.data ?? [];
  const settings = useSettings().data;
  const config = useConfig().data;
  const product = products.find((p) => String(p.id) === id);
  const { add, items, setQty } = useCart();

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

  const seoCfg = config?.seo;
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
          <h2>{product.name}</h2>
          {product.weight && <p className="muted">{product.weight}</p>}
          <div className="price-row" style={{ margin: '12px 0' }}>
            <span className="price" style={{ fontSize: 24 }}>₹{product.price}</span>
            {!hideMrp && product.mrp > product.price && <span className="mrp">₹{product.mrp}</span>}
            {!hideMrp && product.discount > 0 && <span className="disc">{product.discount}% OFF</span>}
          </div>
          {product.description && <p style={{ margin: '12px 0', lineHeight: 1.6 }}>{product.description}</p>}

          {!product.in_stock ? (
            <p className="out">Out of stock</p>
          ) : inCart ? (
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <div className="stepper">
                <button onClick={() => setQty(product.id, inCart.quantity - 1)}>−</button>
                <span>{inCart.quantity}</span>
                <button onClick={() => setQty(product.id, inCart.quantity + 1)}>+</button>
              </div>
              <button className="btn" onClick={() => navigate('/cart')}>Go to Cart →</button>
            </div>
          ) : (
            <button className="btn btn-block" onClick={() => add(product)}>Add to Cart</button>
          )}
        </div>
      </div>
    </div>
  );
}
