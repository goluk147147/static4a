import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useCategories, useProducts } from '../../lib/queries';
import { saveCategory, deleteCategory, CategoryPayload } from '../../lib/admin';
import { apiError } from '../../lib/api';
import { showToast } from '../../store/toast';
import { showConfirm } from '../../store/confirm';
import type { Category } from '../../types';
import AdminModal from './AdminModal';

interface Form {
  id?: number;
  name: string; icon: string; slug: string; image: string;
  hidden: boolean; ageRestricted: boolean; warning: string;
}

const toForm = (c?: Category): Form => ({
  id: c?.id, name: c?.name || '', icon: c?.icon || '', slug: c?.slug || '', image: c?.image || '',
  hidden: !!c?.hidden, ageRestricted: !!c?.age_restricted, warning: c?.warning || '',
});

const toPayload = (f: Form): CategoryPayload => ({
  id: f.id, name: f.name.trim(), icon: f.icon.trim(), slug: f.slug.trim(), image: f.image.trim(),
  hidden: f.hidden, ageRestricted: f.ageRestricted, warning: f.warning.trim(),
});

// Port of the original renderCategoriesTab() / openCategoryModal() / saveCategory().
export default function AdminCategories() {
  const qc = useQueryClient();
  const { data: cats = [], isLoading } = useCategories();
  const prods = useProducts().data ?? [];
  const [form, setForm] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['categories'] });
    qc.invalidateQueries({ queryKey: ['products'] }); // slug renames move products
  };
  const countFor = (slug: string) => prods.filter((p) => p.category === slug).length;
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));

  async function save() {
    if (!form) return;
    if (!form.name.trim()) return showToast('Category name is required', 'error');
    setBusy(true);
    try {
      await saveCategory(form.id ? 'update' : 'add', toPayload(form));
      showToast(form.id ? 'Category updated' : 'Category added', 'success');
      setForm(null);
      refresh();
    } catch (e) {
      showToast(apiError(e) || 'Failed to save category', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function remove(c: Category) {
    const n = countFor(c.slug);
    const extra = n ? `\n\n⚠️ ${n} product(s) is category me hain. Delete karne se wo products bina category ke reh jayenge.` : '';
    const ok = await showConfirm(`Delete category "${c.name}"?${extra}`, { title: 'Delete category', confirmText: 'Delete', danger: true });
    if (!ok) return;
    try {
      await deleteCategory(c.id);
      showToast('Category deleted', 'success');
      refresh();
    } catch (e) {
      showToast(apiError(e) || 'Failed to delete', 'error');
    }
  }

  async function toggleHidden(c: Category) {
    try {
      await saveCategory('update', { ...toPayload(toForm(c)), hidden: !c.hidden });
      showToast(!c.hidden ? 'Category hidden from home' : 'Category published', 'success');
      refresh();
    } catch (e) {
      showToast(apiError(e) || 'Failed to update', 'error');
    }
  }

  if (isLoading) return <p style={{ textAlign: 'center', padding: 30, color: 'var(--gray)' }}>Loading categories...</p>;

  return (
    <>
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <p style={{ fontSize: 13, color: 'var(--gray)' }}>
          <strong>{cats.length}</strong> categories · <span style={{ color: '#b45309' }}>Hidden</span> categories won't show on homepage
        </p>
        <button type="button" className="btn-add-product" onClick={() => setForm(toForm())}>➕ Add Category</button>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table className="admin-table">
          <thead><tr><th>ID</th><th>Icon</th><th>Name / Slug</th><th>Products</th><th>Status</th><th>Action</th></tr></thead>
          <tbody>
            {cats.length ? cats.map((c) => (
              <tr key={c.id}>
                <td>{c.id}</td>
                <td style={{ fontSize: 22 }}>{c.icon || '📦'}</td>
                <td>
                  <strong>{c.name}</strong>
                  {c.age_restricted && <span style={{ background: '#fff3cd', color: '#664d03', fontSize: 10, padding: '2px 6px', borderRadius: 10, marginLeft: 6 }}>🔞 18+</span>}
                  <div style={{ fontSize: 11, color: 'var(--gray)' }}>{c.slug}</div>
                </td>
                <td>{countFor(c.slug)}</td>
                <td><span style={{ fontSize: 12, fontWeight: 600, color: c.hidden ? '#b45309' : '#059669' }}>{c.hidden ? '🚫 Hidden' : '✅ Published'}</span></td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button type="button" onClick={() => toggleHidden(c)} title={c.hidden ? 'Publish (show on home)' : 'Hide from home'}
                    style={{ padding: '5px 9px', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12, background: c.hidden ? '#059669' : '#f59e0b', color: 'white', marginRight: 4 }}>
                    {c.hidden ? '📢 Publish' : '🙈 Hide'}
                  </button>
                  <button type="button" onClick={() => setForm(toForm(c))} style={{ padding: '5px 9px', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12, background: 'var(--primary)', color: 'white', marginRight: 4 }}>✏️ Edit</button>
                  <button type="button" onClick={() => remove(c)} aria-label={`Delete ${c.name}`} style={{ padding: '5px 9px', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12, background: '#dc2626', color: 'white' }}>🗑️</button>
                </td>
              </tr>
            )) : (
              <tr><td colSpan={6} style={{ textAlign: 'center', padding: 20, color: 'var(--gray)' }}>No categories yet</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {form && (
        <AdminModal onClose={() => setForm(null)}>
          <h3 style={{ color: 'var(--primary)', marginBottom: 16 }}>{form.id ? '✏️ Edit Category' : '➕ Add Category'}</h3>
          <div className="prod-form-grid">
            <div className="full"><label htmlFor="cf_name">Category Name *</label><input id="cf_name" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Snacks & Namkeen" /></div>
            <div><label htmlFor="cf_icon">Icon (emoji)</label><input id="cf_icon" value={form.icon} onChange={(e) => set('icon', e.target.value)} placeholder="🍪" maxLength={8} /></div>
            <div><label htmlFor="cf_slug">Slug {form.id ? '' : '(auto)'}</label><input id="cf_slug" value={form.slug} onChange={(e) => set('slug', e.target.value)} placeholder="auto from name" /></div>
            <div className="full"><label htmlFor="cf_image">Image URL (optional)</label><input id="cf_image" value={form.image} onChange={(e) => set('image', e.target.value)} placeholder="https://..." /></div>
            <div>
              <label htmlFor="cf_hidden">Hide from homepage?</label>
              <select id="cf_hidden" value={form.hidden ? '1' : '0'} onChange={(e) => set('hidden', e.target.value === '1')}>
                <option value="0">✅ Show (Published)</option>
                <option value="1">🚫 Hidden</option>
              </select>
            </div>
            <div>
              <label htmlFor="cf_age">Age restricted (18+)?</label>
              <select id="cf_age" value={form.ageRestricted ? '1' : '0'} onChange={(e) => set('ageRestricted', e.target.value === '1')}>
                <option value="0">No</option>
                <option value="1">🔞 Yes (18+)</option>
              </select>
            </div>
            <div className="full"><label htmlFor="cf_warning">Warning note (shown on this category page)</label><textarea id="cf_warning" value={form.warning} onChange={(e) => set('warning', e.target.value)} placeholder="e.g. Tobacco causes cancer. Sirf 18+ ke liye." /></div>
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
            <button type="button" onClick={save} disabled={busy} style={{ flex: 1, padding: 11, background: 'var(--primary)', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600 }}>
              💾 {busy ? 'Saving…' : `${form.id ? 'Update' : 'Add'} Category`}
            </button>
            <button type="button" onClick={() => setForm(null)} style={{ padding: '11px 20px', background: 'var(--gray)', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer' }}>Cancel</button>
          </div>
        </AdminModal>
      )}
    </>
  );
}
