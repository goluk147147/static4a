# Festival Ad Templates — Verification Note

Feature: Expand the 4A Store "Ads & Social" poster-maker with ~50 festival templates,
Navratri day-wise Devi variants, and an app-download CTA on posters.

All edits confined to ONE file:
`4astore-v2/web/public/legacy/js/admin-ads.js`
(the thin React wrapper `web/src/pages/admin/AdminAds.tsx` was NOT touched; it still loads the legacy JS verbatim).

## Automated checks

- `node --check web/public/legacy/js/admin-ads.js` → PASS (exit 0), run before and after edits.
- `npm install` in `web/` → added 172 packages, exit 0 (node_modules was missing).
- `npm run build` in `web/` → exit 0. Ran generate-sitemap.mjs (207 URLs), `tsc -b`, and `vite build`
  (730 modules transformed, bundles emitted). The asset pipeline copies `public/legacy/js/admin-ads.js`.
- Temporary data-assertion script `web/scripts/_verify-ads-templates.mjs` (created, run, then deleted) →
  all assertions PASS, exit 0:
  - template count >= 48 (got 65)
  - all ids kebab-case
  - ids unique
  - every template has name/emoji/bg[2]/accent
  - navratri-day-1..9 all present
  - each navratri day has non-empty greeting
  - navratri day palettes not all identical
  - original 6 templates preserved
  - AD_CTAS includes 'Download App'
  - AD_APP_URL ends with id=com.store4a.app

`git status --short` after cleanup shows only `admin-ads.js` as the feature change
(`plan.md` was already modified before this step; `sitemap.xml` is a build-regen artifact with no content diff).

## Final AD_TEMPLATES — 65 entries (id => name)

Original 8 (unchanged, still working):
- todays-offer => Today's Offer
- discount => Discount Offer
- fresh-veg => Fresh Vegetables
- festival => Festival Offer
- home-delivery => Home Delivery
- flash-sale => Flash Sale
- new-arrival => New Arrival
- weekend => Weekend Offer

Navratri day-wise (9, Navadurga Devi, Devanagari + roman, each with devotional Hindi greeting):
- navratri-day-1 => Navratri Day 1 — Maa Shailputri / शैलपुत्री
- navratri-day-2 => Navratri Day 2 — Maa Brahmacharini / ब्रह्मचारिणी
- navratri-day-3 => Navratri Day 3 — Maa Chandraghanta / चंद्रघंटा
- navratri-day-4 => Navratri Day 4 — Maa Kushmanda / कूष्मांडा
- navratri-day-5 => Navratri Day 5 — Maa Skandamata / स्कंदमाता
- navratri-day-6 => Navratri Day 6 — Maa Katyayani / कात्यायनी
- navratri-day-7 => Navratri Day 7 — Maa Kalaratri / कालरात्रि
- navratri-day-8 => Navratri Day 8 — Maa Mahagauri / महागौरी
- navratri-day-9 => Navratri Day 9 — Maa Siddhidatri / सिद्धिदात्री

Festival templates (34):
- durga-puja => Durga Puja
- dussehra => Dussehra
- diwali => Diwali
- dhanteras => Dhanteras
- govardhan => Govardhan Puja
- bhai-dooj => Bhai Dooj
- chhath-puja => Chhath Puja
- holi => Holi
- holika-dahan => Holika Dahan
- raksha-bandhan => Raksha Bandhan
- janmashtami => Janmashtami
- ganesh-chaturthi => Ganesh Chaturthi
- makar-sankranti => Makar Sankranti
- pongal => Pongal
- lohri => Lohri
- baisakhi => Baisakhi
- eid-ul-fitr => Eid-ul-Fitr
- bakrid => Bakrid
- christmas => Christmas
- new-year => Happy New Year
- republic-day => Republic Day
- independence-day => Independence Day
- ram-navami => Ram Navami
- hanuman-jayanti => Hanuman Jayanti
- mahashivratri => Mahashivratri
- karwa-chauth => Karwa Chauth
- teej => Teej
- onam => Onam
- gudi-padwa => Gudi Padwa
- ugadi => Ugadi
- guru-nanak-jayanti => Guru Nanak Jayanti
- mahavir-jayanti => Mahavir Jayanti
- buddha-purnima => Buddha Purnima
- mothers-day => Mother's Day

