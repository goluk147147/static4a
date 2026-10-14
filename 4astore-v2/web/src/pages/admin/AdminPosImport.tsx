import { useRef, useState } from 'react';
import { apiError } from '../../lib/api';
import { showToast } from '../../store/toast';
import { formatDate } from './adminData';
import { ImportPreview, useImportCommit, useImportHistory, useImportPreview } from '../../lib/pos';

// Canonical import columns (keep in sync with services/excelImport.ts IMPORT_HEADERS).
const COLUMNS = ['name', 'sku', 'barcode', 'category', 'purchase_price', 'selling_price', 'stock', 'unit', 'tax_rate', 'low_stock_threshold'] as const;

/**
 * Excel import (design §6.1) — upload an .xlsx/.csv, preview the row-wise
 * insert/update/error classification (NO write), fix errors in the source file
 * and re-upload, then commit. The server re-validates on commit and upserts in
 * one transaction, so this screen only drives the preview → commit flow.
 */
export default function AdminPosImport() {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [fileName, setFileName] = useState('');
  const previewMut = useImportPreview();
  const commitMut = useImportCommit();

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setPreview(null);
    try {
      const result = await previewMut.mutateAsync(file);
      setPreview(result);
      if (result.summary.error > 0) {
        showToast(`${result.summary.error} row(s) have errors — fix and re-upload.`, 'error');
      } else {
        showToast(`Previewed ${result.summary.total} rows — ready to import.`, 'success');
      }
    } catch (err) {
      showToast(apiError(err), 'error');
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function commit() {
    if (!preview) return;
    if (preview.summary.error > 0) {
      return showToast('Cannot import while rows have errors. Fix the file and re-upload.', 'error');
    }
    try {
      const rows = preview.rows
        .filter((r) => r.action !== 'error')
        .map((r) => ({ rowNum: r.rowNum, data: r.data }));
      const res = await commitMut.mutateAsync({ batchPreviewId: preview.batchPreviewId, rows });
      showToast(`✅ Imported — ${res.summary.insert} new, ${res.summary.update} updated.`, 'success');
      setPreview(null);
      setFileName('');
    } catch (e) {
      showToast(apiError(e), 'error');
    }
  }

  const summary = preview?.summary;

  return (
    <div>
      <div style={styles.card}>
        <h3 style={{ margin: '0 0 6px' }}>⬆️ Import products from Excel</h3>
        <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--gray)' }}>
          Upload an .xlsx or .csv with columns: {COLUMNS.join(', ')}. Existing products (matched by SKU, barcode or name) are updated; new ones are inserted. Nothing is saved until you press Import.
        </p>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <input ref={fileRef} type="file" accept=".xlsx,.csv" onChange={onFile} aria-label="Choose Excel or CSV file" />
          {previewMut.isPending && <span style={{ color: 'var(--gray)', fontSize: 13 }}>Reading {fileName}…</span>}
        </div>
        {preview && preview.unknownHeaders.length > 0 && (
          <p style={{ marginTop: 10, fontSize: 12, color: '#b96500' }}>
            Ignored unknown columns: {preview.unknownHeaders.join(', ')}
          </p>
        )}
      </div>

      {summary && (
        <div style={{ ...styles.card, marginTop: 14 }}>
          <div style={styles.summaryBar}>
            <Badge label="Total" value={summary.total} color="#555" />
            <Badge label="New" value={summary.insert} color="#087a3d" />
            <Badge label="Update" value={summary.update} color="#2C6FAD" />
            <Badge label="Errors" value={summary.error} color="#c62828" />
            <button
              type="button"
              onClick={commit}
              disabled={commitMut.isPending || summary.error > 0}
              style={{ ...styles.importBtn, ...(summary.error > 0 ? styles.importBtnDisabled : {}) }}
            >
              {commitMut.isPending ? '⏳ Importing…' : '✅ Import now'}
            </button>
          </div>

          <div style={{ overflowX: 'auto', marginTop: 12 }}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Row</th>
                  <th style={styles.th}>Action</th>
                  {COLUMNS.map((c) => (
                    <th key={c} style={styles.th}>{c}</th>
                  ))}
                  <th style={styles.th}>Errors</th>
                </tr>
              </thead>
              <tbody>
                {preview!.rows.map((r) => (
                  <tr key={r.rowNum} style={r.action === 'error' ? { background: '#fdecea' } : undefined}>
                    <td style={styles.td}>{r.rowNum}</td>
                    <td style={styles.td}>
                      <span style={{ ...styles.actionChip, ...actionStyle(r.action) }}>{r.action}</span>
                    </td>
                    {COLUMNS.map((c) => (
                      <td key={c} style={styles.td}>{String((r.data as Record<string, unknown>)[c] ?? '')}</td>
                    ))}
                    <td style={{ ...styles.td, color: '#c62828', fontSize: 12 }}>{r.errors.join('; ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <ImportHistory />
    </div>
  );
}

function Badge({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', padding: '4px 12px', borderRadius: 8, background: `${color}14`, color }}>
      <strong style={{ fontSize: 18 }}>{value}</strong>
      <small>{label}</small>
    </span>
  );
}

function actionStyle(action: string): React.CSSProperties {
  if (action === 'insert') return { background: '#e8f5e9', color: '#087a3d' };
  if (action === 'update') return { background: '#e0f2fe', color: '#2C6FAD' };
  return { background: '#fdecea', color: '#c62828' };
}

function ImportHistory() {
  const { data, isLoading } = useImportHistory(10);
  const batches = data?.batches ?? [];
  return (
    <div style={{ ...styles.card, marginTop: 16 }}>
      <h3 style={{ margin: '0 0 10px' }}>📜 Import history</h3>
      {isLoading ? (
        <p style={styles.hint}>Loading…</p>
      ) : batches.length === 0 ? (
        <p style={styles.hint}>No imports yet.</p>
      ) : (
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>When</th>
              <th style={styles.th}>File</th>
              <th style={styles.th}>Status</th>
              <th style={{ ...styles.th, textAlign: 'right' }}>Rows</th>
              <th style={{ ...styles.th, textAlign: 'right' }}>New / Upd / Err</th>
              <th style={styles.th}>By</th>
            </tr>
          </thead>
          <tbody>
            {batches.map((b) => (
              <tr key={b.id}>
                <td style={styles.td}>{formatDate(b.created_at)}</td>
                <td style={styles.td}>{b.filename}</td>
                <td style={styles.td}>{b.status}</td>
                <td style={{ ...styles.td, textAlign: 'right' }}>{b.total_rows}</td>
                <td style={{ ...styles.td, textAlign: 'right' }}>{b.inserted} / {b.updated} / {b.errors}</td>
                <td style={styles.td}>{b.created_by ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  card: { background: 'white', border: '1px solid var(--border)', borderRadius: 12, padding: 14, boxShadow: 'var(--shadow)' },
  summaryBar: { display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' },
  importBtn: { marginLeft: 'auto', padding: '10px 18px', border: 0, borderRadius: 8, background: 'var(--primary)', color: 'white', fontWeight: 700, cursor: 'pointer' },
  importBtnDisabled: { background: '#ccc', cursor: 'not-allowed' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 12 },
  th: { textAlign: 'left', borderBottom: '2px solid var(--border)', padding: '6px 6px', color: 'var(--gray)', whiteSpace: 'nowrap' },
  td: { borderBottom: '1px solid #f0f0f0', padding: '6px 6px', whiteSpace: 'nowrap' },
  actionChip: { padding: '2px 8px', borderRadius: 12, fontSize: 11, fontWeight: 700, textTransform: 'capitalize' },
  hint: { padding: 20, textAlign: 'center', color: 'var(--gray)', margin: 0 },
};
