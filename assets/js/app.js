/* ============================================
   4astore - Main Application JavaScript
   ============================================ */

// Store Configuration
const STORE_CONFIG = {
  name: "4astore",
  mobile: "8210874123",
  email: "YOUR_EMAIL_HERE",
  address: "Gajana Road, Chandargarh, Nabinagar, Aurangabad, Bihar – 824301",
  pincode: "824301",
  deliveryCharge: 30,
  freeDeliveryAbove: 500,
  whatsappNumber: "918210874123",
  upiId: "goluk147147@ybl",
  upiName: "4astore",
  adminPassword: "",
  storeEmail: "4astorewale@gmail.com"
};

// State
let products = [];
let categories = [];
let dbUsers = [];
let dbOrders = [];
let dbAdmin = null;

// ============================================
// INITIALIZATION
// ============================================
document.addEventListener('DOMContentLoaded', () => {
  checkAssetVersion();   // auto-refresh if admin pushed a new build
  loadData();
  updateCartBadge();
  updateLoginUI();
  showAppVersion();
  updateUpiDisplays();
  injectDownloadAppButton();
  applyHideMode();                       // catalog-only mode: hide cart/buy UI
  // Re-apply after settings finish loading from the server
  window.addEventListener('dataLoaded', applyHideMode);
});

// Show a "Download App" button in the header — ONLY in a web browser
// (hidden inside the Android app, where installing the app is pointless).
function injectDownloadAppButton() {
  try {
    const isInApp = !!(window.AndroidApp);   // our WebView exposes AndroidApp
    if (isInApp) {
      // Inside the app: no "Download App" button needed. Also remove the header
      // "📋 Orders" link — Orders is already available in the bottom nav, so the
      // app header stays clean (logo + search + cart).
      const ordersLink = document.getElementById('headerOrdersLink');
      if (ordersLink) ordersLink.style.display = 'none';
      return;
    }
    const actions = document.querySelector('.header-actions');
    if (!actions || document.getElementById('getAppBtn')) return;
    const apkUrl = new URL('4AStore.apk', window.location.href).href;
    const a = document.createElement('a');
    a.id = 'getAppBtn';
    a.href = apkUrl;
    a.setAttribute('download', '4AStore.apk');
    a.title = 'Download App';                 // native tooltip
    a.setAttribute('aria-label', 'Download App');
    // Match the other header action links (📋 Orders / 🛒 Cart): icon + label text
    a.innerHTML = '⬇️ <span class="action-text">Get App</span>';
    // place it as the first action (before Orders) so it matches their style
    const loginArea = actions.querySelector('.login-btn-area');
    if (loginArea && loginArea.nextSibling) actions.insertBefore(a, loginArea.nextSibling);
    else actions.appendChild(a);
  } catch (e) { /* ignore */ }
}

// Cache-buster: if the admin bumped the version (via "Clear Cache & Update"),
// clear caches and hard-reload once so every user gets the fresh code.
function checkAssetVersion() {
  fetch('api/bump-cache.php?t=' + Date.now(), { cache: 'no-store' })
    .then(r => r.json())
    .then(res => {
      if (!res.success) return;
      const server = String(res.assetVersion);
      const local = localStorage.getItem('4astore_asset_version');
      if (local === null) {
        // First visit — just remember the current version, no reload
        localStorage.setItem('4astore_asset_version', server);
        return;
      }
      if (local !== server) {
        localStorage.setItem('4astore_asset_version', server);
        // Clear service worker caches, then hard reload
        if ('caches' in window) {
          caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))))
            .finally(() => location.reload(true));
        } else {
          location.reload(true);
        }
      }
    })
    .catch(() => {});
}

// Update every UPI ID / Name shown on the page with the admin's global setting.
// Elements marked with [data-upi-id] / [data-upi-name] get filled automatically.
function updateUpiDisplays() {
  const apply = () => {
    const cfg = (typeof getSettings === 'function') ? getSettings() : null;
    const id = (cfg && cfg.upiId) ? cfg.upiId : STORE_CONFIG.upiId;
    const name = (cfg && cfg.upiName) ? cfg.upiName : STORE_CONFIG.upiName;
    document.querySelectorAll('[data-upi-id]').forEach(el => el.textContent = id);
    document.querySelectorAll('[data-upi-name]').forEach(el => el.textContent = name);
  };
  apply();
  // Re-apply once settings finish loading from the server
  window.addEventListener('dataLoaded', apply);
}

// Show the app/web version in the footer (helps confirm which build is running)
function showAppVersion() {
  try {
    const el = document.querySelector('.footer-bottom');
    if (!el) return;
    let ver = 'Web';
    if (window.AndroidApp && typeof window.AndroidApp.getAppVersion === 'function') {
      const v = window.AndroidApp.getAppVersion();
      if (v) ver = 'App v' + v;
    }
    if (!/v\d|Web/.test(el.dataset.verDone || '')) {
      el.innerHTML += ` <span style="opacity:0.6; font-size:11px;">· ${ver}</span>`;
      el.dataset.verDone = ver;
    }
  } catch (e) { /* ignore */ }
}

