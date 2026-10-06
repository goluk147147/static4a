# Verification notes

## FEAT-003 — mobile wiring + Issue 2 asset report

### Issue 7 — staff order poller on the paginated endpoint
`mobile/src/queries.ts` `useAllOrders` now requests only the newest page of the (now paginated,
FEAT-001) staff order endpoint via a `limit=50` query. The response shape is unchanged — it still
returns `{ orders }` (the extra `nextCursor` the paginated endpoint emits is ignored by the poller).
Orders are parsed/normalized exactly as before, and the silent background behaviour is preserved
(`retry: false`, `silent: true` request so a dropped poll fails once quietly and the next interval
refetches). `StaffOrderWatcher.tsx` is unchanged: it dedups by `order_id` via the AsyncStorage
seen-set, so the newest page alone is sufficient to detect new orders; its alert/voice logic was not
touched.

### Issue 4 — product deep-link tap routing (confirm only, no change)
Confirmed already fully wired on mobile:
- `src/push.ts` `listenNotificationTaps` reads `data.link` from the tapped notification and invokes
  the supplied `onLink` callback.
- `src/links.ts` `legacyToRoute` maps `product-details?id=<n>` → `/product/<n>`, and a bare
  `/product/:id` falls through to `/product/:id` (the generic `ROUTES[rawPath] ?? /${rawPath}` path),
  so both forms resolve to the Expo Router product screen.
- `app/_layout.tsx` `navigateToLink` runs `legacyToRoute` and `router.replace()`s to the resolved
  route (stashing the target until auth bootstrap is `ready` for cold-start taps).
No code change was made for Issue 4.

### Issue 2 — notification icon asset (report only, NO asset change / NO APK rebuild)
`mobile/assets/images/notification-icon.png` was inspected:
- PNG header: 96×96 px, bit depth 8, colour type 6 (RGBA / 32bpp).
- Pixel analysis (sampled across the image): 0 non-gray (colour) pixels. Every opaque pixel is
  white (R=G=B, >240); the rest are fully transparent (alpha 0). It is a valid white-on-transparent
  monochrome silhouette, exactly what the Android status-bar small icon requires (Android masks and
  tints the small icon to a single colour; a full-colour logo would render as a white blob).
- `app.config.ts` `expo-notifications` plugin is configured correctly:
  `{ icon: './assets/images/notification-icon.png', color: '#FF7A00', defaultChannel: 'default' }`.

Conclusion: the asset and config are already correct, so NO asset change and NO APK/AAB rebuild are
required for correctness. If an installed build still shows a wrong/old icon, that is a stale install
(the icon only takes effect after a prebuild + APK rebuild), not a code defect in this repo.

### Scope
No changes were made to tracking (`src/components/TrackMap.tsx`, `app/track/*`) or the rider flow.
