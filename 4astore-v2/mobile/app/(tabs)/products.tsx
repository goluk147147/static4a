import React, { useMemo, useState } from 'react';
import { FlatList, Image, Pressable, ScrollView, StyleSheet, Switch, Text, View, useWindowDimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import StoreHeader from '../../src/components/StoreHeader';
import ProductCard from '../../src/components/ProductCard';
import { ProductGridSkeleton } from '../../src/components/ui';
import { useCategories, useConfig, useProducts } from '../../src/queries';
import { openLink } from '../../src/links';
import { absoluteUrl } from '../../src/config';
import { colors, radius } from '../../src/theme';

const FESTIVAL_INFO: Record<string, { name: string; colors: [string, string] }> = {
  rakhi: { name: '🪢 Raksha Bandhan Special', colors: ['#d81b60', '#f06292'] },
  diwali: { name: '🪔 Diwali Dhamaka', colors: ['#ff6f00', '#ffd54f'] },
  navratri: { name: '🕉️ Navratri Special', colors: ['#F5A623', '#ff8f00'] },
  holi: { name: '🎨 Holi Dhamaka', colors: ['#6a1b9a', '#ab47bc'] },
  christmas: { name: '🎄 Christmas & New Year', colors: ['#c62828', '#ef5350'] },
  eid: { name: '☪️ Eid Special', colors: ['#1b5e20', '#4caf50'] },
  ipl: { name: '🏏 IPL Snack Fest', colors: ['#1565c0', '#42a5f5'] },
  independence: { name: '🇮🇳 Independence Day', colors: ['#e65100', '#F5A623'] },
  chhath: { name: '🛕 Chhath Puja', colors: ['#e65100', '#ffb300'] },
};

const SORTS: [string, string][] = [['', 'Default'], ['price-low', 'Price Low→High'], ['price-high', 'Price High→Low'], ['discount', 'Best Discount'], ['name', 'Name A→Z']];

type PriceKey = '' | 'u50' | '50-100' | '100-200' | '200p';
const PRICE_RANGES: { key: PriceKey; label: string; min: number; max: number }[] = [
  { key: 'u50', label: 'Under ₹50', min: 0, max: 50 },
  { key: '50-100', label: '₹50–100', min: 50, max: 100 },
  { key: '100-200', label: '₹100–200', min: 100, max: 200 },
  { key: '200p', label: '₹200+', min: 200, max: Infinity },
];

export default function Products() {
  const params = useLocalSearchParams<{ search?: string; category?: string; festival?: string }>();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const search = String(params.search || '');
  const category = String(params.category || '');
  const config = useConfig().data;
  const festival = String(params.festival || config?.currentFestival || '');
  const { data: products = [], isLoading } = useProducts();
  const categories = useCategories().data ?? [];
  const [sort, setSort] = useState('');
  const [brand, setBrand] = useState('');
  const [inStockOnly, setInStockOnly] = useState(true);
  const [price, setPrice] = useState<PriceKey>('');
  const [filtersOpen, setFiltersOpen] = useState(false);

  const brands = useMemo(() => [...new Set(products.map((p) => p.brand).filter(Boolean) as string[])].sort(), [products]);
  const activeFilterCount = (brand ? 1 : 0) + (price ? 1 : 0) + (sort ? 1 : 0);
  const result = useMemo(() => {
    let list = [...products];
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((p) => p.name.toLowerCase().includes(q) || (p.brand || '').toLowerCase().includes(q) || p.category.replace(/-/g, ' ').includes(q) || (p.description || '').toLowerCase().includes(q));
    }
    if (category) list = list.filter((p) => p.category === category);
    if (brand) list = list.filter((p) => p.brand === brand);
    const pr = PRICE_RANGES.find((r) => r.key === price);
    if (pr) list = list.filter((p) => p.price >= pr.min && p.price <= pr.max);
    if (inStockOnly) list = list.filter((p) => p.in_stock);
    if (sort === 'price-low') list.sort((a, b) => a.price - b.price);
    else if (sort === 'price-high') list.sort((a, b) => b.price - a.price);
    else if (sort === 'discount') list.sort((a, b) => b.discount - a.discount);
    else if (sort === 'name') list.sort((a, b) => a.name.localeCompare(b.name));
    return list;
  }, [products, search, category, brand, price, inStockOnly, sort]);

  const festAds = config?.festivalAds?.[festival];
  const festInfo = festival && festAds ? FESTIVAL_INFO[festival] || { name: '🎉 Festival', colors: ['#2C6FAD', '#5BA3D9'] as [string, string] } : null;
  const activeCat = categories.find((c) => c.slug === category);
  const showWarning = !!activeCat && (activeCat.age_restricted || activeCat.hidden);
  const setParam = (k: string, v: string) => router.setParams({ [k]: v || undefined } as never);
  const cardW = (width - 28) / 2 - 10;

  const Chip = ({ active, label, onPress, img }: { active: boolean; label: string; onPress: () => void; img?: string }) => (
    <Pressable onPress={onPress} style={[s.pill, active && s.pillActive]} accessibilityRole="button" accessibilityState={{ selected: active }}>
      {!!img && <Image source={{ uri: absoluteUrl(img) }} style={{ width: 18, height: 18 }} />}
      <Text style={[s.pillText, active && { color: '#fff' }]}>{label}</Text>
    </Pressable>
  );

  const header = (
    <View>
      {festInfo && (
        <LinearGradient colors={festInfo.colors} style={s.fest}>
          <Text style={s.festTitle}>{festInfo.name}</Text>
          <Text style={{ color: '#fff' }}>Shop festive deals at 4astore, Chandargarh!</Text>
        </LinearGradient>
      )}
      {/* Category rail — the primary, prominent selector */}
      <Text style={s.railLabel}>Shop by category</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 12, paddingBottom: 4 }}>
        <Chip active={!category} label="🛒 All" onPress={() => setParam('category', '')} />
        {categories.map((c) => <Chip key={c.id} active={category === c.slug} img={c.image} label={`${c.image ? '' : (c.icon || '🛒') + ' '}${c.name}`} onPress={() => setParam('category', c.slug)} />)}
      </ScrollView>

      {/* Compact toolbar: results count · In-stock · Filters toggle */}
      <View style={s.bar}>
        <Text style={{ color: colors.gray, fontSize: 13, flex: 1 }} numberOfLines={1}>{isLoading ? 'Loading...' : `${result.length} product${result.length !== 1 ? 's' : ''}`}{search ? ` · "${search}"` : ''}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginRight: 10 }}>
          <Text style={{ fontSize: 13, color: colors.dark }}>In Stock</Text>
          <Switch value={inStockOnly} onValueChange={setInStockOnly} trackColor={{ true: colors.primary }} accessibilityLabel="In stock only" />
        </View>
        <Pressable onPress={() => setFiltersOpen((o) => !o)} style={[s.filterBtn, (filtersOpen || activeFilterCount > 0) && s.filterBtnActive]} accessibilityRole="button" accessibilityState={{ expanded: filtersOpen }}>
          <Text style={{ fontSize: 13, fontWeight: '800', color: filtersOpen || activeFilterCount > 0 ? '#fff' : colors.primary }}>
            ⚙️ Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
          </Text>
        </Pressable>
      </View>

      {/* Collapsible panel: price range, sort, brand — tidy, grouped, out of the way */}
      {filtersOpen && (
        <View style={s.panel}>
          <Text style={s.groupLabel}>💰 Price</Text>
          <View style={s.wrapRow}>
            <Chip active={!price} label="Any" onPress={() => setPrice('')} />
            {PRICE_RANGES.map((r) => <Chip key={r.key} active={price === r.key} label={r.label} onPress={() => setPrice(price === r.key ? '' : r.key)} />)}
          </View>

          <Text style={s.groupLabel}>↕️ Sort</Text>
          <View style={s.wrapRow}>
            {SORTS.map(([v, l]) => <Chip key={v || 'd'} active={sort === v} label={l} onPress={() => setSort(v)} />)}
          </View>

          {brands.length > 0 && (
            <>
              <Text style={s.groupLabel}>🏷️ Brand</Text>
              <View style={s.wrapRow}>
                <Chip active={!brand} label="All Brands" onPress={() => setBrand('')} />
                {brands.map((b) => <Chip key={b} active={brand === b} label={b} onPress={() => setBrand(brand === b ? '' : b)} />)}
              </View>
            </>
          )}
        </View>
      )}

      {(category || search || brand || price || sort) ? (
        <Pressable onPress={() => { router.setParams({ category: undefined, search: undefined } as never); setBrand(''); setSort(''); setPrice(''); }} style={{ paddingHorizontal: 14, paddingVertical: 6 }}>
          <Text style={{ color: colors.primary, fontWeight: '700', fontSize: 12 }}>✕ Reset Filters</Text>
        </Pressable>
      ) : null}
      {showWarning && (
        <View style={s.warn}>
          <Text style={{ fontSize: 20 }}>🔞</Text>
          <Text style={{ flex: 1, fontSize: 13, color: '#664d03', lineHeight: 19 }}>
            <Text style={{ fontWeight: '800' }}>18+ only. </Text>{activeCat?.warning || 'Tobacco causes cancer. Sirf 18+ ke liye.'}{'\n'}Chetavani: Tambaku / nasha sehat ke liye haanikarak hai aur cancer ka kaaran ban sakta hai.
          </Text>
        </View>
      )}
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.lightGray }}>
      <StoreHeader />
      <FlatList
        data={isLoading ? [] : result}
        keyExtractor={(p) => String(p.id)}
        numColumns={2}
        ListHeaderComponent={header}
        contentContainerStyle={{ paddingHorizontal: 9, paddingBottom: 24 }}
        ListEmptyComponent={isLoading ? <ProductGridSkeleton cardWidth={cardW} count={8} /> : (
          <View style={{ alignItems: 'center', padding: 50 }}>
            <Text style={{ fontSize: 48 }}>🔍</Text>
            <Text style={{ fontWeight: '800', fontSize: 16, color: colors.dark }}>No products found</Text>
            <Text style={{ color: colors.gray }}>Try different filter</Text>
          </View>
        )}
        renderItem={({ item }) => <ProductCard product={item} width={cardW} />}
        ListFooterComponent={festInfo && festAds?.midBanner ? (
          <Pressable onPress={() => openLink(router, festAds.midBanner!.link)}>
            <LinearGradient colors={festAds.midBanner.bgGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.mid}>
              <Text style={{ fontSize: 26 }}>{festAds.midBanner.emoji}</Text>
              <View style={{ flex: 1, alignItems: 'center' }}>
                <Text style={{ color: '#fff', fontWeight: '800', fontSize: 16 }}>{festAds.midBanner.title}</Text>
                <Text style={{ color: '#fff' }}>{festAds.midBanner.text}</Text>
              </View>
              <Text style={{ fontSize: 26 }}>{festAds.midBanner.emoji}</Text>
            </LinearGradient>
          </Pressable>
        ) : null}
      />
    </View>
  );
}