async function loadData() {
  try {
    // Try PHP API first, fallback to direct JSON files (for local dev without PHP)
    let prodData, catData, adminData;
    
    try {
      const [prodRes, catRes] = await Promise.all([
        fetch('api/data.php?type=products'),
        fetch('api/data.php?type=categories')
      ]);
      if (!prodRes.ok || !catRes.ok) throw new Error('API not available');
      prodData = await prodRes.json();
      catData = await catRes.json();
    } catch(apiErr) {
      // Fallback to direct JSON files (local development)
      const [prodRes2, catRes2] = await Promise.all([
        fetch('data/products.json'),
        fetch('data/categories.json')
      ]);
      prodData = await prodRes2.json();
      catData = await catRes2.json();
    }
    
    products = prodData;
    categories = catData;
    localStorage.setItem('4astore_products', JSON.stringify(products));

    // Load store settings (delivery fee, free-delivery threshold, store email)
    try {
      let settings;
      const bust = 'nocache=' + Date.now();
      try {
        // no-store + cache-bust so a stale service-worker/browser cache never
        // returns an old UPI ID / delivery fee after the admin updates settings.
        const sRes = await fetch('api/settings.php?' + bust, { cache: 'no-store' });
        if (!sRes.ok) throw new Error('API not available');
        const sData = await sRes.json();
        settings = sData.success ? sData.settings : null;
      } catch (sErr) {
        const sRes2 = await fetch('data/settings.json?' + bust, { cache: 'no-store' });
        settings = await sRes2.json();
      }
      if (settings) {
        if (settings.deliveryCharge !== undefined) STORE_CONFIG.deliveryCharge = Number(settings.deliveryCharge);
        if (settings.freeDeliveryAbove !== undefined) STORE_CONFIG.freeDeliveryAbove = Number(settings.freeDeliveryAbove);
        if (settings.storeEmail) STORE_CONFIG.storeEmail = settings.storeEmail;
        if (settings.upiId) STORE_CONFIG.upiId = settings.upiId;
        if (settings.upiName) STORE_CONFIG.upiName = settings.upiName;
        localStorage.setItem('4astore_settings', JSON.stringify(settings));
      }
    } catch (e) { /* keep defaults in STORE_CONFIG */ }
    
    // Users and orders are loaded only by authenticated pages that need them.
    dbUsers = [];
    dbOrders = [];
    try {
      const sessionRes = await fetch('api/users.php?action=session', { cache: 'no-store' });
      const sessionData = await sessionRes.json();
      if (sessionData.success && sessionData.user && sessionData.user.mobile) {
        const orderRes = await fetch('api/orders.php?mobile=' + encodeURIComponent(sessionData.user.mobile), { cache: 'no-store' });
        const orderData = await orderRes.json();
        if (orderData.success && Array.isArray(orderData.orders)) {
          dbOrders = orderData.orders;
          localStorage.setItem('4astore_orders', JSON.stringify(dbOrders));
        }
      }
    } catch (e) { /* unauthenticated storefront has no private order data */ }
    
    window.dispatchEvent(new CustomEvent('dataLoaded', { detail: { products, categories, users: [], orders: [], admin: null } }));
  } catch (e) {
    console.error('Error loading data:', e);
    // Remove shimmer placeholders on error and show fallback
    document.querySelectorAll('.skeleton-card, .skeleton-category, .skeleton-banner, .skeleton-detail, .skeleton-cart-item, .skeleton-order, .skeleton-pills, .skeleton-ad, .skeleton-container').forEach(el => el.remove());
    document.querySelectorAll('.products-grid, .categories-grid, .prod-grid, #productDetail, #cartContent, #ordersContent').forEach(el => {
      if (!el.querySelector('.product-card, .category-card, .cart-item, .order-card')) {
        el.innerHTML = '<div style="text-align:center;padding:40px;color:var(--gray);"><p>Unable to load data. Please refresh the page.</p></div>';
      }
    });
  }
}

// ============================================
// USER LOGIN / AUTH (LocalStorage based)
// ============================================
function getLoggedInUser() {
  return JSON.parse(localStorage.getItem('4astore_user')) || null;
}

function loginUser(name, mobile, username, role, backendRider) {
  const user = { name, mobile, username: username || mobile, role: role || 'customer', backendRider: backendRider === true, loggedInAt: new Date().toISOString() };
  localStorage.setItem('4astore_user', JSON.stringify(user));
  updateLoginUI();
  showToast(`🙏 Welcome, ${name}!`, 'success');
  return user;
}

function logoutUser() {
  try {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', 'api/users.php', false);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.send(JSON.stringify({ action: 'logout' }));
  } catch (e) { /* clear local state even if the server is unavailable */ }
  localStorage.removeItem('4astore_user');
  updateLoginUI();
  showToast('Logged out successfully', 'info');
  window.location.href = 'login';
}

function updateLoginUI() {
  const user = getLoggedInUser();
  document.querySelectorAll('.login-btn-area').forEach(el => {
    if (user) {
      el.innerHTML = `<a href="profile" title="${user.name}" style="display:flex;align-items:center;gap:4px;">
        <span style="background:var(--primary);color:white;width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;">${user.name.charAt(0).toUpperCase()}</span>
        <span class="action-text">${user.name.split(' ')[0]}</span>
      </a>`;
    } else {
      el.innerHTML = `<a href="login">👤 <span class="action-text">Login</span></a>`;
    }
  });
}

function requireLogin() {
  const user = getLoggedInUser();
  if (!user) {
    showToast('Please login first to continue', 'error');
    const currentPage = window.location.pathname.split('/').pop();
    setTimeout(() => { window.location.href = `login?return=${currentPage}`; }, 1000);
    return false;
  }
  return true;
}

// ============================================
// CART FUNCTIONS
// ============================================
function normalizeCartItem(item) {
  const product = (Array.isArray(products) && products.length)
    ? products.find(p => Number(p.id) === Number(item && item.id))
    : null;

  if (!product || !item) return item;

  return {
    ...item,
    name: item.name || product.name,
    brand: item.brand || product.brand,
    weight: item.weight || product.weight,
    price: Number(product.price) || Number(item.price) || 0,
    mrp: Number(product.mrp) || Number(item.mrp) || 0,
    image: item.image || product.image
  };
}

