import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { useSettings } from '../../lib/queries';
import { useAdminOrders } from './adminData';
import AdminModal from './AdminModal';

interface TrackingRow {
  order_id: string;
  status?: string | null;
  rider_name?: string | null;
  rider_mobile?: string | null;
  lat?: number | null;
  lng?: number | null;
  updated_at?: string | null;
}

const hasLoc = (t: TrackingRow) => t.lat != null && t.lng != null && Number.isFinite(Number(t.lat)) && Number.isFinite(Number(t.lng));

// Port of the original renderRiderTrackingTab() / loadRiderTrackingData().
export default function AdminRiderTracking() {
  const settings = useSettings().data;
  const { data: orders = [] } = useAdminOrders();
  const [detail, setDetail] = useState<TrackingRow | null>(null);
  const { data: all = [], isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['admin-tracking'],
    refetchInterval: 15000,
    queryFn: async () => (await api.get('/tracking')).data.all as TrackingRow[],
  });

  const origin = `${settings?.storeLatitude ?? 24.580164},${settings?.storeLongitude ?? 84.114194}`;
  const mapsUrl = (t: TrackingRow) =>
    `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(`${t.lat},${t.lng}`)}&travelmode=driving`;
  const orderById = new Map(orders.map((o) => [o.order_id, o]));

  if (isLoading) return <p style={{ textAlign: 'center', padding: 30, color: 'var(--gray)' }}>Loading rider locations...</p>;
  if (isError) return <div style={{ padding: 30, textAlign: 'center', color: '#c62828' }}>Rider locations load nahi hui. {(error as Error)?.message}</div>;

  const rows = all.filter((t) => t && (t.rider_name || t.rider_mobile || hasLoc(t)));
  const active = rows.filter((t) => !['Delivered', 'Cancelled'].includes(String(t.status)));
  const display = active.length ? active : rows;

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
        <div>
          <h3 style={{ margin: 0, color: 'var(--primary-dark)' }}>📍 Rider Live Locations</h3>
          <p style={{ margin: '4px 0 0', color: 'var(--gray)', fontSize: 12 }}>{active.length} active rider{active.length === 1 ? '' : 's'} · Auto-refresh every 15 seconds</p>
        </div>
        <button type="button" onClick={() => refetch()} disabled={isFetching} style={{ padding: '8px 12px', background: '#eef5f8', color: '#17627a', border: '1px solid #cfe5ed', borderRadius: 7, cursor: 'pointer', fontWeight: 700 }}>
          {isFetching ? '↻ Refreshing…' : '↻ Refresh'}
        </button>
      </div>

      {display.length ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(270px,1fr))', gap: 14 }}>
          {display.map((t) => {
            const order = orderById.get(t.order_id);
            const age = t.updated_at ? Math.floor((Date.now() - new Date(t.updated_at).getTime()) / 60000) : null;
            const freshness = age === null ? 'No update time' : age <= 2 ? 'Live now' : `${age} min ago`;
            const tone = age !== null && age <= 2 ? '#2e7d32' : '#ef6c00';
            return (
              <div key={t.order_id} style={{ background: '#fff', border: '1px solid var(--border)', borderLeft: `4px solid ${tone}`, borderRadius: 12, padding: 15, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
                  <div>
                    <strong style={{ fontSize: 16, color: 'var(--primary-dark)' }}>🛵 {t.rider_name || 'Unnamed rider'}</strong>
                    <div style={{ fontSize: 12, color: 'var(--gray)', marginTop: 3 }}>Order #{t.order_id}</div>
                  </div>
                  <span style={{ padding: '4px 8px', borderRadius: 12, background: `${tone}18`, color: tone, fontSize: 11, fontWeight: 800, whiteSpace: 'nowrap' }}>{freshness}</span>
                </div>
                <div style={{ fontSize: 13, color: '#445' }}>
                  Status: <strong>{t.status || order?.order_status || 'Unknown'}</strong>{t.rider_mobile ? ` · 📞 ${t.rider_mobile}` : ''}
                </div>
                <div style={{ fontSize: 12, color: 'var(--gray)' }}>Customer: {order?.customer?.name || '-'} · {order?.customer?.city || ''}</div>
                <div style={{ padding: 9, background: '#f5f9fc', borderRadius: 8, fontFamily: 'monospace', fontSize: 12 }}>
                  {hasLoc(t) ? `Lat ${Number(t.lat).toFixed(6)} · Lng ${Number(t.lng).toFixed(6)}` : 'Exact location not shared yet'}
                </div>
                <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
                  {hasLoc(t) && (
                    <a href={mapsUrl(t)} target="_blank" rel="noopener noreferrer" style={{ flex: 1, textAlign: 'center', padding: 8, background: '#0891b2', color: '#fff', borderRadius: 7, textDecoration: 'none', fontSize: 12, fontWeight: 700 }}>🗺️ Open Exact Location</a>
                  )}
                  <button type="button" onClick={() => setDetail(t)} style={{ flex: 1, padding: 8, background: 'var(--primary)', color: '#fff', border: 0, borderRadius: 7, cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>👁️ View Details</button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div style={{ padding: 35, textAlign: 'center', background: '#f8fafb', borderRadius: 12, color: 'var(--gray)' }}>No rider location records found.</div>
      )}

      {detail && (
        <AdminModal onClose={() => setDetail(null)}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <h3 style={{ margin: 0, color: 'var(--primary)' }}>🛵 Rider Details</h3>
            <button type="button" onClick={() => setDetail(null)} aria-label="Close" style={{ background: 'none', border: 0, fontSize: 22, cursor: 'pointer' }}>×</button>
          </div>
          <div style={{ display: 'grid', gap: 10, fontSize: 14 }}>
            <div><strong>Name:</strong> {detail.rider_name || '-'}</div>
            <div><strong>Mobile:</strong> {detail.rider_mobile || '-'}</div>
            <div><strong>Order:</strong> #{detail.order_id}</div>
            <div><strong>Status:</strong> {detail.status || '-'}</div>
            <div><strong>Last update:</strong> {detail.updated_at ? new Date(detail.updated_at).toLocaleString() : '-'}</div>
            <div style={{ padding: 12, background: '#f5f9fc', borderRadius: 8, fontFamily: 'monospace' }}>
              <strong>Exact coordinates</strong><br />
              {hasLoc(detail) ? `${Number(detail.lat).toFixed(8)}, ${Number(detail.lng).toFixed(8)}` : 'Location not shared'}
            </div>
            {hasLoc(detail) && (
              <a href={mapsUrl(detail)} target="_blank" rel="noopener noreferrer" style={{ textAlign: 'center', padding: 11, background: '#0891b2', color: '#fff', borderRadius: 8, textDecoration: 'none', fontWeight: 700 }}>🗺️ Open in Google Maps</a>
            )}
          </div>
        </AdminModal>
      )}
    </>
  );
}
