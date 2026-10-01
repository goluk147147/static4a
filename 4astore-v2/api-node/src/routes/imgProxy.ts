import { Router, Request, Response } from 'express';
import http from 'http';
import https from 'https';
import dns from 'dns';
import net from 'net';

// Port of the original api/img-proxy.php: fetches remote product images server-side
// (some CDNs block hotlinking) and lets them be drawn on <canvas> without tainting it.
const router = Router();

const MAX_BYTES = 8 * 1024 * 1024;
const TIMEOUT_MS = 15000;
const MAX_REDIRECTS = 3;

/** true for loopback, private, link-local, CGNAT, multicast, reserved ranges. */
function isBlockedIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19))
    );
  }
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    if (v.startsWith('::ffff:')) return isBlockedIp(v.slice(7));
    return v === '::' || v === '::1' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80') || v.startsWith('ff');
  }
  return true;
}

/**
 * DNS lookup that refuses private addresses. Used as the socket `lookup`, so the
 * address we validate is exactly the one we connect to (no DNS-rebinding gap).
 */
const safeLookup = ((hostname: string, options: dns.LookupOptions, callback: (...args: unknown[]) => void) => {
  // Newer Node calls this with { all: true } and expects an address array back.
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err);
    const list = addresses as dns.LookupAddress[];
    if (!list.length || list.some((a) => isBlockedIp(a.address))) {
      return callback(Object.assign(new Error('blocked host'), { code: 'EBLOCKED' }));
    }
    if (options.all) return callback(null, list);
    callback(null, list[0].address, list[0].family);
  });
}) as unknown as net.LookupFunction;

function fetchImage(url: URL, redirectsLeft: number): Promise<{ type: string; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.get(
      url,
      {
        lookup: safeLookup,
        timeout: TIMEOUT_MS,
        headers: { 'User-Agent': '4AStore-ImgProxy/1.0', Accept: 'image/*' },
      },
      (res) => {
        const status = res.statusCode || 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          if (redirectsLeft <= 0) return reject(new Error('too many redirects'));
          let next: URL;
          try {
            next = new URL(res.headers.location, url);
          } catch {
            return reject(new Error('bad redirect'));
          }
          if (!/^https?:$/.test(next.protocol)) return reject(new Error('bad redirect'));
          return fetchImage(next, redirectsLeft - 1).then(resolve, reject);
        }
        if (status !== 200) {
          res.resume();
          return reject(new Error(`upstream ${status}`));
        }
        const type = String(res.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
        if (!type.startsWith('image/') || type === 'image/svg+xml') {
          res.resume();
          return reject(new Error('not an image'));
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (c: Buffer) => {
          size += c.length;
          if (size > MAX_BYTES) {
            req.destroy(new Error('image too large'));
            return;
          }
          chunks.push(c);
        });
        res.on('end', () => resolve({ type, body: Buffer.concat(chunks) }));
        res.on('error', reject);
      }
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

/** Server-side fetch of a remote image with the same SSRF guards (used by the video renderer). */
export async function fetchRemoteImage(raw: string): Promise<Buffer> {
  const url = new URL(raw);
  if (!/^https?:$/.test(url.protocol) || url.username || url.password) throw new Error('bad url');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host) && isBlockedIp(host)) throw new Error('blocked host');
  return (await fetchImage(url, MAX_REDIRECTS)).body;
}

// GET /api/img-proxy?url=<encoded http(s) image url>
router.get('/', async (req: Request, res: Response) => {
  const raw = String(req.query.url || '').trim();
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return res.status(400).type('text/plain').send('bad url');
  }
  if (!/^https?:$/.test(url.protocol)) return res.status(400).type('text/plain').send('bad url');
  if (url.username || url.password) return res.status(400).type('text/plain').send('bad url');
  if (net.isIP(url.hostname.replace(/^\[|\]$/g, '')) && isBlockedIp(url.hostname.replace(/^\[|\]$/g, ''))) {
    return res.status(403).type('text/plain').send('blocked host');
  }

  try {
    const { type, body } = await fetchImage(url, MAX_REDIRECTS);
    res.setHeader('Content-Type', type);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.send(body);
  } catch (e) {
    const msg = (e as Error).message;
    return res.status(msg === 'blocked host' ? 403 : 502).type('text/plain').send(msg === 'blocked host' ? msg : 'fetch failed');
  }
});

export default router;