function getCart() {
  const raw = JSON.parse(localStorage.getItem('4astore_cart')) || [];
  const normalized = Array.isArray(raw) ? raw.map(normalizeCartItem) : [];

  // Keep cart data synced with live product prices so stale snapshots do not override
  // the current catalog values after an admin update.
  const current = JSON.stringify(normalized);
  const saved = JSON.stringify(raw);
  if (current !== saved) {
    localStorage.setItem('4astore_cart', current);
  }

  return normalized;
}

function saveCart(cartData) {
  const normalized = Array.isArray(cartData) ? cartData.map(normalizeCartItem) : [];
  localStorage.setItem('4astore_cart', JSON.stringify(normalized));
  updateCartBadge();
}

function addToCart(productId) {
  const product = products.find(p => p.id === productId);
  if (!product) return;
  
  let cart = getCart();
  const existing = cart.find(item => item.id === productId);
  
  if (existing) {
    existing.quantity += 1;
  } else {
    cart.push({
      id: product.id,
      name: product.name,
      brand: product.brand,
      weight: product.weight,
      price: product.price,
      mrp: product.mrp,
      image: product.image,
      quantity: 1
    });
  }
  
  saveCart(cart);
  showToast('✅ ' + product.name + ' added', 'success');
  updateProductCardUI(productId);
}

function removeFromCart(productId) {
  let cart = getCart();
  cart = cart.filter(item => item.id !== productId);
  saveCart(cart);
  showToast('Removed from cart', 'info');
  updateProductCardUI(productId);
}

function updateQuantity(productId, change) {
  let cart = getCart();
  const item = cart.find(i => i.id === productId);
  if (!item) return;
  
  item.quantity += change;
  if (item.quantity <= 0) {
    cart = cart.filter(i => i.id !== productId);
  }
  
  saveCart(cart);
  updateProductCardUI(productId);
  
  if (typeof renderCart === 'function') {
    renderCart();
  }
}

function getCartCount() {
  const cart = getCart();
  return cart.reduce((sum, item) => sum + item.quantity, 0);
}

function getCartTotal() {
  const cart = getCart();
  const subtotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  const mrpTotal = cart.reduce((sum, item) => sum + (item.mrp * item.quantity), 0);
  const discount = mrpTotal - subtotal;

  // Per-user delivery fee overrides the global setting (if the admin set one).
  // customDelivery: a number (e.g. 0 = free, 5 = ₹5). If not set, use global rule.
  let deliveryCharge;
  const user = getLoggedInUser();
  const custom = getUserCustomDelivery(user ? user.mobile : null);
  if (custom !== null) {
    deliveryCharge = custom;                          // fixed per-user fee (no free-above rule)
  } else {
    deliveryCharge = subtotal >= STORE_CONFIG.freeDeliveryAbove ? 0 : STORE_CONFIG.deliveryCharge;
  }

  const total = subtotal + deliveryCharge;

  return { subtotal, mrpTotal, discount, deliveryCharge, total, itemCount: getCartCount() };
}

// Does the cart contain any age-restricted (18+) item?
function cartHasAgeRestricted() {
  const cart = getCart();
  if (!cart.length) return false;
  const cats = (typeof categories !== 'undefined' && categories.length) ? categories : [];
  const restricted = cats.filter(c => c.ageRestricted || c.hidden).map(c => c.slug);
  if (!restricted.length) return false;
  // match by product category (look up full product list)
  const prods = getProducts();
  return cart.some(item => {
    const p = prods.find(pr => pr.id === item.id);
    return p && restricted.includes(p.category);
  });
}

// Returns a user's custom delivery fee (number) or null if none set.
// Reads from the freshest users list available (server-synced cache).
function getUserCustomDelivery(mobile) {
  if (!mobile) return null;
  // Prefer the in-memory dbUsers (refreshed from server in loadData), then localStorage.
  let users = (Array.isArray(dbUsers) && dbUsers.length) ? dbUsers : getUsers();
  let u = users.find(x => x.mobile === mobile);

  // If this user's record is missing customDelivery, do a quick fresh fetch once.
  if (!u || u.customDelivery === undefined) {
    try {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', 'api/users.php?action=list&t=' + Date.now(), false);
      xhr.send();
      const res = JSON.parse(xhr.responseText);
      if (res.success && Array.isArray(res.users)) {
        dbUsers = res.users;
        localStorage.setItem('4astore_users', JSON.stringify(res.users));
        u = res.users.find(x => x.mobile === mobile);
      }
    } catch (e) { /* use whatever we have */ }
  }

  if (u && u.customDelivery !== undefined && u.customDelivery !== null && u.customDelivery !== '') {
    const n = Number(u.customDelivery);
    if (!isNaN(n)) return n;   // 0 is a valid value (free delivery)
  }
  return null;
}

function updateCartBadge() {
  const count = getCartCount();
  document.querySelectorAll('.cart-count').forEach(el => {
    el.textContent = count;
    el.style.display = count > 0 ? 'flex' : 'none';
  });
}

function getItemQuantityInCart(productId) {
  const cart = getCart();
  const item = cart.find(i => i.id === productId);
  return item ? item.quantity : 0;
}

function updateProductCardUI(productId) {
  const card = document.querySelector(`[data-product-id="${productId}"]`);
  if (!card) return;
  
  const qty = getItemQuantityInCart(productId);
  const actionsDiv = card.querySelector('.card-actions');
  
  if (qty > 0) {
    actionsDiv.innerHTML = `
      <div class="qty-controls">
        <button onclick="updateQuantity(${productId}, -1)">−</button>
        <span>${qty}</span>
        <button onclick="updateQuantity(${productId}, 1)">+</button>
      </div>
    `;
  } else {
    actionsDiv.innerHTML = `
      <button class="btn-add-cart" onclick="addToCart(${productId})">Add to Cart</button>
    `;
  }
}

