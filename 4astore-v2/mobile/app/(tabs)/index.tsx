import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Image, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import StoreHeader from '../../src/components/StoreHeader';
import ProductCard from '../../src/components/ProductCard';
import AnnouncementPopup from '../../src/components/AnnouncementPopup';
import SocialProof from '../../src/components/SocialProof';
import { AnimatedGradient, GradientButton, Loading, styles as ui } from '../../src/components/ui';
import { useCategories, useConfig, useProducts, useSettings, queryClient } from '../../src/queries';
import { fillDeliveryPlaceholders, openLink } from '../../src/links';
import { absoluteUrl } from '../../src/config';
import { colors, radius, shadow } from '../../src/theme';

export default function Home() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const configQ = useConfig();
  const settings = useSettings().data;
  const categoriesQ = useCategories();
  const productsQ = useProducts();
  const [refreshing, setRefreshing] = useState(false);

  const config = configQ.data;
  const allCategories = categoriesQ.data ?? [];
  const categories = allCategories.filter((c) => !c.hidden);
  const products = productsQ.data ?? [];

  // Same selection rules as web Home.tsx
  const festival = config?.currentFestival || '';
  const banners = useMemo(() => {
    const all = config?.banners ?? [];
    let b = all.filter((x) => x.active !== false && (!x.festival || x.festival === festival));
    if (!b.length) b = all.filter((x) => x.active !== false && !x.festival);
    return b;
  }, [config, festival]);
  const ads = (config?.ads ?? []).filter((a) => a.active !== false);
  const fda = Number(settings?.freeDeliveryAbove ?? 500);
  const dc = Number(settings?.deliveryCharge ?? 0);
  const restricted = new Set(allCategories.filter((c) => c.hidden || c.age_restricted).map((c) => c.slug));
  const popular = products.filter((p) => !restricted.has(p.category)).slice(0, 12);

  // Auto-sliding hero (4 s like the web slider)
  const [slide, setSlide] = useState(0);
  const slider = useRef<FlatList>(null);
  const bannerH = Math.round((width * 9) / 16);
  useEffect(() => {
    if (banners.length < 2) return;
    const t = setInterval(() => {
      setSlide((s) => {
        const next = (s + 1) % banners.length;
        slider.current?.scrollToIndex({ index: next, animated: true });
        return next;
      });
    }, 4000);
    return () => clearInterval(t);
  }, [banners.length]);

  const onRefresh = async () => {
    setRefreshing(true);
    await queryClient.invalidateQueries();
    setRefreshing(false);
  };

  const cardW = (width - 28) / 2 - 10;

  return (
    <View style={{ flex: 1, backgroundColor: colors.lightGray }}>
      <StoreHeader />
      <AnnouncementPopup />
      <ScrollView refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />}>
        {/* Hero slider */}
        {configQ.isLoading ? (
          <View style={{ height: bannerH, backgroundColor: '#f3e3d0' }} />
        ) : banners.length > 0 ? (
          <View>
            <FlatList
              ref={slider}
              data={banners}
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              keyExtractor={(_, i) => String(i)}
              getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
              onMomentumScrollEnd={(e) => setSlide(Math.round(e.nativeEvent.contentOffset.x / width))}
              renderItem={({ item: b }) => {
                const content = (
                  <View style={[s.slideContent, b.image ? { alignItems: 'flex-start' } : null]}>
                    {!!b.title && <Text style={s.slideTitle}>{b.title}</Text>}
                    {!!b.subtitle && <Text style={s.slideSub}>{b.subtitle}</Text>}
                    {!!b.btnText && !!b.btnLink && (
                      <Pressable onPress={() => openLink(router, b.btnLink)} style={s.shopBtn} accessibilityRole="button">
                        <Text style={s.shopText}>{b.btnText}</Text>
                      </Pressable>
                    )}
                  </View>
                );
                return (
                  <Pressable onPress={() => b.btnLink && openLink(router, b.btnLink)} style={{ width, height: bannerH }} accessibilityLabel={b.title || 'Offer banner'}>
                    {b.image ? (
                      <View style={{ flex: 1 }}>
                        <Image source={{ uri: absoluteUrl(b.image) }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                        {!!(b.title || b.subtitle || b.btnText) && (
                          <LinearGradient colors={['rgba(0,0,0,0.55)', 'rgba(0,0,0,0.25)', 'rgba(0,0,0,0)'] as const} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={StyleSheet.absoluteFill}>
                            {content}
                          </LinearGradient>
                        )}
                      </View>
                    ) : (
                      // Image-less banners share ONE animated warm gradient so every banner looks
                      // consistent and alive (same colour family as buttons/header).
                      <AnimatedGradient style={{ flex: 1 }}>
                        {content}
                      </AnimatedGradient>
                    )}
                  </Pressable>
                );
              }}
            />
            {banners.length > 1 && (
              <View style={s.dots}>
                {banners.map((_, i) => <View key={i} style={[s.dot, i === slide && s.dotActive]} />)}
              </View>
            )}
          </View>
        ) : null}

        {/* Ads / offers */}
        {ads.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ padding: 14, gap: 10 }}>
            {ads.map((ad) => (
              <Pressable key={ad.id} onPress={() => openLink(router, ad.link)} style={[s.ad, { backgroundColor: ad.bgColor || '#fff', borderColor: ad.borderColor || colors.border }]} accessibilityRole="button">
                <Text style={{ fontSize: 28 }}>{ad.icon}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={[s.adTitle, { color: ad.borderColor || colors.primaryDark }]}>{fillDeliveryPlaceholders(ad.title, fda, dc)}</Text>
                  <Text style={s.adText} numberOfLines={2}>{fillDeliveryPlaceholders(ad.description, fda, dc)}</Text>
                </View>
              </Pressable>
            ))}
          </ScrollView>
        )}

        {/* Categories */}
        <View style={{ paddingHorizontal: 14, paddingTop: 14 }}>
          <Text style={ui.sectionTitle}>🛍️ Shop by Category</Text>
        </View>
        {categoriesQ.isLoading ? (
          <Loading />
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 10, gap: 10 }}>
            {categories.map((c) => (
              <Pressable key={c.id} onPress={() => router.push({ pathname: '/products', params: { category: c.slug } } as never)} style={s.cat} accessibilityRole="button" accessibilityLabel={c.name}>
                <View style={s.catIcon}>
                  {c.image ? <Image source={{ uri: absoluteUrl(c.image) }} style={{ width: 52, height: 52 }} resizeMode="contain" /> : <Text style={{ fontSize: 30 }}>{c.icon}</Text>}
                </View>
                <Text style={s.catName} numberOfLines={2}>{c.name}</Text>
              </Pressable>
            ))}
          </ScrollView>
        )}

        {/* Popular products */}
        <View style={{ paddingHorizontal: 14, paddingTop: 10 }}>
          <Text style={ui.sectionTitle}>🔥 Popular Products</Text>
        </View>
        {productsQ.isLoading ? (
          <Loading />
        ) : (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 9 }}>
            {popular.map((p) => <ProductCard key={p.id} product={p} width={cardW} />)}
          </View>
        )}
        <View style={{ padding: 20, alignItems: 'center' }}>
          <GradientButton title="View All Products →" onPress={() => router.push('/products')} style={{ minWidth: 220 }} />
        </View>
      </ScrollView>
      <SocialProof />
    </View>
  );
}

