import { useState } from 'react';
import { apiError } from '../../lib/api';
import { showToast } from '../../store/toast';
import { formatDate } from './adminData';
import { PosProduct, exportProductsXlsx, useBulkUpdate, useChangeLog, usePosProductSearch } from '../../lib/pos';

const money = (n: number) => `₹${Number(n).toFixed(2)}`;

/**
 * Inventory management (design §6.4) — search products, bulk-edit selling price
 * and stock (transactional server-side with change-log + stock movements), and
 * export the full inventory to Excel. Also surfaces the product change log so
 * the owner can audit every price/stock change.
 */
export default function AdminInventory() {
  const [search, setSearch] = useState('');
  const { data: results = [], isFetching } = usePosProductSearch(search);
  const bulk = useBulkUpdate();

  // Pending edits keyed by product id: { price?, stock? }.
  const [edits, setEdits] = useState<Record<number, { price?: string; stock?: string }>>({});
  const [exporting, setExporting] = useState(false);

  function setEdit(id: number, field: 'price' | 'stock', value: string) {
    setEdits((prev) => ({ ...prev, [id]: { ...prev[id], [field]: value } }));
  }

  async function saveEdits() {
    const priceUpdates: { id: number; value: number }[] = [];
    const stockUpdates: { id: number; value: number }[] = [];
    for (const [idStr, e] of Object.entries(edits)) {
      const id = Number(idStr);
      if (e.price != null && e.price.trim() !== '') priceUpdates.push({ id, value: Number(e.price) });
      if (e.stock != null && e.stock.trim() !== '') stockUpdates.push({ id, value: Number(e.stock) });
    }
    if (!priceUpdates.length && !stockUpdates.length) {
      return showToast('Change a price or stock value first.', 'error');
    }
    try {
      if (priceUpdates.length) {
        const r = await bulk.mutateAsync({ field: 'selling_price', updates: priceUpdates });
        showToast(r.message, 'success');
      }
      if (stockUpdates.length) {
        const r = await bulk.mutateAsync({ field: 'stock', updates: stockUpdates });
        showToast(r.message, 'success');
      }
      setEdits({});
    } catch (e) {
      showToast(apiError(e), 'error');
    }
  }

  async function doExport() {
    setExporting(true);
    try {
      await exportProductsXlsx();
    } catch (e) {
      showToast(apiError(e), 'error');
    } finally {
      setExporting(false);
    }
  }

  const dirty = Object.values(edits).some((e) => (e.price && e.price.trim()) || (e.stock && e.stock.trim()));

  return (
    <div>
      <div style={styles.toolbar}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="🔎 Search products by name, SKU or barcode"
          style={styles.search}
          aria-label="Search products"
        />
        <button type="button" onClick={doExport} disabled={exporting} style={styles.exportBtn}>
          {exporting ? '⏳ Exporting…' : '⬇️ Export Excel'}
        </button>
      </div>

      <div style={styles.card}>
        {search.trim() === '' ? (
          <p style={styles.hint}>Search for a product to edit its price or stock.</p>
        ) : isFetching && results.length === 0 ? (
          <p style={styles.hint}>Searching…</p>
        ) : results.length === 0 ? (
          <p style={styles.hint}>No matching products.</p>
        ) : (
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Product</th>
                <th style={{ ...styles.th, textAlign: 'right' }}>Current price</th>
                <th style={{ ...styles.th, textAlign: 'right' }}>New price</th>
                <th style={{ ...styles.th, textAlign: 'right' }}>Stock</th>
                <th style={{ ...styles.th, textAlign: 'right' }}>New stock</th>
              </tr>
            </thead>
            <tbody>
              {results.map((p: PosProduct) => (
                <tr key={p.id}>
                  <td style={styles.td}>
                    <strong>{p.name}</strong>
                    <div style={{ fontSize: 11, color: 'var(--gray)' }}>{p.sku ? `SKU ${p.sku}` : '—'} · {p.unit}</div>
                  </td>
                  <td style={{ ...styles.td, textAlign: 'right' }}>{money(p.price)}</td>
                  <td style={{ ...styles.td, textAlign: 'right' }}>
                    <input
                      type="number"
                      min={1}
                      step="0.01"
                      value={edits[p.id]?.price ?? ''}
                      placeholder={p.price.toFixed(2)}
                      onChange={(e) => setEdit(p.id, 'price', e.target.value)}
                      style={styles.cellInput}
                      aria-label={`New price for ${p.name}`}
                    />
                  </td>
                  <td style={{ ...styles.td, textAlign: 'right' }}>{p.stock}</td>
                  <td style={{ ...styles.td, textAlign: 'right' }}>
                    <input
                      type="number"
                      step="0.001"
                      value={edits[p.id]?.stock ?? ''}
                      placeholder={String(p.stock)}
                      onChange={(e) => setEdit(p.id, 'stock', e.target.value)}
                      style={styles.cellInput}
                      aria-label={`New stock for ${p.name}`}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {dirty && (
          <div style={{ marginTop: 12, display: 'flex', gap: 10 }}>
            <button type="button" onClick={saveEdits} disabled={bulk.isPending} style={styles.saveBtn}>
              {bulk.isPending ? '⏳ Saving…' : '💾 Save changes'}
            </button>
            <button type="button" onClick={() => setEdits({})} style={styles.linkBtn}>Discard</button>
          </div>
        )}
      </div>

      <ChangeLog />
    </div>
  );
}

function ChangeLog() {
  const { data, isLoading } = useChangeLog(undefined, 25);
  const entries = data?.entries ?? [];
  return (
    <div style={{ ...styles.card, marginTop: 16 }}>
      <h3 style={{ margin: '0 0 10px' }}>🧾 Recent changes</h3>
      {isLoading ? (
        <p style={styles.hint}>Loading…</p>
      ) : entries.length === 0 ? (
        <p style={styles.hint}>No changes logged yet.</p>
      ) : (
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>When</th>
              <th style={styles.th}>Product</th>
              <th style={styles.th}>Field</th>
              <th style={styles.th}>Old → New</th>
              <th style={styles.th}>By</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id}>
                <td style={styles.td}>{formatDate(e.created_at)}</td>
                <td style={styles.td}>#{e.product_id ?? '—'}</td>
                <td style={styles.td}>{e.field}</td>
                <td style={styles.td}>{e.old_val ?? '—'} → {e.new_val ?? '—'} <small style={{ color: 'var(--gray)' }}>({e.source})</small></td>
                <td style={styles.td}>{e.actor ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  toolbar: { display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 },
  search: { flex: '1 1 240px', padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 15 },
  exportBtn: { padding: '10px 16px', border: '1px solid var(--border)', borderRadius: 8, background: 'white', cursor: 'pointer', fontWeight: 600 },
  card: { background: 'white', border: '1px solid var(--border)', borderRadius: 12, padding: 14, boxShadow: 'var(--shadow)' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th: { textAlign: 'left', borderBottom: '2px solid var(--border)', padding: '7px 6px', color: 'var(--gray)', fontSize: 12 },
  td: { borderBottom: '1px solid #f0f0f0', padding: '7px 6px' },
  cellInput: { width: 90, padding: '6px 8px', border: '1px solid var(--border)', borderRadius: 6, textAlign: 'right' },
  saveBtn: { padding: '10px 18px', border: 0, borderRadius: 8, background: 'var(--primary)', color: 'white', fontWeight: 700, cursor: 'pointer' },
  linkBtn: { border: 0, background: 'none', color: 'var(--primary-dark)', cursor: 'pointer', fontSize: 13, fontWeight: 600 },
  hint: { padding: 20, textAlign: 'center', color: 'var(--gray)', margin: 0 },
};
