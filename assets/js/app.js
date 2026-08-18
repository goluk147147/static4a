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
  adminPassword: "4astore@admin"
};

// State
let products = [];
let categories = [];

// ============================================
// INITIALIZATION
// ============================================
document.addEventListener('DOMContentLoaded', () => {
  loadData();
  updateCartBadge();
  updateLoginUI();
});

async function loadData() {
  try {
    const [prodRes, catRes] = await Promise.all([
      fetch('data/products.json'),
      fetch('data/categories.json')
    ]);
    products = await prodRes.json();
    categories = await catRes.json();
    
    window.dispatchEvent(new CustomEvent('dataLoaded', { detail: { products, categories } }));
  } catch (e) {
    console.error('Error loading data:', e);
  }
}

// ============================================
// USER LOGIN / AUTH (LocalStorage based)
// ============================================
function getLoggedInUser() {
  return JSON.parse(localStorage.getItem('4astore_user')) || null;
}

function loginUser(name, mobile, username) {
  const user = { name, mobile, username: username || mobile, loggedInAt: new Date().toISOString() };
  localStorage.setItem('4astore_user', JSON.stringify(user));
  updateLoginUI();
  showToast(`🙏 Welcome, ${name}!`, 'success');
  return user;
}

function logoutUser() {
  localStorage.removeItem('4astore_user');
  updateLoginUI();
  showToast('Logged out successfully', 'info');
  window.location.href = 'login.html';
}

function updateLoginUI() {
  const user = getLoggedInUser();
  document.querySelectorAll('.login-btn-area').forEach(el => {
    if (user) {
      el.innerHTML = `<a href="profile.html" title="${user.name}" style="display:flex;align-items:center;gap:4px;">
        <span style="background:var(--primary);color:white;width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;">${user.name.charAt(0).toUpperCase()}</span>
        <span class="action-text">${user.name.split(' ')[0]}</span>
      </a>`;
    } else {
      el.innerHTML = `<a href="login.html">👤 <span class="action-text">Login</span></a>`;
    }
  });
}

function requireLogin() {
  const user = getLoggedInUser();
  if (!user) {
    showToast('Please login first to continue', 'error');
    const currentPage = window.location.pathname.split('/').pop();
    setTimeout(() => { window.location.href = `login.html?return=${currentPage}`; }, 1000);
    return false;
  }
  return true;
}

// ============================================
// CART FUNCTIONS
// ============================================
function getCart() {
  return JSON.parse(localStorage.getItem('4astore_cart')) || [];
}

function saveCart(cartData) {
  localStorage.setItem('4astore_cart', JSON.stringify(cartData));
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
  const deliveryCharge = subtotal >= STORE_CONFIG.freeDeliveryAbove ? 0 : STORE_CONFIG.deliveryCharge;
  const total = subtotal + deliveryCharge;
  
  return { subtotal, mrpTotal, discount, deliveryCharge, total, itemCount: getCartCount() };
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
    window.location.href = `products.html?search=${encodeURIComponent(query.trim())}`;
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
  
  const icons = { success: '✅', error: '❌', info: 'ℹ️' };
  
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
  
  const order = {
    orderId: generateOrderId(),
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
  
  // Save to order history
  let orders = JSON.parse(localStorage.getItem('4astore_orders')) || [];
  orders.unshift(order);
  localStorage.setItem('4astore_orders', JSON.stringify(orders));
  
  // Save customer info
  localStorage.setItem('4astore_customer', JSON.stringify(customerData));
  
  // Clear cart
  saveCart([]);
  
  return order;
}

function getOrders() {
  return JSON.parse(localStorage.getItem('4astore_orders')) || [];
}

function updateOrderStatus(orderId, newStatus) {
  let orders = JSON.parse(localStorage.getItem('4astore_orders')) || [];
  const order = orders.find(o => o.orderId === orderId);
  if (order) {
    order.orderStatus = newStatus;
    localStorage.setItem('4astore_orders', JSON.stringify(orders));
  }
  return order;
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
  const discountBadge = product.discount > 0 
    ? `<span class="discount-badge">${product.discount}% OFF</span>` : '';
  
  const actionsHTML = qty > 0 
    ? `<div class="qty-controls">
        <button onclick="updateQuantity(${product.id}, -1)">−</button>
        <span>${qty}</span>
        <button onclick="updateQuantity(${product.id}, 1)">+</button>
       </div>`
    : `<button class="btn-add-cart" onclick="addToCart(${product.id})">Add to Cart</button>`;
  
  const fallbackImg = getProductImage(product);
  
  return `
    <div class="product-card" data-product-id="${product.id}">
      ${discountBadge}
      <img src="${fallbackImg}" alt="${product.name}" class="product-img" onclick="goToProduct(${product.id})">
      <div class="product-brand">${product.brand}</div>
      <div class="product-name" onclick="goToProduct(${product.id})">${product.name}</div>
      <div class="product-weight">${product.weight}</div>
      <div class="price-row">
        <span class="price">₹${product.price}</span>
        ${product.discount > 0 ? `<span class="mrp">₹${product.mrp}</span>` : ''}
      </div>
      ${product.inStock 
        ? `<div class="card-actions">${actionsHTML}</div>` 
        : `<div class="stock-out">Out of Stock</div>`}
    </div>
  `;
}

function goToProduct(id) {
  window.location.href = `product-details.html?id=${id}`;
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
