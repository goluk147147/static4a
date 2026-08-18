import AsyncStorage from '@react-native-async-storage/async-storage';

// ============================================
// Cart
// ============================================
export async function getCart() {
  const data = await AsyncStorage.getItem('4astore_cart');
  return data ? JSON.parse(data) : [];
}

export async function saveCart(cart) {
  await AsyncStorage.setItem('4astore_cart', JSON.stringify(cart));
}

export async function addToCart(product) {
  const cart = await getCart();
  const existing = cart.find(item => item.id === product.id);
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
      quantity: 1,
    });
  }
  await saveCart(cart);
  return cart;
}

export async function removeFromCart(productId) {
  let cart = await getCart();
  cart = cart.filter(item => item.id !== productId);
  await saveCart(cart);
  return cart;
}

export async function updateCartQty(productId, change) {
  let cart = await getCart();
  const item = cart.find(i => i.id === productId);
  if (!item) return cart;
  item.quantity += change;
  if (item.quantity <= 0) {
    cart = cart.filter(i => i.id !== productId);
  }
  await saveCart(cart);
  return cart;
}

export function getCartTotals(cart, freeDeliveryAbove = 500, deliveryCharge = 30) {
  const subtotal = cart.reduce((s, i) => s + i.price * i.quantity, 0);
  const mrpTotal = cart.reduce((s, i) => s + i.mrp * i.quantity, 0);
  const discount = mrpTotal - subtotal;
  const delivery = subtotal >= freeDeliveryAbove ? 0 : deliveryCharge;
  const total = subtotal + delivery;
  const itemCount = cart.reduce((s, i) => s + i.quantity, 0);
  return { subtotal, mrpTotal, discount, delivery, total, itemCount };
}

// ============================================
// User Auth
// ============================================
export async function getUser() {
  const data = await AsyncStorage.getItem('4astore_user');
  return data ? JSON.parse(data) : null;
}

export async function saveUser(user) {
  await AsyncStorage.setItem('4astore_user', JSON.stringify(user));
}

export async function logout() {
  await AsyncStorage.removeItem('4astore_user');
}

export async function getUsers() {
  const data = await AsyncStorage.getItem('4astore_users');
  return data ? JSON.parse(data) : [];
}

export async function saveUsers(users) {
  await AsyncStorage.setItem('4astore_users', JSON.stringify(users));
}

// ============================================
// Orders
// ============================================
export async function getOrders() {
  const data = await AsyncStorage.getItem('4astore_orders');
  return data ? JSON.parse(data) : [];
}

export async function saveOrder(order) {
  const orders = await getOrders();
  orders.unshift(order);
  await AsyncStorage.setItem('4astore_orders', JSON.stringify(orders));
}

export function generateOrderId() {
  return '4A' + Math.floor(100000 + Math.random() * 900000);
}
