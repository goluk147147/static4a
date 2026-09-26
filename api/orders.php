<?php
require_once __DIR__ . '/security.php';

$ordersFile = __DIR__ . '/../data/orders.json';

// Read orders
function getOrders()
{
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
function saveOrders($orders)
{
    global $ordersFile;
    $written = file_put_contents($ordersFile, json_encode($orders, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE), LOCK_EX);
    return $written !== false;
}

function initializeTrackingForOrder($order)
{
    $file = __DIR__ . '/../data/tracking.json';
    $tracking = file_exists($file) ? (json_decode(file_get_contents($file), true) ?: []) : [];
    $customer = $order['customer'] ?? [];
    $snapshot = $order['deliveryAddress'] ?? [];
    $tracking[$order['orderId']] = array_merge($tracking[$order['orderId']] ?? [], [
        'orderId' => $order['orderId'],
        'status' => $order['orderStatus'] ?? ($order['status'] ?? 'Rider Assigned'),
        'riderName' => $order['rider_name'] ?? '',
        'riderMobile' => $order['rider_mobile'] ?? '',
        'destLat' => isset($snapshot['latitude']) ? (float) $snapshot['latitude'] : (isset($customer['deliveryLat']) ? (float) $customer['deliveryLat'] : null),
        'destLng' => isset($snapshot['longitude']) ? (float) $snapshot['longitude'] : (isset($customer['deliveryLng']) ? (float) $customer['deliveryLng'] : null),
        'assignedAt' => $order['assigned_at'] ?? date('c')
    ]);
    @file_put_contents($file, json_encode($tracking, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), LOCK_EX);
}

function currentLocationIsServiceable($customer)
{
    if (($customer['deliverySource'] ?? '') !== 'current')
        return true;
    $lat = $customer['deliveryLat'] ?? null;
    $lng = $customer['deliveryLng'] ?? null;
    if (!is_numeric($lat) || !is_numeric($lng))
        return false;
    $settingsFile = __DIR__ . '/../data/settings.json';
    $settings = file_exists($settingsFile) ? (json_decode(file_get_contents($settingsFile), true) ?: []) : [];
    $storeLat = (float) ($settings['storeLatitude'] ?? 24.580164);
    $storeLng = (float) ($settings['storeLongitude'] ?? 84.114194);
    $latDelta = ((float) $lat - $storeLat) * M_PI / 180;
    $lngDelta = ((float) $lng - $storeLng) * M_PI / 180;
    $a = sin($latDelta / 2) ** 2 + cos($storeLat * M_PI / 180) * cos((float) $lat * M_PI / 180) * sin($lngDelta / 2) ** 2;
    $distance = 2 * 6371 * atan2(sqrt($a), sqrt(1 - $a));
    return $distance <= 100;
}

function serviceableVillage($city)
{
    $settingsFile = __DIR__ . '/../data/settings.json';
    $settings = file_exists($settingsFile) ? (json_decode(file_get_contents($settingsFile), true) ?: []) : [];
    $typed = trim((string) $city);
    if ($typed === '')
        return false;
    $typedLower = function_exists('mb_strtolower') ? mb_strtolower($typed, 'UTF-8') : strtolower($typed);
    $villages = explode(',', (string) ($settings['serviceableVillages'] ?? ''));
    foreach ($villages as $village) {
        $full = trim($village);
        if ($full === '')
            continue;
        $parts = [];
        if (preg_match('/^(.*?)\s*\(([^)]*)\)\s*$/u', $full, $matches))
            $parts = [$matches[1], $matches[2]];
        $english = trim($parts[0] ?? $full);
        $hindi = trim($parts[1] ?? '');
        $normalize = function ($value) {
            $value = function_exists('mb_strtolower') ? mb_strtolower(trim($value), 'UTF-8') : strtolower(trim($value));
            return preg_replace('/\s+/', ' ', $value);
        };
        if ($typedLower === $normalize($full) || $typedLower === $normalize($english) || ($hindi !== '' && $typedLower === $normalize($hindi)))
            return true;
    }
    return false;
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
        $userOrders = array_values(array_filter($orders, function ($o) use ($mobile) {
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
        $customerMobile = preg_replace('/\D+/', '', (string) ($order['customer']['mobile'] ?? ''));
        $viewerMobile = preg_replace('/\D+/', '', (string) ($viewer['mobile'] ?? ''));
        if (($viewer['role'] ?? '') !== 'superadmin' && $customerMobile !== '' && $viewerMobile !== '' && $customerMobile !== $viewerMobile) {
            apiJson(['success' => false, 'message' => 'Order owner mismatch'], 403);
        }

        $customer = is_array($order['customer'] ?? null) ? $order['customer'] : [];
        if ((string) ($customer['pincode'] ?? '') !== '824301') {
            apiJson(['success' => false, 'message' => 'Delivery is available only in PIN code 824301'], 422);
        }
        if (!serviceableVillage($customer['city'] ?? '')) {
            apiJson(['success' => false, 'message' => 'This village is outside the 4A Store delivery area. Please select a village from the available list.'], 422);
        }
        if (!currentLocationIsServiceable($customer)) {
            apiJson(['success' => false, 'message' => 'Current location is outside the 4A Store delivery area. Please enter a manual Chandrargarh delivery address.'], 422);
        }
        $address = is_array($order['deliveryAddress'] ?? null) ? $order['deliveryAddress'] : [];
        $order['deliveryAddress'] = [
            'label' => $address['label'] ?? 'Other',
            'receiver_name' => $address['receiver_name'] ?? $customer['name'] ?? '',
            'phone' => $address['phone'] ?? $customer['mobile'] ?? '',
            'house_no' => $address['house_no'] ?? '',
            'landmark' => $address['landmark'] ?? $customer['landmark'] ?? '',
            'full_address' => $address['full_address'] ?? trim(implode(', ', array_filter([$customer['address'] ?? '', $customer['city'] ?? '', $customer['pincode'] ?? '']))),
            'city' => $address['city'] ?? $customer['city'] ?? '',
            'district' => $address['district'] ?? '',
            'state' => $address['state'] ?? 'Bihar',
            'pincode' => $address['pincode'] ?? $customer['pincode'] ?? '',
            'latitude' => isset($address['latitude']) ? (float) $address['latitude'] : (isset($customer['deliveryLat']) ? (float) $customer['deliveryLat'] : null),
            'longitude' => isset($address['longitude']) ? (float) $address['longitude'] : (isset($customer['deliveryLng']) ? (float) $customer['deliveryLng'] : null),
            'captured_at' => date('c')
        ];
        $order['delivery_latitude'] = $order['deliveryAddress']['latitude'];
        $order['delivery_longitude'] = $order['deliveryAddress']['longitude'];

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

        if (!saveOrders($orders)) {
            apiJson(['success' => false, 'message' => 'Order file is not writable on server'], 500);
        }
        echo json_encode(['success' => true, 'message' => 'Order saved']);
        exit;
    }

    if ($action === 'adminCreate') {
        $canCreate = ($viewer['role'] ?? '') === 'owner' || ($viewer['role'] ?? '') === 'superadmin' || (($viewer['role'] ?? '') === 'admin' && in_array('orders', $viewer['permissions'] ?? [], true));
        if (!$canCreate)
            apiJson(['success' => false, 'message' => 'Orders permission required'], 403);
        $customer = is_array($input['customer'] ?? null) ? $input['customer'] : [];
        $items = is_array($input['items'] ?? null) ? $input['items'] : [];
        $mobile = preg_replace('/\D+/', '', (string) ($customer['mobile'] ?? ''));
        if (($customer['name'] ?? '') === '' || !preg_match('/^[6-9][0-9]{9}$/', $mobile) || count($items) < 1) {
            apiJson(['success' => false, 'message' => 'Customer name, valid mobile and at least one item required'], 422);
        }
        $cleanItems = [];
        $total = 0;
        foreach ($items as $item) {
            $id = (int) ($item['id'] ?? 0);
            $qty = (int) ($item['quantity'] ?? 0);
            $price = (float) ($item['price'] ?? 0);
            if (!$id || $qty < 1 || $qty > 999 || $price < 0 || ($item['name'] ?? '') === '')
                apiJson(['success' => false, 'message' => 'Invalid item data'], 422);
            $cleanItems[] = ['id' => $id, 'name' => trim((string) $item['name']), 'weight' => trim((string) ($item['weight'] ?? '')), 'price' => $price, 'quantity' => $qty];
            $total += $price * $qty;
        }
        $order = ['orderId' => '4A' . strtoupper(bin2hex(random_bytes(4))), 'userId' => null, 'customer' => array_merge($customer, ['mobile' => $mobile]), 'items' => $cleanItems, 'subtotal' => $total, 'discount' => 0, 'deliveryCharge' => 0, 'totalAmount' => $total, 'paymentMethod' => 'Cash', 'orderStatus' => 'Order Placed', 'status' => 'Order Placed', 'orderDate' => date('c'), 'createdBy' => $viewer['username'] ?? 'admin'];
        $orders = getOrders();
        $orders[] = $order;
        if (!saveOrders($orders)) {
            apiJson(['success' => false, 'message' => 'Order file is not writable on server'], 500);
        }
        apiJson(['success' => true, 'message' => 'Order created', 'order' => $order]);
    }

    if ($action === 'updateStatus') {
        $isAdmin = ($viewer['role'] ?? '') === 'owner' || ($viewer['role'] ?? '') === 'superadmin' || (($viewer['role'] ?? '') === 'admin' && in_array('orders', $viewer['permissions'] ?? [], true));
        if ($isAdmin) {
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
                if (!$isAdmin && (string) ($order['rider_id'] ?? '') !== (string) ($viewer['id'] ?? $viewer['mobile'] ?? '')) {
                    apiJson(['success' => false, 'message' => 'This order is not assigned to you'], 403);
                }
                // The app uses "orderStatus" everywhere; keep "status" too for compatibility.
                $order['orderStatus'] = $status;
                $order['status'] = $status;
                if ($status === 'Delivered')
                    $order['deliveredAt'] = $order['deliveredAt'] ?? date('c');
                $found = true;
                break;
            }
        }
        unset($order);

        if ($found) {
            if (!saveOrders($orders)) {
                apiJson(['success' => false, 'message' => 'Order file is not writable on server'], 500);
            }
            echo json_encode(['success' => true, 'message' => 'Status updated']);
        } else {
            echo json_encode(['success' => false, 'message' => 'Order not found']);
        }
        exit;
    }

    if ($action === 'acceptOrder') {
        $rider = requireRiderMode();
        $orderId = trim((string) ($input['orderId'] ?? ''));
        if ($orderId === '')
            apiJson(['success' => false, 'message' => 'Order ID required'], 422);
        $riderKey = (string) ($rider['id'] ?? $rider['mobile'] ?? '');
        $orders = getOrders();
        foreach ($orders as &$order) {
            if (($order['orderId'] ?? '') !== $orderId)
                continue;
            if (!empty($order['rider_id']) && (string) $order['rider_id'] !== $riderKey) {
                apiJson(['success' => false, 'message' => 'This order has already been assigned'], 409);
            }
            $order['rider_id'] = $riderKey;
            $order['rider_name'] = $rider['name'] ?? '';
            $order['rider_mobile'] = preg_replace('/\D+/', '', (string) ($rider['mobile'] ?? ''));
            $order['assigned_at'] = $order['assigned_at'] ?? date('c');
            $order['orderStatus'] = 'Rider Assigned';
            $order['status'] = 'Rider Assigned';
            $acceptedOrder = $order;
            unset($order);
            if (!saveOrders($orders))
                apiJson(['success' => false, 'message' => 'Order file is not writable on server'], 500);
            initializeTrackingForOrder($acceptedOrder);
            apiJson(['success' => true, 'message' => 'Order accepted']);
        }
        unset($order);
        apiJson(['success' => false, 'message' => 'Order not found'], 404);
    }

    echo json_encode(['success' => false, 'message' => 'Invalid action']);
}
?>