// Typed client for the automatic SEO engine admin endpoints
// (/api/admin/seo-auto/*), mirroring the style of web/src/lib/admin.ts.
// Every endpoint lives behind requireAuth + requireStaff('settings') on the API.
// Responses use the shared { success, ...payload } envelope; callers read the
// payload fields directly (axios already unwraps `.data`).
//
// React-Query hooks are provided for the two polling surfaces the dashboard
// needs: the aggregate dashboard snapshot and job-status polling.

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import type {
  SeoDashboard,
  SeoProductsPage,
  SeoJobView,
  SeoIntegrationStatus,
  SeoProductsFilter,
  SeoOptimizeMode,
} from '../types';

// ---- raw client calls ----

export async function getDashboard(): Promise<SeoDashboard> {
  const d = (await api.get('/admin/seo-auto/dashboard')).data;
  return {
    counters: d.counters,
    attentionThreshold: Number(d.attentionThreshold) || 0,
    jobs: (d.jobs as SeoJobView[]) || [],
    integrations: (d.integrations as SeoIntegrationStatus[]) || [],
    recentChanges: d.recentChanges || [],
  };
}

export async function listSeoProducts(params: {
  filter?: SeoProductsFilter;
  cursor?: number;
  limit?: number;
} = {}): Promise<SeoProductsPage> {
  const d = (await api.get('/admin/seo-auto/products', { params })).data;
  return { products: d.products || [], nextCursor: (d.nextCursor as number | null) ?? null };
}

export async function optimize(body: {
  mode: SeoOptimizeMode;
  productIds?: number[];
  category?: string;
}): Promise<{ jobId: number }> {
  return (await api.post('/admin/seo-auto/optimize', body)).data as { jobId: number };
}

export async function runAudit(): Promise<{ jobId: number }> {
  return (await api.post('/admin/seo-auto/audit', {})).data as { jobId: number };
}

export async function getJob(id: number): Promise<SeoJobView> {
  return (await api.get(`/admin/seo-auto/jobs/${id}`)).data.job as SeoJobView;
}

export async function listJobs(): Promise<SeoJobView[]> {
  return ((await api.get('/admin/seo-auto/jobs')).data.jobs as SeoJobView[]) || [];
}

export async function rollback(jobId?: number): Promise<{ restored: number; backupId: number | null }> {
  return (await api.post('/admin/seo-auto/rollback', jobId ? { jobId } : {})).data as {
    restored: number;
    backupId: number | null;
  };
}

export async function setOverride(body: {
  entityType: 'product' | 'category';
  id: number | string;
  field: string;
  value: boolean;
}): Promise<{ entityType: string; id: number; field: string; value: boolean }> {
  return (await api.post('/admin/seo-auto/override', body)).data;
}

export async function resetAuto(body: {
  entityType: 'product' | 'category';
  id: number | string;
  field?: string;
}): Promise<{ entityType: string; id: number; cleared: string }> {
  return (await api.post('/admin/seo-auto/reset-auto', body)).data;
}

export async function getIntegrations(): Promise<SeoIntegrationStatus[]> {
  return ((await api.get('/admin/seo-auto/integrations')).data.integrations as SeoIntegrationStatus[]) || [];
}

export async function setIntegration(
  provider: 'gsc' | 'ga4' | 'gbp',
  body: { action: 'connect' | 'disconnect'; accountRef?: string },
): Promise<{ status: SeoIntegrationStatus }> {
  return (await api.post(`/admin/seo-auto/integrations/${provider}`, body)).data as { status: SeoIntegrationStatus };
}

// ---- React-Query hooks ----

/** Dashboard snapshot. Light auto-refresh so counters follow finished jobs. */
export function useSeoDashboard(enabled = true) {
  return useQuery({
    queryKey: ['seo-dashboard'],
    queryFn: getDashboard,
    enabled,
    refetchInterval: 15_000,
  });
}

/**
 * Poll a single job while it is queued/running; stop polling once it reaches a
 * terminal state. Pass `null` to disable (no job in flight).
 */
export function useSeoJob(jobId: number | null) {
  return useQuery({
    queryKey: ['seo-job', jobId],
    queryFn: () => getJob(jobId as number),
    enabled: jobId != null,
    refetchInterval: (query) => {
      const job = query.state.data as SeoJobView | undefined;
      if (!job) return 1500;
      return job.status === 'queued' || job.status === 'running' ? 1500 : false;
    },
  });
}

/** Mutations that enqueue a job + invalidate the dashboard. */
export function useOptimize() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: optimize,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['seo-dashboard'] }),
  });
}

export function useRunAudit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: runAudit,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['seo-dashboard'] }),
  });
}

export function useRollback() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (jobId?: number) => rollback(jobId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['seo-dashboard'] }),
  });
}
