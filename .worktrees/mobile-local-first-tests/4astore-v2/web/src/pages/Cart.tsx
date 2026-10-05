import { Link, useNavigate } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { useCart } from '../store/cart';
import { useSettings, useProducts } from '../lib/queries';
import { useAuth } from '../store/auth';
import { cartTotals } from '../lib/checkout';
import { productImageSrc, onProductImageError } from '../lib/productImage';
import { SkeletonCartItems } from '../components/Skeleton';

export default function Cart() {
  const { items, setQty, remove } = useCart();
  const settings = useSettings().data;
  const productsQ = useProducts();
  const products = productsQ.data ?? [];
  const user = useAuth((s) => s.user);
  const navigate = useNavigate();

  // Totals re-price the cart from the live catalogue, so wait for it (original cart shimmer).
  if (productsQ.isLoading && items.length > 0) {
    return (
      <div className="container" style={{ padding: 16 }}>
        <Helmet><title>Cart | 4A Store</title></Helmet>
        <h3 style={{ marginBottom: 12 }}>Your Cart</h3>
        <SkeletonCartItems count={Math.min(items.length, 4)} />
      </div>
    );
  }

  const totals = cartTotals(items, products, settings, user);
  const sub = totals.subtotal;
  const freeAbove = settings?.freeDeliveryAbove ?? 500;
  const deliveryCharge = totals.deliveryCharge;
  const total = totals.total;

  if (items.length === 0) {
    return (
      <div className="container" style={{ padding: 40, textAlign: 'center' }}>
        <Helmet><title>Cart | 4A Store</title></Helmet>
        <div style={{ fontSize: 60 }}>🛒</div>
        <h3>Your cart is empty</h3>
        <p className="muted" style={{ margin: '8px 0 16px' }}>Add some fresh groceries to get started.</p>
        <Link to="/products" className="btn">Shop Now</Link>
      </div>
    );
  }

  return (
    <div className="container" style={{ padding: 16 }}>
      <Helmet><title>{`Cart (${items.length}) | 4A Store`}</title></Helmet>
      <h3 style={{ marginBottom: 12 }}>Your Cart</h3>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {items.map((i) => (
          <div key={i.id} style={{ background: '#fff', borderRadius: 12, padding: 12, display: 'flex', gap: 12, alignItems: 'center', boxShadow: 'var(--shadow)' }}>
            <div style={{ width: 56, height: 56, background: '#fafafa', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {(() => {
                const p = { id: i.id, name: i.name, weight: i.weight, category: i.category ?? products.find((x) => x.id === i.id)?.category, image: i.image };
                return <img src={productImageSrc(p)} alt={i.name} onError={onProductImageError(p)} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />;
              })()}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{i.name}</div>
              <div className="muted" style={{ fontSize: 12 }}>{i.weight} · ₹{i.price}</div>
            </div>
            <div className="stepper">
              <button onClick={() => setQty(i.id, i.quantity - 1)}>−</button>
              <span>{i.quantity}</span>
              <button onClick={() => setQty(i.id, i.quantity + 1)}>+</button>
            </div>
            <div style={{ fontWeight: 700, minWidth: 60, textAlign: 'right' }}>₹{i.price * i.quantity}</div>
            <button onClick={() => remove(i.id)} style={{ background: 'none', border: 0, fontSize: 18, color: '#c62828' }}>×</button>
          </div>
        ))}
      </div>

      <div style={{ background: '#fff', borderRadius: 12, padding: 16, marginTop: 16, boxShadow: 'var(--shadow)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}><span className="muted">Subtotal</span><span>₹{sub}</span></div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
          <span className="muted">Delivery</span>
          <span>{deliveryCharge === 0 ? <b style={{ color: 'var(--primary)' }}>FREE</b> : `₹${deliveryCharge}`}</span>
        </div>
        {deliveryCharge > 0 && user?.custom_delivery == null && sub < freeAbove && (
          <p className="muted" style={{ fontSize: 12 }}>Add ₹{freeAbove - sub} more for free delivery</p>
        )}
        <hr style={{ border: 0, borderTop: '1px solid var(--border)', margin: '10px 0' }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 18 }}><span>Total</span><span>₹{total}</span></div>
        <button className="btn btn-block" style={{ marginTop: 14 }} onClick={() => navigate(user ? '/checkout' : '/login?next=/cart')}>
          {user ? 'Proceed to Checkout' : 'Login to Checkout'}
        </button>
      </div>
    </div>
  );
}
