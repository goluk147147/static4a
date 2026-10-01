import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { useProducts, useCategories, useConfig } from '../lib/queries';
import ProductCard from '../components/ProductCard';
import { legacyToRoute } from '../lib/links';
import './products.css';

interface FestAd {
  title: string;
  text: string;
  bgGradient: [string, string];
  link: string;
  emoji: string;
}
type FestivalAds = Record<string, { leftAd?: FestAd; rightAd?: FestAd; midBanner?: FestAd }>;

// Original products.html setupFestival() infoMap
const FESTIVAL_INFO: Record<string, { name: string; colors: [string, string]; emojis: string[] }> = {
  rakhi: { name: '🪢 Raksha Bandhan Special', colors: ['#d81b60', '#f06292'], emojis: ['🪢', '🎁', '💝', '🌸'] },
  diwali: { name: '🪔 Diwali Dhamaka', colors: ['#ff6f00', '#ffd54f'], emojis: ['🪔', '✨', '🎆', '💫'] },
  navratri: { name: '🕉️ Navratri Special', colors: ['#F5A623', '#ff8f00'], emojis: ['🕉️', '🔱', '🙏'] },
  holi: { name: '🎨 Holi Dhamaka', colors: ['#6a1b9a', '#ab47bc'], emojis: ['🎨', '💜', '💚', '❤️'] },
  christmas: { name: '🎄 Christmas & New Year', colors: ['#c62828', '#ef5350'], emojis: ['🎄', '⭐', '❄️'] },
  eid: { name: '☪️ Eid Special', colors: ['#1b5e20', '#4caf50'], emojis: ['☪️', '🌙', '⭐'] },
  ipl: { name: '🏏 IPL Snack Fest', colors: ['#1565c0', '#42a5f5'], emojis: ['🏏', '🏆', '⚡'] },
  independence: { name: '🇮🇳 Independence Day', colors: ['#e65100', '#F5A623'], emojis: ['🇮🇳', '🦚', '⭐'] },
  chhath: { name: '🛕 Chhath Puja', colors: ['#e65100', '#ffb300'], emojis: ['🛕', '🌅', '🙏'] },
};

const toRoute = (link: string) => legacyToRoute(link);

