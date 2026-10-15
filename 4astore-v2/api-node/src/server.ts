import 'express-async-errors'; // route async rejections flow to the error handler (must be first)
import './systemCa'; // must run before any outbound HTTPS request
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { config } from './config';
import './db'; // initializes prisma + BigInt JSON patch

import usersRouter from './routes/users';
import otpRouter from './routes/otp';
import catalogRouter from './routes/catalog';
import ordersRouter from './routes/orders';
import trackingRouter from './routes/tracking';
import pushRouter, { adminNotificationsRouter } from './routes/push';
import adminRouter, { BANNER_DIR, ADS_DIR } from './routes/admin';
import adminDataRouter from './routes/admin-data';
import addressesRouter from './routes/addresses';
import imgProxyRouter from './routes/imgProxy';
import pagesRouter from './routes/pages';
import videosRouter from './routes/videos';
import ogRouter from './routes/og';
import seoRouter from './routes/seo';
import seoAdminRouter from './routes/seo-admin';
import marketingRouter from './routes/marketing';
import linkRouter from './routes/link';
import adminLinksRouter from './routes/admin-links';
import posAuthRouter from './routes/pos-auth';
import adminPosRouter from './routes/admin-pos';
import posImportRouter from './routes/pos-import';
import posRouter from './routes/pos';
import { requireAuth } from './auth/middleware';
import { ogCrawlHandler, ogCrawlerMiddleware } from './middleware/ogCrawler';
import { startVideoScheduler } from './services/videoScheduler';
import { startReminderJob } from './services/reminderJob';
import { startSeoAuditJob } from './services/seoAuditJob';
import { seedDefaultOwner, ensureNotificationTables, ensureMasterPasswordColumn, ensureMarketingTables, ensureShortLinkTables, ensureProductInventoryColumns, ensurePosSettingsColumns, ensurePosTables, ensureCatalogVersionColumn, ensureWhatsappApiColumn } from './services/dataImport';
import { timing } from './middleware/timing';

const app = express();

app.use(
  cors({
    origin: config.corsOrigins,
    credentials: true,
  })
);
// Ad creatives can carry several uploaded images (data: URLs) in one save.
app.use('/api/admin/ads', express.json({ limit: '15mb' }));
app.use(express.json({ limit: '6mb' })); // room for base64 payment screenshots
app.use(cookieParser());
app.use(timing); // no-op unless DEBUG_TIMING=1

// Health check
app.get('/api/health', (_req, res) => res.json({ success: true, service: '4astore-api-node', env: config.env }));

// Social-crawler OG routing (universal, deploy-safe replacement for the fragile .htaccess
// crawler rewrite). The Apache vhost include (deploy/4astore-og.conf) proxies ONLY crawler
// user-agents on /product/:id , /page/:slug , /category/:slug , /products?category=… to this
// endpoint, which rebuilds the OG HTML from the ONE source of truth (services/ogShare.ts).
app.get('/api/og-crawl', ogCrawlHandler);
// Transparent in-process guard for a bare public path that somehow reaches Node with a
// crawler UA — a no-op for /api traffic and all human requests.
app.use(ogCrawlerMiddleware);

