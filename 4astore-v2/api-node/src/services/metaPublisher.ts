// PHASE 2 (structure only, DISABLED): auto-post generated Reels to Instagram / Facebook
// via the Meta Graph API. Requires a Business Instagram account linked to a Facebook Page.
//
// Credentials come ONLY from server environment variables — never from the database,
// public JSON or frontend code:
//   META_AUTOPOST_ENABLED=true        (feature flag; anything else = off)
//   META_GRAPH_VERSION=v21.0
//   META_PAGE_ID=...                  (Facebook Page id)
//   META_IG_USER_ID=...               (Instagram Business account id)
//   META_ACCESS_TOKEN=...             (long-lived Page access token)
//   PUBLIC_MEDIA_BASE_URL=https://... (Graph API must download the mp4 from a public HTTPS URL)
//
// Flow when implemented:
//   1. POST /{ig-user-id}/media  { media_type: 'REELS', video_url, caption }  → creation id
//   2. poll GET /{creation-id}?fields=status_code until FINISHED
//   3. POST /{ig-user-id}/media_publish { creation_id }
//   Facebook: POST /{page-id}/video_reels (upload_phase start → upload → finish)

export interface MetaStatus {
  enabled: boolean;
  configured: boolean;
  missing: string[];
  note: string;
}

const REQUIRED = ['META_PAGE_ID', 'META_IG_USER_ID', 'META_ACCESS_TOKEN', 'PUBLIC_MEDIA_BASE_URL'];

/** Safe to expose to admins: says what is missing, never returns token values. */
export function metaStatus(): MetaStatus {
  const missing = REQUIRED.filter((k) => !process.env[k]);
  const enabled = process.env.META_AUTOPOST_ENABLED === 'true';
  return {
    enabled: false, // phase 2 — publishing is not implemented yet, so it always reports disabled
    configured: missing.length === 0,
    missing,
    note: enabled
      ? 'META_AUTOPOST_ENABLED is set, but auto-posting is a Phase 2 feature and is not active yet.'
      : 'Phase 2: Instagram/Facebook auto-post is disabled.',
  };
}

export async function publishReel(_jobId: number): Promise<never> {
  throw Object.assign(new Error('Instagram/Facebook auto-post is not enabled yet (Phase 2).'), { status: 501 });
}
