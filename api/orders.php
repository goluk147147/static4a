<?php
require_once __DIR__ . '/security.php';

$ordersFile = __DIR__ . '/../data/orders.json';

// Read orders
function getOrders() {
    global $ordersFile;
    if (!file_exists($ordersFile)) {
        return [];
    }
    $data = file_get_contents($ordersFile);
    $orders = json_decode($data, true) ?: [];
    $trackingFile = __DIR__ . '/../data/tracking.json';
    $tracking = file_exists($trackingFile) ? (json_decode(file_get_contents($trackingFile), true) ?: []) : [];
    foreach ($orders as &$order) {
        if (($order['orderStatus'] ?? $order['status'] ?? '') === 'Delivered' && empty($order['deliveredAt'])) {
            $order['deliveredAt'] = $tracking[$order['orderId']]['updatedAt'] ?? null;
        }
    }
    unset($order);
    return $orders;
}

// Save orders
function saveOrders($orders) {
    global $ordersFile;
    file_put_contents($ordersFile, json_encode($orders, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
}

// GET - Fetch all orders or by user
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $mobile = $_GET['mobile'] ?? '';
    $viewer = requireSessionUser();
    $staffMode = ($viewer['role'] ?? '') === 'owner' || ($viewer['role'] ?? '') === 'superadmin' || (($viewer['role'] ?? '') === 'admin' && in_array('orders', $viewer['permissions'] ?? [], true)) || (($viewer['role'] ?? '') === 'rider' && ($viewer['mode'] ?? 'rider') === 'rider');
    if (!$mobile && !$staffMode) {
        apiJson(['success' => false, 'message' => 'User mobile or staff access required'], 403);
    }
    if ($mobile && !$staffMode && ($viewer['mobile'] ?? '') !== $mobile) {
        apiJson(['success' => false, 'message' => 'Access denied'], 403);
    }
    $orders = getOrders();
    
    if ($mobile) {
        // Filter orders by user mobile
        $userOrders = array_values(array_filter($orders, function($o) use ($mobile) {
            return isset($o['customer']['mobile']) && $o['customer']['mobile'] === $mobile;
        }));
        echo json_encode(['success' => true, 'orders' => $userOrders]);
    } else {
        echo json_encode(['success' => true, 'orders' => $orders]);
    }
    exit;
}

// POST - Save new order or update status
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $viewer = requireSessionUser();
    $input = json_decode(file_get_contents('php://input'), true);
    $action = $input['action'] ?? 'save';
    
    if ($action === 'save') {
        $order = $input['order'] ?? null;
        
        if (!$order || !isset($order['orderId'])) {
            echo json_encode(['success' => false, 'message' => 'Invalid order data']);
            exit;
        }
        if (($viewer['role'] ?? '') !== 'superadmin' && ($order['customer']['mobile'] ?? '') !== ($viewer['mobile'] ?? '')) {
            apiJson(['success' => false, 'message' => 'Order owner mismatch'], 403);
        }
        
        $orders = getOrders();
        
        // Check if order already exists (avoid duplicates)
        $exists = false;
        foreach ($orders as $key => $o) {
            if ($o['orderId'] === $order['orderId']) {
                $orders[$key] = $order; // Update existing
                $exists = true;
                break;
            }
        }
        
        if (!$exists) {
            $orders[] = $order;
        }
        
        saveOrders($orders);
        echo json_encode(['success' => true, 'message' => 'Order saved']);
        exit;
    }

    if ($action === 'adminCreate') {
        $canCreate = ($viewer['role'] ?? '') === 'owner' || ($viewer['role'] ?? '') === 'superadmin' || (($viewer['role'] ?? '') === 'admin' && in_array('orders', $viewer['permissions'] ?? [], true));
        if (!$canCreate) apiJson(['success' => false, 'message' => 'Orders permission required'], 403);
        $customer = is_array($input['customer'] ?? null) ? $input['customer'] : [];
        $items = is_array($input['items'] ?? null) ? $input['items'] : [];
        $mobile = preg_replace('/\D+/', '', (string)($customer['mobile'] ?? ''));
        if (($customer['name'] ?? '') === '' || !preg_match('/^[6-9][0-9]{9}$/', $mobile) || count($items) < 1) {
            apiJson(['success' => false, 'message' => 'Customer name, valid mobile and at least one item required'], 422);
        }
        $cleanItems = [];
        $total = 0;
        foreach ($items as $item) {
            $id = (int)($item['id'] ?? 0); $qty = (int)($item['quantity'] ?? 0); $price = (float)($item['price'] ?? 0);
            if (!$id || $qty < 1 || $qty > 999 || $price < 0 || ($item['name'] ?? '') === '') apiJson(['success' => false, 'message' => 'Invalid item data'], 422);
            $cleanItems[] = ['id' => $id, 'name' => trim((string)$item['name']), 'weight' => trim((string)($item['weight'] ?? '')), 'price' => $price, 'quantity' => $qty];
            $total += $price * $qty;
        }
        $order = ['orderId' => '4A' . strtoupper(bin2hex(random_bytes(4))), 'userId' => null, 'customer' => array_merge($customer, ['mobile' => $mobile]), 'items' => $cleanItems, 'subtotal' => $total, 'discount' => 0, 'deliveryCharge' => 0, 'totalAmount' => $total, 'paymentMethod' => 'Cash', 'orderStatus' => 'Order Placed', 'status' => 'Order Placed', 'orderDate' => date('c'), 'createdBy' => $viewer['username'] ?? 'admin'];
        $orders = getOrders(); $orders[] = $order; saveOrders($orders);
        apiJson(['success' => true, 'message' => 'Order created', 'order' => $order]);
    }
    
    if ($action === 'updateStatus') {
        if (($viewer['role'] ?? '') === 'owner' || ($viewer['role'] ?? '') === 'superadmin' || (($viewer['role'] ?? '') === 'admin' && in_array('orders', $viewer['permissions'] ?? [], true))) {
            // Admin may update any order status.
        } elseif (($viewer['role'] ?? '') !== 'rider' || ($viewer['mode'] ?? 'rider') !== 'rider') {
            apiJson(['success' => false, 'message' => 'Staff access required'], 403);
        }
        $orderId = $input['orderId'] ?? '';
        $status = $input['status'] ?? '';
        
        if (!$orderId || !$status) {
            echo json_encode(['success' => false, 'message' => 'Order ID and status required']);
            exit;
        }
        
        $orders = getOrders();
        $found = false;
        
        foreach ($orders as &$order) {
            if ($order['orderId'] === $orderId) {
                // The app uses "orderStatus" everywhere; keep "status" too for compatibility.
                $order['orderStatus'] = $status;
                $order['status'] = $status;
                if ($status === 'Delivered') $order['deliveredAt'] = $order['deliveredAt'] ?? date('c');
                $found = true;
                break;
            }
        }
        unset($order);
        
        if ($found) {
            saveOrders($orders);
            echo json_encode(['success' => true, 'message' => 'Status updated']);
        } else {
            echo json_encode(['success' => false, 'message' => 'Order not found']);
        }
        exit;
    }
    
    echo json_encode(['success' => false, 'message' => 'Invalid action']);
}
?>
