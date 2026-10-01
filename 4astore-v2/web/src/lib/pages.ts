import { useQuery } from '@tanstack/react-query';
import DOMPurify from 'dompurify';
import { api } from './api';

export interface CmsPage {
  id: number;
  slug: string;
  title: string;
  metaDescription: string;
  content: string;
  showInFooter: boolean;
  published: boolean;
  sortOrder: number;
  updatedAt: string;
}

/** Published pages (no content) — footer / profile links. */
export function usePages() {
  return useQuery({
    queryKey: ['pages'],
    queryFn: async () => (await api.get('/pages')).data.pages as CmsPage[],
    staleTime: 5 * 60_000,
  });
}

export function usePage(slug: string | undefined) {
  return useQuery({
    queryKey: ['page', slug],
    enabled: !!slug,
    retry: false,
    queryFn: async () => (await api.get(`/pages/${encodeURIComponent(slug!)}`)).data.page as CmsPage,
  });
}

// Admin-authored HTML → safe markup (no scripts, handlers, iframes or javascript: URLs).
export function sanitizePageHtml(html: string): string {
  return DOMPurify.sanitize(html || '', {
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'textarea', 'select'],
    FORBID_ATTR: ['srcset'],
    ALLOW_DATA_ATTR: false,
  });
}

// ---- Admin ----
export type PagePayload = Omit<CmsPage, 'id' | 'updatedAt'> & { id?: number };

export async function fetchAdminPages() {
  return (await api.get('/admin/pages')).data.pages as CmsPage[];
}
export async function savePage(action: 'add' | 'update', page: PagePayload) {
  return (await api.post('/admin/pages', { action, page })).data as { page: CmsPage };
}
export async function deletePage(id: number) {
  return (await api.post('/admin/pages', { action: 'delete', id })).data;
}