// ============================================
// SEARCH
// ============================================
function searchProducts(query) {
  if (!query || query.trim() === '') return products;
  const q = query.toLowerCase().trim();
  return products.filter(p =>
    p.name.toLowerCase().includes(q) ||
    p.brand.toLowerCase().includes(q) ||
    p.category.toLowerCase().includes(q) ||
    p.description.toLowerCase().includes(q)
  );
}

function handleSearch(e) {
  if (e) e.preventDefault();
  const input = document.querySelector('.search-box input');
  const query = input ? input.value : '';
  if (query.trim()) {
    window.location.href = `products?search=${encodeURIComponent(query.trim())}`;
  }
}

// ============================================
// PIN CODE VALIDATION
// ============================================
function checkPincode(pin) {
  if (pin === STORE_CONFIG.pincode) {
    return { available: true, message: '🎉 Great! Delivery is available in your location.' };
  } else {
    return { available: false, message: '🚀 Coming Soon! Currently, 4astore is delivering only in Chandargarh, Nabinagar – 824301. We will expand to your location soon.' };
  }
}

// ============================================
// TOAST NOTIFICATIONS
// ============================================
function showToast(message, type = 'success') {
  let container = document.querySelector('.toast-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  
  const icons = { success: '✅', error: '⚠️', info: 'ℹ️' };
  
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <span class="toast-icon">${icons[type] || '✅'}</span>
    <span class="toast-msg">${message}</span>
    <button class="toast-close" onclick="this.parentElement.remove()">×</button>
  `;
  container.appendChild(toast);
  
  setTimeout(() => {
    toast.style.animation = 'slideOut 0.3s ease forwards';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// ============================================
// UPI PAYMENT
// ============================================
function generateUPILink(amount, orderId) {
  // UPI deep link for payment
  return `upi://pay?pa=${STORE_CONFIG.upiId}&pn=${encodeURIComponent(STORE_CONFIG.upiName)}&am=${amount}&cu=INR&tn=Order%20${orderId}%20-%204astore`;
}

function generateUPIQRData(amount, orderId) {
  // Data for QR code (using UPI format)
  return `upi://pay?pa=${STORE_CONFIG.upiId}&pn=${encodeURIComponent(STORE_CONFIG.upiName)}&am=${amount}&cu=INR&tn=Order%20${orderId}%20-%204astore`;
}

// ============================================
// ORDER MANAGEMENT
// ============================================
function generateOrderId() {
  const num = Math.floor(100000 + Math.random() * 900000);
  return '4A' + num;
}

function placeOrder(customerData) {
  const cart = getCart();
  const totals = getCartTotal();
  const user = getLoggedInUser();
  
  const order = {
    orderId: generateOrderId(),
    userId: user ? getUserId(user.mobile) : null,
    customer: customerData,
    items: cart.map(item => ({
      id: item.id,
      name: item.name,
      weight: item.weight,
      price: item.price,
      quantity: item.quantity
    })),
    subtotal: totals.subtotal,
    discount: totals.discount,
    deliveryCharge: totals.deliveryCharge,
    totalAmount: totals.total,
    paymentMethod: 'UPI',
    orderStatus: 'Order Placed',
    orderDate: new Date().toISOString()
  };
  
  // Save to PHP API (server-side JSON)
  try {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', 'api/orders.php', false);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.send(JSON.stringify({ action: 'save', order: order }));
  } catch(e) {
    console.error('Failed to save order to server:', e);
  }

  // Also save to localStorage as cache
  let orders = JSON.parse(localStorage.getItem('4astore_orders')) || [];
  orders.unshift(order);
  localStorage.setItem('4astore_orders', JSON.stringify(orders));
  dbOrders = orders;
  
  // Save customer info
  localStorage.setItem('4astore_customer', JSON.stringify(customerData));
  
  // Clear cart
  saveCart([]);
  
  return order;
}

function getOrders() {
  return JSON.parse(localStorage.getItem('4astore_orders')) || [];
}

function getOrdersByUser(mobile) {
  const orders = getOrders();
  return orders.filter(o => o.customer.mobile === mobile);
}

function updateOrderStatus(orderId, newStatus) {
  // Update on server via PHP API
  try {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', 'api/orders.php', false);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.send(JSON.stringify({ action: 'updateStatus', orderId: orderId, status: newStatus }));
  } catch(e) {
    console.error('Failed to update order status on server:', e);
  }

  // Also update localStorage
  let orders = JSON.parse(localStorage.getItem('4astore_orders')) || [];
  const order = orders.find(o => o.orderId === orderId);
  if (order) {
    order.orderStatus = newStatus;
    if (newStatus === 'Delivered') order.deliveredAt = order.deliveredAt || new Date().toISOString();
    localStorage.setItem('4astore_orders', JSON.stringify(orders));
    dbOrders = orders;
  }
  return order;
}

// ============================================
// USER MANAGEMENT (JSON DB based)
// ============================================
function getUsers() {
  return JSON.parse(localStorage.getItem('4astore_users')) || [];
}

function getUserId(mobile) {
  const users = getUsers();
  const user = users.find(u => u.mobile === mobile);
  return user ? (user.id || null) : null;
}

function findUser(usernameOrMobile, password) {
  // Try PHP API first
  try {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', 'api/users.php', false);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.send(JSON.stringify({ action: 'login', username: usernameOrMobile, password: password }));
    const res = JSON.parse(xhr.responseText);
    if (res.success) return res.user;
    return null;
  } catch(e) {
    // Fallback to localStorage
    const users = getUsers();
    return users.find(u => 
      (u.username === usernameOrMobile || u.mobile === usernameOrMobile) && u.password === password
    );
  }
}

function registerUser(userData) {
  // Sync call to PHP API
  const xhr = new XMLHttpRequest();
  xhr.open('POST', 'api/users.php', false); // synchronous
  xhr.setRequestHeader('Content-Type', 'application/json');
  xhr.send(JSON.stringify({
    action: 'register',
    name: userData.name,
    mobile: userData.mobile,
    username: userData.username,
    password: userData.password
  }));
  
  try {
    const res = JSON.parse(xhr.responseText);
    if (res.success) {
      // Also update local cache
      const users = getUsers();
      users.push(res.user);
      localStorage.setItem('4astore_users', JSON.stringify(users));
      dbUsers = users;
    }
    return res;
  } catch(e) {
    // Fallback to local-only
    const users = getUsers();
    if (users.find(u => u.username === userData.username)) {
      return { success: false, message: 'Username already taken' };
    }
    if (users.find(u => u.mobile === userData.mobile)) {
      return { success: false, message: 'Mobile number already registered' };
    }
    const maxId = users.reduce((max, u) => Math.max(max, u.id || 0), 0);
    const newUser = { id: maxId + 1, ...userData, registeredAt: new Date().toISOString(), lastLogin: new Date().toISOString() };
    users.push(newUser);
    localStorage.setItem('4astore_users', JSON.stringify(users));
    dbUsers = users;
    return { success: true, user: newUser };
  }
}

function updateUserLogin(usernameOrMobile) {
  // PHP API handles lastLogin update during login action already
  // Just update local cache
  const users = getUsers();
  const user = users.find(u => u.username === usernameOrMobile || u.mobile === usernameOrMobile);
  if (user) {
    user.lastLogin = new Date().toISOString();
    localStorage.setItem('4astore_users', JSON.stringify(users));
    dbUsers = users;
  }
  return user;
}

function getAdminCredentials() {
  return JSON.parse(localStorage.getItem('4astore_admin')) || { username: 'admin', password: STORE_CONFIG.adminPassword };
}

// ============================================
// STORE SETTINGS (email, delivery fee) — admin configurable
// ============================================
function getSettings() {
  const cached = JSON.parse(localStorage.getItem('4astore_settings')) || {};
  return {
    storeEmail: cached.storeEmail || STORE_CONFIG.storeEmail,
    deliveryCharge: cached.deliveryCharge !== undefined ? Number(cached.deliveryCharge) : STORE_CONFIG.deliveryCharge,
    freeDeliveryAbove: cached.freeDeliveryAbove !== undefined ? Number(cached.freeDeliveryAbove) : STORE_CONFIG.freeDeliveryAbove,
    upiId: cached.upiId || STORE_CONFIG.upiId,
    upiName: cached.upiName || STORE_CONFIG.upiName,
    hideMrp: cached.hideMrp === true,
    storePhone: cached.storePhone || '8210874123',
    storeAddress: cached.storeAddress || 'गजना रोड, चंद्रगढ़, नबीनगर, औरंगाबाद',
    serviceableVillages: cached.serviceableVillages || 'Chandargarh(चंद्रगढ़), Mayapur(मायापुर), Sankarpur(शंकरपुर), Mishirbigha(मिशिरबिगहा), Sinpur(सिनपुर), Kharundha(खरौंधा), Simiri(सिमरी), Bilaspur(बिलासपुर), Bighapar(बिघापर)'
  };
}

// ============================================
// VILLAGE / GAON VERIFICATION (fuzzy match + auto-correct)
// ============================================
// Returns array of serviceable village names (from admin settings).
// Each entry keeps its full "English(Hindi)" label.
function getServiceableVillages() {
  try {
    const raw = getSettings().serviceableVillages || '';
    return raw.split(',').map(v => v.trim()).filter(Boolean);
  } catch (e) { return ['Chandargarh(चंद्रगढ़)']; }
}

// Levenshtein distance — how many edits to turn a into b (for spelling match)
function _levenshtein(a, b) {
  a = a.toLowerCase(); b = b.toLowerCase();
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
    }
  }
  return d[m][n];
}

