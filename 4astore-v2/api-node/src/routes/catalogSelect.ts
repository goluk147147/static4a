/**
 * The ONE public product projection — the single source of truth shared by the
 * public catalog endpoints (routes/catalog.ts) and the leakage test
 * (src/__tests__/catalog-leak.test.ts). Kept in its own tiny module (no Express
 * router / prisma / db import) so the test can import it without booting the DB.
 *
 * The POS/inventory work added owner-only columns to the Product model
 * (purchase_price, low_stock_threshold, allow_negative_stock, track_inventory).
 * Those must NEVER reach a public client. `stock`, `unit` and `in_stock` stay
 * public so the storefront can show "only N left". Never add cost/inventory-
 * control fields to PUBLIC_PRODUCT_SELECT.
 */
// Typed as Record<string, true> rather than Prisma.ProductSelect so this module
// does not depend on the generated Prisma client (which is NOT generated in the
// worktree — see context.json). Prisma accepts this plain select object at the
// call sites in routes/catalog.ts; the shape is still an explicit true-only
// allow-list, which is what the leakage test asserts.
export const PUBLIC_PRODUCT_SELECT = {
  id: true,
  name: true,
  brand: true,
  category: true,
  weight: true,
  mrp: true,
  price: true,
  discount: true,
  image: true,
  description: true,
  features: true,
  seo_title: true,
  seo_description: true,
  seo_keywords: true,
  og_image: true,
  seo_slug: true,
  seo_overrides: true,
  seo_auto_json: true,
  seo_score: true,
  seo_problems: true,
  seo_generated_at: true,
  seo_source_hash: true,
  in_stock: true,
  featured: true,
  sku: true,
  stock: true,
  unit: true,
  tax_rate: true,
  created_at: true,
  updated_at: true,
} satisfies Record<string, true>;

/**
 * Owner-only inventory/cost fields that must NEVER appear in a public catalog
 * payload. Asserted absent by the leakage test on both /api/products and
 * /api/products/:id response shapes.
 */
export const FORBIDDEN_PUBLIC_PRODUCT_FIELDS = [
  'purchase_price',
  'low_stock_threshold',
  'allow_negative_stock',
  'track_inventory',
] as const;
