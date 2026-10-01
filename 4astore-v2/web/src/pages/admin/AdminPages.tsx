import { useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchAdminPages, savePage, deletePage, sanitizePageHtml, CmsPage, PagePayload } from '../../lib/pages';
import { apiError } from '../../lib/api';
import { showToast } from '../../store/toast';
import { showConfirm } from '../../store/confirm';
import { formatDate } from './adminData';
import AdminModal from './AdminModal';
import '../legal.css';

type Form = PagePayload;

const slugify = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
const blank = (order: number): Form => ({
  slug: '', title: '', metaDescription: '', content: '<div class="legal-card">\n  <h1>Title</h1>\n  <p>Write here…</p>\n</div>',
  showInFooter: true, published: true, sortOrder: order,
});
// Pages Google Play / users rely on — deleting them needs an extra warning.
const IMPORTANT = ['privacy-policy', 'account-deletion', 'terms'];

// Small toolbar: wraps the selection (or inserts a snippet) in the HTML textarea.
const SNIPPETS: [string, string, string][] = [
  ['H1', '<h1>', '</h1>'],
  ['H2', '<h2>', '</h2>'],
  ['P', '<p>', '</p>'],
  ['B', '<strong>', '</strong>'],
  ['• List', '<ul>\n  <li>', '</li>\n</ul>'],
  ['🔗 Link', '<a href="https://">', '</a>'],
  ['📞 Call', '<a href="tel:8210874123">', '</a>'],
  ['▭ Card', '<div class="legal-card">\n', '\n</div>'],
];

