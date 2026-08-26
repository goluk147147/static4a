<?php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

$ordersFile = __DIR__ . '/../data/orders.json';

// Read orders
function getOrders() {
    global $ordersFile;
    if (!file_exists($ordersFile)) {
        return [];
    }
    $data = file_get_contents($ordersFile);
    return json_decode($data, true) ?: [];
}

// Save orders
function saveOrders($orders) {
    global $ordersFile;
    file_put_contents($ordersFile, json_encode($orders, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
}

// GET - Fetch all orders or by user
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $mobile = $_GET['mobile'] ?? '';
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
    $input = json_decode(file_get_contents('php://input'), true);
    $action = $input['action'] ?? 'save';
    
    if ($action === 'save') {
        $order = $input['order'] ?? null;
        
        if (!$order || !isset($order['orderId'])) {
            echo json_encode(['success' => false, 'message' => 'Invalid order data']);
            exit;
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
    
    if ($action === 'updateStatus') {
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
                $order['status'] = $status;
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
