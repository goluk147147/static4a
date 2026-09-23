<?php
// Live delivery tracking (free, no external API).
// Rider posts his GPS periodically; customer polls it for a near-live map.
require_once __DIR__ . '/security.php';

$file = __DIR__ . '/../data/tracking.json';

function readTracking()
{
    global $file;
    if (!file_exists($file))
        return [];
    $d = json_decode(file_get_contents($file), true);
    return is_array($d) ? $d : [];
}
function writeTracking($data)
{
    global $file;
    file_put_contents($file, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
}

// GET ?orderId=XXX  -> current tracking info for one order
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $all = readTracking();
    $orderId = isset($_GET['orderId']) ? trim($_GET['orderId']) : '';
    if ($orderId !== '') {
        $viewer = requireSessionUser();
        $staffMode = hasPermission($viewer, 'riderTracking')
            || (($viewer['role'] ?? '') === 'rider' && ($viewer['mode'] ?? 'rider') === 'rider');
        if (!$staffMode) {
            $ordersFile = __DIR__ . '/../data/orders.json';
            $orders = file_exists($ordersFile) ? (json_decode(file_get_contents($ordersFile), true) ?: []) : [];
            $owned = false;
            foreach ($orders as $order) {
                if (($order['orderId'] ?? '') === $orderId && ($order['customer']['mobile'] ?? '') === ($viewer['mobile'] ?? '')) {
                    $owned = true;
                    break;
                }
            }
            if (!$owned)
                apiJson(['success' => false, 'message' => 'Access denied'], 403);
        }
        $t = isset($all[$orderId]) ? $all[$orderId] : null;
        echo json_encode(['success' => true, 'tracking' => $t]);
        exit;
    }
    // no orderId -> return all (admin/rider overview)
    $viewer = requireSessionUser();
    $adminTracking = hasPermission($viewer, 'riderTracking');
    if (!$adminTracking && !(($viewer['role'] ?? '') === 'rider' && ($viewer['mode'] ?? 'rider') === 'rider')) {
        apiJson(['success' => false, 'message' => 'Staff access required'], 403);
    }
    echo json_encode(['success' => true, 'all' => $all]);
    exit;
}

// POST actions: updateLocation | setStatus
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $in = json_decode(file_get_contents('php://input'), true) ?: [];
    $action = $in['action'] ?? '';
    $viewer = requireRiderMode();
    $orderId = trim($in['orderId'] ?? '');
    if ($orderId === '') {
        echo json_encode(['success' => false, 'message' => 'orderId required']);
        exit;
    }

    $all = readTracking();
    if (!isset($all[$orderId])) {
        // Older/admin-created orders may not have a tracking row yet. Create it
        // only when the order really exists, so riders cannot invent IDs.
        $ordersFile = __DIR__ . '/../data/orders.json';
        $orders = file_exists($ordersFile) ? (json_decode(file_get_contents($ordersFile), true) ?: []) : [];
        $order = null;
        foreach ($orders as $candidate) {
            if (($candidate['orderId'] ?? '') === $orderId) {
                $order = $candidate;
                break;
            }
        }
        if (!$order)
            apiJson(['success' => false, 'message' => 'Order not found'], 404);
        $orderStatus = $order['orderStatus'] ?? ($order['status'] ?? 'Order Placed');
        if (in_array($orderStatus, ['Delivered', 'Cancelled'], true)) {
            apiJson(['success' => false, 'message' => 'This order is already closed'], 409);
        }
        $customer = $order['customer'] ?? [];
        $all[$orderId] = [
            'orderId' => $orderId,
            'status' => $orderStatus,
            'destLat' => isset($customer['deliveryLat']) ? (float) $customer['deliveryLat'] : null,
            'destLng' => isset($customer['deliveryLng']) ? (float) $customer['deliveryLng'] : null,
            'createdAt' => date('c')
        ];
    }

    if ($action === 'updateLocation') {
        $lat = isset($in['lat']) ? (float) $in['lat'] : null;
        $lng = isset($in['lng']) ? (float) $in['lng'] : null;
        if ($lat === null || $lng === null || !is_finite($lat) || !is_finite($lng) || $lat < -90 || $lat > 90 || $lng < -180 || $lng > 180) {
            echo json_encode(['success' => false, 'message' => 'Valid lat/lng required']);
            exit;
        }
        $all[$orderId]['lat'] = $lat;
        $all[$orderId]['lng'] = $lng;
        $all[$orderId]['updatedAt'] = date('c');
        if (isset($in['riderName']))
            $all[$orderId]['riderName'] = trim($in['riderName']);
        if (isset($in['riderMobile'])) {
            $mobile = preg_replace('/\D+/', '', (string) $in['riderMobile']);
            $all[$orderId]['riderMobile'] = preg_match('/^[6-9][0-9]{9}$/', $mobile) ? $mobile : '';
        }
        if (($all[$orderId]['status'] ?? '') !== 'Delivered')
            $all[$orderId]['status'] = 'Out for Delivery';
        writeTracking($all);
        echo json_encode(['success' => true, 'message' => 'Location updated']);
        exit;
    }

    if ($action === 'setStatus') {
        $status = trim($in['status'] ?? '');
        $allowed = ['Order Placed', 'Confirmed', 'Packed', 'Out for Delivery', 'Delivered', 'Cancelled'];
        if (!in_array($status, $allowed, true)) {
            echo json_encode(['success' => false, 'message' => 'bad status']);
            exit;
        }
        $all[$orderId]['status'] = $status;
        $all[$orderId]['updatedAt'] = date('c');
        if (isset($in['destLat']) && isset($in['destLng'])) {
            $all[$orderId]['destLat'] = (float) $in['destLat'];
            $all[$orderId]['destLng'] = (float) $in['destLng'];
        }
        writeTracking($all);
        echo json_encode(['success' => true, 'message' => 'Status set']);
        exit;
    }

    echo json_encode(['success' => false, 'message' => 'Invalid action']);
    exit;
}

echo json_encode(['success' => false, 'message' => 'Invalid request']);
?>