Evergreen offer templates (14, festive copy only — no fabricated prices):
- weekend-sale => Weekend Sale
- month-end-sale => Month End Sale
- monsoon-essentials => Monsoon Essentials
- summer-coolers => Summer Coolers
- winter-specials => Winter Specials
- fresh-fruits => Fresh Fruits
- dairy-fresh => Dairy Fresh
- pooja-samagri => Pooja Samagri
- clearance-sale => Clearance Sale
- combo-offer => Combo Offer
- buy-more-save-more => Buy More Save More
- free-delivery-day => Free Delivery Day
- grand-opening => Grand Opening
- festival-mega-sale => Festival Mega Sale

Count: 8 original + 9 Navratri + 34 festival + 14 evergreen = 65 (>= 48 required, ~50 target met with room).

## App-download CTA / footer — where it renders and why it does not overlap

1. `AD_CTAS` gains `'Download App'` so it is selectable as the Order-button text.
2. `AD_APP_URL = 'https://play.google.com/store/apps/details?id=com.store4a.app'` defined once near AD_CTAS and reused.
3. Footer line is drawn on EVERY template inside `adDraw()`'s footer block. Coordinate walk:
   - Footer height was `footerH = fFoot*1.4 + addrLines.length*fAddr*1.35 + H*0.02`.
     It now reserves one extra line: `footerH = fFoot*1.4 + fFoot*1.3 + addrLines.length*fAddr*1.35 + H*0.02`.
     Because `footerTop = H - footerH - H*0.02`, the whole footer block moves UP by exactly `fFoot*1.3`,
     so the new line fits without pushing the address lines off the canvas bottom. The `footer` hit area
     uses `footerH`, so it grows with the block automatically — no separate edit needed.
   - Draw order inside the block (running `fy` cursor):
       `fy = footerTop + fFoot`              → phone + 🌐 site line (unchanged position relative to block top)
       `fy += fFoot*1.3`                      → 📲 Play Store पर 4A Store App डाउनलोड करें  (NEW)
       `fy += fAddr*1.35` (per address line)  → 📍 address line(s)
     The app line sits exactly `fFoot*1.3` below the phone/site line and the first address line sits
     `fAddr*1.35` below the app line, so there is no overlap with either neighbor.
   - The app line is drawn with `ctx.font = '600 ' + fFoot + 'px ' + FONT;` reusing the SAME `FONT`
     constant (`"Nirmala UI","Noto Sans Devanagari","Mangal",...`) that the existing Hindi footer address
     uses, so the Devanagari "डाउनलोड करें" renders through the same path (no tofu/boxes), with no new deps.
4. Share/caption: `adGenerateContent()` prepends the picked template's `greeting` (festival/devotional line)
   and appends `📲 4A Store App डाउनलोड करें: <AD_APP_URL>`. `adFullCaption()` (used by adShareNative/adShare
   for WhatsApp/FB/Insta) appends `AD_APP_URL` once, guarded by `.includes('play.google.com')` so the link
   is never duplicated when the generated caption already added it.

## Festive content completion (freshly-picked template looks complete)

- Each festival/evergreen/Navratri template carries a `greeting` string (Hindi/English festive one-liner).
- `adSetTemplate(k)` seeds `caption` from the greeting + app line ONLY when the user has not typed a caption
  (`!adEditor.caption`), and sets `offerTitle` to the template name ONLY when it is empty or still the default
  `'आज का खास ऑफर'`. User-entered text is never clobbered.
- No price/MRP/discount fields are set by templates or greetings — those remain product-driven.

## Untouched (confirmed by static review of unchanged paths)

- Existing 6 templates (todays-offer, discount, fresh-veg, festival, home-delivery, flash-sale) + the other
  2 originals are unchanged and still drop into the picker (`Object.entries(AD_TEMPLATES)`) and the canvas
  renderer (`AD_TEMPLATES[e.template]`) with NO renderer rewrite — new entries are purely additive to the
  same `{ name, emoji, bg, accent, text }` shape (plus the optional `greeting` read only in adSetTemplate /
  adGenerateContent).
- Picker card markup, format buttons, drag/zoom/undo-redo, export/share, saved-ads library, and
  storefront/checkout were not modified.
