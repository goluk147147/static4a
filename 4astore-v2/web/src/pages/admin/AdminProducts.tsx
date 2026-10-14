import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useProducts, useCategories } from '../../lib/queries';
import { saveProduct, deleteProduct } from '../../lib/admin';
import { compressToMaxBytes, dataUriBytes } from '../../lib/checkout';
import { apiError } from '../../lib/api';
import { showToast } from '../../store/toast';
import { showConfirm } from '../../store/confirm';
import type { Product } from '../../types';
import AdminModal from './AdminModal';

const PER_PAGE = 15; // original PRODUCTS_PER_PAGE

interface FormState {
  id?: number;
  name: string; brand: string; weight: string; category: string;
  mrp: string; price: string; discount: string; inStock: boolean; featured: boolean;
  image: string; description: string; features: string;
}

const toForm = (p?: Partial<Product>, keepId = true): FormState => ({
  id: keepId ? p?.id : undefined,
  name: p?.name || '', brand: p?.brand || '', weight: p?.weight || '', category: p?.category || '',
  mrp: p?.mrp != null ? String(p.mrp) : '', price: p?.price != null ? String(p.price) : '',
  discount: p?.discount != null ? String(p.discount) : '', inStock: p?.in_stock !== false, featured: !!p?.featured,
  image: p?.image || '', description: p?.description || '',
  features: Array.isArray(p?.features) ? p!.features!.join('\n') : '',
});