const s = StyleSheet.create({
  pill: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 30, backgroundColor: '#fff', borderWidth: 1.5, borderColor: colors.border },
  pillActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  pillText: { fontSize: 13, fontWeight: '700', color: colors.dark },
  bar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 8 },
  railLabel: { fontSize: 13, fontWeight: '800', color: colors.dark, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 2 },
  filterBtn: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 30, borderWidth: 1.5, borderColor: colors.primary, backgroundColor: '#fff' },
  filterBtnActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  panel: { marginHorizontal: 10, marginTop: 2, padding: 12, backgroundColor: '#fff', borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  groupLabel: { fontSize: 13, fontWeight: '800', color: colors.primaryDark, marginBottom: 8, marginTop: 4 },
  wrapRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 6 },
  warn: { flexDirection: 'row', gap: 10, backgroundColor: '#fff3cd', borderWidth: 1, borderColor: '#f0c36d', borderLeftWidth: 5, borderLeftColor: '#e0a800', borderRadius: 10, padding: 12, marginHorizontal: 5, marginBottom: 10 },
  fest: { padding: 18, alignItems: 'center' },
  festTitle: { color: '#fff', fontSize: 20, fontWeight: '900' },
  mid: { flexDirection: 'row', alignItems: 'center', padding: 14, borderRadius: radius.md, margin: 5 },
});