// Verify a typed village against the serviceable list, tolerating spelling
// mistakes. Returns:
//   { status:'exact',    match:'Chandargarh' }               -> perfect
//   { status:'suggest',  match:'Chandargarh', typed:'...' }   -> close typo
//   { status:'invalid' }                                      -> not serviceable
// Split an "English(Hindi)" entry into search tokens: full, english, hindi
function _villageTokens(v) {
  const full = v.trim();
  const m = full.match(/^(.*?)\s*\(([^)]*)\)\s*$/);
  if (m) return { full, en: m[1].trim(), hi: m[2].trim() };
  return { full, en: full, hi: '' };
}

function verifyVillage(input) {
  const typed = (input || '').trim();
  if (!typed) return { status: 'invalid' };
  const list = getServiceableVillages();
  const tl = typed.toLowerCase();

  // 1) exact — matches full "English(Hindi)", or just English, or just Hindi
  for (const v of list) {
    const t = _villageTokens(v);
    if (t.full.toLowerCase() === tl || t.en.toLowerCase() === tl || (t.hi && t.hi === typed)) {
      return { status: 'exact', match: v };
    }
  }
  // 2) contains / partial (English or Hindi part)
  for (const v of list) {
    const t = _villageTokens(v);
    const el = t.en.toLowerCase();
    if (el.includes(tl) || tl.includes(el) || (t.hi && typed.includes(t.hi))) {
      return { status: 'suggest', match: v, typed };
    }
  }
  // 3) fuzzy: closest English part by edit distance (spelling mistakes)
  let best = null, bestDist = Infinity;
  for (const v of list) {
    const t = _villageTokens(v);
    const dist = _levenshtein(tl, t.en.toLowerCase());
    if (dist < bestDist) { bestDist = dist; best = v; }
  }
  if (best) {
    const enLen = _villageTokens(best).en.length;
    const tol = Math.max(2, Math.floor(enLen * 0.4));   // allow ~40% typos
    if (bestDist <= tol) return { status: 'suggest', match: best, typed };
  }
  return { status: 'invalid' };
}