export default function Products() {
  const [params, setParams] = useSearchParams();
  const search = params.get('search') || '';
  const category = params.get('category') || '';
  const config = useConfig().data;
  const festival = params.get('festival') || config?.currentFestival || '';

  const { data: products = [], isLoading } = useProducts();
  const categories = useCategories().data ?? [];

  const [sort, setSort] = useState('');
  const [brand, setBrand] = useState('');
  const [inStockOnly, setInStockOnly] = useState(true);
  const pillsRef = useRef<HTMLDivElement | null>(null);

  const brands = useMemo(() => [...new Set(products.map((p) => p.brand).filter(Boolean) as string[])].sort(), [products]);

  // Same filter pipeline as the original applyFilters().
  const result = useMemo(() => {
    let list = [...products];
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.brand || '').toLowerCase().includes(q) ||
          p.category.replace(/-/g, ' ').includes(q) ||
          (p.description || '').toLowerCase().includes(q)
      );
    }
    if (category) list = list.filter((p) => p.category === category);
    if (brand) list = list.filter((p) => p.brand === brand);
    if (inStockOnly) list = list.filter((p) => p.in_stock);
    if (sort === 'price-low') list.sort((a, b) => a.price - b.price);
    else if (sort === 'price-high') list.sort((a, b) => b.price - a.price);
    else if (sort === 'discount') list.sort((a, b) => b.discount - a.discount);
    else if (sort === 'name') list.sort((a, b) => a.name.localeCompare(b.name));
    return list;
  }, [products, search, category, brand, inStockOnly, sort]);

  // ---- festival (header, side ads, mid banner, particles) ----
  const festAds = (config?.festivalAds as FestivalAds | undefined)?.[festival];
  const festInfo = festival && festAds ? FESTIVAL_INFO[festival] || { name: '🎉 Festival', colors: ['#2C6FAD', '#5BA3D9'] as [string, string], emojis: ['✨'] } : null;

  useEffect(() => {
    if (!festInfo) return;
    let count = 0;
    const timers: number[] = [];
    const iv = window.setInterval(() => {
      const el = document.createElement('div');
      el.className = 'festive-particle';
      el.textContent = festInfo.emojis[Math.floor(Math.random() * festInfo.emojis.length)];
      el.style.left = Math.random() * 100 + 'vw';
      el.style.animationDuration = 4 + Math.random() * 4 + 's';
      document.body.appendChild(el);
      timers.push(window.setTimeout(() => el.remove(), 8000));
      if (++count > 10) clearInterval(iv);
    }, 3000);
    return () => {
      clearInterval(iv);
      timers.forEach(clearTimeout);
      document.querySelectorAll('.festive-particle').forEach((el) => el.remove());
    };
  }, [festival, !!festInfo]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- category pills: arrow + mouse drag scrolling (original behaviour) ----
  const scrollPills = (amount: number) => pillsRef.current?.scrollBy({ left: amount, behavior: 'smooth' });
  const drag = useRef({ down: false, startX: 0, scrollLeft: 0, moved: false });
  const onPillsDown = (e: React.MouseEvent) => {
    const el = pillsRef.current;
    if (!el) return;
    drag.current = { down: true, startX: e.pageX - el.offsetLeft, scrollLeft: el.scrollLeft, moved: false };
  };
  const onPillsMove = (e: React.MouseEvent) => {
    const el = pillsRef.current;
    if (!el || !drag.current.down) return;
    const walk = e.pageX - el.offsetLeft - drag.current.startX;
    if (Math.abs(walk) > 4) drag.current.moved = true;
    el.scrollLeft = drag.current.scrollLeft - walk;
  };
  const onPillsUp = () => {
    drag.current.down = false;
  };

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next);
  }

  function selectCategory(slug: string) {
    if (drag.current.moved) return; // a drag, not a click
    setParam('category', slug);
  }

  function resetFilters() {
    const next = new URLSearchParams(params);
    next.delete('category');
    next.delete('search');
    setParams(next);
    setSort('');
    setBrand('');
  }

  const activeCat = categories.find((c) => c.slug === category);
  const showWarning = !!category && !!activeCat && (activeCat.age_restricted || activeCat.hidden);
  const midBanner = festAds?.midBanner;

  return (
    <>
      <Helmet>
        <title>Products - 4A Store | Shop Groceries Online</title>
        <meta name="description" content="4A Store - Browse all products. Fresh groceries, fruits, vegetables, snacks, oil, ghee & daily essentials at best prices." />
      </Helmet>

      {festInfo && (
        <div className="fest-header" style={{ background: `linear-gradient(135deg,${festInfo.colors[0]},${festInfo.colors[1]})` }}>
          <span className="deco" style={{ top: 5, left: '5%' }}>{festInfo.emojis[0]}</span>
          <span className="deco" style={{ top: 5, right: '7%', animationDelay: '.4s' }}>{festInfo.emojis[1 % festInfo.emojis.length]}</span>
          <span className="deco" style={{ bottom: 5, left: '12%', animationDelay: '.8s' }}>{festInfo.emojis[2 % festInfo.emojis.length]}</span>
          <span className="deco" style={{ bottom: 5, right: '5%', animationDelay: '1.2s' }}>{festInfo.emojis[0]}</span>
          <h1>{festInfo.name}</h1>
          <p>Shop festive deals at 4astore, Chandargarh!</p>
        </div>
      )}

      <div className={`page-outer${festInfo ? ' has-ads' : ''}`}>
        <div className="side-ad">
          {festInfo && festAds?.leftAd && (
            <Link to={toRoute(festAds.leftAd.link)} className="side-ad-inner" style={{ background: `linear-gradient(180deg,${festAds.leftAd.bgGradient[0]},${festAds.leftAd.bgGradient[1]})` }}>
              <span className="ad-emoji">{festAds.leftAd.emoji}</span><h4>{festAds.leftAd.title}</h4><p>{festAds.leftAd.text}</p><span className="ad-btn">Shop →</span>
            </Link>
          )}
        </div>

        <div style={{ padding: '16px 4px', minWidth: 0, overflow: 'hidden' }}>
          <div className="filter-bar">
            <div className="cat-pills-wrapper">
              <button type="button" className="arrow-btn" aria-label="Scroll categories left" onClick={() => scrollPills(-200)}>‹</button>
              <div className="cat-pills" ref={pillsRef} onMouseDown={onPillsDown} onMouseMove={onPillsMove} onMouseUp={onPillsUp} onMouseLeave={onPillsUp}>
                {categories.length === 0 ? (
                  <div className="skeleton-pills">{[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="skeleton-pill shimmer" />)}</div>
                ) : (
                  <>
                    <button type="button" className={`cat-pill${!category ? ' active' : ''}`} onClick={() => selectCategory('')}>🛒 All</button>
                    {categories.map((c) => (
                      <button type="button" key={c.id} className={`cat-pill${category === c.slug ? ' active' : ''}`} onClick={() => selectCategory(c.slug)}>
                        {c.image ? <img src={c.image} alt="" draggable={false} onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} /> : c.icon || '🛒'} {c.name}
                      </button>
                    ))}
                  </>
                )}
              </div>
              <button type="button" className="arrow-btn" aria-label="Scroll categories right" onClick={() => scrollPills(200)}>›</button>
            </div>
            <div className="filter-row" style={{ marginTop: 10 }}>
              <label htmlFor="sortFilter">Sort:</label>
              <select id="sortFilter" value={sort} onChange={(e) => setSort(e.target.value)}>
                <option value="">Default</option>
                <option value="price-low">Price Low→High</option>
                <option value="price-high">Price High→Low</option>
                <option value="discount">Best Discount</option>
                <option value="name">Name A→Z</option>
              </select>
              <label htmlFor="brandFilter">Brand:</label>
              <select id="brandFilter" value={brand} onChange={(e) => setBrand(e.target.value)}>
                <option value="">All Brands</option>
                {brands.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
              <label style={{ marginLeft: 'auto' }}>
                <input type="checkbox" checked={inStockOnly} onChange={(e) => setInStockOnly(e.target.checked)} style={{ accentColor: 'var(--primary)' }} /> In Stock
              </label>
            </div>
          </div>

          {showWarning && (
            <div style={{ background: '#fff3cd', border: '1px solid #f0c36d', borderLeft: '5px solid #e0a800', borderRadius: 10, padding: '12px 14px', marginBottom: 12, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <div style={{ fontSize: 20, lineHeight: 1 }}>🔞</div>
              <div style={{ fontSize: 13, color: '#664d03', lineHeight: 1.5 }}>
                <strong>18+ only.</strong> {activeCat?.warning || 'Tobacco causes cancer. Sirf 18+ ke liye.'}
                <br />
                <span style={{ opacity: 0.85 }}>Chetavani: Tambaku / nasha sehat ke liye haanikarak hai aur cancer ka kaaran ban sakta hai.</span>
              </div>
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, padding: '0 4px' }}>
            <span style={{ fontSize: 13, color: 'var(--gray)' }}>{isLoading ? 'Loading...' : `Showing ${result.length} product${result.length !== 1 ? 's' : ''}`}</span>
            {(category || search || brand) && (
              <button type="button" onClick={resetFilters} style={{ fontSize: 12, color: 'var(--primary)', fontWeight: 600, cursor: 'pointer', background: 'none', border: 0 }}>✕ Reset Filters</button>
            )}
          </div>

          <div className="prod-grid">
            {isLoading ? (
              [0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
                <div key={i} className="skeleton-card"><div className="skeleton-img shimmer" /><div className="skeleton-text short shimmer" /><div className="skeleton-text long shimmer" /><div className="skeleton-text medium shimmer" /><div className="skeleton-price shimmer" /><div className="skeleton-btn shimmer" /></div>
              ))
            ) : result.length === 0 ? (
              <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: '50px 20px' }}>
                <div style={{ fontSize: '3rem', marginBottom: 12 }}>🔍</div>
                <h3>No products found</h3>
                <p style={{ color: 'var(--gray)' }}>Try different filter</p>
              </div>
            ) : (
              result.map((p, i) => (
                <Fragment key={p.id}>
                  <ProductCard product={p} />
                  {i === 7 && festInfo && midBanner && (
                    <Link to={toRoute(midBanner.link)} className="mid-banner" style={{ gridColumn: '1/-1', background: `linear-gradient(90deg,${midBanner.bgGradient[0]},${midBanner.bgGradient[1]})` }}>
                      <span style={{ fontSize: '1.8rem' }}>{midBanner.emoji}</span>
                      <div style={{ textAlign: 'center', flex: 1 }}><h3>{midBanner.title}</h3><p>{midBanner.text}</p></div>
                      <span style={{ fontSize: '1.8rem' }}>{midBanner.emoji}</span>
                    </Link>
                  )}
                </Fragment>
              ))
            )}
          </div>
        </div>

        <div className="side-ad">
          {festInfo && festAds?.rightAd && (
            <Link to={toRoute(festAds.rightAd.link)} className="side-ad-inner" style={{ background: `linear-gradient(180deg,${festAds.rightAd.bgGradient[0]},${festAds.rightAd.bgGradient[1]})` }}>
              <span className="ad-emoji">{festAds.rightAd.emoji}</span><h4>{festAds.rightAd.title}</h4><p>{festAds.rightAd.text}</p><span className="ad-btn">Offers →</span>
            </Link>
          )}
        </div>
      </div>
    </>
  );
}
