import { useNavigate } from 'react-router-dom';
import type { Product } from '../types';
import { useCart } from '../store/cart';
import { useSettings } from '../lib/queries';
import { productImageSrc, onProductImageError } from '../lib/productImage';

export default function ProductCard({ product }: { product: Product }) {
  const { add, items, setQty } = useCart();
  const settings = useSettings().data;
  const navigate = useNavigate();
  const inCart = items.find((i) => i.id === product.id);
  const hideMrp = settings?.hideMrp;
  const showDiscount = product.discount > 0 && !hideMrp;

  return (
    <div className="product-card" data-product-id={product.id}>
      {showDiscount && <span className="discount-badge">{product.discount}% OFF</span>}
      <img
        src={productImageSrc(product)}
        alt={product.name}
        className="product-img"
        onClick={() => navigate(`/product/${product.id}`)}
        onError={onProductImageError(product)}
        loading="lazy"
      />
      {product.brand && <div className="product-brand">{product.brand}</div>}
      <div className="product-name" onClick={() => navigate(`/product/${product.id}`)}>{product.name}</div>
      <div className="product-weight">{product.weight}</div>
      <div className="price-row">
        <span className="price">₹{product.price}</span>
        {showDiscount && product.mrp > product.price && <span className="mrp">₹{product.mrp}</span>}
      </div>
      {hideMrp ? null : product.in_stock ? (
        <div className="card-actions">
          {inCart ? (
            <div className="qty-controls">
              <button onClick={() => setQty(product.id, inCart.quantity - 1)}>−</button>
              <span>{inCart.quantity}</span>
              <button onClick={() => setQty(product.id, inCart.quantity + 1)}>+</button>
            </div>
          ) : (
            <button className="btn-add-cart" onClick={() => add(product)}>Add to Cart</button>
          )}
        </div>
      ) : (
        <div className="stock-out">Out of Stock</div>
      )}
    </div>
  );
}