// Port of the original renderProductsTab() / openProductModal() / saveProduct().
export default function AdminProducts() {
  const qc = useQueryClient();
  const { data: prods = [], isLoading } = useProducts();
  const categories = useCategories().data ?? [];
  const [term, setTerm] = useState('');
  const [page, setPage] = useState(1);
  const [modal, setModal] = useState<{ mode: 'add' | 'edit' | 'copy'; form: FormState } | null>(null);
  const [saving, setSaving] = useState(false);
  const [compressing, setCompressing] = useState(false);

  // Pick a local image file, HARD-compress it to <= 50 KB (51200 bytes) and store the resulting
  // JPEG data-URI into the form `image` field (same save path as a pasted URL — no API shape change).
  const MAX_IMAGE_BYTES = 51200; // 50 KB
  async function onPickImage(file: File) {
    setCompressing(true);
    try {
      const dataUri = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result || ''));
        r.onerror = () => reject(new Error('read failed'));
        r.readAsDataURL(file);
      });
      const out = await compressToMaxBytes(dataUri, MAX_IMAGE_BYTES);
      if (!out) {
        showToast('Could not read/compress this image', 'error');
        return;
      }
      set('image', out);
    } catch {
      showToast('Could not read/compress this image', 'error');
    } finally {
      setCompressing(false);
    }
  }

  if (isLoading) return <p style={{ textAlign: 'center', padding: 30, color: 'var(--gray)' }}>Loading products...</p>;

  const t = term.trim().toLowerCase();
  const filtered = t
    ? prods.filter((p) => p.name.toLowerCase().includes(t) || (p.brand || '').toLowerCase().includes(t) || (p.category || '').toLowerCase().includes(t))
    : prods;
  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const current = Math.min(Math.max(1, page), totalPages);
  const rows = filtered.slice((current - 1) * PER_PAGE, current * PER_PAGE);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setModal((m) => (m ? { ...m, form: { ...m.form, [k]: v } } : m));

  /** Original autoDiscount(): fill discount % from MRP and price. */
  function withAutoDiscount(next: FormState): FormState {
    const mrp = parseFloat(next.mrp) || 0;
    const price = parseFloat(next.price) || 0;
    return mrp > 0 && price >= 0 && price <= mrp ? { ...next, discount: String(Math.round(((mrp - price) / mrp) * 100)) } : next;
  }

  async function save() {
    if (!modal) return;
    const f = modal.form;
    if (!f.name.trim()) return showToast('Product name is required', 'error');
    if (f.price === '' || Number.isNaN(parseFloat(f.price))) return showToast('Valid selling price is required', 'error');
    const payload = {
      id: modal.mode === 'edit' ? f.id : undefined,
      name: f.name.trim(), brand: f.brand, weight: f.weight, category: f.category,
      mrp: parseFloat(f.mrp) || 0, price: parseFloat(f.price) || 0,
      discount: f.discount === '' ? undefined : parseInt(f.discount, 10),
      image: f.image.trim(), description: f.description,
      features: f.features.split(/[\r\n,]+/).map((x) => x.trim()).filter(Boolean),
      inStock: f.inStock,
      featured: f.featured,
    };
    setSaving(true);
    try {
      await saveProduct(modal.mode === 'edit' ? 'update' : 'add', payload);
      showToast(modal.mode === 'edit' ? 'Product updated' : 'Product added', 'success');
      setModal(null);
      qc.invalidateQueries({ queryKey: ['products'] });
    } catch (e) {
      showToast(apiError(e) || 'Failed to save product', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function remove(p: Product) {
    const ok = await showConfirm(`Delete product "${p.name}"? This cannot be undone!`, { title: 'Delete product', confirmText: 'Delete', danger: true });
    if (!ok) return;
    try {
      await deleteProduct(p.id);
      showToast('Product deleted', 'success');
      qc.invalidateQueries({ queryKey: ['products'] });
    } catch (e) {
      showToast(apiError(e), 'error');
    }
  }

  const pagerBtn = (label: string, target: number, disabled: boolean, active = false) => (
    <button key={label} type="button" onClick={() => setPage(target)} disabled={disabled}
      style={{ minWidth: 36, padding: '7px 11px', border: '1px solid var(--border)', borderRadius: 8, cursor: disabled ? 'not-allowed' : 'pointer', fontSize: 13, fontWeight: 600, background: active ? 'var(--primary)' : 'white', color: active ? 'white' : disabled ? '#bbb' : 'var(--primary-dark)' }}>
      {label}
    </button>
  );
  const lo = Math.max(1, current - 2);
  const hi = Math.min(totalPages, current + 2);
  const nums: JSX.Element[] = [];
  if (lo > 1) { nums.push(pagerBtn('1', 1, false, current === 1)); if (lo > 2) nums.push(<span key="l">…</span>); }
  for (let i = lo; i <= hi; i++) nums.push(pagerBtn(String(i), i, false, i === current));
  if (hi < totalPages) { if (hi < totalPages - 1) nums.push(<span key="r">…</span>); nums.push(pagerBtn(String(totalPages), totalPages, false, current === totalPages)); }

  const heading = modal?.mode === 'edit' ? '✏️ Edit Product' : modal?.mode === 'copy' ? '📋 Copy Product (new)' : '➕ Add Product';

  return (
    <>
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <p style={{ fontSize: 13, color: 'var(--gray)' }}>Showing <strong>{filtered.length}</strong> of {prods.length} products</p>
        <button type="button" className="btn-add-product" onClick={() => setModal({ mode: 'add', form: toForm() })}>➕ Add Product</button>
      </div>
      <div style={{ marginBottom: 14 }}>
        <input type="text" value={term} onChange={(e) => { setTerm(e.target.value); setPage(1); }} placeholder="🔍 Search by name, brand or category..." aria-label="Search products"
          style={{ width: '100%', maxWidth: 420, padding: '10px 14px', border: '2px solid var(--border)', borderRadius: 8, fontSize: 14 }} />
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table className="admin-table">
          <thead>
            <tr><th>ID</th><th>Image</th><th>Name</th><th>Category</th><th>MRP</th><th>Price</th><th>Disc</th><th>Features</th><th>Stock</th><th>Action</th></tr>
          </thead>
          <tbody>
            {rows.length ? rows.map((p) => {
              const feat = Array.isArray(p.features) ? p.features.length : 0;
              return (
                <tr key={p.id}>
                  <td>{p.id}</td>
                  <td><img className="prod-thumb" src={p.image || ''} alt="" onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} /></td>
                  <td><strong>{p.name}</strong><div style={{ fontSize: 11, color: 'var(--gray)' }}>{p.brand || ''} · {p.weight || ''}</div></td>
                  <td>{p.category || ''}</td>
                  <td>₹{p.mrp}</td>
                  <td><strong style={{ color: 'var(--primary-dark)' }}>₹{p.price}</strong></td>
                  <td>{p.discount || 0}%</td>
                  <td>{feat ? `${feat} ✨` : '-'}</td>
                  <td><span className={`stock-badge ${p.in_stock ? 'stock-in' : 'stock-out'}`}>{p.in_stock ? 'In Stock' : 'Out'}</span></td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button type="button" onClick={() => setModal({ mode: 'edit', form: toForm(p) })} title="Edit" style={{ padding: '5px 10px', background: 'var(--primary)', color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 11, marginRight: 4 }}>✏️ Edit</button>
                    <button type="button" onClick={() => setModal({ mode: 'copy', form: toForm(p, false) })} title="Copy as new product (change size/price)" style={{ padding: '5px 10px', background: '#0891b2', color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 11, marginRight: 4 }}>📋 Copy</button>
                    <button type="button" onClick={() => remove(p)} title="Delete" aria-label={`Delete ${p.name}`} style={{ padding: '5px 10px', background: '#e53935', color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 11 }}>🗑️</button>
                  </td>
                </tr>
              );
            }) : (
              <tr><td colSpan={10} style={{ textAlign: 'center', padding: 30, color: 'var(--gray)' }}>No matching products.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {totalPages > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginTop: 16 }}>
          <span style={{ fontSize: 12, color: 'var(--gray)' }}>Showing {(current - 1) * PER_PAGE + 1}–{Math.min(current * PER_PAGE, filtered.length)} of {filtered.length}</span>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            {pagerBtn('‹ Prev', current - 1, current === 1)}
            {nums}
            {pagerBtn('Next ›', current + 1, current === totalPages)}
          </div>
        </div>
      )}

      {modal && (
        <AdminModal onClose={() => setModal(null)}>
          <h3 style={{ color: 'var(--primary)', marginBottom: 16 }}>{heading}</h3>
          {modal.mode === 'copy' && (
            <p style={{ fontSize: 12, color: '#e65100', background: '#fff3e6', borderRadius: 8, padding: '8px 10px', marginBottom: 14 }}>
              📋 Copy ban raha hai. Title/description same hain — sirf <strong>Weight/Size</strong> aur <strong>Price</strong> badlo, phir Save. Ye ek NAYA product banega (purana waise hi rahega).
            </p>
          )}
          <div className="prod-form-grid">
            <div className="full"><label htmlFor="pf_name">Product Name *</label><input id="pf_name" value={modal.form.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Aashirvaad Atta" /></div>
            <div><label htmlFor="pf_brand">Brand</label><input id="pf_brand" value={modal.form.brand} onChange={(e) => set('brand', e.target.value)} placeholder="e.g. Aashirvaad" /></div>
            <div><label htmlFor="pf_weight">Weight / Size</label><input id="pf_weight" autoFocus={modal.mode === 'copy'} value={modal.form.weight} onChange={(e) => set('weight', e.target.value)} placeholder="e.g. 5 Kg" /></div>
            <div className="full">
              <label htmlFor="pf_category">Category</label>
              <select id="pf_category" value={modal.form.category} onChange={(e) => set('category', e.target.value)}>
                <option value="">— Select category —</option>
                {categories.map((c) => <option key={c.id} value={c.slug}>{c.name}</option>)}
              </select>
            </div>
            <div><label htmlFor="pf_mrp">MRP (₹)</label><input id="pf_mrp" type="number" min={0} step="0.01" value={modal.form.mrp} onChange={(e) => setModal((m) => m && { ...m, form: withAutoDiscount({ ...m.form, mrp: e.target.value }) })} placeholder="0" /></div>
            <div><label htmlFor="pf_price">Selling Price (₹) *</label><input id="pf_price" type="number" min={0} step="0.01" value={modal.form.price} onChange={(e) => setModal((m) => m && { ...m, form: withAutoDiscount({ ...m.form, price: e.target.value }) })} placeholder="0" /></div>
            <div><label htmlFor="pf_discount">Discount (%)</label><input id="pf_discount" type="number" min={0} max={100} value={modal.form.discount} onChange={(e) => set('discount', e.target.value)} placeholder="auto" /></div>
            <div>
              <label htmlFor="pf_instock">In Stock?</label>
              <select id="pf_instock" value={modal.form.inStock ? '1' : '0'} onChange={(e) => set('inStock', e.target.value === '1')}>
                <option value="1">✅ In Stock</option>
                <option value="0">❌ Out of Stock</option>
              </select>
            </div>
            <div>
              <label htmlFor="pf_featured">Featured (Aaj ka Special video)?</label>
              <select id="pf_featured" value={modal.form.featured ? '1' : '0'} onChange={(e) => set('featured', e.target.value === '1')}>
                <option value="0">No</option>
                <option value="1">⭐ Yes — daily video me dikhao</option>
              </select>
            </div>
            <div className="full"><label htmlFor="pf_image">Image URL</label><input id="pf_image" value={modal.form.image} onChange={(e) => set('image', e.target.value)} placeholder="https://..." /></div>
            <div className="full">
              <label htmlFor="pf_image_file">…or upload from device (auto-compressed to ≤ 50 KB)</label>
              <input id="pf_image_file" type="file" accept="image/*" disabled={compressing}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) onPickImage(f); e.currentTarget.value = ''; }} />
              {compressing && <div style={{ fontSize: 12, color: 'var(--gray)', marginTop: 6 }}>Compressing…</div>}
              {!compressing && modal.form.image && modal.form.image.startsWith('data:image') && (
                <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 10 }}>
                  <img src={modal.form.image} alt="Preview" style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--border)' }} />
                  <span style={{ fontSize: 12, color: 'var(--gray)' }}>Stored size: {(dataUriBytes(modal.form.image) / 1024).toFixed(1)} KB / 50 KB</span>
                </div>
              )}
            </div>
            <div className="full"><label htmlFor="pf_description">Description</label><textarea id="pf_description" value={modal.form.description} onChange={(e) => set('description', e.target.value)} placeholder="Short product description" /></div>
            <div className="full"><label htmlFor="pf_features">Features (one per line, or comma separated)</label><textarea id="pf_features" value={modal.form.features} onChange={(e) => set('features', e.target.value)} placeholder={'100% whole wheat\nSoft rotis every time\nNo added maida'} /></div>
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
            <button type="button" onClick={save} disabled={saving || compressing} style={{ flex: 1, padding: 11, background: 'var(--primary)', color: 'white', border: 'none', borderRadius: 8, cursor: saving || compressing ? 'not-allowed' : 'pointer', fontWeight: 600 }}>
              💾 {saving ? 'Saving…' : compressing ? 'Compressing…' : `${modal.mode === 'edit' ? 'Update' : 'Add'} Product`}
            </button>
            <button type="button" onClick={() => setModal(null)} style={{ padding: '11px 20px', background: 'var(--gray)', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer' }}>Cancel</button>
          </div>
        </AdminModal>
      )}
    </>
  );
}
