// GSC / GA4 / GBP integration plumbing (PHASE-2 safe no-op).
//
// This layer only reports connection STATUS and stores non-secret references in the
// seo_integrations table. OAuth client secrets / refresh tokens live in server-side
// env (or a git-ignored config) ONLY — they are NEVER read into a response, never
// stored in seo_integrations, never shipped to the client. When creds are absent every
// call no-ops with a clear "not connected" message; no numbers are ever fabricated.

import { prisma } from '../db';

export type IntegrationProvider = 'gsc' | 'ga4' | 'gbp';
export type IntegrationState = 'connected' | 'disconnected' | 'error';

export interface IntegrationStatus {
  provider: IntegrationProvider;
  status: IntegrationState;
  // Non-secret reference only (site URL / property id / location id).
  accountRef: string | null;
  lastSyncAt: Date | null;
  lastError: string | null;
  // Whether server-side credentials are present (presence only — never the value).
  credsPresent: boolean;
  message: string;
}

// Env var that holds the (secret) credential per provider. Only its PRESENCE is read.
const CRED_ENV: Record<IntegrationProvider, string> = {
  gsc: 'SEO_GSC_CLIENT_SECRET',
  ga4: 'SEO_GA4_PROPERTY_ID',
  gbp: 'SEO_GBP_CLIENT_SECRET',
};

const PROVIDERS: ReadonlySet<string> = new Set<IntegrationProvider>(['gsc', 'ga4', 'gbp']);

const isProvider = (p: string): p is IntegrationProvider => PROVIDERS.has(p);

const credsPresentFor = (provider: IntegrationProvider): boolean =>
  !!(process.env[CRED_ENV[provider]] && String(process.env[CRED_ENV[provider]]).trim());

interface IntegrationRow {
  provider: string;
  status: string;
  account_ref: string | null;
  last_sync_at: Date | null;
  last_error: string | null;
}

const readRow = async (provider: IntegrationProvider): Promise<IntegrationRow | null> => {
  const rows = await prisma
    .$queryRawUnsafe<IntegrationRow[]>(
      'SELECT provider, status, account_ref, last_sync_at, last_error FROM seo_integrations WHERE provider = ? LIMIT 1',
      provider,
    )
    .catch(() => [] as IntegrationRow[]);
  return rows[0] || null;
};

/**
 * Read the stored status + whether server-side creds exist. Returns `disconnected`
 * with a clear message when no creds are configured. Never returns a secret.
 */
export async function getIntegrationStatus(provider: string): Promise<IntegrationStatus> {
  if (!isProvider(provider)) {
    return {
      provider: 'gsc',
      status: 'error',
      accountRef: null,
      lastSyncAt: null,
      lastError: 'unknown provider',
      credsPresent: false,
      message: `Unknown integration provider "${provider}".`,
    };
  }
  const creds = credsPresentFor(provider);
  const row = await readRow(provider);
  const status = (row?.status as IntegrationState) || 'disconnected';
  return {
    provider,
    status: creds ? status : 'disconnected',
    accountRef: row?.account_ref ?? null,
    lastSyncAt: row?.last_sync_at ?? null,
    lastError: row?.last_error ?? null,
    credsPresent: creds,
    message: creds
      ? `${provider.toUpperCase()} ${status}.`
      : `${provider.toUpperCase()} not connected — configure ${CRED_ENV[provider]} on the server first.`,
  };
}

export interface ConnectPayload {
  // Non-secret reference the admin supplies (site URL / property id / location id).
  accountRef?: string | null;
}

/**
 * Record a connection intent. No-op (returns disconnected) when server-side creds are
 * absent — the actual OAuth exchange is PHASE-2 behind a feature flag. Only non-secret
 * references are persisted.
 */
export async function connect(provider: string, payload: ConnectPayload = {}): Promise<IntegrationStatus> {
  if (!isProvider(provider)) return getIntegrationStatus(provider);
  if (!credsPresentFor(provider)) {
    // Safe no-op: cannot connect without server-side credentials.
    return getIntegrationStatus(provider);
  }
  const accountRef = payload.accountRef ? String(payload.accountRef).slice(0, 190) : null;
  await prisma
    .$executeRawUnsafe(
      `INSERT INTO seo_integrations (provider, status, account_ref, updated_at)
       VALUES (?, 'connected', ?, CURRENT_TIMESTAMP(3))
       ON DUPLICATE KEY UPDATE status = 'connected', account_ref = VALUES(account_ref), last_error = NULL, updated_at = CURRENT_TIMESTAMP(3)`,
      provider,
      accountRef,
    )
    .catch(() => 0);
  return getIntegrationStatus(provider);
}

/** Mark a provider disconnected. Idempotent; never touches secrets. */
export async function disconnect(provider: string): Promise<IntegrationStatus> {
  if (!isProvider(provider)) return getIntegrationStatus(provider);
  await prisma
    .$executeRawUnsafe(
      `INSERT INTO seo_integrations (provider, status, account_ref, updated_at)
       VALUES (?, 'disconnected', NULL, CURRENT_TIMESTAMP(3))
       ON DUPLICATE KEY UPDATE status = 'disconnected', updated_at = CURRENT_TIMESTAMP(3)`,
      provider,
    )
    .catch(() => 0);
  return getIntegrationStatus(provider);
}