// Should the strike-through MRP / discount be hidden? (admin toggle)
function shouldHideMrp() {
  try { return getSettings().hideMrp === true; } catch (e) { return false; }
}

// When "Hide MRP" (catalog-only / Play Store safe) mode is ON, hide the whole
// buying flow: cart icon in header, cart in bottom nav, and cart footer link.
// Products stay browsable (catalog), but nothing to buy is shown.
function applyHideMode() {
  const hide = shouldHideMrp();
  const sel = [
    '.cart-badge',                       // header cart icon
    '.bottom-nav a[href="cart"]',        // bottom-nav cart
    '.bottom-nav .nav-item[href="cart"]',
    '.footer-col a[href="cart"]'         // footer "My Cart" link
  ];
  document.querySelectorAll(sel.join(',')).forEach(el => {
    el.style.display = hide ? 'none' : '';
  });
}

// Save settings to the server (with localStorage fallback). Returns { success, message }.
function saveSettings(data) {
  const payload = {
    storeEmail: (data.storeEmail || '').trim(),
    deliveryCharge: parseInt(data.deliveryCharge, 10) || 0,
    freeDeliveryAbove: parseInt(data.freeDeliveryAbove, 10) || 0,
    upiId: (data.upiId || '').trim(),
    upiName: (data.upiName || '').trim(),
    hideMrp: data.hideMrp === true,
    storePhone: (data.storePhone || '').trim(),
    storeAddress: (data.storeAddress || '').trim(),
    serviceableVillages: (data.serviceableVillages || '').trim()
  };
  try {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', 'api/settings.php', false);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.send(JSON.stringify(payload));
    const res = JSON.parse(xhr.responseText);
    if (res.success) {
      localStorage.setItem('4astore_settings', JSON.stringify(res.settings));
      STORE_CONFIG.deliveryCharge = res.settings.deliveryCharge;
      STORE_CONFIG.freeDeliveryAbove = res.settings.freeDeliveryAbove;
      STORE_CONFIG.storeEmail = res.settings.storeEmail;
      if (res.settings.upiId) STORE_CONFIG.upiId = res.settings.upiId;
      if (res.settings.upiName) STORE_CONFIG.upiName = res.settings.upiName;
      return res;
    }
    return res;
  } catch (e) {
    // Local fallback
    localStorage.setItem('4astore_settings', JSON.stringify(payload));
    STORE_CONFIG.deliveryCharge = payload.deliveryCharge;
    STORE_CONFIG.freeDeliveryAbove = payload.freeDeliveryAbove;
    STORE_CONFIG.storeEmail = payload.storeEmail;
    if (payload.upiId) STORE_CONFIG.upiId = payload.upiId;
    if (payload.upiName) STORE_CONFIG.upiName = payload.upiName;
    return { success: true, message: 'Settings saved (local)', settings: payload };
  }
}

// ============================================
// PRODUCT MANAGEMENT (Admin) — add / edit price & features
// ============================================
function getProducts() {
  // Prefer in-memory list loaded by loadData(); fall back to localStorage cache.
  if (Array.isArray(products) && products.length) return products;
  const cached = JSON.parse(localStorage.getItem('4astore_products'));
  return Array.isArray(cached) ? cached : (Array.isArray(products) ? products : []);
}

function cacheProducts(list) {
  products = list;
  localStorage.setItem('4astore_products', JSON.stringify(list));
}

// Calculate discount % from mrp/price
function calcDiscount(mrp, price) {
  mrp = parseFloat(mrp) || 0;
  price = parseFloat(price) || 0;
  if (mrp > 0 && price >= 0 && price <= mrp) {
    return Math.round(((mrp - price) / mrp) * 100);
  }
  return 0;
}

// Normalize the features field into an array of trimmed strings
function normalizeFeatures(features) {
  if (Array.isArray(features)) {
    return features.map(f => String(f).trim()).filter(Boolean);
  }
  if (typeof features === 'string' && features.trim()) {
    return features.split(/[\r\n,]+/).map(f => f.trim()).filter(Boolean);
  }
  return [];
}

// Add a new product. Returns { success, message, product }.
function addProduct(data) {
  const product = {
    name: (data.name || '').trim(),
    brand: (data.brand || '').trim(),
    category: (data.category || '').trim(),
    weight: (data.weight || '').trim(),
    mrp: parseFloat(data.mrp) || 0,
    price: parseFloat(data.price) || 0,
    discount: data.discount !== undefined && data.discount !== '' ? parseInt(data.discount, 10) : calcDiscount(data.mrp, data.price),
    image: (data.image || '').trim(),
    description: (data.description || '').trim(),
    features: normalizeFeatures(data.features),
    inStock: data.inStock !== undefined ? !!data.inStock : true
  };

  if (!product.name) return { success: false, message: 'Product name is required' };

  try {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', 'api/products.php', false);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.send(JSON.stringify({ action: 'add', product }));
    const res = JSON.parse(xhr.responseText);
    if (res.success && res.product) {
      const list = getProducts().slice();
      list.push(res.product);
      cacheProducts(list);
      return res;
    }
    throw new Error(res.message || 'API failed');
  } catch (e) {
    // Local fallback
    const list = getProducts().slice();
    const maxId = list.reduce((m, p) => Math.max(m, p.id || 0), 0);
    product.id = maxId + 1;
    list.push(product);
    cacheProducts(list);
    return { success: true, message: 'Product added (local)', product };
  }
}

