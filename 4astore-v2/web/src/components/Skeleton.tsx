// Shimmer placeholders from the original pages (index / products / product-details /
// cart / order-history). Styling comes from legacy style.css (.shimmer, .skeleton-*).

const range = (n: number) => Array.from({ length: n }, (_, i) => i);

export const SkeletonBanner = () => (
  <div className="skeleton-container" aria-hidden="true"><div className="skeleton-banner shimmer" /></div>
);

export const SkeletonAds = ({ count = 3 }: { count?: number }) => (
  <>{range(count).map((i) => <div key={i} className="skeleton-ad shimmer" aria-hidden="true" />)}</>
);

export const SkeletonCategories = ({ count = 8 }: { count?: number }) => (
  <>
    {range(count).map((i) => (
      <div key={i} className="skeleton-category" aria-hidden="true"><div className="skeleton-icon shimmer" /><div className="skeleton-label shimmer" /></div>
    ))}
  </>
);

export const SkeletonCards = ({ count = 6 }: { count?: number }) => (
  <>
    {range(count).map((i) => (
      <div key={i} className="skeleton-card" aria-hidden="true">
        <div className="skeleton-img shimmer" /><div className="skeleton-text short shimmer" /><div className="skeleton-text long shimmer" />
        <div className="skeleton-text medium shimmer" /><div className="skeleton-price shimmer" /><div className="skeleton-btn shimmer" />
      </div>
    ))}
  </>
);

export const SkeletonPills = ({ count = 6 }: { count?: number }) => (
  <div className="skeleton-pills" aria-hidden="true">{range(count).map((i) => <div key={i} className="skeleton-pill shimmer" />)}</div>
);

export const SkeletonDetail = () => (
  <div className="skeleton-detail" aria-hidden="true">
    <div className="skeleton-detail-img shimmer" />
    <div className="skeleton-detail-info">
      <div className="skeleton-title shimmer" /><div className="skeleton-subtitle shimmer" /><div className="skeleton-price-lg shimmer" />
      <div className="skeleton-desc shimmer" /><div className="skeleton-desc shimmer" style={{ width: '85%' }} />
      <div className="skeleton-desc shimmer" style={{ width: '70%' }} /><div className="skeleton-btn-lg shimmer" />
    </div>
  </div>
);

export const SkeletonCartItems = ({ count = 3 }: { count?: number }) => (
  <>
    {range(count).map((i) => (
      <div key={i} className="skeleton-cart-item" aria-hidden="true">
        <div className="skeleton-cart-img shimmer" />
        <div className="skeleton-cart-info"><div className="skeleton-text long shimmer" /><div className="skeleton-text short shimmer" /><div className="skeleton-text medium shimmer" /></div>
        <div className="skeleton-cart-price shimmer" />
      </div>
    ))}
  </>
);

export const SkeletonOrders = ({ count = 3 }: { count?: number }) => (
  <>
    {range(count).map((i) => (
      <div key={i} className="skeleton-order" aria-hidden="true">
        <div className="skeleton-order-header"><div className="skeleton-text shimmer" style={{ width: '35%' }} /><div className="skeleton-text shimmer" style={{ width: '20%' }} /></div>
        <div className="skeleton-order-items"><div className="skeleton-text shimmer" style={{ width: '80%' }} /><div className="skeleton-text shimmer" style={{ width: '60%' }} /></div>
        <div className="skeleton-order-footer"><div className="skeleton-text shimmer" style={{ width: '25%' }} /><div className="skeleton-text shimmer" style={{ width: '30%' }} /></div>
      </div>
    ))}
  </>
);
