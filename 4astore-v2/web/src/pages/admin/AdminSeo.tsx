// Automatic SEO engine dashboard (design §8, capability 13).
//
// REAL DATA ONLY: every counter is sourced from GET /api/admin/seo-auto/dashboard.
// PHASE-2 metrics (broken links, Core Web Vitals, organic performance/GSC) render an
// explicit "not available yet" / "connect GA4" / "not connected" state — never a
// placeholder number. Four actions (Optimize All Eligible / Optimize Selected / Run
// Full Audit / Rollback Last Changes) each post to their endpoint and poll the returned
// job. Bilingual Hindi/English copy matching the existing admin.

import { useMemo, useState } from 'react';
import {
  useSeoDashboard,
  useSeoJob,
  useOptimize,
  useRunAudit,
  useRollback,
  listSeoProducts,
} from '../../lib/seoAdmin';
import { apiError } from '../../lib/api';
import { showToast } from '../../store/toast';
import type {
  SeoDashboard,
  SeoIntegrationStatus,
  SeoJobView,
  SeoProductRow,
  SeoUnavailable,
} from '../../types';

const card: React.CSSProperties = {
  background: '#fff',
  border: '1px solid var(--border)',
  borderRadius: 12,
  padding: 16,
  marginBottom: 18,
};

const grid: React.CSSProperties = {
  display: 'grid',
  gap: 12,
  gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))',
};

const btn = (bg = 'var(--primary)'): React.CSSProperties => ({
  padding: '10px 18px',
  background: bg,
  color: 'white',
  border: 'none',
  borderRadius: 8,
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer',
});

const hint: React.CSSProperties = { fontSize: 12, color: 'var(--gray)', marginTop: 4 };

