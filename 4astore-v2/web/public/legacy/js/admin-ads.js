/*
 * 4AStore admin � Ads & Social Media module (poster editor + library).
 * Copied VERBATIM from the original admin.html so the editor looks and works the same.
 * Loaded once by src/pages/admin/AdminAds.tsx, which provides the globals it expects:
 *   escapeHtml, showToast, adminConfirm, getSettings, getProducts, products.
 * Only changes vs. the original: API paths (api/ads.php -> /api/admin/ads,
 * api/img-proxy.php -> /api/img-proxy) and the keydown shortcut guard.
 */

    // ==========================================================
    // 📢 ADS & SOCIAL MEDIA MODULE (Phase 1)
    // ==========================================================
    let adsList = [];                 // all saved ads (from server)
    let adsView = 'dashboard';        // dashboard | editor | library
    let adEditor = null;              // current editing creative state
    let adAutoSaveTimer = null;
    const AD_DRAFT_KEY = '4astore_ad_draft';

    const AD_FORMATS = {
      '1:1':  { w: 1080, h: 1080, label: 'Post 1:1' },
      '4:5':  { w: 1080, h: 1350, label: 'Feed 4:5' },
      '9:16': { w: 1080, h: 1920, label: 'Reel/Story 9:16' },
      '16:9': { w: 1080, h: 608,  label: 'FB 16:9' }
    };

    const AD_CTAS = ['Order Now', 'Shop Now', 'Visit Store', 'Call Now', 'WhatsApp Now', 'Free Home Delivery'];

    // Grocery-store templates: background + accent colors + default offer style
    const AD_TEMPLATES = {
      'todays-offer':  { name: "Today's Offer",   emoji: '🔥', bg: ['#FF7A00','#E85D00'], accent: '#FFD54F', text: '#ffffff' },
      'discount':      { name: 'Discount Offer',  emoji: '💥', bg: ['#E53935','#B71C1C'], accent: '#FFEB3B', text: '#ffffff' },
      'fresh-veg':     { name: 'Fresh Vegetables',emoji: '🥬', bg: ['#2E7D32','#1B5E20'], accent: '#FFEB3B', text: '#ffffff' },
      'festival':      { name: 'Festival Offer',  emoji: '🪔', bg: ['#6A1B9A','#4A148C'], accent: '#FFD54F', text: '#ffffff' },
      'home-delivery': { name: 'Home Delivery',   emoji: '🛵', bg: ['#0277BD','#01579B'], accent: '#FFD54F', text: '#ffffff' },
      'flash-sale':    { name: 'Flash Sale',      emoji: '⚡', bg: ['#F57C00','#E65100'], accent: '#FFFFFF', text: '#ffffff' },
      'new-arrival':   { name: 'New Arrival',     emoji: '✨', bg: ['#00838F','#006064'], accent: '#FFD54F', text: '#ffffff' },
      'weekend':       { name: 'Weekend Offer',   emoji: '🎉', bg: ['#AD1457','#880E4F'], accent: '#FFEB3B', text: '#ffffff' }
    };

    // ---- Data loading ----
    function adsApi(body, cb) {
      try {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', '/api/admin/ads', false);
        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.send(JSON.stringify(body));
        cb(JSON.parse(xhr.responseText));
      } catch (e) { cb({ success: false, message: 'Server error: ' + e.message }); }
    }

    function reloadAds(after) {
      try {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', '/api/admin/ads?_=' + Date.now(), false);
        xhr.send();
        const res = JSON.parse(xhr.responseText);
        if (res && res.success && Array.isArray(res.ads)) adsList = res.ads;
      } catch (e) { /* keep existing */ }
      if (typeof after === 'function') after();
    }

    // ---- Router: main tab entry ----
    function renderAdsTab() {
      reloadAds(() => {
        if (adsView === 'editor') renderAdEditor();
        else if (adsView === 'library') renderAdLibrary();
        else renderAdsDashboard();
      });
    }

    function adsGoto(view) { adsView = view; renderAdsTab(); }

    // ---- 3. DASHBOARD ----
    function renderAdsDashboard() {
      const total = adsList.length;
      const drafts = adsList.filter(a => a.status === 'draft').length;
      const published = adsList.filter(a => a.status === 'published').length;
      const scheduled = adsList.filter(a => a.status === 'scheduled').length;
      const ready = adsList.filter(a => a.status === 'ready').length;

      const card = (icon, val, label, accent) => `
        <div class="stat-card" style="border-left-color:${accent};">
          <div class="stat-icon">${icon}</div><div class="stat-value">${val}</div><div class="stat-label">${label}</div>
        </div>`;

      const statusBadge = st => {
        const c = { draft:'#f59e0b', ready:'#0891b2', scheduled:'#8b5cf6', published:'#059669', failed:'#dc2626' }[st] || '#6b7280';
        return `<span style="font-size:11px;font-weight:600;padding:3px 8px;border-radius:12px;color:#fff;background:${c};">${escapeHtml(st||'draft')}</span>`;
      };

      const rows = adsList.length ? adsList.slice().reverse().map(a => `
        <tr>
          <td><strong>${escapeHtml(a.name||'')}</strong></td>
          <td>${escapeHtml(a.campaign||'-')}</td>
          <td>${escapeHtml(a.productName||'-')}</td>
          <td>${escapeHtml(a.format||'1:1')}</td>
          <td>${a.createdAt ? new Date(a.createdAt).toLocaleDateString('en-IN') : '-'}</td>
          <td>${statusBadge(a.status)}</td>
          <td style="white-space:nowrap;">
            <button onclick="openAdEditor(${a.id})" title="Edit" style="padding:5px 9px;background:var(--primary);color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:11px;margin-right:3px;">✏️</button>
            <button onclick="duplicateAd(${a.id})" title="Duplicate" style="padding:5px 9px;background:#0891b2;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:11px;margin-right:3px;">📋</button>
            <button onclick="removeAd(${a.id})" title="Delete" style="padding:5px 9px;background:#e53935;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:11px;">🗑️</button>
          </td>
        </tr>`).join('') : '<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--gray);">Abhi koi ad nahi. "+ Create New Ad" se banao.</td></tr>';

      document.getElementById('tabContent').innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:18px;">
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <button onclick="adsGoto('dashboard')" style="padding:9px 16px;border:none;border-radius:20px;cursor:pointer;font-size:13px;font-weight:600;background:var(--primary);color:#fff;">📊 Dashboard</button>
            <button onclick="adsGoto('library')" style="padding:9px 16px;border:1px solid var(--border);border-radius:20px;cursor:pointer;font-size:13px;font-weight:600;background:#fff;color:var(--primary-dark);">📚 Ad Library</button>
          </div>
          <button onclick="openAdEditor(null, true)" style="padding:11px 22px;background:var(--primary);color:#fff;border:none;border-radius:10px;cursor:pointer;font-size:14px;font-weight:700;box-shadow:0 3px 10px rgba(255,122,0,.3);">+ Create New Ad</button>
        </div>

        <div class="stats-grid" style="margin-bottom:22px;">
          ${card('📢', total, 'Total Ads', 'var(--primary)')}
          ${card('📝', drafts, 'Drafts', '#f59e0b')}
          ${card('✅', published, 'Published', '#059669')}
          ${card('⏰', scheduled, 'Scheduled', '#8b5cf6')}
          ${card('🖼️', total, 'Images', '#0891b2')}
        </div>

        <div style="background:#fff;border:1px solid var(--border);border-radius:14px;padding:18px;">
          <h4 style="margin:0 0 14px;color:var(--primary-dark);">🕒 Recent Ads</h4>
          <div style="overflow-x:auto;">
            <table class="admin-table">
              <thead><tr><th>Ad Name</th><th>Campaign</th><th>Product</th><th>Format</th><th>Created</th><th>Status</th><th>Action</th></tr></thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
        </div>`;
    }

    function duplicateAd(id) {
      adsApi({ action: 'duplicate', id: id }, res => {
        if (res && res.success) { showToast('Ad duplicated', 'success'); reloadAds(renderAdsDashboard); }
        else showToast((res && res.message) || 'Failed', 'error');
      });
    }

    async function removeAd(id) {
      const a = adsList.find(x => x.id === id);
      if (!await adminConfirm('Delete ad "' + (a ? a.name : '') + '"?', { title: 'Delete ad', confirmText: 'Delete' })) return;
      adsApi({ action: 'delete', id: id }, res => {
        if (res && res.success) { showToast('Ad deleted', 'success'); reloadAds(renderAdsTab); }
        else showToast((res && res.message) || 'Failed', 'error');
      });
    }

    // ---- 4. EDITOR ----
    // Build a fresh creative state
    function newAdState() {
      const s = getSettings();
      return {
        id: null,
        name: 'New Ad',
        campaign: '',
        offerTitle: 'आज का खास ऑफर',
        productId: null,
        productName: '',
        productIds: [],
        productCount: 1,
        productPrices: {},
        productMrps: {},
        price: '', mrp: '', discount: '',
        format: '1:1',
        platform: 'all',
        template: 'todays-offer',
        cta: 'Order Now',
        ctaLink: '',
        headerTitle: '4A STORE',
        headerTagline: 'आपकी अपनी किराना दुकान',
        localMode: true,
        lang: 'hindi',
        img: null,          // {src, zoom, x, y, rot, flipH, flipV}
        background: null,   // {src, zoom}
        layout: { background: {}, products: {}, title: {}, discount: {}, cta: {}, footer: {} },
        textColors: { header: '#ffffff', title: '#ffffff', discount: '#FFD54F', cta: '#3a2400', footer: '#ffffff' },
        hiddenLayers: {},
        overlays: [],
        lines: [],          // extra custom text lines [{text}]
        caption: '',
        hashtags: '',
        status: 'draft'
      };
    }

    function openAdEditor(id, forceNew) {
      if (id != null) {
        // Load existing ad
        let ad = null;
        try {
          const xhr = new XMLHttpRequest();
          xhr.open('GET', '/api/admin/ads?id=' + id + '&_=' + Date.now(), false);
          xhr.send();
          const res = JSON.parse(xhr.responseText);
          if (res.success) ad = res.ad;
        } catch (e) {}
        if (!ad) { showToast('Ad not found', 'error'); return; }
        adEditor = Object.assign(newAdState(), ad.creative || {}, {
          id: ad.id, name: ad.name, campaign: ad.campaign, offerTitle: ad.offerTitle,
          productId: ad.productId, productName: ad.productName, format: ad.format, ctaLink: ad.ctaLink || ad.creative?.ctaLink || '',
          productIds: Array.isArray(ad.creative?.productIds) ? ad.creative.productIds : [],
          productCount: Math.max(1, Math.min(3, Number(ad.creative?.productCount || (Array.isArray(ad.creative?.productIds) ? ad.creative.productIds.length : 1)) || 1)),
          productPrices: ad.creative?.productPrices || {},
          productMrps: ad.creative?.productMrps || {},
          platform: ad.platform, template: ad.template, caption: ad.caption,
          hashtags: ad.hashtags, status: ad.status
        });
      } else if (!forceNew) {
        // Restore an autosaved draft only when returning to the editor, never for Create New Ad.
        const draft = localStorage.getItem(AD_DRAFT_KEY);
        adEditor = draft ? Object.assign(newAdState(), JSON.parse(draft)) : newAdState();
      } else {
        localStorage.removeItem(AD_DRAFT_KEY);
        adEditor = newAdState();
      }
      _adUndoStack = [];
      _adRedoStack = [];
      _adHistoryState = adSnapshot();
      _adSelected = '';
      adsView = 'editor';
      renderAdEditor();
    }

    function renderAdEditor() {
      if (!adEditor) adEditor = newAdState();
      const e = adEditor;
      e.textColors = e.textColors || {};
      e.hiddenLayers = e.hiddenLayers || {};
      const prods = getProducts();
      const selectedIds = Array.isArray(e.productIds) && e.productIds.length ? e.productIds : (e.productId ? [e.productId] : []);
      const productCount = Math.max(1, Math.min(3, Number(e.productCount || selectedIds.length || 1)));
      const prodOpts = ['<option value="">— Product select karein —</option>']
        .concat(prods.map(p => `<option value="${p.id}" ${e.productId==p.id?'selected':''}>${escapeHtml(p.name)}</option>`)).join('');
      const ctaOpts = AD_CTAS.map(c => `<option value="${c}" ${e.cta===c?'selected':''}>${c}</option>`).join('');
      const tplCards = Object.entries(AD_TEMPLATES).map(([k,t]) => `
        <button onclick="adSetTemplate('${k}')" style="flex:0 0 auto;width:96px;border:2px solid ${e.template===k?'var(--primary)':'var(--border)'};border-radius:10px;padding:8px 6px;cursor:pointer;background:linear-gradient(135deg,${t.bg[0]},${t.bg[1]});color:#fff;">
          <div style="font-size:20px;">${t.emoji}</div>
          <div style="font-size:10px;font-weight:700;margin-top:3px;line-height:1.1;">${t.name}</div>
        </button>`).join('');
      const fmtBtns = Object.keys(AD_FORMATS).map(f => `
        <button onclick="adSetFormat('${f}')" style="padding:7px 12px;border:1px solid ${e.format===f?'var(--primary)':'var(--border)'};border-radius:8px;cursor:pointer;font-size:12px;font-weight:600;background:${e.format===f?'var(--primary)':'#fff'};color:${e.format===f?'#fff':'var(--primary-dark)'};">${f}</button>`).join('');
      const layerBtns = [
        ['background', 'Background'], ['header', 'Header'], ['products', 'Products'], ['title', 'Title'],
        ['discount', 'Discount'], ['cta', 'Order Button'], ['footer', 'Footer']
      ].map(([key, label]) => `<button onclick="adSelectElement('${key}')" class="ad-mini">${label}</button>`).join('') +
        (e.overlays || []).map(item => `<button onclick="adSelectElement('overlay:${item.id}')" class="ad-mini">Image</button>`).join('') +
        (e.lines || []).map((line, index) => `<button onclick="adSelectElement('line:${index}')" class="ad-mini">Text ${index + 1}</button>`).join('');

      document.getElementById('tabContent').innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:16px;">
          <button onclick="adsGoto('dashboard')" style="padding:8px 16px;border:1px solid var(--border);border-radius:8px;background:#fff;cursor:pointer;font-size:13px;font-weight:600;">← Back</button>
          <span id="adSaveStatus" style="font-size:12px;color:var(--gray);"></span>
        </div>

        <div class="ad-editor-wrap">
          <!-- LEFT: controls -->
          <div class="ad-controls">
            <div class="ad-panel">
              <h5>📝 Basic Info</h5>
              <label>Ad Name</label>
              <input type="text" id="adName" value="${escapeHtml(e.name||'')}" oninput="adField('name',this.value)">
              <label>Offer Title</label>
              <input type="text" id="adOfferTitle" value="${escapeHtml(e.offerTitle||'')}" oninput="adField('offerTitle',this.value); adDrawSoon();">
              <label>Product</label>
              <select id="adProductCount" onchange="adSetProductCount(this.value)"><option value="1" ${productCount===1?'selected':''}>1 Product - Hero poster</option><option value="2" ${productCount===2?'selected':''}>2 Products - Split offer</option><option value="3" ${productCount===3?'selected':''}>3 Products - Grocery grid</option></select>
              <select id="adProduct" onchange="adSelectProduct(this.value)">${prodOpts}</select>
              <div id="adExtraProducts">${productCount > 1 ? renderExtraProductSelectors(prods, selectedIds, productCount) : ''}</div>
              <div style="display:flex;gap:8px;">
                <div style="flex:1;"><label>Price ₹</label><input type="number" id="adPrice" value="${e.price}" oninput="adSetPrimaryProductPrice(this.value)"></div>
                <div style="flex:1;"><label>MRP ₹</label><input type="number" id="adMrp" value="${e.mrp}" oninput="adSetPrimaryProductMrp(this.value)"></div>
                <div style="flex:1;"><label>Disc %</label><input type="number" id="adDisc" value="${e.discount}" oninput="adField('discount',this.value); adDrawSoon();"></div>
              </div>
              <label>CTA Button</label>
              <select id="adCta" onchange="adField('cta',this.value); adDrawSoon();">${ctaOpts}</select>
              <label>CTA Link</label>
              <input type="url" id="adCtaLink" value="${escapeHtml(e.ctaLink || '')}" placeholder="https://example.com ya products.html" oninput="adField('ctaLink',this.value)">
              <p style="font-size:11px;color:var(--gray);margin:4px 0 0;">Live preview me Order button click karne par ye link khulega. PNG/JPG me click action nahi hota.</p>
            </div>

            <div class="ad-panel">
              <h5>🎨 Template</h5>
              <div style="display:flex;gap:8px;overflow-x:auto;padding-bottom:6px;">${tplCards}</div>
            </div>

            <div class="ad-panel">
              <h5>📐 Format</h5>
              <div style="display:flex;gap:8px;flex-wrap:wrap;">${fmtBtns}</div>
            </div>

            <div class="ad-panel">
              <h5>🖼️ Product Image</h5>
              <div id="adDrop" ondragover="event.preventDefault();this.style.background='#fff3e6'" ondragleave="this.style.background=''" ondrop="adDropImage(event)"
                style="border:2px dashed var(--border);border-radius:10px;padding:16px;text-align:center;cursor:pointer;font-size:13px;color:var(--gray);"
                onclick="document.getElementById('adImgInput').click()">
                📤 Image drag karo ya click karke choose karo (JPG/PNG/WEBP)
              </div>
              <input type="file" id="adImgInput" accept="image/*" style="display:none;" onchange="adLoadImageFile(this.files[0])">
              <div id="adImgControls" style="display:${e.img?'block':'none'};margin-top:12px;">
                <label>Zoom <span id="adZoomVal">${e.img?Math.round((e.img.zoom||1)*100):100}%</span></label>
                <input type="range" id="adZoom" min="20" max="300" value="${e.img?(e.img.zoom||1)*100:100}" oninput="adImgZoom(this.value)" style="width:100%;">
                <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;">
                  <button onclick="adImgRotate(-90)" class="ad-mini">↺ 90</button>
                  <button onclick="adImgRotate(90)" class="ad-mini">↻ 90</button>
                  <button onclick="adImgFlip('h')" class="ad-mini">↔ Flip</button>
                  <button onclick="adImgFlip('v')" class="ad-mini">↕ Flip</button>
                  <button onclick="adImgReset()" class="ad-mini">⟳ Reset</button>
                  <button onclick="adRemoveImageBackground()" class="ad-mini">✂ Remove Background</button>
                  <button onclick="adImgRemove()" class="ad-mini" style="background:#ffebee;color:#c62828;">🗑️ Remove</button>
                </div>
                <p style="font-size:11px;color:var(--gray);margin-top:6px;">💡 Preview me image ko drag karke position set karo.</p>
              </div>
            </div>

            <div class="ad-panel">
              <h5>🖼️ Custom Background</h5>
              <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
                <label class="ad-mini" style="cursor:pointer;">📤 Upload Background
                  <input type="file" accept="image/*" style="display:none;" onchange="adLoadBackgroundFile(this.files[0])">
                </label>
                <button onclick="adRemoveBackground()" class="ad-mini" style="background:#ffebee;color:#c62828;">🗑️ Remove</button>
              </div>
              <div style="display:flex;gap:6px;margin-top:8px;">
                <input id="adBgUrl" type="url" value="${escapeHtml(e.background?.src && !e.background.src.startsWith('data:') ? e.background.src : '')}" placeholder="Background image URL" style="flex:1;">
                <button onclick="adUseBackgroundUrl()" class="ad-mini" style="background:var(--primary);color:#fff;">Use URL</button>
              </div>
              <div style="display:${e.background?'block':'none'};margin-top:10px;">
                <label>Background Zoom <span id="adBgZoomVal">${e.background?Math.round((e.background.zoom||1)*100):100}%</span></label>
                <input type="range" min="50" max="200" value="${e.background?(e.background.zoom||1)*100:100}" oninput="adBackgroundZoom(this.value)" style="width:100%;">
              </div>
            </div>

            <div class="ad-panel">
              <h5>➕ Add Image Anywhere</h5>
              <label class="ad-mini" style="display:inline-block;cursor:pointer;">📤 Add PNG/JPG/WEBP
                <input type="file" accept="image/*" style="display:none;" onchange="adAddOverlayFile(this.files[0])">
              </label>
              <p style="font-size:11px;color:var(--gray);margin:7px 0 0;">Image add karke canvas par drag, resize ya delete karein.</p>
            </div>

            <div class="ad-panel">
              <h5>➕ Extra Text Lines</h5>
              <div id="adLines"></div>
              <button onclick="adAddLine()" style="margin-top:8px;padding:8px 14px;background:var(--primary);color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:12px;font-weight:600;">+ Add Text</button>
            </div>

            <div class="ad-panel">
              <h5>🤖 Generate Content</h5>
              <label style="display:flex;align-items:center;gap:6px;font-size:13px;">
                <input type="checkbox" id="adLocalMode" ${e.localMode?'checked':''} onchange="adField('localMode',this.checked)"> 🇮🇳 Local Customer Mode
              </label>
              <label style="margin-top:8px;">Language</label>
              <select id="adLang" onchange="adField('lang',this.value)">
                <option value="hindi" selected>Hindi</option>
              </select>
              <button onclick="adGenerateContent()" style="margin-top:10px;width:100%;padding:10px;background:#6a1b9a;color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:13px;font-weight:600;">✨ Generate Caption + Hashtags + Hook</button>
              <div id="adHooks" style="margin-top:10px;"></div>
              <label style="margin-top:10px;">Caption</label>
              <textarea id="adCaption" rows="4" oninput="adField('caption',this.value)" style="resize:vertical;">${escapeHtml(e.caption||'')}</textarea>
              <label style="margin-top:8px;">Hashtags</label>
              <textarea id="adHashtags" rows="2" oninput="adField('hashtags',this.value)" style="resize:vertical;">${escapeHtml(e.hashtags||'')}</textarea>
            </div>
          </div>

          <!-- RIGHT: live preview -->
          <div class="ad-preview-col">
            <div class="ad-preview-sticky">
              <div style="font-size:12px;color:var(--gray);text-align:center;margin-bottom:8px;">LIVE PREVIEW</div>
              <div id="adCanvasWrap" style="display:flex;justify-content:center;">
                <canvas id="adCanvas" style="max-width:100%;max-height:60vh;border-radius:12px;box-shadow:0 6px 24px rgba(0,0,0,.15);touch-action:none;cursor:grab;"></canvas>
              </div>
              <div style="display:flex;gap:7px;align-items:center;flex-wrap:wrap;margin-top:10px;padding:8px;background:#fff8ef;border:1px solid #ffe0b2;border-radius:8px;">
                <strong style="font-size:12px;color:var(--primary-dark);">Selected: <span id="adSelectedElement">None</span></strong>
                <input id="adSelectedText" type="text" placeholder="Edit selected text" oninput="adSetSelectedText(this.value)" style="min-width:150px;flex:1;">
                <input id="adSelectedTagline" type="text" placeholder="Edit header subtitle" oninput="adSetSelectedTagline(this.value)" style="min-width:150px;flex:1;display:none;">
                <input id="adSelectedColor" type="color" value="#ffffff" title="Text color" onchange="adSetSelectedColor(this.value)" style="width:34px;height:28px;padding:1px;">
                <label style="font-size:11px;margin-left:auto;">Size <span id="adElementScaleVal">100%</span></label>
                <input id="adElementScale" type="range" min="50" max="180" value="100" oninput="adSetSelectedScale(this.value)" style="width:110px;">
                <button onclick="adUndo()" class="ad-mini">↶ Undo</button>
                <button onclick="adRedo()" class="ad-mini">↷ Redo</button>
                <button onclick="adDeleteSelected()" class="ad-mini" style="background:#ffebee;color:#c62828;">🗑️ Delete</button>
                <button onclick="adResetLayout()" class="ad-mini">↺ Reset layout</button>
              </div>
              <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:center;margin-top:7px;">${layerBtns}</div>
              <p style="font-size:11px;color:var(--gray);text-align:center;margin:6px 0 0;">Canvas par background, products, title, discount, button ya footer ko drag karke move karein. Selected item ka size slider se badlein.</p>
              <div class="ad-actions-bar">
                <button onclick="saveAd()" class="ad-act ad-act-primary">💾 Save</button>
                <button onclick="adDownload('png')" class="ad-act">📥 PNG</button>
                <button onclick="adDownload('jpg')" class="ad-act">📥 JPG</button>
                <button onclick="adCopyCaption()" class="ad-act">📋 Caption</button>
              </div>
              <button onclick="adShareNative()" style="width:100%;margin-top:10px;padding:13px;background:linear-gradient(135deg,#25D366,#128C7E);color:#fff;border:none;border-radius:10px;cursor:pointer;font-size:15px;font-weight:700;box-shadow:0 3px 10px rgba(37,211,102,.35);">📲 Share (Image + Caption)</button>
              <p style="font-size:11px;color:#2e7d32;text-align:center;margin:6px 0 0;">👆 Phone/App me: image + caption dono ek saath jaayenge. WhatsApp/FB/Insta choose karo.</p>
              <div class="ad-share-bar" style="margin-top:10px;">
                <button onclick="adShare('whatsapp')" class="ad-share" style="background:#25D366;">🟢 WhatsApp</button>
                <button onclick="adShare('facebook')" class="ad-share" style="background:#1877F2;">🔵 Facebook</button>
                <button onclick="adShare('instagram')" class="ad-share" style="background:#E1306C;">🟣 Instagram</button>
              </div>
              <p style="font-size:11px;color:var(--gray);text-align:center;margin-top:8px;">💻 Desktop pe: image download hogi + caption copy — phir platform me manually upload karo. (Facebook/Instagram apne aap image attach nahi karne dete — ye unki security policy hai, kisi tool me possible nahi.)</p>
            </div>
          </div>
        </div>`;

      // Set product dropdown selection
      const pd = document.getElementById('adProduct');
      if (pd && e.productId != null) pd.value = e.productId;
      renderAdLines();
      // Load image if present, then draw
      adPrepareImageThenDraw();
      startAdAutoSave();
      adSyncSelectedControls();
    }

    // ---- field helpers ----
    function adField(key, val) { adEditor[key] = val; queueAutoSave(); }

    function adSelectProduct(id) {
      const p = getProducts().find(pr => String(pr.id) === String(id));
      adEditor.productId = id || null;
      adEditor.productIds = [id].concat((adEditor.productIds || []).slice(1)).filter(Boolean);
      if (p) {
        adEditor.productName = p.name;
        adEditor.productPrices = adEditor.productPrices || {};
        adEditor.productMrps = adEditor.productMrps || {};
        if (adEditor.productPrices[id] === undefined || adEditor.productPrices[id] === '') adEditor.productPrices[id] = p.price;
        if (adEditor.productMrps[id] === undefined || adEditor.productMrps[id] === '') adEditor.productMrps[id] = p.mrp;
        adEditor.price = adEditor.productPrices[id];
        adEditor.mrp = p.mrp;
        adEditor.discount = p.discount || '';
        if (p.image) { adSetImageSrc(p.image); }
        const pr = document.getElementById('adPrice'); if (pr) pr.value = adEditor.productPrices[id];
        const mr = document.getElementById('adMrp'); if (mr) mr.value = p.mrp;
        const dc = document.getElementById('adDisc'); if (dc) dc.value = p.discount || '';
      }
      queueAutoSave();
      adDrawSoon();
    }

    function adSetPrimaryProductPrice(value) {
      adField('price', value);
      const id = adEditor.productId;
      if (id) {
        adEditor.productPrices = adEditor.productPrices || {};
        adEditor.productMrps = adEditor.productMrps || {};
        adEditor.productPrices[id] = value === '' ? '' : Math.max(0, Number(value) || 0);
      }
      adDrawSoon();
    }

    function adSetPrimaryProductMrp(value) {
      adField('mrp', value);
      const id = adEditor.productId;
      if (id) {
        adEditor.productMrps = adEditor.productMrps || {};
        adEditor.productMrps[id] = value === '' ? '' : Math.max(0, Number(value) || 0);
      }
      adDrawSoon();
    }

    function renderExtraProductSelectors(prods, ids, count) {
      return Array.from({length: count - 1}, (_, i) => {
        const current = ids[i + 1] || '';
        const options = ['<option value="">— Product ' + (i + 2) + ' —</option>'].concat(prods.map(p => '<option value="' + p.id + '" ' + (String(current) === String(p.id) ? 'selected' : '') + '>' + escapeHtml(p.name) + '</option>')).join('');
        const product = prods.find(p => String(p.id) === String(current));
        const price = current && adEditor.productPrices && adEditor.productPrices[current] !== undefined ? adEditor.productPrices[current] : (product ? product.price : '');
        const mrp = current && adEditor.productMrps && adEditor.productMrps[current] !== undefined ? adEditor.productMrps[current] : (product ? product.mrp : '');
        return '<select style="margin-top:7px;" onchange="adSelectExtraProduct(' + (i + 1) + ', this.value)">' + options + '</select><div style="display:flex;gap:6px;margin-top:6px;"><input id="adExtraPrice' + (i + 1) + '" type="number" min="0" step="0.01" value="' + escapeHtml(price == null ? '' : String(price)) + '" placeholder="Price" oninput="adSetExtraProductPrice(' + (i + 1) + ', this.value)" style="flex:1;"><input id="adExtraMrp' + (i + 1) + '" type="number" min="0" step="0.01" value="' + escapeHtml(mrp == null ? '' : String(mrp)) + '" placeholder="MRP" oninput="adSetExtraProductMrp(' + (i + 1) + ', this.value)" style="flex:1;"></div>';
      }).join('');
    }

    function adSetProductCount(value) {
      const count = Math.max(1, Math.min(3, Number(value) || 1));
      const ids = Array.isArray(adEditor.productIds) && adEditor.productIds.length ? adEditor.productIds : (adEditor.productId ? [adEditor.productId] : []);
      adEditor.productIds = ids.slice(0, count);
      adEditor.productCount = count;
      renderAdEditor();
    }

    function adSelectExtraProduct(index, id) {
      adEditor.productIds = Array.isArray(adEditor.productIds) ? adEditor.productIds : [adEditor.productId].filter(Boolean);
      adEditor.productIds[index] = id || null;
      if (id) {
        const product = getProducts().find(p => String(p.id) === String(id));
        adEditor.productPrices = adEditor.productPrices || {};
        adEditor.productMrps = adEditor.productMrps || {};
        if (adEditor.productPrices[id] === undefined && product) adEditor.productPrices[id] = product.price;
        if (adEditor.productMrps[id] === undefined && product) adEditor.productMrps[id] = product.mrp;
        const priceInput = document.getElementById('adExtraPrice' + index);
        if (priceInput) priceInput.value = adEditor.productPrices[id] == null ? '' : adEditor.productPrices[id];
        const mrpInput = document.getElementById('adExtraMrp' + index);
        if (mrpInput) mrpInput.value = adEditor.productMrps[id] == null ? '' : adEditor.productMrps[id];
      }
      queueAutoSave(); adDrawSoon();
    }

    function adSetExtraProductPrice(index, value) {
      const id = (adEditor.productIds || [])[index];
      if (!id) return;
      adEditor.productPrices = adEditor.productPrices || {};
      adEditor.productPrices[id] = value === '' ? '' : Math.max(0, Number(value) || 0);
      queueAutoSave(); adDrawSoon();
    }

    function adSetExtraProductMrp(index, value) {
      const id = (adEditor.productIds || [])[index];
      if (!id) return;
      adEditor.productMrps = adEditor.productMrps || {};
      adEditor.productMrps[id] = value === '' ? '' : Math.max(0, Number(value) || 0);
      queueAutoSave(); adDrawSoon();
    }

    function adSetTemplate(k) { adEditor.template = k; queueAutoSave(); renderAdEditor(); }
    function adSetFormat(f) { adEditor.format = f; queueAutoSave(); renderAdEditor(); }

    // ---- template text lines ----
    function renderAdLines() {
      const wrap = document.getElementById('adLines');
      if (!wrap) return;
      wrap.innerHTML = (adEditor.lines || []).map((ln, i) => `
        <div style="display:flex;gap:6px;margin-bottom:6px;">
          <input type="text" value="${escapeHtml(ln.text||'')}" oninput="adEditLine(${i},this.value)" style="flex:1;" placeholder="Text line">
          <button onclick="adRemoveLine(${i})" class="ad-mini" style="background:#ffebee;color:#c62828;">✕</button>
        </div>`).join('');
    }
    function adAddLine() { adEditor.lines = adEditor.lines || []; adEditor.lines.push({ text: '' }); renderAdLines(); }
    function adEditLine(i, v) { adEditor.lines[i].text = v; queueAutoSave(); adDrawSoon(); }
    function adRemoveLine(i) { adEditor.lines.splice(i, 1); renderAdLines(); adDrawSoon(); }

    // ==========================================================
    // ADS MODULE — image handling, canvas draw, export, caption gen, library
    // ==========================================================
    let _adImgObj = null;   // loaded HTMLImageElement for the product image
    let _adBgObj = null;    // loaded HTMLImageElement for the custom background
    let _adBgLoadToken = 0;
    const _adOverlayCache = {};
    const _adMultiImgCache = {};

    function adSetImageSrc(src) {
      adEditor.img = adEditor.img || { zoom: 1, x: 0, y: 0, rot: 0, flipH: false, flipV: false };
      adEditor.img.src = src;
      // reset transform for a new image
      adEditor.img.zoom = 1; adEditor.img.x = 0; adEditor.img.y = 0; adEditor.img.rot = 0;
      adEditor.img.flipH = false; adEditor.img.flipV = false;

      // Ensure the new image is loaded into the canvas image object immediately.
      // Selecting a product or uploading a file sets the src without creating the
      // canvas image element, which left the preview blank even though the src existed.
      adPrepareImageThenDraw();
    }

    function adLoadImageFile(file) {
      if (!file) return;
      if (!/^image\/(jpeg|jpg|png|webp)$/i.test(file.type)) { showToast('Sirf JPG/PNG/WEBP', 'error'); return; }
      const reader = new FileReader();
      reader.onload = ev => { adSetImageSrc(ev.target.result); renderAdEditor(); };
      reader.readAsDataURL(file);
    }

    function adSetBackgroundSrc(src) {
      if (!src) return;
      adEditor.background = { src, zoom: 1 };
      const token = ++_adBgLoadToken;
      const image = new Image();
      image.crossOrigin = 'anonymous';
      _adBgObj = image;
      image.onload = () => {
        if (token !== _adBgLoadToken) return;
        renderAdEditor(); adDraw();
      };
      image.onerror = () => {
        if (token !== _adBgLoadToken) return;
        _adBgObj = null; showToast('Background image load nahi hui', 'error'); adDraw();
      };
      image.src = adResolveImgSrc(src);
      queueAutoSave();
    }

    function adLoadBackgroundFile(file) {
      if (!file || !file.type.startsWith('image/')) { showToast('Sirf image file choose karo', 'error'); return; }
      const reader = new FileReader();
      reader.onload = ev => adSetBackgroundSrc(ev.target.result);
      reader.readAsDataURL(file);
    }

    function adAddOverlayFile(file) {
      if (!file || !file.type.startsWith('image/')) { showToast('Sirf image file choose karo', 'error'); return; }
      const reader = new FileReader();
      reader.onload = ev => {
        adRecordHistory();
        const id = 'overlay_' + Date.now();
        adEditor.overlays = adEditor.overlays || [];
        adEditor.overlays.push({ id, src: ev.target.result, x: 0, y: 0, scale: 1 });
        adLoadOverlay(id, ev.target.result);
        _adSelected = 'overlay:' + id;
        renderAdEditor();
        queueAutoSave();
      };
      reader.readAsDataURL(file);
    }

    function adLoadOverlay(id, src) {
      if (_adOverlayCache[id]) return;
      const image = new Image();
      image.onload = () => adDraw();
      image.src = adResolveImgSrc(src);
      _adOverlayCache[id] = image;
    }

    function adDeleteSelected() {
      if (!_adSelected) return;
      if (_adSelected.startsWith('overlay:')) {
        adRecordHistory();
        const id = _adSelected.slice(8);
        adEditor.overlays = (adEditor.overlays || []).filter(item => item.id !== id);
        delete _adOverlayCache[id];
        _adSelected = '';
        renderAdEditor();
        queueAutoSave();
      } else if (_adSelected === 'background') {
        if (_adSelected === 'background') adRemoveBackground();
      } else if (_adSelected === 'products' || ['header', 'title', 'discount', 'cta', 'footer'].includes(_adSelected)) {
        adRecordHistory();
        adEditor.hiddenLayers = adEditor.hiddenLayers || {};
        adEditor.hiddenLayers[_adSelected] = true;
        adDraw();
        queueAutoSave();
      } else if (_adSelected.startsWith('line:')) {
        const index = Number(_adSelected.slice(5));
        if (Number.isInteger(index) && adEditor.lines[index]) {
          adRecordHistory();
          adEditor.lines.splice(index, 1);
          _adSelected = '';
          renderAdEditor();
          queueAutoSave();
        }
      }
    }

    function adUseBackgroundUrl() {
      const input = document.getElementById('adBgUrl');
      const src = input ? input.value.trim() : '';
      if (!src) { showToast('Background image URL daalo', 'info'); return; }
      adSetBackgroundSrc(src);
    }

    function adRemoveBackground() {
      adEditor.background = null;
      _adBgObj = null;
      renderAdEditor();
      adDraw();
      queueAutoSave();
    }

    function adBackgroundZoom(value) {
      if (!adEditor.background) return;
      adEditor.background.zoom = Number(value) / 100;
      const label = document.getElementById('adBgZoomVal');
      if (label) label.textContent = Math.round(value) + '%';
      adDraw();
      queueAutoSave();
    }

    function adWaitForCanvasImages() {
      const pending = [];
      if (_adImgObj && !_adImgObj.complete) pending.push(new Promise(resolve => {
        _adImgObj.addEventListener('load', resolve, { once: true });
        _adImgObj.addEventListener('error', resolve, { once: true });
      }));
      if (_adBgObj && !_adBgObj.complete) pending.push(new Promise(resolve => {
        _adBgObj.addEventListener('load', resolve, { once: true });
        _adBgObj.addEventListener('error', resolve, { once: true });
      }));
      Object.values(_adMultiImgCache).forEach(entry => {
        const image = entry && entry.image;
        if (image && !image.complete) pending.push(new Promise(resolve => {
          image.addEventListener('load', resolve, { once: true });
          image.addEventListener('error', resolve, { once: true });
        }));
      });
      Object.values(_adOverlayCache).forEach(image => {
        if (image && !image.complete) pending.push(new Promise(resolve => {
          image.addEventListener('load', resolve, { once: true });
          image.addEventListener('error', resolve, { once: true });
        }));
      });
      return Promise.all(pending);
    }

    function adDropImage(ev) {
      ev.preventDefault();
      ev.currentTarget.style.background = '';
      const f = ev.dataTransfer.files && ev.dataTransfer.files[0];
      if (f) adLoadImageFile(f);
    }

    function adImgRemove() { adEditor.img = null; _adImgObj = null; renderAdEditor(); }
    function adImgReset() {
      if (!adEditor.img) return;
      adEditor.img.zoom = 1; adEditor.img.x = 0; adEditor.img.y = 0; adEditor.img.rot = 0;
      adEditor.img.flipH = false; adEditor.img.flipV = false;
      const z = document.getElementById('adZoom'); if (z) z.value = 100;
      const zv = document.getElementById('adZoomVal'); if (zv) zv.textContent = '100%';
        adDraw(); queueAutoSave();
    }
    function adImgZoom(v) {
      if (!adEditor.img) return;
      adEditor.img.zoom = Number(v) / 100;
      const zv = document.getElementById('adZoomVal'); if (zv) zv.textContent = Math.round(v) + '%';
      adDraw(); queueAutoSave();
    }
    function adImgRotate(deg) { if (!adEditor.img) return; adEditor.img.rot = ((adEditor.img.rot || 0) + deg) % 360; adDraw(); queueAutoSave(); }
    function adImgFlip(axis) { if (!adEditor.img) return; if (axis === 'h') adEditor.img.flipH = !adEditor.img.flipH; else adEditor.img.flipV = !adEditor.img.flipV; adDraw(); queueAutoSave(); }

    function adRemoveImageBackground() {
      if (!_adImgObj || !_adImgObj.width || !_adImgObj.height) { showToast('Pehle local product image upload karo', 'info'); return; }
      try {
        const work = document.createElement('canvas');
        work.width = _adImgObj.width; work.height = _adImgObj.height;
        const ctx = work.getContext('2d');
        ctx.drawImage(_adImgObj, 0, 0);
        const pixels = ctx.getImageData(0, 0, work.width, work.height);
        const data = pixels.data, width = work.width, height = work.height;
        const queue = [], seen = new Uint8Array(width * height);
        const tolerance = 42;
        const similar = (offset, r, g, b) => Math.abs(data[offset] - r) + Math.abs(data[offset + 1] - g) + Math.abs(data[offset + 2] - b) < tolerance * 3;
        const add = (x, y) => { if (x >= 0 && y >= 0 && x < width && y < height) { const i = y * width + x; if (!seen[i]) { seen[i] = 1; queue.push(i); } } };
        for (let x = 0; x < width; x++) { add(x, 0); add(x, height - 1); }
        for (let y = 0; y < height; y++) { add(0, y); add(width - 1, y); }
        while (queue.length) {
          const i = queue.pop(), x = i % width, y = Math.floor(i / width), o = i * 4;
          const r = data[o], g = data[o + 1], b = data[o + 2];
          if (Math.min(r, g, b) < 205 || !similar(o, r, g, b)) continue;
          data[o + 3] = 0;
          add(x - 1, y); add(x + 1, y); add(x, y - 1); add(x, y + 1);
        }
        ctx.putImageData(pixels, 0, 0);
        adSetImageSrc(work.toDataURL('image/png'));
        showToast('Background removed (light edge background)', 'success');
      } catch (error) {
        showToast('Remote image par background remove nahi ho sakta. Image upload karo.', 'error');
      }
    }

    // Resolve an image src for the canvas. External http(s) URLs are routed
    // through our same-origin proxy so the canvas stays exportable (not tainted).
    function adResolveImgSrc(src) {
      if (!src) return src;
      if (src.startsWith('data:') || src.startsWith('blob:')) return src;   // uploaded file
      if (/^https?:\/\//i.test(src)) {
        // Same-origin already? then use directly
        try {
          const u = new URL(src, window.location.href);
          if (u.origin === window.location.origin) return src;
        } catch (e) {}
        return '/api/img-proxy?url=' + encodeURIComponent(src);
      }
      return src;   // relative path (same origin)
    }

    // Load the image element (if any) then draw
    function adPrepareImageThenDraw() {
      if (adEditor.img && adEditor.img.src) {
        _adImgObj = new Image();
        _adImgObj.crossOrigin = 'anonymous';
        _adImgObj.onload = () => adDraw();
        _adImgObj.onerror = () => { _adImgObj = null; adDraw(); showToast('Product image load nahi hui. Apni image upload karo.', 'info'); };
        _adImgObj.src = adResolveImgSrc(adEditor.img.src);
      } else {
        _adImgObj = null;
        adDraw();
      }
      if (adEditor.background && adEditor.background.src && !_adBgObj) {
        _adBgObj = new Image();
        _adBgObj.crossOrigin = 'anonymous';
        _adBgObj.onload = () => adDraw();
        _adBgObj.onerror = () => { _adBgObj = null; adDraw(); };
        _adBgObj.src = adResolveImgSrc(adEditor.background.src);
      }
    }

    function adPrepareMultiImages(adProducts) {
      (adProducts || []).forEach(product => {
        if (!product.image || _adMultiImgCache[product.id]) return;
        const image = new Image();
        image.crossOrigin = 'anonymous';
        _adMultiImgCache[product.id] = { loading: true, image };
        image.onload = () => {
          _adMultiImgCache[product.id] = { loading: false, image };
          adDraw();
        };
        image.onerror = () => { _adMultiImgCache[product.id] = { loading: false, image: null }; adDraw(); };
        image.src = adResolveImgSrc(product.image);
      });
    }

    let _adDrawTimer = null;
    let _adHitAreas = [];
    let _adSelected = '';
    let _adUndoStack = [];
    let _adRedoStack = [];
    let _adHistoryState = '';
    function adDrawSoon() { clearTimeout(_adDrawTimer); _adDrawTimer = setTimeout(adDraw, 120); }

    function adSnapshot() { return JSON.stringify({ layout: adEditor.layout, textColors: adEditor.textColors, hiddenLayers: adEditor.hiddenLayers, headerTitle: adEditor.headerTitle, headerTagline: adEditor.headerTagline, offerTitle: adEditor.offerTitle, discount: adEditor.discount, cta: adEditor.cta, overlays: adEditor.overlays }); }
    function adRecordHistory() {
      const next = adSnapshot();
      if (_adHistoryState && _adHistoryState !== next) _adUndoStack.push(_adHistoryState);
      _adHistoryState = next;
      _adRedoStack = [];
      if (_adUndoStack.length > 30) _adUndoStack.shift();
    }
    function adRestoreSnapshot(snapshot) {
      const data = JSON.parse(snapshot);
      Object.assign(adEditor, data);
      adEditor.textColors = adEditor.textColors || {};
      adEditor.hiddenLayers = adEditor.hiddenLayers || {};
      adEditor.overlays = adEditor.overlays || [];
      _adHistoryState = snapshot;
      renderAdEditor();
      queueAutoSave();
    }
    function adUndo() {
      if (!_adUndoStack.length) return;
      _adRedoStack.push(adSnapshot());
      adRestoreSnapshot(_adUndoStack.pop());
    }
    function adRedo() {
      if (!_adRedoStack.length) return;
      _adUndoStack.push(adSnapshot());
      adRestoreSnapshot(_adRedoStack.pop());
    }

    function adLayout(key) {
      adEditor.layout = adEditor.layout || {};
      adEditor.layout[key] = adEditor.layout[key] || {};
      return adEditor.layout[key];
    }

    function adSelectElement(key) {
      _adSelected = key;
      adSyncSelectedControls();
      adDraw();
    }

    function adSyncSelectedControls() {
      const selectedOverlay = _adSelected.startsWith('overlay:') ? (adEditor.overlays || []).find(item => item.id === _adSelected.slice(8)) : null;
      const layout = selectedOverlay || (_adSelected ? adLayout(_adSelected) : {});
      const textKeys = { header: 'headerTitle', title: 'offerTitle', discount: 'discount', cta: 'cta' };
      const textKey = textKeys[_adSelected];
      const textColors = adEditor.textColors || {};
      const label = document.getElementById('adSelectedElement');
      const slider = document.getElementById('adElementScale');
      const value = document.getElementById('adElementScaleVal');
      const text = document.getElementById('adSelectedText');
      const tagline = document.getElementById('adSelectedTagline');
      const color = document.getElementById('adSelectedColor');
      if (label) label.textContent = _adSelected || 'None';
      if (slider) slider.value = Math.round((layout.scale || 1) * 100);
      if (value) value.textContent = Math.round((layout.scale || 1) * 100) + '%';
      const lineIndex = _adSelected.startsWith('line:') ? Number(_adSelected.slice(5)) : -1;
      if (text) { text.value = textKey ? String(adEditor[textKey] || '') : (lineIndex >= 0 && adEditor.lines[lineIndex] ? String(adEditor.lines[lineIndex].text || '') : ''); text.disabled = !textKey && lineIndex < 0; }
      if (tagline) {
        tagline.value = _adSelected === 'header' ? String(adEditor.headerTagline || '') : '';
        tagline.style.display = _adSelected === 'header' ? '' : 'none';
      }
      if (color) { color.value = textColors[_adSelected] || '#ffffff'; color.disabled = !textKey && !['header', 'footer'].includes(_adSelected) && lineIndex < 0; }
    }

    function adSetSelectedText(value) {
      const keys = { header: 'headerTitle', title: 'offerTitle', discount: 'discount', cta: 'cta' };
      const lineIndex = _adSelected.startsWith('line:') ? Number(_adSelected.slice(5)) : -1;
      if (!_adSelected || (!keys[_adSelected] && lineIndex < 0)) return;
      adRecordHistory();
      if (lineIndex >= 0 && adEditor.lines[lineIndex]) adEditor.lines[lineIndex].text = value;
      else adEditor[keys[_adSelected]] = value;
      adSyncSelectedControls();
      adDraw(); queueAutoSave();
    }

    function adSetSelectedTagline(value) {
      if (_adSelected !== 'header') return;
      adRecordHistory();
      adEditor.headerTagline = value;
      adSyncSelectedControls();
      adDraw(); queueAutoSave();
    }

    function adSetSelectedColor(value) {
      if (!_adSelected || (!['header', 'title', 'discount', 'cta', 'footer'].includes(_adSelected) && !_adSelected.startsWith('line:'))) return;
      adRecordHistory();
      adEditor.textColors = adEditor.textColors || {};
      adEditor.textColors[_adSelected] = value;
      adDraw(); queueAutoSave();
    }

    function adSetSelectedScale(value) {
      if (!_adSelected) return;
      adRecordHistory();
      if (_adSelected.startsWith('overlay:')) {
        const item = (adEditor.overlays || []).find(entry => entry.id === _adSelected.slice(8));
        if (item) item.scale = Number(value) / 100;
      } else {
        adLayout(_adSelected).scale = Number(value) / 100;
      }
      const label = document.getElementById('adElementScaleVal');
      if (label) label.textContent = Math.round(value) + '%';
      adDraw(); queueAutoSave();
    }

    function adResetLayout() {
      adRecordHistory();
      adEditor.layout = { background: {}, products: {}, title: {}, discount: {}, cta: {}, footer: {} };
      adEditor.hiddenLayers = {};
      _adSelected = '';
      adSelectElement('');
      queueAutoSave();
    }

    // Core canvas renderer — draws the full creative
    function adDraw() {
      const canvas = document.getElementById('adCanvas');
      if (!canvas) return;
      const e = adEditor;
      const fmt = AD_FORMATS[e.format] || AD_FORMATS['1:1'];
      canvas.width = fmt.w; canvas.height = fmt.h;
      const ctx = canvas.getContext('2d');
      const W = fmt.w, H = fmt.h;
      const tpl = AD_TEMPLATES[e.template] || AD_TEMPLATES['todays-offer'];

      // Background gradient (diagonal for a livelier look)
      const g = ctx.createLinearGradient(0, 0, W, H);
      g.addColorStop(0, tpl.bg[0]); g.addColorStop(1, tpl.bg[1]);
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

      // Custom background sits behind the template decorations and text.
      if (_adBgObj && _adBgObj.width && _adBgObj.height) {
        const bgZoom = Math.max(0.5, Number(e.background?.zoom || 1));
        const bgLayout = adLayout('background');
        const bgScale = Math.max(W / _adBgObj.width, H / _adBgObj.height) * bgZoom;
        const bgW = _adBgObj.width * bgScale;
        const bgH = _adBgObj.height * bgScale;
        ctx.save();
        ctx.globalAlpha = 0.88;
        ctx.translate(W / 2 + (bgLayout.x || 0), H / 2 + (bgLayout.y || 0));
        ctx.scale(bgLayout.scale || 1, bgLayout.scale || 1);
        ctx.drawImage(_adBgObj, -bgW / 2, -bgH / 2, bgW, bgH);
        ctx.restore();
      }

      // Additional user images are independent movable layers.
      (e.overlays || []).forEach(item => {
        if (!item.src) return;
        adLoadOverlay(item.id, item.src);
        const image = _adOverlayCache[item.id];
        if (!image || !image.width) return;
        const scale = Math.min(W / image.width, H / image.height) * 0.28 * (item.scale || 1);
        const width = image.width * scale;
        const height = image.height * scale;
        ctx.save();
        ctx.translate(W / 2 + (item.x || 0), H / 2 + (item.y || 0));
        ctx.drawImage(image, -width / 2, -height / 2, width, height);
        ctx.restore();
      });

      // Decorative background shapes (soft circles + accent blobs) so it doesn't
      // look flat. Kept subtle with low opacity so text stays readable.
      const _U0 = Math.min(W, H);
      ctx.save();
      ctx.globalAlpha = 0.10;
      ctx.fillStyle = e.textColors.title || '#ffffff';
      ctx.beginPath(); ctx.arc(W*0.90, H*0.08, _U0*0.22, 0, Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.arc(W*0.06, H*0.92, _U0*0.26, 0, Math.PI*2); ctx.fill();
      ctx.globalAlpha = 0.14;
      ctx.fillStyle = tpl.accent;
      ctx.beginPath(); ctx.arc(W*0.10, H*0.06, _U0*0.10, 0, Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.arc(W*0.94, H*0.94, _U0*0.13, 0, Math.PI*2); ctx.fill();
      ctx.restore();

      const s = getSettings();
      const FONT = '"Nirmala UI","Noto Sans Devanagari","Mangal","Segoe UI",Arial,sans-serif';
      // Font unit tied to the SHORTER side so text stays readable in every ratio
      const U = Math.min(W, H);
      const pad = W * 0.06;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';

      // ---- Measure the text block first so we can size the image box to fit ----
      // Every ratio: header (top) + image (flexible) + text block + footer (bottom).
      const titleTxt = (tpl.emoji + ' ' + (e.offerTitle||'') + ' ' + tpl.emoji).trim();
      const hasDisc = !!e.discount;
      const selectedProductIds = (Array.isArray(e.productIds) && e.productIds.length ? e.productIds.filter(Boolean) : (e.productId ? [e.productId] : []))
        .slice(0, Math.max(1, Math.min(3, Number(e.productCount || 1))));
      const adProducts = selectedProductIds.map(id => {
        const product = (products || []).find(p => String(p.id) === String(id));
        return product ? Object.assign({}, product, {
          adPrice: e.productPrices && e.productPrices[id] !== undefined && e.productPrices[id] !== '' ? Number(e.productPrices[id]) : Number(product.price) || 0,
          adMrp: e.productMrps && e.productMrps[id] !== undefined && e.productMrps[id] !== '' ? Number(e.productMrps[id]) : Number(product.mrp) || 0
        }) : null;
      }).filter(Boolean);
      const multiProduct = adProducts.length > 1;
      if (multiProduct) adPrepareMultiImages(adProducts);
      const hasPrice = !!e.price && !multiProduct;
      const showMrp = hasPrice && e.mrp && String(e.mrp) !== String(e.price);
      const extraLines = (e.lines||[]).map((line, index) => ({ line, index })).filter(item => item.line && item.line.text);

      // Font sizes (based on U, clamped)
      const fStore   = Math.round(U*0.075);
      const fTagline = Math.round(U*0.032);
      const fTitle   = Math.round(U*0.058);
      const fDisc    = Math.round(U*0.11);
      const fPrice   = Math.round(U*0.058);
      const fMrp     = Math.round(U*0.038);
      const fLine    = Math.round(U*0.036);
      const fCta     = Math.round(U*0.036);
      const fFoot    = Math.round(U*0.030);
      const fAddr    = Math.round(U*0.026);

      // Pre-wrap the title to know how many lines it needs
      ctx.font = '800 ' + fTitle + 'px ' + FONT;
      const titleLines = wrapLines(ctx, titleTxt, W*0.88);

      // ---- Vertical zones ----
      // Header block height
      const headerTop = H*0.05;
      const headerH   = fStore*1.1 + fTagline*1.6;
      // Footer block height (phone line + up to 2 address lines)
      ctx.font = '500 ' + fAddr + 'px ' + FONT;
      const addr = (s && s.storeAddress) ? s.storeAddress : 'गजना रोड, चंद्रगढ़, नबीनगर, औरंगाबाद';
      const addrLines = wrapLines(ctx, '📍 ' + addr, W*0.9);
      const footerH = fFoot*1.4 + addrLines.length*fAddr*1.35 + H*0.02;
      const footerTop = H - footerH - H*0.02;

      // CTA block
      const ctaH = Math.max(U*0.075, fCta*1.9);
      const ctaW = Math.min(W*0.6, W - pad*2);

      // Text block height (title + disc + price + extra lines) with gaps
      const gap = U*0.028;
      let textBlockH = titleLines.length * fTitle*1.25;
      if (hasDisc)  textBlockH += gap + fDisc*1.0;
      if (hasPrice) textBlockH += gap + fPrice*1.05;
      textBlockH += extraLines.length * (fLine*1.4);

      // Image box: fills the space left between header and (textBlock+CTA+footer)
      const imgTop = headerTop + headerH + H*0.02;
      const belowImgNeeded = textBlockH + gap*1.5 + ctaH + H*0.03;
      let imgH = footerTop - imgTop - belowImgNeeded;
      // Keep the image box within sensible bounds for the ratio
      const minImgH = multiProduct ? H*0.24 : H*0.12;
      const maxImgH = multiProduct ? H*0.56 : H*0.5;
      imgH = Math.max(minImgH, Math.min(maxImgH, imgH));
      const maxImgW = W - pad*2;
      // Size the white card to HUG the product image (its aspect ratio) so a
      // wide format (16:9) doesn't show a big empty white box around a tiny bottle.
      let imgW = maxImgW;
      if (_adImgObj && _adImgObj.width && _adImgObj.height) {
        const ar = _adImgObj.width / _adImgObj.height;
        const fitW = imgH * ar + U*0.06;   // card width to contain the image + small margin
        imgW = Math.max(U*0.35, Math.min(maxImgW, fitW));
      }
      const imgX = W/2 - imgW/2, imgY = imgTop;
      const rr = Math.round(U*0.03);
      const productLayout = adLayout('products');
      const productOffsetX = productLayout.x || 0;
      const productOffsetY = productLayout.y || 0;
      const productScale = productLayout.scale || 1;
      const discountLayout = adLayout('discount');

      // ---- DRAW: Header ----
      if (!e.hiddenLayers.header) {
        const headerLayout = adLayout('header');
        ctx.save();
        ctx.translate(W / 2 + (headerLayout.x || 0), headerTop + (headerLayout.y || 0));
        ctx.scale(headerLayout.scale || 1, headerLayout.scale || 1);
        ctx.translate(-W / 2, -headerTop);
        ctx.fillStyle = e.textColors.header || '#ffffff';
        ctx.font = '700 ' + fStore + 'px ' + FONT;
        ctx.fillText(e.headerTitle || '4A STORE', W/2, headerTop + fStore*0.9);
        ctx.fillStyle = tpl.accent;
        ctx.font = '600 ' + fTagline + 'px ' + FONT;
        ctx.fillText(e.headerTagline || 'आपकी अपनी किराना दुकान', W/2, headerTop + fStore*0.9 + fTagline*1.4);
        ctx.restore();
      }

      // ---- DRAW: Image box ----
      ctx.save();
      ctx.translate(W / 2 + productOffsetX, imgY + imgH / 2 + productOffsetY);
      ctx.scale(productScale, productScale);
      ctx.translate(-W / 2, -(imgY + imgH / 2));
      roundRectPath(ctx, imgX, imgY, imgW, imgH, rr);
      if (multiProduct && !e.hiddenLayers.products) {
        ctx.fillStyle = 'rgba(255,255,255,0.96)'; ctx.fill(); ctx.clip();
        const cardGap = Math.max(12, U * 0.022);
        const cardW = (imgW - cardGap * (adProducts.length + 1)) / adProducts.length;
        adProducts.forEach((p, i) => {
          const cardX = imgX + cardGap + i * (cardW + cardGap);
          const cardY = imgY + imgH * 0.045;
          const cardH = imgH * 0.91;
          const innerPad = Math.max(12, U * 0.022);
          roundRectPath(ctx, cardX, cardY, cardW, cardH, rr * 0.6);
          ctx.fillStyle = i % 2 ? '#fff7e8' : '#f2faf5'; ctx.fill();
          ctx.strokeStyle = '#e4e8e8'; ctx.lineWidth = Math.max(1, U * 0.002); ctx.stroke();
          const cached = _adMultiImgCache[p.id];
          const productImg = cached && cached.image;
          const imageTop = cardY + innerPad;
          const imageH = cardH * 0.50;
          if (productImg && productImg.width && productImg.height) {
            const iw = productImg.width, ih = productImg.height;
            const productZoom = Math.max(0.2, Number(e.img?.zoom || 1.18));
            const scale = Math.min((cardW - innerPad * 2) / iw, imageH / ih) * 0.98 * productZoom;
            ctx.drawImage(productImg, cardX + cardW / 2 - iw * scale / 2, imageTop + imageH / 2 - ih * scale / 2, iw * scale, ih * scale);
          } else {
            ctx.fillStyle = '#dfeee5';
            ctx.font = '700 ' + Math.max(16, Math.round(U * 0.028)) + 'px ' + FONT;
            ctx.fillText('🛒', cardX + cardW / 2, imageTop + imageH / 2);
          }
          const nameFont = Math.max(18, Math.min(Math.round(U * 0.045), Math.round(cardW * 0.13)));
          const nameLineH = nameFont * 1.15;
          ctx.fillStyle = '#17324d'; ctx.font = '800 ' + nameFont + 'px ' + FONT;
          const nameLines = wrapLines(ctx, p.name || 'Product', cardW - innerPad * 2).slice(0, 3);
          const nameStartY = imageTop + imageH + nameFont * 0.9;
          nameLines.forEach((line, n) => ctx.fillText(line, cardX + cardW / 2, nameStartY + n * nameLineH));
          const multiPriceY = cardY + cardH - innerPad * 1.8;
          const saleFont = Math.max(18, Math.min(Math.round(U * 0.052), Math.round(cardW * 0.19)));
          const mrpFont = Math.max(13, Math.min(Math.round(U * 0.030), Math.round(cardW * 0.13)));
          const saleText = '₹' + p.adPrice;
          const mrpText = p.adMrp && p.adMrp !== p.adPrice ? '₹' + p.adMrp : '';
          ctx.font = '900 ' + saleFont + 'px ' + FONT;
          const saleWidth = ctx.measureText(saleText).width;
          ctx.font = '600 ' + mrpFont + 'px ' + FONT;
          const mrpWidth = mrpText ? ctx.measureText(mrpText).width : 0;
          const priceGap = mrpText ? Math.max(8, U * 0.012) : 0;
          const pillWidth = Math.min(cardW - innerPad, saleWidth + mrpWidth + priceGap + innerPad);
          const pillHeight = Math.max(30, saleFont * 1.35);
          const pillX = cardX + cardW / 2 - pillWidth / 2;
          const pillY = multiPriceY - pillHeight * 0.78;
          roundRectPath(ctx, pillX, pillY, pillWidth, pillHeight, pillHeight / 2);
          ctx.fillStyle = '#fff1a8'; ctx.fill();
          ctx.textAlign = 'left';
          ctx.font = '900 ' + saleFont + 'px ' + FONT;
          ctx.fillStyle = tpl.bg[0];
          ctx.fillText(saleText, cardX + cardW / 2 - (saleWidth + priceGap + mrpWidth) / 2, multiPriceY);
          if (mrpText) {
            const mrpX = cardX + cardW / 2 - (saleWidth + priceGap + mrpWidth) / 2 + saleWidth + priceGap;
            ctx.font = '600 ' + mrpFont + 'px ' + FONT;
            ctx.fillStyle = '#6b7280';
            ctx.fillText(mrpText, mrpX, multiPriceY);
            ctx.strokeStyle = '#6b7280'; ctx.lineWidth = Math.max(1, U * 0.002);
            ctx.beginPath(); ctx.moveTo(mrpX, multiPriceY - mrpFont * 0.3); ctx.lineTo(mrpX + mrpWidth, multiPriceY - mrpFont * 0.3); ctx.stroke();
          }
          ctx.textAlign = 'center';
        });
      } else if (!e.hiddenLayers.products && _adImgObj && e.img) {
        ctx.fillStyle = '#ffffff'; ctx.fill();
        ctx.clip();
        const cx = imgX + imgW/2 + (e.img.x||0);
        const cy = imgY + imgH/2 + (e.img.y||0);
        ctx.translate(cx, cy);
        ctx.rotate((e.img.rot||0) * Math.PI/180);
        ctx.scale((e.img.flipH?-1:1)*(e.img.zoom||1), (e.img.flipV?-1:1)*(e.img.zoom||1));
        const iw = _adImgObj.width, ih = _adImgObj.height;
        const sc = Math.min(imgW/iw, imgH/ih) * 0.92;   // contain with small margin
        ctx.drawImage(_adImgObj, -iw*sc/2, -ih*sc/2, iw*sc, ih*sc);
      } else if (!e.hiddenLayers.products) {
        ctx.fillStyle = 'rgba(255,255,255,0.15)'; ctx.fill();
        ctx.clip();
        ctx.fillStyle = 'rgba(255,255,255,0.75)';
        ctx.font = '500 ' + Math.round(U*0.032) + 'px ' + FONT;
        ctx.textBaseline = 'middle';
        ctx.fillText('🖼️ Product image daalein', W/2, imgY + imgH/2);
        ctx.textBaseline = 'alphabetic';
      }
      ctx.restore();

      // ---- DRAW: Text block (flows below the image) ----
      let y = imgY + imgH + gap*1.4;
      const titleLayout = adLayout('title');
      const titleScale = titleLayout.scale || 1;

      // Title (multi-line)
      if (!e.hiddenLayers.title) {
        ctx.save();
        ctx.translate(W / 2 + (titleLayout.x || 0), y + (titleLayout.y || 0));
        ctx.scale(titleScale, titleScale);
        ctx.translate(-W / 2, -y);
        ctx.fillStyle = e.textColors.title || '#ffffff';
        ctx.font = '800 ' + fTitle + 'px ' + FONT;
        titleLines.forEach(l => { y += fTitle; ctx.fillText(l, W/2, y); y += fTitle*0.25; });
        ctx.restore();
      } else {
        y += titleLines.length * fTitle * 1.25;
      }

      // Discount badge
      if (hasDisc && !e.hiddenLayers.discount) {
        y += gap + fDisc*0.85;
        ctx.save();
        ctx.translate(W / 2 + (discountLayout.x || 0), y + (discountLayout.y || 0));
        ctx.scale(discountLayout.scale || 1, discountLayout.scale || 1);
        ctx.translate(-W / 2, -y);
        ctx.fillStyle = e.textColors.discount || tpl.accent;
        ctx.font = '900 ' + fDisc + 'px ' + FONT;
        ctx.fillText(e.discount + '% OFF', W/2, y);
        ctx.restore();
      }

      // Price + struck MRP
      if (hasPrice) {
        y += gap + fPrice*0.9;
        const priceTxt = '₹' + e.price;
        ctx.font = '800 ' + fPrice + 'px ' + FONT;
        const pw = ctx.measureText(priceTxt).width;
        ctx.font = '600 ' + fMrp + 'px ' + FONT;
        const mrpTxt = showMrp ? ('₹' + e.mrp) : '';
        const mw = showMrp ? ctx.measureText(mrpTxt).width : 0;
        const g2 = showMrp ? W*0.03 : 0;
        const startX = W/2 - (pw + g2 + mw)/2;
        ctx.textAlign = 'left';
        ctx.font = '800 ' + fPrice + 'px ' + FONT;
        ctx.fillStyle = '#ffffff';
        ctx.fillText(priceTxt, startX, y);
        if (showMrp) {
          const mx = startX + pw + g2;
          ctx.font = '600 ' + fMrp + 'px ' + FONT;
          ctx.fillStyle = 'rgba(255,255,255,0.75)';
          ctx.fillText(mrpTxt, mx, y);
          ctx.strokeStyle = 'rgba(255,255,255,0.75)'; ctx.lineWidth = Math.max(2, U*0.004);
          ctx.beginPath(); ctx.moveTo(mx, y - fMrp*0.3); ctx.lineTo(mx + mw, y - fMrp*0.3); ctx.stroke();
        }
        ctx.textAlign = 'center';
      }

      // Extra custom lines
      const lineHitAreas = [];
      extraLines.forEach((item) => {
        const ln = item.line;
        const index = item.index;
        y += fLine*1.35;
        const lineLayout = adLayout('line:' + index);
        const lineScale = lineLayout.scale || 1;
        ctx.save();
        ctx.translate(W / 2 + (lineLayout.x || 0), y + (lineLayout.y || 0));
        ctx.scale(lineScale, lineScale);
        ctx.translate(-W / 2, -y);
        ctx.font = '600 ' + fLine + 'px ' + FONT;
        ctx.fillStyle = e.textColors['line:' + index] || '#fff';
        ctx.fillText(ln.text, W/2, y);
        ctx.restore();
        lineHitAreas.push({ key: 'line:' + index, x: W * 0.12 + (lineLayout.x || 0), y: y - fLine + (lineLayout.y || 0), w: W * 0.76 * lineScale, h: fLine * 1.6 * lineScale });
      });

      // ---- DRAW: CTA button (anchored above footer) ----
      const ctaX = W/2 - ctaW/2;
      const ctaY = footerTop - H*0.02 - ctaH;
      const ctaLayout = adLayout('cta');
      if (!e.hiddenLayers.cta) {
        ctx.save();
        ctx.translate(W / 2 + (ctaLayout.x || 0), ctaY + ctaH / 2 + (ctaLayout.y || 0));
        ctx.scale(ctaLayout.scale || 1, ctaLayout.scale || 1);
        ctx.translate(-W / 2, -(ctaY + ctaH / 2));
        roundRectPath(ctx, ctaX, ctaY, ctaW, ctaH, ctaH/2);
        ctx.fillStyle = tpl.accent; ctx.fill();
        ctx.fillStyle = e.textColors.cta || '#3a2400';
        ctx.font = '800 ' + fCta + 'px ' + FONT;
        ctx.textBaseline = 'middle';
        ctx.fillText(e.cta || 'Order Now', W/2, ctaY + ctaH/2);
        ctx.textBaseline = 'alphabetic';
        ctx.restore();
      }

      // ---- DRAW: Footer (phone + site, then address) anchored to bottom ----
      const footerLayout = adLayout('footer');
      ctx.save();
      ctx.translate(W / 2 + (footerLayout.x || 0), footerTop + (footerLayout.y || 0));
      ctx.scale(footerLayout.scale || 1, footerLayout.scale || 1);
      ctx.translate(-W / 2, -footerTop);
      if (e.hiddenLayers.footer) { ctx.restore(); } else {
      ctx.fillStyle = e.textColors.footer || '#ffffff';
      ctx.font = '700 ' + fFoot + 'px ' + FONT;
      const phone = (s && s.storePhone) ? s.storePhone : '7543888698';
      let fy = footerTop + fFoot;
      ctx.fillText('📞 ' + phone + '   •   🌐 4astore.com', W/2, fy);
      ctx.font = '500 ' + fAddr + 'px ' + FONT;
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      addrLines.forEach(l => { fy += fAddr*1.35; ctx.fillText(l, W/2, fy); });
      ctx.restore();
      }

      _adHitAreas = [
        { key: 'background', x: 0, y: 0, w: W, h: H },
        ...(e.overlays || []).map(item => {
          const image = _adOverlayCache[item.id];
          const scale = image && image.width ? Math.min(W / image.width, H / image.height) * 0.28 * (item.scale || 1) : 120;
          return { key: 'overlay:' + item.id, x: W / 2 + (item.x || 0) - (image ? image.width * scale / 2 : 60), y: H / 2 + (item.y || 0) - (image ? image.height * scale / 2 : 60), w: image ? image.width * scale : 120, h: image ? image.height * scale : 120 };
        }),
        { key: 'products', x: imgX + productOffsetX, y: imgY + productOffsetY, w: imgW * productScale, h: imgH * productScale },
        { key: 'header', x: W * 0.18, y: headerTop - fStore * 0.2, w: W * 0.64, h: fStore + fTagline * 2.1 },
        { key: 'title', x: W * 0.05 + (titleLayout.x || 0), y: imgY + imgH + (titleLayout.y || 0), w: W * 0.9, h: Math.max(fTitle * 1.5, titleLines.length * fTitle * 1.5) },
        { key: 'discount', x: W * 0.2 + (discountLayout.x || 0), y: y - fDisc + (discountLayout.y || 0), w: W * 0.6, h: fDisc * 1.4 },
        ...lineHitAreas,
        { key: 'cta', x: ctaX + (ctaLayout.x || 0), y: ctaY + (ctaLayout.y || 0), w: ctaW * (ctaLayout.scale || 1), h: ctaH * (ctaLayout.scale || 1) },
        { key: 'footer', x: W * 0.08 + (footerLayout.x || 0), y: footerTop + (footerLayout.y || 0), w: W * 0.84, h: footerH * (footerLayout.scale || 1) }
      ];
    }

    // Wrap text into an array of lines that fit maxW (no drawing)
    function wrapLines(ctx, text, maxW) {
      const words = String(text).split(' ');
      let line = '', out = [];
      words.forEach(w => {
        const test = line ? line + ' ' + w : w;
        if (ctx.measureText(test).width > maxW && line) { out.push(line); line = w; }
        else line = test;
      });
      if (line) out.push(line);
      return out;
    }

    function roundRectPath(ctx, x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x+r, y);
      ctx.arcTo(x+w, y, x+w, y+h, r);
      ctx.arcTo(x+w, y+h, x, y+h, r);
      ctx.arcTo(x, y+h, x, y, r);
      ctx.arcTo(x, y, x+w, y, r);
      ctx.closePath();
    }
    function wrapText(ctx, text, x, y, maxW, lh) {
      const words = String(text).split(' ');
      let line = '', lines = [];
      words.forEach(w => {
        const test = line ? line + ' ' + w : w;
        if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = w; }
        else line = test;
      });
      if (line) lines.push(line);
      const startY = y - (lines.length-1)*lh/2;
      lines.forEach((l, i) => ctx.fillText(l, x, startY + i*lh));
    }

    // ---- drag image on canvas (mouse + touch) ----
    let _adDrag = null;
    let _adPointerMoved = false;
    function adCanvasPointerDown(clientX, clientY) {
      const canvas = document.getElementById('adCanvas');
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const x = (clientX - rect.left) * canvas.width / rect.width;
      const y = (clientY - rect.top) * canvas.height / rect.height;
      const hit = _adHitAreas.slice().reverse().find(area => x >= area.x && x <= area.x + area.w && y >= area.y && y <= area.y + area.h);
      const key = hit ? hit.key : 'background';
      const overlay = key.startsWith('overlay:') ? (adEditor.overlays || []).find(item => item.id === key.slice(8)) : null;
      const layout = overlay || adLayout(key);
      adSelectElement(key);
      _adPointerMoved = false;
      _adDrag = { sx: clientX, sy: clientY, ox: layout.x || 0, oy: layout.y || 0, key, scale: canvas.width / rect.width };
    }
    function adCanvasPointerMove(clientX, clientY) {
      if (!_adDrag) return;
      if (Math.abs(clientX - _adDrag.sx) > 3 || Math.abs(clientY - _adDrag.sy) > 3) _adPointerMoved = true;
      const layout = _adDrag.key.startsWith('overlay:')
        ? (adEditor.overlays || []).find(item => item.id === _adDrag.key.slice(8))
        : adLayout(_adDrag.key);
      if (!layout) return;
      layout.x = _adDrag.ox + (clientX - _adDrag.sx) * _adDrag.scale;
      layout.y = _adDrag.oy + (clientY - _adDrag.sy) * _adDrag.scale;
      adDraw();
    }
    function adCanvasPointerUp() { if (_adDrag) { _adDrag = null; queueAutoSave(); } }

    function adCanvasActivateCTA(clientX, clientY) {
      if (_adPointerMoved || !adEditor.ctaLink) return;
      const canvas = document.getElementById('adCanvas');
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const x = (clientX - rect.left) * canvas.width / rect.width;
      const y = (clientY - rect.top) * canvas.height / rect.height;
      const cta = _adHitAreas.find(area => area.key === 'cta');
      if (!cta || x < cta.x || x > cta.x + cta.w || y < cta.y || y > cta.y + cta.h) return;
      const target = String(adEditor.ctaLink).trim();
      if (!target) return;
      window.open(target, '_blank', 'noopener,noreferrer');
    }

    // ---- Export ----
    function adSafeName(ext) {
      const parts = ['4A_STORE', (adEditor.offerTitle||'Ad'), (adEditor.discount? adEditor.discount+'off':''), new Date().toISOString().slice(0,10)];
      return parts.filter(Boolean).join('_').replace(/[^\w\-]+/g, '_') + '.' + ext;
    }
    async function adDownload(fmt) {
      const canvas = document.getElementById('adCanvas');
      if (!canvas) return;
      await adWaitForCanvasImages();
      adDraw();
      const mime = fmt === 'jpg' ? 'image/jpeg' : 'image/png';
      let dataUrl;
      try { dataUrl = canvas.toDataURL(mime, 0.92); }
      catch (err) { showToast('Image cross-origin block. Product image ko upload karke try karo.', 'error'); return; }
      // In-app bridge (WebView) or normal download
      if (window.AndroidApp && typeof window.AndroidApp.saveBase64File === 'function') {
        const base64 = dataUrl.split(',')[1];
        window.AndroidApp.saveBase64File(base64, adSafeName(fmt), mime);
        showToast('Saved to phone', 'success');
        return;
      }
      const a = document.createElement('a');
      a.href = dataUrl; a.download = adSafeName(fmt);
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      showToast('Downloaded', 'success');
    }

    function adCopyCaption() {
      const text = (adEditor.caption || '') + (adEditor.hashtags ? '\n\n' + adEditor.hashtags : '');
      if (!text.trim()) { showToast('Pehle caption generate karo', 'info'); return; }
      navigator.clipboard.writeText(text).then(
        () => showToast('Caption copied', 'success'),
        () => showToast('Copy failed', 'error')
      );
    }

    // Full caption text (caption + hashtags)
    function adFullCaption() {
      return (adEditor.caption || '') + (adEditor.hashtags ? '\n\n' + adEditor.hashtags : '');
    }

    // Turn the current canvas into a PNG File (for native sharing)
    function adCanvasToBlob() {
      return new Promise((resolve, reject) => {
        const canvas = document.getElementById('adCanvas');
        if (!canvas) return reject('no canvas');
        adWaitForCanvasImages().then(() => {
          adDraw();
          try {
            canvas.toBlob(b => b ? resolve(b) : reject('blob failed'), 'image/png', 0.92);
          } catch (err) { reject(err); }
        });
      });
    }

    // ⭐ BEST OPTION: native share sheet with IMAGE + CAPTION together.
    // Works on phones (and the 4A Store app WebView) — user picks WhatsApp/FB/
    // Insta from the system sheet and the image + text are already attached.
    async function adShareNative() {
      const caption = adFullCaption();
      if (!caption.trim()) { showToast('Pehle caption generate karo', 'info'); }
      try {
        const blob = await adCanvasToBlob();
        const file = new File([blob], adSafeName('png'), { type: 'image/png' });
        // Prefer sharing the image file + text (needs file-share support)
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], text: caption, title: '4A Store Offer' });
          showToast('Shared', 'success');
          return;
        }
        // Text-only native share (image not supported) → still copy + download image
        if (navigator.share) {
          await navigator.share({ text: caption, title: '4A Store Offer' });
        }
        adCopyCaption();
        adDownload('png');
        showToast('Caption copied + image downloaded. App me image attach karke post karo.', 'info');
      } catch (err) {
        // User cancelled or unsupported → fallback: copy caption + download image
        if (err && err.name === 'AbortError') return;   // user closed the sheet
        adCopyCaption();
        adDownload('png');
        showToast('Image download ho gayi + caption copy. Manually share karo.', 'info');
      }
    }

    // Platform-specific fallback (desktop where native share may be absent).
    // Downloads the image, copies caption, then opens the platform.
    function adShare(platform) {
      adCopyCaption();
      adDownload('png');
      const text = encodeURIComponent(adFullCaption());
      if (platform === 'whatsapp') {
        window.open('https://wa.me/?text=' + text, '_blank');
        showToast('Caption WhatsApp me gaya. Downloaded image attach kar do 📎', 'info');
      } else if (platform === 'facebook') {
        window.open('https://www.facebook.com/sharer/sharer.php?u=' + encodeURIComponent('https://4astore.com'), '_blank');
        showToast('Image download ho gayi. FB post me upload kar do (caption copied 📋)', 'info');
      } else if (platform === 'instagram') {
        window.open('https://www.instagram.com/', '_blank');
        showToast('Image download ho gayi. Instagram me post karo (caption copied 📋)', 'info');
      }
    }

    // ---- Caption / Hashtag / Hook generator (rule-based) ----
    function adGenerateContent() {
      const e = adEditor;
      const s = getSettings();
      const area = 'चंद्रगढ़';
      const disc = e.discount ? (e.discount + '% छूट') : 'बढ़िया छूट';
      const phone = (s && s.storePhone) ? s.storePhone : '7543888698';
      const selectedIds = Array.isArray(e.productIds) && e.productIds.length ? e.productIds.filter(Boolean) : (e.productId ? [e.productId] : []);
      const productNames = selectedIds.map(id => (getProducts() || []).find(p => String(p.id) === String(id))?.name).filter(Boolean);
      const productsText = productNames.length > 1
        ? productNames.slice(0, -1).join(', ') + ' और ' + productNames[productNames.length - 1]
        : (productNames[0] || e.productName || 'ताज़ा सामान');
      const variant = Number(e.captionVariant || 0);
      const captions = [
        `चंद्रगढ़ के सम्मानित निवासियों के लिए विशेष सूचना! 😍\nआज 4A STORE पर ${productsText} पर ${disc} का विशेष लाभ उपलब्ध है।\nगुणवत्तापूर्ण सामान, उचित मूल्य और भरोसेमंद सेवा का लाभ उठाइए।\nघर बैठे ऑर्डर करें 🛵\n📞 ${phone}`,
        `आपकी दैनिक जरूरतों के लिए 4A STORE प्रस्तुत करता है विशेष बचत का अवसर। 🛒\n${productsText} पर ${disc} का लाभ उठाइए।\nअपनी पसंद का सामान आसानी से मंगाइए और समय की बचत कीजिए।\n📞 ${phone}`,
        `चंद्रगढ़ क्षेत्र के ग्राहकों के लिए आज का विशेष ऑफर! 🔥\n${productsText} पर ${disc} की बचत प्राप्त कीजिए।\nगुणवत्तापूर्ण किराना सामान अब आपके घर तक सुविधाजनक होम डिलीवरी के साथ।\nअभी ऑर्डर करें 🛵\n📞 ${phone}`,
        `आपके परिवार की रोजमर्रा की जरूरतों के लिए भरोसेमंद खरीदारी का विकल्प। 😊\n${productsText} पर 4A STORE की ओर से ${disc} का विशेष लाभ उपलब्ध है।\nआज ही अपना ऑर्डर बुक कीजिए।\n📞 ${phone}`,
        `बचत और सुविधा के साथ बेहतर खरीदारी का सही समय आज है! ✨\n${productsText} पर ${disc} का शानदार अवसर उपलब्ध है।\n4A STORE से खरीदारी कीजिए और सामान अपने घर पर प्राप्त कीजिए।\n📞 ${phone}`
      ];
      const caption = captions[variant % captions.length];
      e.captionVariant = variant + 1;
      e.lang = 'hindi';
      const hashtagSets = [
        '#4AStore #Chandargarh #Nabinagar #GroceryStore #HomeDelivery #Offer',
        '#4AStore #आजकाऑफर #किरानास्टोर #घरपहुँचसेवा #बचत',
        '#4AStore #FreshGrocery #BestOffer #Chandargarh #Shopping',
        '#4AStore #घरबैठेऑर्डर #होमडिलीवरी #आजकीबचत',
        '#4AStore #KiranaShopping #SpecialOffer #Nabinagar #Grocery'
      ];
      const hashtags = hashtagSets[variant % hashtagSets.length];
      const hooks = [
        `${area} के सम्मानित निवासियों के लिए आज का विशेष लाभ! 😍`,
        `${productsText} पर उपलब्ध विशेष बचत का लाभ उठाइए। 🛒`,
        'घर बैठे सुविधाजनक किराना खरीदारी का लाभ उठाइए। 🛵',
        'गुणवत्तापूर्ण सामान और उचित मूल्य के साथ बेहतर खरीदारी कीजिए। 🔥',
        '4A STORE की नई ग्राहक सुविधा और विशेष ऑफर देखिए। ✨'
      ];

      e.caption = caption; e.hashtags = hashtags;
      const cap = document.getElementById('adCaption'); if (cap) cap.value = caption;
      const hh = document.getElementById('adHashtags'); if (hh) hh.value = hashtags;
      const hookBox = document.getElementById('adHooks');
      if (hookBox) {
        hookBox.innerHTML = '<div style="font-size:11px;color:var(--gray);margin-bottom:4px;">Hook options (click to use as title):</div>' +
          hooks.map(h => `<button onclick="adUseHook('${h.replace(/'/g,"\\'")}')" style="display:block;width:100%;text-align:left;margin-bottom:4px;padding:7px 10px;border:1px solid var(--border);border-radius:8px;background:#fff;cursor:pointer;font-size:12px;">${escapeHtml(h)}</button>`).join('');
      }
      queueAutoSave();
      showToast('Content generated', 'success');
    }
    function adUseHook(h) { adEditor.offerTitle = h; const t = document.getElementById('adOfferTitle'); if (t) t.value = h; adDraw(); queueAutoSave(); }

    // ---- Save ----
    function saveAd() {
      const e = adEditor;
      e.headerTitle = e.headerTitle == null ? '4A STORE' : String(e.headerTitle);
      e.headerTagline = e.headerTagline == null ? 'आपकी अपनी किराना दुकान' : String(e.headerTagline);
      e.textColors = e.textColors || {};
      e.hiddenLayers = e.hiddenLayers || {};
      e.layout = e.layout || {};
      e.overlays = Array.isArray(e.overlays) ? e.overlays : [];
      const payload = {
        name: e.name || 'Untitled Ad',
        campaign: e.campaign || '',
        offerTitle: e.offerTitle || '',
        productId: e.productId,
        productName: e.productName || '',
        productIds: Array.isArray(e.productIds) ? e.productIds.filter(Boolean) : [],
        productCount: Math.max(1, Math.min(3, Number(e.productCount || 1))),
        productPrices: e.productPrices || {},
        format: e.format, platform: e.platform, template: e.template, ctaLink: e.ctaLink || '',
        status: e.status || 'draft',
        caption: e.caption || '', hashtags: e.hashtags || '',
        creative: JSON.parse(JSON.stringify(e))   // full editor state as structured JSON
      };
      const action = e.id ? 'update' : 'add';
      if (e.id) payload.id = e.id;
      adsApi({ action, ad: payload }, res => {
        if (res && res.success) {
          if (res.ad && res.ad.id) adEditor.id = res.ad.id;
          localStorage.removeItem(AD_DRAFT_KEY);
          _adHistoryState = adSnapshot();
          setAdSaveStatus('✓ Saved');
          showToast('Ad saved', 'success');
        } else showToast((res && res.message) || 'Save failed', 'error');
      });
    }

    // ---- Autosave ----
    function queueAutoSave() {
      setAdSaveStatus('Saving...');
      clearTimeout(adAutoSaveTimer);
      adAutoSaveTimer = setTimeout(() => {
        try { localStorage.setItem(AD_DRAFT_KEY, JSON.stringify(adEditor)); } catch (e) {}
        setAdSaveStatus('✓ Draft saved');
      }, 1200);
    }
    function startAdAutoSave() {
      const canvas = document.getElementById('adCanvas');
      if (canvas && !canvas._adBound) {
        canvas._adBound = true;
        canvas.addEventListener('mousedown', ev => { canvas.style.cursor='grabbing'; adCanvasPointerDown(ev.clientX, ev.clientY); });
        canvas.addEventListener('click', ev => adCanvasActivateCTA(ev.clientX, ev.clientY));
        canvas.addEventListener('touchstart', ev => { const t=ev.touches[0]; adCanvasPointerDown(t.clientX, t.clientY); }, {passive:true});
        canvas.addEventListener('touchmove', ev => { const t=ev.touches[0]; adCanvasPointerMove(t.clientX, t.clientY); ev.preventDefault(); }, {passive:false});
        canvas.addEventListener('touchend', adCanvasPointerUp);
      }
      if (!window._adGlobalDragBound) {
        window._adGlobalDragBound = true;
        window.addEventListener('mousemove', ev => adCanvasPointerMove(ev.clientX, ev.clientY));
        window.addEventListener('mouseup', () => {
          const currentCanvas = document.getElementById('adCanvas');
          if (currentCanvas) currentCanvas.style.cursor='grab';
          adCanvasPointerUp();
        });
        window.addEventListener('keydown', ev => {
          if (!document.getElementById('adCanvas')) return; // only while the Ads editor is open (React admin)
          const tag = document.activeElement && document.activeElement.tagName;
          if ((tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') && !ev.ctrlKey && !ev.metaKey) return;
          if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'z') { ev.preventDefault(); ev.shiftKey ? adRedo() : adUndo(); }
          if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'y') { ev.preventDefault(); adRedo(); }
          if (ev.key === 'Delete' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) { ev.preventDefault(); adDeleteSelected(); }
        });
      }
    }
    function setAdSaveStatus(txt) { const el = document.getElementById('adSaveStatus'); if (el) el.textContent = txt; }

    // ---- 16. AD LIBRARY ----
    let adLibFilter = 'all';
    let adLibSearch = '';
    function renderAdLibrary() {
      const filters = ['all','draft','ready','scheduled','published'];
      const filterBtns = filters.map(f => `
        <button onclick="adLibSetFilter('${f}')" style="padding:7px 14px;border:1px solid ${adLibFilter===f?'var(--primary)':'var(--border)'};border-radius:20px;cursor:pointer;font-size:12px;font-weight:600;background:${adLibFilter===f?'var(--primary)':'#fff'};color:${adLibFilter===f?'#fff':'var(--primary-dark)'};text-transform:capitalize;">${f}</button>`).join('');

      let list = adsList.slice().reverse();
      if (adLibFilter !== 'all') list = list.filter(a => a.status === adLibFilter);
      if (adLibSearch) {
        const t = adLibSearch.toLowerCase();
        list = list.filter(a => (a.name||'').toLowerCase().includes(t) || (a.productName||'').toLowerCase().includes(t) || (a.offerTitle||'').toLowerCase().includes(t));
      }

      const cards = list.length ? list.map(a => {
        const tpl = AD_TEMPLATES[a.template] || AD_TEMPLATES['todays-offer'];
        return `
        <div style="border:1px solid var(--border);border-radius:12px;overflow:hidden;background:#fff;">
          <div style="height:120px;background:linear-gradient(135deg,${tpl.bg[0]},${tpl.bg[1]});display:flex;align-items:center;justify-content:center;color:#fff;text-align:center;padding:10px;">
            <div><div style="font-size:26px;">${tpl.emoji}</div><div style="font-size:12px;font-weight:700;margin-top:4px;">${escapeHtml(a.offerTitle||a.name||'')}</div></div>
          </div>
          <div style="padding:10px;">
            <div style="font-weight:700;font-size:13px;">${escapeHtml(a.name||'')}</div>
            <div style="font-size:11px;color:var(--gray);margin:2px 0 8px;">${escapeHtml(a.format||'')} · ${escapeHtml(a.status||'draft')}</div>
            <div style="display:flex;gap:5px;flex-wrap:wrap;">
              <button onclick="openAdEditor(${a.id})" class="ad-mini" style="background:var(--primary);color:#fff;">✏️ Edit</button>
              <button onclick="duplicateAd(${a.id})" class="ad-mini" style="background:#0891b2;color:#fff;">📋</button>
              <button onclick="removeAd(${a.id})" class="ad-mini" style="background:#ffebee;color:#c62828;">🗑️</button>
            </div>
          </div>
        </div>`;
      }).join('') : '<p style="grid-column:1/-1;text-align:center;padding:30px;color:var(--gray);">Koi ad nahi mila.</p>';

      document.getElementById('tabContent').innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:16px;">
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <button onclick="adsGoto('dashboard')" style="padding:9px 16px;border:1px solid var(--border);border-radius:20px;cursor:pointer;font-size:13px;font-weight:600;background:#fff;color:var(--primary-dark);">📊 Dashboard</button>
            <button onclick="adsGoto('library')" style="padding:9px 16px;border:none;border-radius:20px;cursor:pointer;font-size:13px;font-weight:600;background:var(--primary);color:#fff;">📚 Ad Library</button>
          </div>
          <button onclick="openAdEditor(null, true)" style="padding:11px 22px;background:var(--primary);color:#fff;border:none;border-radius:10px;cursor:pointer;font-size:14px;font-weight:700;">+ Create New Ad</button>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;">${filterBtns}</div>
        <input type="text" value="${escapeHtml(adLibSearch)}" oninput="adLibSetSearch(this.value)" placeholder="🔍 Search by ad name, product, offer..." style="width:100%;max-width:420px;padding:10px 14px;border:2px solid var(--border);border-radius:8px;font-size:14px;margin-bottom:16px;">
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:14px;">${cards}</div>`;
    }
    function adLibSetFilter(f) { adLibFilter = f; renderAdLibrary(); }
    function adLibSetSearch(v) { adLibSearch = v; renderAdLibrary(); }
