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
import { startVideoScheduler } from './services/videoScheduler';
import { startReminderJob } from './services/reminderJob';
import { seedDefaultOwner, ensureNotificationTables } from './services/dataImport';
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

// Routes
app.use('/api/users', usersRouter);
app.use('/api/otp', otpRouter);
app.use('/api', catalogRouter); // /api/products, /api/categories, /api/settings, /api/config, /api/announcement, /api/version
app.use('/api/orders', ordersRouter);
app.use('/api/tracking', trackingRouter);
app.use('/api/push', pushRouter);
app.use('/api/admin', adminNotificationsRouter); // GET /api/admin/notifications (own auth: staff + "ads")
app.use('/api/admin/videos', videosRouter); // before /api/admin (own auth: staff + "ads")
app.use('/api/admin', adminDataRouter); // owner-only /data/* (import, reset, status) — specific paths first
app.use('/api/admin', adminRouter);
app.use('/api/addresses', addressesRouter);
app.use('/api/img-proxy', imgProxyRouter);
app.use('/api/pages', pagesRouter);
app.use('/api/og', ogRouter); // social share HTML + compressed OG images (crawler-rewritten in nginx)
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
  startReminderJob();
  startVideoScheduler();
});
