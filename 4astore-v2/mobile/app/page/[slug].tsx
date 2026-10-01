import React from 'react';
import { Linking, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { useLocalSearchParams, useRouter } from 'expo-router';
import StoreHeader from '../../src/components/StoreHeader';
import { EmptyState, Loading } from '../../src/components/ui';
import { usePage } from '../../src/queries';
import { legacyToRoute } from '../../src/links';
import { SITE_URL } from '../../src/config';

/** CMS pages (Privacy, Terms, Help & Support, Account Deletion) from Admin → Pages. */
export default function CmsPage() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const router = useRouter();
  const { data: page, isLoading, isError } = usePage(slug);

  const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"/>
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: data:; style-src 'unsafe-inline';"/>
  <style>body{font-family:sans-serif;color:#291b16;padding:16px;line-height:1.6;background:#fffaf3}h1,h2,h3{color:#c62828}a{color:#ff7a00}img{max-width:100%}</style>
  </head><body>${page?.content || ''}</body></html>`;

  return (
    <View style={{ flex: 1, backgroundColor: '#fffaf3' }}>
      <StoreHeader back title={page?.title || ''} />
      {isLoading ? (
        <Loading />
      ) : isError || !page ? (
        <View style={{ padding: 14 }}><EmptyState icon="📄" title="Page not found" text="Ye page maujood nahi hai ya abhi published nahi hai." /></View>
      ) : (
        <WebView
          originWhitelist={['about:*']}
          source={{ html, baseUrl: SITE_URL }}
          javaScriptEnabled={false}
          onShouldStartLoadWithRequest={(req) => {
            if (req.url.startsWith('about:') || req.url === `${SITE_URL}/`) return true;
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