// Routes
app.use('/api/users', usersRouter);
app.use('/api/otp', otpRouter);
app.use('/api/pos/auth', posAuthRouter); // POS phone-OTP login (PUBLIC)
app.use('/api/pos', posRouter); // POS billing + stock engine (requireAuth + requireStaff('pos'))
app.use('/api', catalogRouter); // /api/products, /api/categories, /api/settings, /api/config, /api/announcement, /api/version
app.use('/api/orders', ordersRouter);
app.use('/api/tracking', trackingRouter);
app.use('/api/push', pushRouter);
app.use('/api/admin', adminNotificationsRouter); // GET /api/admin/notifications (own auth: staff + "ads")
app.use('/api/admin/videos', videosRouter); // before /api/admin (own auth: staff + "ads")
app.use('/api/admin', adminDataRouter); // owner-only /data/* (import, reset, status) — specific paths first
app.use('/api/admin/seo-auto', requireAuth, seoAdminRouter); // staff-gated SEO engine — specific path before generic /api/admin
app.use('/api/admin/marketing', marketingRouter); // Marketing Center (staff + "ads") — specific path before generic /api/admin
app.use('/api/admin/links', adminLinksRouter); // short-link admin (staff + "ads") — specific path before generic /api/admin
app.use('/api/admin/pos', adminPosRouter); // POS phone allowlist (owner-only) — specific path before generic /api/admin
app.use('/api/admin/pos', posImportRouter); // POS Excel import/export + bulk-update (staff + "inventory") — specific path before generic /api/admin
app.use('/api/admin', adminRouter);
app.use('/api/addresses', addressesRouter);
app.use('/api/img-proxy', imgProxyRouter);
app.use('/api/pages', pagesRouter);
app.use('/api/og', ogRouter); // social share HTML + compressed OG images (crawler-rewritten in nginx)
app.use('/api/link', linkRouter); // universal short-link redirect (crawler OG + human smart-redirect); Apache /link proxies here
app.use('/api', seoRouter); // /api/sitemap.xml + /api/robots.txt (crawler infra — never flag-gated)
// Public banner images only (payment screenshots stay private in uploads/screenshots).
app.use(
  '/api/uploads/banners',
  express.static(BANNER_DIR, {
    maxAge: '7d',
    setHeaders: (res) => res.setHeader('X-Content-Type-Options', 'nosniff'),
  })
);
// Images uploaded inside ad creatives (magic-byte checked in routes/admin.ts).
app.use(
  '/api/uploads/ads',
  express.static(ADS_DIR, {
    maxAge: '7d',
    setHeaders: (res) => res.setHeader('X-Content-Type-Options', 'nosniff'),
  })
);

// 404
app.use((_req, res) => res.status(404).json({ success: false, message: 'Not found' }));

// Error handler
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  // eslint-disable-next-line no-console
  console.error(err);
  res.status(500).json({ success: false, message: 'Server error' });
});

app.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(`4AStore Node API running on http://localhost:${config.port} (${config.env})`);
  // A fresh/emptied DB must always have an owner login (idempotent).
  seedDefaultOwner().catch((e) => console.error('[seed] owner failed', e));
  // Notification history tables (idempotent, no-migrate raw SQL).
  ensureNotificationTables().catch((e) => console.error('[seed] notification tables failed', e));
  // Marketing Center tables + users.marketing_opt_out column (idempotent, no-migrate raw SQL).
  ensureMarketingTables().catch((e) => console.error('[seed] marketing tables failed', e));
  // Universal short_links table (idempotent, no-migrate raw SQL).
  ensureShortLinkTables().catch((e) => console.error('[seed] short link tables failed', e));
  // POS/inventory foundation (idempotent, no-migrate raw SQL) — additive products
  // inventory columns, POS settings toggles, and the six POS tables.
  ensureProductInventoryColumns().catch((e) => console.error('[seed] product inventory columns failed', e));
  ensurePosSettingsColumns().catch((e) => console.error('[seed] pos settings columns failed', e));
  ensurePosTables().catch((e) => console.error('[seed] pos tables failed', e));
  // Owner "master password" column on settings (idempotent, no-migrate raw SQL).
  ensureMasterPasswordColumn().catch((e) => console.error('[seed] master password column failed', e));
  // WhatsApp API config column on settings — PREP ONLY, read/written via admin
  // settings endpoint; never exposed publicly (idempotent, no-migrate raw SQL).
  ensureWhatsappApiColumn().catch((e) => console.error('[seed] whatsapp_api column failed', e));

  // app_version.catalog_version column — drives storefront/admin catalog freshness
  // (ETag on /products + /categories). Without it the ETag never changes and all
  // clients are served stale cached data forever. (idempotent, no-migrate raw SQL).
  ensureCatalogVersionColumn().catch((e) => console.error('[seed] catalog_version column failed', e));
  startReminderJob();
  startVideoScheduler();
  startSeoAuditJob(); // 15-min SEO audit sweep + queue recovery (recoverSeoQueue runs inside)
});
