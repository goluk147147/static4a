import tls from 'tls';

/**
 * Trust the operating system's certificate store in addition to Node's bundled CAs.
 *
 * Corporate TLS inspection (e.g. Zscaler) re-signs HTTPS traffic with a root that
 * Windows trusts but Node's bundled list doesn't, so outbound calls (image proxy,
 * OSRM, mail) fail with UNABLE_TO_GET_ISSUER_CERT_LOCALLY. Adding the system store
 * fixes that while KEEPING certificate verification on.
 *
 * Needs Node >= 22.15 / 23.8 (tls.getCACertificates / setDefaultCACertificates);
 * on older Node this is a no-op — set NODE_EXTRA_CA_CERTS to the proxy's root instead.
 */
type TlsWithCa = typeof tls & {
  getCACertificates?: (type?: 'default' | 'system' | 'bundled' | 'extra') => string[];
  setDefaultCACertificates?: (certs: string[]) => void;
};

export function trustSystemCertificates(): void {
  const t = tls as TlsWithCa;
  if (typeof t.getCACertificates !== 'function' || typeof t.setDefaultCACertificates !== 'function') return;
  try {
    const merged = [...new Set([...t.getCACertificates('default'), ...t.getCACertificates('system')])];
    t.setDefaultCACertificates(merged);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[tls] could not load system certificates:', (e as Error).message);
  }
}

trustSystemCertificates();