// Update an existing product by id. Returns { success, message }.
function updateProduct(id, data) {
  id = parseInt(id, 10);
  const list = getProducts().slice();
  const idx = list.findIndex(p => parseInt(p.id, 10) === id);
  if (idx === -1) return { success: false, message: 'Product not found' };

  const existing = list[idx];
  const mrp = data.mrp !== undefined && data.mrp !== '' ? parseFloat(data.mrp) : existing.mrp;
  const price = data.price !== undefined && data.price !== '' ? parseFloat(data.price) : existing.price;
  const updated = {
    ...existing,
    id,
    name: data.name !== undefined ? String(data.name).trim() : existing.name,
    brand: data.brand !== undefined ? String(data.brand).trim() : existing.brand,
    category: data.category !== undefined ? String(data.category).trim() : existing.category,
    weight: data.weight !== undefined ? String(data.weight).trim() : existing.weight,
    mrp,
    price,
    discount: data.discount !== undefined && data.discount !== '' ? parseInt(data.discount, 10) : calcDiscount(mrp, price),
    image: data.image !== undefined ? String(data.image).trim() : existing.image,
    description: data.description !== undefined ? String(data.description).trim() : existing.description,
    features: data.features !== undefined ? normalizeFeatures(data.features) : (existing.features || []),
    inStock: data.inStock !== undefined ? !!data.inStock : (existing.inStock !== undefined ? existing.inStock : true)
  };

  try {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', 'api/products.php', false);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.send(JSON.stringify({ action: 'update', product: updated }));
    const res = JSON.parse(xhr.responseText);
    list[idx] = updated;
    cacheProducts(list);
    return res.success ? res : { success: true, message: 'Product updated (local)' };
  } catch (e) {
    list[idx] = updated;
    cacheProducts(list);
    return { success: true, message: 'Product updated (local)' };
  }
}

// Delete a product by id. Returns { success, message }.
function deleteProduct(id) {
  id = parseInt(id, 10);
  try {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', 'api/products.php', false);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.send(JSON.stringify({ action: 'delete', id }));
    const res = JSON.parse(xhr.responseText);
    const list = getProducts().filter(p => parseInt(p.id, 10) !== id);
    cacheProducts(list);
    return res.success ? res : { success: true, message: 'Product deleted (local)' };
  } catch (e) {
    const list = getProducts().filter(p => parseInt(p.id, 10) !== id);
    cacheProducts(list);
    return { success: true, message: 'Product deleted (local)' };
  }
}

// ============================================
// WHATSAPP NOTIFICATION (Auto-send on order)
// ============================================
function sendWhatsAppNotification(order) {
  const itemsList = order.items.map((item, i) => 
    `${i + 1}. ${item.name} – ${item.quantity} Qty`
  ).join('\n');
  
  const message = `*New Order – 4astore* 🛒\n\n` +
    `*Order ID:* #${order.orderId}\n` +
    `*Customer:* ${order.customer.name}\n` +
    `*Mobile:* ${order.customer.mobile}\n\n` +
    `*Address:* ${order.customer.address}, ${order.customer.city}, Bihar – ${order.customer.pincode}\n\n` +
    `*Items:*\n${itemsList}\n\n` +
    `*Total: ₹${order.totalAmount}*\n` +
    `*Payment:* UPI (${STORE_CONFIG.upiId})\n\n` +
    `---\n4astore | Chandargarh`;
  
  const encoded = encodeURIComponent(message);
  const url = `https://wa.me/${STORE_CONFIG.whatsappNumber}?text=${encoded}`;
  window.open(url, '_blank');
}