function PageEditor({ initial, onClose, onSaved }: { initial: Form; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<Form>(initial);
  const [slugTouched, setSlugTouched] = useState(!!initial.id);
  const [tab, setTab] = useState<'edit' | 'preview'>('edit');
  const [busy, setBusy] = useState(false);
  const ta = useRef<HTMLTextAreaElement | null>(null);
  const preview = useMemo(() => sanitizePageHtml(f.content), [f.content]);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((s) => ({ ...s, [k]: v }));

  function wrap(open: string, close: string) {
    const el = ta.current;
    if (!el) return;
    const { selectionStart: a, selectionEnd: b, value } = el;
    const next = value.slice(0, a) + open + value.slice(a, b) + close + value.slice(b);
    set('content', next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(a + open.length, b + open.length);
    });
  }

  async function save() {
    const payload = { ...f, title: f.title.trim(), slug: (f.slug || slugify(f.title)).trim(), metaDescription: (f.metaDescription || '').trim() };
    if (!payload.title) return showToast('Title is required', 'error');
    if (!payload.slug) return showToast('Slug is required (a-z, 0-9, -)', 'error');
    setBusy(true);
    try {
      await savePage(f.id ? 'update' : 'add', payload);
      showToast(f.id ? 'Page updated' : 'Page added', 'success');
      onSaved();
      onClose();
    } catch (e) {
      showToast(apiError(e) || 'Failed to save page', 'error');
    } finally {
      setBusy(false);
    }
  }

  const pill = (active: boolean): React.CSSProperties => ({
    padding: '7px 14px', borderRadius: 20, cursor: 'pointer', fontSize: 12, fontWeight: 600,
    border: `1px solid ${active ? 'var(--primary)' : 'var(--border)'}`, background: active ? 'var(--primary)' : '#fff', color: active ? '#fff' : 'var(--primary-dark)',
  });

  return (
    <AdminModal onClose={onClose} maxWidth={900}>
      <h3 style={{ color: 'var(--primary)', marginBottom: 16 }}>{f.id ? '✏️ Edit Page' : '➕ Add Page'}</h3>
      <div className="prod-form-grid">
        <div>
          <label htmlFor="pg_title">Title *</label>
          <input id="pg_title" value={f.title} placeholder="e.g. Privacy Policy"
            onChange={(e) => { set('title', e.target.value); if (!slugTouched) set('slug', slugify(e.target.value)); }} />
        </div>
        <div>
          <label htmlFor="pg_slug">Slug (URL) *</label>
          <input id="pg_slug" value={f.slug} placeholder="privacy-policy" onChange={(e) => { setSlugTouched(true); set('slug', e.target.value.toLowerCase()); }} />
          <small style={{ color: 'var(--gray)', fontSize: 11 }}>Page URL: /page/{f.slug || '…'}</small>
        </div>
        <div className="full">
          <label htmlFor="pg_meta">Meta description (Google / share preview)</label>
          <input id="pg_meta" value={f.metaDescription} maxLength={300} onChange={(e) => set('metaDescription', e.target.value)} />
        </div>
        <div>
          <label htmlFor="pg_pub">Status</label>
          <select id="pg_pub" value={f.published ? '1' : '0'} onChange={(e) => set('published', e.target.value === '1')}>
            <option value="1">✅ Published</option>
            <option value="0">🚫 Hidden (draft)</option>
          </select>
        </div>
        <div>
          <label htmlFor="pg_footer">Footer me dikhana hai?</label>
          <select id="pg_footer" value={f.showInFooter ? '1' : '0'} onChange={(e) => set('showInFooter', e.target.value === '1')}>
            <option value="1">Yes — Legal &amp; Support me</option>
            <option value="0">No</option>
          </select>
        </div>
        <div>
          <label htmlFor="pg_order">Order (footer)</label>
          <input id="pg_order" type="number" min={0} value={f.sortOrder} onChange={(e) => set('sortOrder', Math.max(0, Number(e.target.value) || 0))} />
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, margin: '16px 0 8px', alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="button" style={pill(tab === 'edit')} onClick={() => setTab('edit')}>✍️ Edit HTML</button>
        <button type="button" style={pill(tab === 'preview')} onClick={() => setTab('preview')}>👁️ Preview</button>
        {tab === 'edit' && (
          <span style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginLeft: 'auto' }}>
            {SNIPPETS.map(([label, open, close]) => (
              <button key={label} type="button" className="ad-mini" onClick={() => wrap(open, close)}>{label}</button>
            ))}
          </span>
        )}
      </div>

      {tab === 'edit' ? (
        <textarea ref={ta} value={f.content} onChange={(e) => set('content', e.target.value)} aria-label="Page content (HTML)" spellCheck={false}
          style={{ width: '100%', minHeight: 340, padding: 12, border: '1px solid var(--border)', borderRadius: 8, fontFamily: 'Consolas, monospace', fontSize: 12.5, lineHeight: 1.5, boxSizing: 'border-box', resize: 'vertical' }} />
      ) : (
        <div style={{ background: 'var(--light, #f5f7fa)', borderRadius: 10, maxHeight: 460, overflowY: 'auto', border: '1px solid var(--border)' }}>
          <div className="legal-wrap" style={{ margin: 0, padding: 14 }}>
            <div className="legal-body" dangerouslySetInnerHTML={{ __html: preview }} />
          </div>
        </div>
      )}
      <p style={{ fontSize: 11, color: 'var(--gray)', marginTop: 6 }}>
        HTML allowed: headings, paragraphs, lists, links, bold, images, <code>class="legal-card"</code>. Scripts/iframes/forms are removed automatically for safety.
      </p>

      <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
        <button type="button" onClick={save} disabled={busy} style={{ flex: 1, padding: 11, background: 'var(--primary)', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600 }}>
          💾 {busy ? 'Saving…' : f.id ? 'Update Page' : 'Add Page'}
        </button>
        <button type="button" onClick={onClose} style={{ padding: '11px 20px', background: 'var(--gray)', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer' }}>Cancel</button>
      </div>
    </AdminModal>
  );
}

