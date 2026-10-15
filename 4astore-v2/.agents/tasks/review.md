# Festival template pack + app-download CTA for the Ads & Social poster-maker

Expands the legacy poster-maker (`admin-ads.js`) from 8 templates to 65 by adding 9 Navratri day-wise Navadurga templates, 34 festival templates, and 14 evergreen offer templates, plus an app-download CTA. The change is purely additive: new entries follow the existing `{ name, emoji, bg, accent, text }` shape (with an optional `greeting`) so they flow through the unchanged canvas renderer. A `'Download App'` CTA option, a Play Store footer line drawn on every poster, and a Play Store link appended to generated/shared captions complete the feature. The entire feature diff lands in one file; `plan.md` and a verification note are the only other changes.

Watch for: nothing blocking. The footer coordinate change was traced and fits within the canvas (confirmed). Devanagari in the source file is clean UTF-8, not the mojibake the raw git-diff console output suggests (confirmed).

**Verdict**: APPROVED

## High-level view

The design keeps the renderer untouched and treats templates as data. Every new template is just another entry in `AD_TEMPLATES` with the same keys the renderer already reads, so the picker (`Object.entries`) and canvas (`AD_TEMPLATES[e.template]`) pick them up with no code path changes. The only new per-template field, `greeting`, is read in exactly two places (`adSetTemplate`, `adGenerateContent`) and ignored everywhere else, so old templates that lack it behave as before.

The app-download CTA touches three surfaces: a `'Download App'` string added to `AD_CTAS`, a Devanagari footer line drawn on every poster, and a Play Store URL appended to captions. The footer line required the only non-trivial code change — reserving vertical space so it doesn't collide with the phone/site line above or the address lines below. That math was traced and holds.

Caption handling appends the Play Store link in two paths. `adGenerateContent` always prepends the template greeting and appends the app line; `adFullCaption` appends the link only when the caption doesn't already contain `play.google.com`. Because the generated caption's app line contains that substring, the two paths don't double-append.

Devotional and festive copy is seeded into the editor only when the user hasn't typed their own caption/title, so picking a template never clobbers in-progress edits.

<details>
<summary>Issues (2)</summary>

1. **Navratri day-1/festival palette overlap (possible, non-blocking)** — `navratri-day-1` and the original `festival` template both use purple-family gradients; several festival entries also share `#E65100`-based oranges. Palettes are distinct enough to be tasteful but not all unique. No action required; worth an eye if visual variety matters.
2. **Bundled plan.md edit (confirmed, non-blocking)** — `plan.md` is modified in the same branch. It's a task-tracking doc, not product code, and the verification note states it predates this step. No action needed beyond awareness.

</details>

<details>
<summary>Details</summary>

### Templates as data, renderer untouched

The whole expansion rides on an existing contract. The renderer reads `AD_TEMPLATES[e.template]` for `bg`, `accent`, `text`, and the picker iterates `Object.entries(AD_TEMPLATES)`. Every one of the 57 new entries supplies exactly those keys plus `name`/`emoji`, so they render identically to the original 8 with zero renderer edits. Verified the original 8 (`todays-offer`, `discount`, `fresh-veg`, `festival`, `home-delivery`, `flash-sale`, `new-arrival`, `weekend`) are byte-for-byte intact — the new block is appended after `weekend`, not spliced into existing entries.

The 9 Navratri entries are present and ordered day-1 through day-9, each named for the correct Navadurga Devi in roman + Devanagari (Shailputri / शैलपुत्री through Siddhidatri / सिद्धिदात्री) with a distinct devotional Hindi greeting. Palettes lean devotional (crimsons, purples, saffron) and are not all identical, matching the brief.

### App-download footer line and the coordinate change

The one piece of real layout logic. The footer block height gained a term:

```
footerH = fFoot*1.4 + fFoot*1.3 + addrLines.length*fAddr*1.35 + H*0.02
```