// ============================================
// IMAGE HELPER
// ============================================
function getProductImage(product) {
  const productEmojis = {
    'atta': '🌾', 'rice': '🍚', 'mustard oil': '🫒', 'sunflower oil': '🌻',
    'salt': '🧂', 'tea': '🍵', 'coffee': '☕', 'maggi': '🍜', 'noodle': '🍜',
    'surf': '🧺', 'vim': '🧽', 'dettol': '🧼', 'soap': '🧼', 'banana': '🍌',
    'apple': '🍎', 'mango': '🥭', 'orange': '🍊', 'papaya': '🍈',
    'potato': '🥔', 'onion': '🧅', 'tomato': '🍅', 'cauliflower': '🥦',
    'chilli': '🌶️', 'biscuit': '🍪', 'parle': '🍪', 'britannia': '🍪',
    'lays': '🥔', 'chips': '🥔', 'kurkure': '🥨', 'bhujia': '🥨',
    'milk': '🥛', 'butter': '🧈', 'cheese': '🧀', 'curd': '🥛',
    'bread': '🍞', 'cola': '🥤', 'coca': '🥤', 'pepsi': '🥤', 'sprite': '🥤',
    'frooti': '🧃', 'water': '💧', 'colgate': '🪥', 'shampoo': '🧴',
    'dove': '🧼', 'harpic': '🚽', 'lizol': '🧹', 'dal': '🫘',
    'sugar': '🍬', 'masala': '🌶️', 'turmeric': '💛', 'ghee': '🫕',
    'diaper': '👶', 'pampers': '👶', 'johnson': '👶', 'baby': '👶',
    'notebook': '📓', 'pen': '🖊️', 'mustard seed': '🟡'
  };

  let emoji = '📦';
  const nameLower = product.name.toLowerCase();
  for (const [key, val] of Object.entries(productEmojis)) {
    if (nameLower.includes(key)) { emoji = val; break; }
  }

  const catStyles = {
    'fruits-vegetables': { bg: '#e8f5e9', color: '#2e7d32', accent: '#a5d6a7' },
    'rice-atta-dal': { bg: '#fff8e1', color: '#e65100', accent: '#ffe082' },
    'oil-ghee': { bg: '#fff3e0', color: '#e65100', accent: '#ffcc80' },
    'biscuits-snacks': { bg: '#fce4ec', color: '#c62828', accent: '#f48fb1' },
    'tea-coffee': { bg: '#efebe9', color: '#4e342e', accent: '#bcaaa4' },
    'cold-drinks-beverages': { bg: '#e3f2fd', color: '#1565c0', accent: '#90caf9' },
    'dairy-bakery': { bg: '#f3e5f5', color: '#6a1b9a', accent: '#ce93d8' },
    'personal-care': { bg: '#e8eaf6', color: '#283593', accent: '#9fa8da' },
    'home-cleaning': { bg: '#e0f7fa', color: '#00695c', accent: '#80deea' },
    'baby-care': { bg: '#fce4ec', color: '#ad1457', accent: '#f48fb1' },
    'stationery': { bg: '#e8eaf6', color: '#1a237e', accent: '#9fa8da' },
    'daily-essentials': { bg: '#f1f8e9', color: '#33691e', accent: '#aed581' }
  };
  
  const style = catStyles[product.category] || { bg: '#f5f5f5', color: '#424242', accent: '#e0e0e0' };
  const shortName = product.name.length > 18 ? product.name.substring(0, 18) + '…' : product.name;
  
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">
    <defs>
      <linearGradient id="bg${product.id}" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" style="stop-color:${style.bg}"/>
        <stop offset="100%" style="stop-color:${style.accent}"/>
      </linearGradient>
    </defs>
    <rect width="200" height="200" fill="url(#bg${product.id})" rx="16"/>
    <circle cx="100" cy="78" r="40" fill="white" opacity="0.6"/>
    <text x="100" y="93" text-anchor="middle" font-size="44">${emoji}</text>
    <rect x="20" y="130" width="160" height="50" fill="white" opacity="0.7" rx="8"/>
    <text x="100" y="150" text-anchor="middle" font-family="Arial,sans-serif" font-size="12" font-weight="bold" fill="${style.color}">${shortName}</text>
    <text x="100" y="168" text-anchor="middle" font-family="Arial,sans-serif" font-size="11" fill="#666">${product.weight || ''}</text>
  </svg>`;
  
  return 'data:image/svg+xml,' + encodeURIComponent(svg);
}

// Returns the real product image URL when provided, otherwise the generated
// SVG placeholder. Real URLs are preferred so admin-set images show on the store.
function getProductImageSrc(product) {
  const url = (product && product.image ? String(product.image).trim() : '');
  if (!url) return getProductImage(product);
  if (/^https?:/i.test(url)) return 'api/img-proxy.php?url=' + encodeURIComponent(url);
  if (/^(data:|blob:)/i.test(url)) return url;
  if (url.indexOf('data:') === 0) return url;
  if (url.startsWith('/')) return url;
  if (url.startsWith('./') || url.startsWith('../')) return url;
  return getProductImage(product);
}

// Escapes a string for safe use inside an HTML attribute (e.g. onerror data URI).
function escapeAttr(str) {
  return String(str == null ? '' : str).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ============================================
// UTILITY
// ============================================
function formatDate(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
  });
}

function getStatusClass(status) {
  const map = {
    'Order Placed': 'status-placed',
    'Confirmed': 'status-confirmed',
    'Processing': 'status-processing',
    'Out for Delivery': 'status-out',
    'Delivered': 'status-delivered'
  };
  return map[status] || 'status-placed';
}

// ============================================
// PRODUCT CARD HTML GENERATOR
// ============================================
function createProductCard(product) {
  const qty = getItemQuantityInCart(product.id);
  const discountBadge = (product.discount > 0 && !shouldHideMrp())
    ? `<span class="discount-badge">${product.discount}% OFF</span>` : '';
  
  const actionsHTML = qty > 0 
    ? `<div class="qty-controls">
        <button onclick="updateQuantity(${product.id}, -1)">−</button>
        <span>${qty}</span>
        <button onclick="updateQuantity(${product.id}, 1)">+</button>
       </div>`
    : `<button class="btn-add-cart" onclick="addToCart(${product.id})">Add to Cart</button>`;
  
  const fallbackImg = getProductImage(product);
  const imgSrc = getProductImageSrc(product);
  
  return `
    <div class="product-card" data-product-id="${product.id}">
      ${discountBadge}
      <img src="${imgSrc}" alt="${product.name}" class="product-img" onclick="goToProduct(${product.id})" onerror="this.onerror=null;this.src='${escapeAttr(fallbackImg)}'">
      <div class="product-brand">${product.brand}</div>
      <div class="product-name" onclick="goToProduct(${product.id})">${product.name}</div>
      <div class="product-weight">${product.weight}</div>
      <div class="price-row">
        <span class="price">₹${product.price}</span>
        ${(product.discount > 0 && !shouldHideMrp()) ? `<span class="mrp">₹${product.mrp}</span>` : ''}
      </div>
      ${shouldHideMrp()
        ? ''
        : (product.inStock
            ? `<div class="card-actions">${actionsHTML}</div>`
            : `<div class="stock-out">Out of Stock</div>`)}
    </div>
  `;
}

function goToProduct(id) {
  window.location.href = `product-details?id=${id}`;
}

// ============================================
// SLIDER
// ============================================
function initSlider() {
  const track = document.querySelector('.slider-track');
  const dots = document.querySelectorAll('.slider-dots .dot');
  if (!track) return;
  
  let current = 0;
  const slides = track.querySelectorAll('.slide');
  const total = slides.length;
  
  function goToSlide(index) {
    current = index;
    track.style.transform = `translateX(-${current * 100}%)`;
    dots.forEach((dot, i) => dot.classList.toggle('active', i === current));
  }
  
  document.querySelector('.slider-btn.prev')?.addEventListener('click', () => {
    goToSlide((current - 1 + total) % total);
  });
  document.querySelector('.slider-btn.next')?.addEventListener('click', () => {
    goToSlide((current + 1) % total);
  });
  dots.forEach((dot, i) => {
    dot.addEventListener('click', () => goToSlide(i));
  });
  
  setInterval(() => goToSlide((current + 1) % total), 4000);
}