function StatCard({ label, value, tone }: { label: string; value: React.ReactNode; tone?: string }) {
  return (
    <div style={{ background: '#fafafa', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 14px' }}>
      <div style={{ fontSize: 22, fontWeight: 700, color: tone || 'var(--primary-dark)' }}>{value}</div>
      <div style={{ fontSize: 12, color: 'var(--gray)', marginTop: 2 }}>{label}</div>
    </div>
  );
}

/** PHASE-2 metric: always an explicit, non-numeric unavailable state. */
function PhaseTwoCard({ label, state, note }: { label: string; state: SeoUnavailable; note: string }) {
  const text = state === 'not_connected' ? 'Not connected' : 'Not available yet';
  return (
    <div style={{ background: '#f6f6f6', border: '1px dashed var(--border)', borderRadius: 10, padding: '12px 14px' }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--gray)' }}>⏳ {text}</div>
      <div style={{ fontSize: 12, color: 'var(--gray)', marginTop: 2 }}>{label}</div>
      <div style={{ fontSize: 11, color: '#999', marginTop: 4 }}>{note}</div>
    </div>
  );
}

function JobProgress({ job }: { job: SeoJobView }) {
  const terminal = job.status === 'done' || job.status === 'failed' || job.status === 'cancelled';
  const tone = job.status === 'failed' ? '#c62828' : job.status === 'done' ? '#2e7d32' : 'var(--primary)';
  return (
    <div style={{ marginTop: 12, padding: 12, background: '#fafafa', border: '1px solid var(--border)', borderRadius: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, fontWeight: 600, color: tone }}>
        <span>#{job.id} · {job.type} · {job.status}</span>
        <span>{job.progress}%</span>
      </div>
      <div style={{ height: 8, background: '#eee', borderRadius: 4, marginTop: 6, overflow: 'hidden' }}>
        <div style={{ width: `${Math.min(100, Math.max(0, job.progress))}%`, height: '100%', background: tone, transition: 'width .3s' }} />
      </div>
      <div style={{ fontSize: 12, color: 'var(--gray)', marginTop: 6 }}>
        {job.processed}/{job.total} processed · {job.updated} updated · {job.skipped} skipped · {job.failed} failed
      </div>
      {terminal && job.error && <div style={{ fontSize: 12, color: '#c62828', marginTop: 4 }}>{job.error}</div>}
    </div>
  );
}

function IntegrationRow({ it }: { it: SeoIntegrationStatus }) {
  const connected = it.status === 'connected';
  const tone = it.status === 'error' ? '#c62828' : connected ? '#2e7d32' : 'var(--gray)';
  const name = it.provider.toUpperCase();
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #f0f0f0' }}>
      <div>
        <strong style={{ fontSize: 13 }}>{name}</strong>
        <div style={{ fontSize: 12, color: 'var(--gray)' }}>{it.message}</div>
      </div>
      <span style={{ fontSize: 12, fontWeight: 700, color: tone }}>
        {connected ? '● Connected' : it.status === 'error' ? '● Error' : '○ Not connected'}
      </span>
    </div>
  );
}

export default function AdminSeo() {
  const dash = useSeoDashboard();
  const optimizeMut = useOptimize();
  const auditMut = useRunAudit();
  const rollbackMut = useRollback();

  // The job returned by the most recent action; polled until terminal.
  const [activeJobId, setActiveJobId] = useState<number | null>(null);
  const jobQ = useSeoJob(activeJobId);

  const [selectedIds, setSelectedIds] = useState<string>('');

  const d: SeoDashboard | undefined = dash.data;

  const parsedSelected = useMemo(
    () =>
      selectedIds
        .split(/[\s,]+/)
        .map((x) => Number(x.trim()))
        .filter((n) => Number.isInteger(n) && n > 0),
    [selectedIds],
  );

  const busy = optimizeMut.isPending || auditMut.isPending || rollbackMut.isPending;

  async function optimizeAll() {
    try {
      const { jobId } = await optimizeMut.mutateAsync({ mode: 'all' });
      setActiveJobId(jobId);
      showToast('Optimizing all eligible products… / सभी eligible products ऑप्टिमाइज़ हो रहे हैं', 'success');
    } catch (e) {
      showToast(apiError(e), 'error');
    }
  }

  async function optimizeSelected() {
    if (parsedSelected.length === 0) {
      showToast('Enter product IDs first / पहले product IDs डालें', 'error');
      return;
    }
    try {
      const { jobId } = await optimizeMut.mutateAsync({ mode: 'selected', productIds: parsedSelected });
      setActiveJobId(jobId);
      showToast(`Optimizing ${parsedSelected.length} products…`, 'success');
    } catch (e) {
      showToast(apiError(e), 'error');
    }
  }

  async function runFullAudit() {
    try {
      const { jobId } = await auditMut.mutateAsync();
      setActiveJobId(jobId);
      showToast('Full audit started / पूरा ऑडिट शुरू', 'success');
    } catch (e) {
      showToast(apiError(e), 'error');
    }
  }

  async function rollbackLast() {
    try {
      const res = await rollbackMut.mutateAsync(undefined);
      showToast(`Rolled back ${res.restored} change(s) / वापस किया`, 'success');
      dash.refetch();
    } catch (e) {
      showToast(apiError(e), 'error');
    }
  }

  /** Convenience: load the IDs of products needing attention into the selected box. */
  async function fillNeedsAttention() {
    try {
      const page = await listSeoProducts({ filter: 'needs-attention', limit: 100 });
      const ids = page.products.map((p: SeoProductRow) => p.id);
      if (!ids.length) {
        showToast('No products need attention / कोई product attention नहीं चाहिए', 'success');
        return;
      }
      setSelectedIds(ids.join(', '));
      showToast(`${ids.length} products loaded into selection`, 'success');
    } catch (e) {
      showToast(apiError(e), 'error');
    }
  }

  if (dash.isLoading) return <p style={{ color: 'var(--gray)' }}>Loading SEO dashboard… / एसईओ डैशबोर्ड लोड हो रहा है…</p>;
  if (dash.isError || !d)
    return (
      <div style={card}>
        <p style={{ color: '#c62828' }}>Dashboard load failed / डैशबोर्ड लोड नहीं हुआ. {dash.error ? apiError(dash.error) : ''}</p>
        <button type="button" style={btn()} onClick={() => dash.refetch()}>🔄 Retry</button>
      </div>
    );

  const c = d.counters;
  const activeJob = jobQ.data;

  return (
    <div>
      <h4 style={{ marginBottom: 6 }}>🔍 Auto SEO Engine / ऑटो एसईओ इंजन</h4>
      <p style={{ fontSize: 13, color: 'var(--gray)', marginBottom: 16, maxWidth: 640 }}>
        Automatic SEO sabhi products aur categories ke liye real data se banta hai — koi manual typing nahi.
        Yahan se optimize, audit aur rollback chalayein. All counters live data se aate hain.
      </p>

      {/* ---- Action buttons ---- */}
      <div style={card}>
        <strong style={{ fontSize: 14, color: 'var(--primary-dark)' }}>⚡ Actions</strong>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 12 }}>
          <button type="button" style={btn()} disabled={busy} onClick={optimizeAll}>
            🚀 Optimize All Eligible / सभी ऑप्टिमाइज़ करें
          </button>
          <button type="button" style={btn('var(--secondary)')} disabled={busy} onClick={optimizeSelected}>
            🎯 Optimize Selected / चुने हुए ऑप्टिमाइज़ करें
          </button>
          <button type="button" style={btn('#455a64')} disabled={busy} onClick={runFullAudit}>
            🧪 Run Full Audit / पूरा ऑडिट चलाएँ
          </button>
          <button type="button" style={btn('#c62828')} disabled={busy} onClick={rollbackLast}>
            ↩️ Rollback Last Changes / आखिरी बदलाव वापस करें
          </button>
        </div>
        <div style={{ marginTop: 12, maxWidth: 520 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--primary-dark)' }} htmlFor="seo_sel_ids">
            Selected product IDs (comma/space se alag)
          </label>
          <input
            id="seo_sel_ids"
            value={selectedIds}
            onChange={(e) => setSelectedIds(e.target.value)}
            placeholder="e.g. 12, 48, 103"
            style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 8, marginTop: 4 }}
          />
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 6 }}>
            <button
              type="button"
              onClick={fillNeedsAttention}
              style={{ background: 'none', border: 'none', color: 'var(--primary)', fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: 0 }}
            >
              ⬇️ Load products needing attention
            </button>
            <span style={hint}>{parsedSelected.length} valid IDs</span>
          </div>
        </div>
        {activeJob && <JobProgress job={activeJob} />}
      </div>

      {/* ---- Product counters (real data) ---- */}
      <div style={card}>
        <strong style={{ fontSize: 14, color: 'var(--primary-dark)' }}>📦 Products (attention threshold {d.attentionThreshold})</strong>
        <div style={{ ...grid, marginTop: 12 }}>
          <StatCard label="Total products / कुल" value={c.products.total} />
          <StatCard label="Optimized / ऑप्टिमाइज़्ड" value={c.products.optimized} tone="#2e7d32" />
          <StatCard label="Needing attention / ध्यान चाहिए" value={c.products.needingAttention} tone="#ef6c00" />
          <StatCard label="With problems / समस्याएँ" value={c.products.withProblems} tone="#c62828" />
          <StatCard label="Missing metadata / मेटाडेटा नहीं" value={c.products.missingMetadata} tone="#c62828" />
        </div>
      </div>

      {/* ---- Category counters (real data) ---- */}
      <div style={card}>
        <strong style={{ fontSize: 14, color: 'var(--primary-dark)' }}>🗂️ Categories</strong>
        <div style={{ ...grid, marginTop: 12 }}>
          <StatCard label="Total categories / कुल" value={c.categories.total} />
          <StatCard label="Optimized / ऑप्टिमाइज़्ड" value={c.categories.optimized} tone="#2e7d32" />
          <StatCard label="Needing attention / ध्यान चाहिए" value={c.categories.needingAttention} tone="#ef6c00" />
        </div>
      </div>

      {/* ---- Metadata health (duplicates) ---- */}
      <div style={card}>
        <strong style={{ fontSize: 14, color: 'var(--primary-dark)' }}>🧬 Duplicate metadata</strong>
        <div style={{ ...grid, marginTop: 12 }}>
          <StatCard label="Duplicate titles / डुप्लिकेट टाइटल" value={c.duplicates.titles} tone={c.duplicates.titles ? '#c62828' : '#2e7d32'} />
          <StatCard label="Duplicate descriptions / डुप्लिकेट डिस्क्रिप्शन" value={c.duplicates.descriptions} tone={c.duplicates.descriptions ? '#c62828' : '#2e7d32'} />
          <StatCard label="Duplicate slugs / डुप्लिकेट स्लग" value={c.duplicates.slugs} tone={c.duplicates.slugs ? '#c62828' : '#2e7d32'} />
        </div>
      </div>

      {/* ---- PHASE-2 metrics: explicit unavailable / not-connected states ---- */}
      <div style={card}>
        <strong style={{ fontSize: 14, color: 'var(--primary-dark)' }}>📈 Advanced metrics (PHASE-2)</strong>
        <div style={{ ...grid, marginTop: 12 }}>
          <PhaseTwoCard label="Broken links / टूटे लिंक" state={c.brokenLinks} note="Site crawler aayega — abhi available nahi." />
          <PhaseTwoCard label="Core Web Vitals" state={c.coreWebVitals} note="Connect GA4 to enable." />
          <PhaseTwoCard label="Organic performance / ऑर्गैनिक" state={c.organicPerformance} note="Connect Search Console to enable." />
        </div>
      </div>

      {/* ---- Integrations ---- */}
      <div style={card}>
        <strong style={{ fontSize: 14, color: 'var(--primary-dark)' }}>🔌 Integrations</strong>
        <div style={{ marginTop: 8 }}>
          {d.integrations.length === 0 ? (
            <p style={hint}>No integrations reported.</p>
          ) : (
            d.integrations.map((it) => <IntegrationRow key={it.provider} it={it} />)
          )}
        </div>
      </div>

      {/* ---- Background jobs ---- */}
      <div style={card}>
        <strong style={{ fontSize: 14, color: 'var(--primary-dark)' }}>⏱️ Background jobs</strong>
        <div style={{ marginTop: 8 }}>
          {d.jobs.length === 0 ? (
            <p style={hint}>No jobs yet / अभी कोई job नहीं.</p>
          ) : (
            d.jobs.map((j) => (
              <div key={j.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '6px 0', borderBottom: '1px solid #f0f0f0' }}>
                <span>#{j.id} · {j.type}</span>
                <span style={{ color: j.status === 'failed' ? '#c62828' : j.status === 'done' ? '#2e7d32' : 'var(--primary)' }}>
                  {j.status} · {j.progress}% · {j.updated} updated
                </span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* ---- Recent automatic changes (seo_audit_log) ---- */}
      <div style={card}>
        <strong style={{ fontSize: 14, color: 'var(--primary-dark)' }}>📝 Recent automatic changes</strong>
        <div style={{ marginTop: 8 }}>
          {d.recentChanges.length === 0 ? (
            <p style={hint}>No recent changes / अभी कोई बदलाव नहीं.</p>
          ) : (
            d.recentChanges.map((r, i) => (
              <div key={`${r.entityType}-${r.entityId}-${i}`} style={{ fontSize: 12, padding: '6px 0', borderBottom: '1px solid #f0f0f0' }}>
                <span style={{ fontWeight: 600 }}>{r.action}</span>{' '}
                <span style={{ color: 'var(--gray)' }}>
                  {r.entityType} #{r.entityId}{r.field ? ` · ${r.field}` : ''}{r.actor ? ` · ${r.actor}` : ''}
                </span>
                <span style={{ float: 'right', color: '#aaa' }}>{new Date(r.at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                {r.reason && <div style={{ color: '#999' }}>{r.reason}</div>}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
