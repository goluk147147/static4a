import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiError } from '../lib/api';
import { useAuth } from '../store/auth';
import type { AdminOrder } from '../lib/admin';

const RIDER_STATUS = ['Rider Assigned', 'Out for Delivery', 'Delivered', 'Cancelled'];

export default function Rider() {
  const { user, ready } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [msg, setMsg] = useState('');
  const [sharing, setSharing] = useState(false);
  const watchId = useRef<number | null>(null);

  useEffect(() => {
    if (ready && (!user || user.role !== 'rider')) navigate('/login?next=/rider');
  }, [ready, user, navigate]);

  const { data: orders } = useQuery({
    queryKey: ['rider-orders'],
    enabled: !!user && user.role === 'rider',
    refetchInterval: 12000,
    queryFn: async () => (await api.get('/orders')).data.orders as AdminOrder[] & { rider_id?: string }[],
  });

  const riderId = String(user?.id ?? '');
  const available = (orders ?? []).filter((o) => !('rider_id' in o && (o as { rider_id?: string }).rider_id) && ['Order Placed', 'Confirmed', 'Packed'].includes(o.order_status));
  const mine = (orders ?? []).filter((o) => (o as { rider_id?: string }).rider_id === riderId && o.order_status !== 'Delivered');

  async function accept(orderId: string) {
    try { await api.post('/orders/accept', { orderId }); setMsg(`Accepted ${orderId}`); qc.invalidateQueries({ queryKey: ['rider-orders'] }); }
    catch (e) { setMsg(apiError(e)); }
  }
  async function setStatus(orderId: string, status: string) {
    try { await api.post('/tracking/status', { orderId, status }); setMsg(`${orderId} → ${status}`); qc.invalidateQueries({ queryKey: ['rider-orders'] }); }
    catch (e) { setMsg(apiError(e)); }
  }

  // Share GPS to the tracking API for every active order.
  function toggleGps() {
    if (sharing) {
      if (watchId.current != null) navigator.geolocation.clearWatch(watchId.current);
      watchId.current = null;
      setSharing(false);
      return;
    }
    if (!navigator.geolocation) { setMsg('Geolocation not supported'); return; }
    watchId.current = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude, accuracy, heading, speed } = pos.coords;
        mine.forEach((o) => {
          api.post('/tracking/location', {
            orderId: o.order_id, latitude, longitude,
            accuracy: accuracy ?? undefined, heading: heading ?? undefined, speed: speed ?? undefined,
          }).catch(() => null);
        });
      },
      (err) => setMsg(`GPS: ${err.message}`),
      { enableHighAccuracy: true, maximumAge: 5000 }
    );
    setSharing(true);
  }

  return (
    <div className="container" style={{ padding: 16 }}>
      <Helmet><title>Rider Console | 4A Store</title></Helmet>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h3>🛵 Rider Console</h3>
        <button className={`btn ${sharing ? '' : 'btn-outline'}`} onClick={toggleGps}>{sharing ? '📍 Sharing GPS…' : 'Start GPS'}</button>
      </div>
      {msg && <div style={{ background: '#e0f2fe', padding: 10, borderRadius: 8, marginBottom: 12 }}>{msg}</div>}

      <h4 style={{ margin: '10px 0' }}>My Deliveries ({mine.length})</h4>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {mine.map((o) => (
          <div key={o.order_id} style={{ background: '#fff', borderRadius: 10, padding: 12, boxShadow: 'var(--shadow)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}><b>{o.order_id}</b><span>₹{o.total_amount}</span></div>
            <div className="muted" style={{ fontSize: 12 }}>{o.customer?.name} · {o.customer?.mobile} · {o.customer?.city}</div>
            <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {RIDER_STATUS.map((s) => <button key={s} className="btn btn-outline" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => setStatus(o.order_id, s)}>{s}</button>)}
            </div>
          </div>
        ))}
        {mine.length === 0 && <p className="muted">No active deliveries.</p>}
      </div>

      <h4 style={{ margin: '20px 0 10px' }}>Available Orders ({available.length})</h4>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {available.map((o) => (
          <div key={o.order_id} style={{ background: '#fff', borderRadius: 10, padding: 12, boxShadow: 'var(--shadow)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <b>{o.order_id}</b>
              <div className="muted" style={{ fontSize: 12 }}>{o.customer?.name} · {o.customer?.city} · ₹{o.total_amount}</div>
            </div>
            <button className="btn" onClick={() => accept(o.order_id)}>Accept</button>
          </div>
        ))}
        {available.length === 0 && <p className="muted">No available orders.</p>}
      </div>
    </div>
  );
}