// Admin → Pages: the footer "Legal & Support" pages, stored in MySQL (`pages`).
export default function AdminPages() {
  const qc = useQueryClient();
  const { data: pages = [], isLoading, error } = useQuery({ queryKey: ['admin-pages'], queryFn: fetchAdminPages });
  const [edit, setEdit] = useState<Form | null>(null);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['admin-pages'] });
    qc.invalidateQueries({ queryKey: ['pages'] });
    qc.invalidateQueries({ queryKey: ['page'] });
  };

  async function toggle(p: CmsPage, field: 'published' | 'showInFooter') {
    try {
      await savePage('update', { ...p, [field]: !p[field] });
      showToast('Page updated', 'success');
      refresh();
    } catch (e) {
      showToast(apiError(e) || 'Failed to update', 'error');
    }
  }

  async function remove(p: CmsPage) {
    const extra = IMPORTANT.includes(p.slug) ? '\n\n⚠️ Ye page Play Store / legal ke liye zaroori hai. Delete ki jagah "Hidden" karna behtar hai.' : '';
    const ok = await showConfirm(`Delete page "${p.title}" (/page/${p.slug})?${extra}`, { title: 'Delete page', confirmText: 'Delete', danger: true });
    if (!ok) return;
    try {
      await deletePage(p.id);
      showToast('Page deleted', 'success');
      refresh();
    } catch (e) {
      showToast(apiError(e) || 'Failed to delete', 'error');
    }
  }

  if (isLoading) return <p style={{ textAlign: 'center', padding: 30, color: 'var(--gray)' }}>Loading pages...</p>;
  if (error) return <p style={{ color: '#c62828' }}>{apiError(error)}</p>;

  const btn = (bg: string): React.CSSProperties => ({ padding: '5px 9px', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12, background: bg, color: 'white', marginRight: 4 });

  return (
    <>
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <p style={{ fontSize: 13, color: 'var(--gray)' }}>
          <strong>{pages.length}</strong> pages · Footer ke <strong>Legal &amp; Support</strong> links yahin se aate hain (database se, static nahi).
        </p>
        <button type="button" className="btn-add-product" onClick={() => setEdit(blank((pages[pages.length - 1]?.sortOrder ?? 0) + 1))}>➕ Add Page</button>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table className="admin-table">
          <thead><tr><th>Order</th><th>Title / URL</th><th>Footer</th><th>Status</th><th>Updated</th><th>Action</th></tr></thead>
          <tbody>
            {pages.length ? pages.map((p) => (
              <tr key={p.id}>
                <td>{p.sortOrder}</td>
                <td><strong>{p.title}</strong><div style={{ fontSize: 11, color: 'var(--gray)' }}>/page/{p.slug}</div></td>
                <td>
                  <button type="button" onClick={() => toggle(p, 'showInFooter')} style={btn(p.showInFooter ? '#059669' : '#9ca3af')} title="Toggle footer link">
                    {p.showInFooter ? '✅ Shown' : '— Hidden'}
                  </button>
                </td>
                <td>
                  <button type="button" onClick={() => toggle(p, 'published')} style={btn(p.published ? '#059669' : '#f59e0b')} title="Publish / hide">
                    {p.published ? '📢 Published' : '🙈 Draft'}
                  </button>
                </td>
                <td style={{ fontSize: 12 }}>{formatDate(p.updatedAt)}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button type="button" onClick={() => setEdit({ ...p })} style={btn('var(--primary)')}>✏️ Edit</button>
                  <a href={`/page/${p.slug}`} target="_blank" rel="noopener noreferrer" style={{ ...btn('#0891b2'), textDecoration: 'none', display: 'inline-block' }}>👁️ View</a>
                  <button type="button" onClick={() => remove(p)} aria-label={`Delete ${p.title}`} style={btn('#dc2626')}>🗑️</button>
                </td>
              </tr>
            )) : (
              <tr><td colSpan={6} style={{ textAlign: 'center', padding: 20, color: 'var(--gray)' }}>No pages yet — "➕ Add Page" se banao.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {edit && <PageEditor initial={edit} onClose={() => setEdit(null)} onSaved={refresh} />}
    </>
  );
}