Since `footerTop = H - footerH - H*0.02`, adding `fFoot*1.3` shifts the whole block up by that amount, reserving room for the new line. The draw cursor confirms the fit: it starts at `footerTop + fFoot` (phone/site line), advances `fFoot*1.3` to draw the Play Store line, then advances `fAddr*1.35` per address line. The last address line lands at `footerTop + fFoot + fFoot*1.3 + n*fAddr*1.35`, which stays inside the reserved block above the `H*0.02` bottom margin. The app line sits exactly `fFoot*1.3` below the phone line and the first address line sits `fAddr*1.35` below the app line — no overlap on either side. The `footer` hit area uses `footerH`, so it grows with the block automatically.

### Devanagari rendering

The footer app line is drawn with `ctx.font = '600 ' + fFoot + 'px ' + FONT`, reusing the same `FONT` constant the existing Hindi address line uses. The source file is clean UTF-8 — "📲 Play Store पर 4A Store App डाउनलोड करें" reads correctly in the file, so the Devanagari renders through the proven path with no tofu. The garbled glyphs visible in the raw `git diff` output are a PowerShell console encoding artifact, not file corruption.

### Caption handling and the no-double-append guard

Two caption paths append the Play Store link, and they're coordinated so the link appears once. `adGenerateContent` prepends the picked template's `greeting` and appends `📲 4A Store App डाउनलोड करें: <AD_APP_URL>`. `adFullCaption` (used by the WhatsApp/FB/Insta share paths) appends `AD_APP_URL` only when the caption doesn't already contain `play.google.com`. Because `AD_APP_URL` contains that substring, a generated caption that already carries the link won't get a second copy. The link's package id is `com.store4a.app` as specified.

### Non-clobbering seed behavior

`adSetTemplate` seeds the editor's `caption` from the template greeting plus the app line, and sets `offerTitle` to the template name — but only when `caption` is empty and `offerTitle` is empty or still the default `'आज का खास ऑफर'`. User-entered text is never overwritten. No price/MRP fields are touched by templates or greetings, so pricing stays product-driven and no fabricated prices leak into posters.

### Palette distinctness

Confidence: possible. The new palettes are generally distinct and on-theme, but a few overlap: `navratri-day-1` (`#C2185B`→`#7B1FA2`) sits close to the original `festival` purple, and multiple festival entries reuse `#E65100`-family oranges. Nothing renders wrong and the brief only asks for "distinct/tasteful," which this meets. Flagging only as a cosmetic follow-up if more variety is wanted.

### Scope and bundled changes

The feature code is confined to `admin-ads.js`; storefront, checkout, and the React wrapper `AdminAds.tsx` are untouched, so no React rewrite of the editor and no new dependencies. The branch also carries a `plan.md` edit (task-tracking doc, not product code) and a regenerated `sitemap.xml` build artifact — both outside the feature surface and both expected per the verification note.

### Verification evidence

The coder's note records `node --check` pass (before and after), `npm run build` exit 0 (sitemap gen, `tsc -b`, `vite build` with 730 modules), and a temporary data-assertion script that confirmed count ≥ 48 (got 65), kebab-case + unique ids, required keys present, all 9 Navratri days with non-empty greetings, originals preserved, `'Download App'` in `AD_CTAS`, and the app URL ending in `com.store4a.app`. Per instructions the full build was not re-run; a targeted re-read of the source confirmed the originals, the Devanagari integrity, and the footer coordinate math independently.

</details>

<details>
<summary>File map</summary>

- `4astore-v2/web/public/legacy/js/admin-ads.js` — 57 new templates added to `AD_TEMPLATES`; `'Download App'` CTA + `AD_APP_URL` const; footer app-download line with reserved vertical space; greeting-seeding in `adSetTemplate`; Play Store link appended in `adGenerateContent` and `adFullCaption`.
- `4astore-v2/.agents/tasks/plan.md` — task-tracking doc update (non-feature).
- `4astore-v2/web/public/sitemap.xml` — build-regen artifact (no content diff).

Full diff: `git diff main -- 4astore-v2/web/public/legacy/js/admin-ads.js`

</details>
