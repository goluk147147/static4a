import React, { useEffect, useState } from 'react';
import { Linking, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { useLocalSearchParams, useRouter } from 'expo-router';
import StoreHeader from '../../src/components/StoreHeader';
import { EmptyState, Shimmer } from '../../src/components/ui';
import { usePage } from '../../src/queries';
import { loadPageCache, savePageCache } from '../../src/persistCache';
import { legacyToRoute } from '../../src/links';
import { SITE_URL } from '../../src/config';
import type { CmsPage as CmsPageType } from '../../src/types';

/** A few Shimmer bars shown only on the first-ever load of a CMS page (no cache yet). */
function PageSkeleton() {
  return (
    <View style={{ padding: 16 }}>
      <Shimmer style={{ height: 22, width: '55%', marginBottom: 18 }} />
      <Shimmer style={{ height: 13, width: '95%', marginBottom: 10 }} />
      <Shimmer style={{ height: 13, width: '90%', marginBottom: 10 }} />
      <Shimmer style={{ height: 13, width: '96%', marginBottom: 10 }} />
      <Shimmer style={{ height: 13, width: '70%', marginBottom: 10 }} />
      <Shimmer style={{ height: 13, width: '85%' }} />
    </View>
  );
}

/** CMS pages (Privacy, Terms, Help & Support, Account Deletion) from Admin → Pages. */
export default function CmsPage() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const router = useRouter();
  const { data, isLoading, isError } = usePage(slug);
  const [cached, setCached] = useState<CmsPageType | null>(null);

  // Seed from the per-slug cache so a previously viewed page opens instantly.
  useEffect(() => {
    if (!slug) return;
    let active = true;
    loadPageCache(slug).then((p) => {
      if (active && p) setCached(p);
    });
    return () => {
      active = false;
    };
  }, [slug]);

  // Persist fresh content when the query returns.
  useEffect(() => {
    if (slug && data) void savePageCache(slug, data);
  }, [slug, data]);

  // Prefer fresh data; fall back to cache while loading or on error.
  const page = data ?? cached;

  const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"/>
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: data:; style-src 'unsafe-inline';"/>
  <style>body{font-family:sans-serif;color:#291b16;padding:16px;line-height:1.6;background:#fffaf3}h1,h2,h3{color:#c62828}a{color:#ff7a00}img{max-width:100%}</style>
  </head><body>${page?.content || ''}</body></html>`;

  return (
    <View style={{ flex: 1, backgroundColor: '#fffaf3' }}>
      <StoreHeader back title={page?.title || ''} />
      {isLoading && !page ? (
        <PageSkeleton />
      ) : (isError && !page) || !page ? (
        <View style={{ padding: 14 }}><EmptyState icon="📄" title="Page not found" text="Ye page maujood nahi hai ya abhi published nahi hai." /></View>
      ) : (
        <WebView
          // `originWhitelist` must allow the `source.baseUrl` (SITE_URL) origin, otherwise the
          // very first load of our inline HTML is blocked and the page renders blank. We keep
          // `baseUrl` so relative links in CMS content still resolve, and allow all origins for
          // the initial render — JS stays disabled and every navigation is intercepted below.
          originWhitelist={['*']}
          source={{ html, baseUrl: SITE_URL }}
          javaScriptEnabled={false}
          onShouldStartLoadWithRequest={(req) => {
            // Allow the initial document render (our own inline HTML on the SITE_URL baseUrl)
            // and about: blanks; intercept every other navigation into the app / browser.
            if (req.url.startsWith('about:') || req.url === SITE_URL || req.url === `${SITE_URL}/`) return true;
            const route = legacyToRoute(req.url, '/');
            if (route.startsWith('/')) router.push(route as never);
            else Linking.openURL(req.url).catch(() => null);
            return false;
          }}
        />
      )}
    </View>
  );
}
