import { useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { useQuery } from '@tanstack/react-query';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { api } from '../lib/api';

interface Tracking {
  status: string;
  rider: { name: string; phone: string; location: { latitude: number; longitude: number } | null };
  customer: { latitude: number | null; longitude: number | null };
  store: { latitude: number; longitude: number; name: string; address: string };
  route: { distance: number; eta: number; polyline: { coordinates: number[][] } } | null;
}

const STEPS = ['Order Placed', 'Confirmed', 'Packed', 'Rider Assigned', 'Out for Delivery', 'Delivered'];

export default function Track() {
  const { orderId } = useParams();
  const navigate = useNavigate();
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const { data } = useQuery({
    queryKey: ['track', orderId],
    enabled: !!orderId,
    refetchInterval: 8000, // near-live polling
    queryFn: async () => (await api.get(`/tracking?orderId=${orderId}`)).data.tracking as Tracking,
  });

  // Init map once.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current).setView([24.58, 84.11], 14);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap', maxZoom: 19 }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
  }, []);

  // Redraw markers + route on each poll.
  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer || !data) return;
    layer.clearLayers();
    const bounds: L.LatLngExpression[] = [];

    const icon = (emoji: string) => L.divIcon({ html: `<div style="font-size:26px">${emoji}</div>`, className: '', iconSize: [26, 26] });

    if (data.store) {
      L.marker([data.store.latitude, data.store.longitude], { icon: icon('🏪') }).addTo(layer).bindPopup('4A Store');
      bounds.push([data.store.latitude, data.store.longitude]);
    }
    if (data.customer?.latitude && data.customer?.longitude) {
      L.marker([data.customer.latitude, data.customer.longitude], { icon: icon('🏠') }).addTo(layer).bindPopup('Delivery address');
      bounds.push([data.customer.latitude, data.customer.longitude]);
    }
    if (data.rider?.location) {
      L.marker([data.rider.location.latitude, data.rider.location.longitude], { icon: icon('🛵') }).addTo(layer).bindPopup(`Rider: ${data.rider.name}`);
      bounds.push([data.rider.location.latitude, data.rider.location.longitude]);
    }
    if (data.route?.polyline?.coordinates?.length) {
      const latlngs = data.route.polyline.coordinates.map((c) => [c[1], c[0]] as [number, number]);
      L.polyline(latlngs, { color: '#0FA958', weight: 5 }).addTo(layer);
      latlngs.forEach((p) => bounds.push(p));
    }
    if (bounds.length) map.fitBounds(bounds as L.LatLngBoundsExpression, { padding: [40, 40] });
  }, [data]);

  const stepIndex = data ? STEPS.indexOf(data.status) : -1;

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const id = String(new FormData(e.currentTarget).get('orderId') || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
    if (id) navigate(`/track/${encodeURIComponent(id)}`);
  }

  return (
    <div className="container" style={{ padding: 16 }}>
      <Helmet><title>{orderId ? `Track ${orderId} | 4A Store` : 'Track Order | 4A Store'}</title></Helmet>
      {/* Original track.html: "Apna Order Track Karein" order-ID box */}
      <h2 style={{ marginBottom: 10, color: 'var(--primary-dark)' }}>📦 Apna Order Track Karein</h2>
      <form onSubmit={submit} style={{ display: 'flex', gap: 8, marginBottom: 16, maxWidth: 480 }}>
        <input key={orderId} name="orderId" defaultValue={orderId || ''} placeholder="Order ID (e.g. 4A123456)" aria-label="Order ID"
          style={{ flex: 1, padding: '10px 12px', border: '2px solid var(--border)', borderRadius: 8, fontSize: 14 }} />
        <button type="submit" className="btn-primary" style={{ border: 0, cursor: 'pointer' }}>Track</button>
      </form>
      {!orderId && <p style={{ color: 'var(--gray)', fontSize: 13 }}>Order ID aapko "My Orders" me milega.</p>}
      {orderId && <h3 style={{ marginBottom: 12 }}>Track Order {orderId}</h3>}

      {/* Status timeline */}
      <div style={{ display: 'flex', gap: 6, overflowX: 'auto', marginBottom: 14 }}>
        {STEPS.map((s, i) => (
          <div key={s} style={{ flex: 1, minWidth: 90, textAlign: 'center', fontSize: 11, color: i <= stepIndex ? 'var(--primary)' : '#94a3b8' }}>
            <div style={{ height: 6, borderRadius: 3, background: i <= stepIndex ? 'var(--primary)' : '#e2e8f0', marginBottom: 4 }} />
            {s}
          </div>
        ))}
      </div>

      {data?.route && (
        <div style={{ background: '#fff', borderRadius: 10, padding: 12, boxShadow: 'var(--shadow)', marginBottom: 12, display: 'flex', justifyContent: 'space-between' }}>
          <span>🛣️ {data.route.distance} km away</span>
          <b>⏱️ ETA {data.route.eta} min</b>
        </div>
      )}
      {data?.rider?.name && (
        <div style={{ marginBottom: 12 }} className="muted">Rider: {data.rider.name} {data.rider.phone && <>· <a href={`tel:${data.rider.phone}`}>📞 {data.rider.phone}</a></>}</div>
      )}

      <div ref={containerRef} style={{ height: 380, borderRadius: 12, overflow: 'hidden', boxShadow: 'var(--shadow)' }} />
    </div>
  );
}