const s = StyleSheet.create({
  slideContent: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  slideTitle: { color: '#fff', fontSize: 24, fontWeight: '900', textAlign: 'center', textShadowColor: 'rgba(0,0,0,0.25)', textShadowRadius: 4 },
  slideSub: { color: '#fff', fontSize: 14, marginTop: 6, textAlign: 'center', opacity: 0.95 },
  shopBtn: { backgroundColor: '#fff', borderRadius: 30, paddingHorizontal: 26, paddingVertical: 10, marginTop: 14 },
  shopText: { color: colors.primary, fontWeight: '800', fontSize: 14 },
  dots: { position: 'absolute', bottom: 8, alignSelf: 'center', flexDirection: 'row', gap: 5 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.55)' },
  dotActive: { backgroundColor: '#fff', width: 18 },
  ad: { width: 260, flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: radius.md, borderWidth: 2, ...shadow },
  adTitle: { fontWeight: '800', fontSize: 14 },
  adText: { color: colors.gray, fontSize: 12, marginTop: 2 },
  cat: { width: 84, alignItems: 'center', backgroundColor: colors.glass, borderRadius: radius.md, paddingVertical: 10, paddingHorizontal: 4, ...shadow },
  catIcon: { width: 56, height: 56, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  catName: { fontSize: 11.5, fontWeight: '700', color: colors.dark, textAlign: 'center' },
});
