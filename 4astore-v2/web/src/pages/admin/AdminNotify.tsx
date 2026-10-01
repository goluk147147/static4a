import { useState } from 'react';
import { sendBroadcast } from '../../lib/admin';
import { apiError } from '../../lib/api';

export default function AdminNotify() {
  const [target, setTarget] = useState('all');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [link, setLink] = useState('');
  const [msg, setMsg] = useState('');

  async function send(e: React.FormEvent) {
    e.preventDefault();
    try { const r = await sendBroadcast(target, title, body, link || undefined); setMsg(r.message); setTitle(''); setBody(''); }
    catch (err) { setMsg(apiError(err)); }
  }

  return (
    <>
      {msg && <div style={{ background: '#dcfce7', padding: 10, borderRadius: 8, marginBottom: 12 }}>{msg}</div>}
      <form onSubmit={send} style={{ background: '#fff', borderRadius: 12, padding: 20, boxShadow: 'var(--shadow)', maxWidth: 520 }}>
        <div className="field">
          <label>Send to</label>
          <select value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="all">Everyone</option>
            <option value="customers">Customers</option>
            <option value="riders">Riders</option>
            <option value="admins">Admins / Staff</option>
          </select>
        </div>
        <div className="field"><label>Title</label><input value={title} onChange={(e) => setTitle(e.target.value)} required /></div>
        <div className="field"><label>Message</label><textarea rows={3} value={body} onChange={(e) => setBody(e.target.value)} required /></div>
        <div className="field"><label>Link (optional)</label><input value={link} onChange={(e) => setLink(e.target.value)} placeholder="/products?festival=diwali" /></div>
        <button className="btn btn-block">Send Push Notification</button>
      </form>
    </>
  );
}
