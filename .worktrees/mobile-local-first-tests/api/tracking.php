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

function validCoordinate($lat, $lng)
{
    return is_numeric($lat) && is_numeric($lng) && is_finite((float) $lat) && is_finite((float) $lng)
        && (float) $lat >= -90 && (float) $lat <= 90 && (float) $lng >= -180 && (float) $lng <= 180
        && !((float) $lat === 0.0 && (float) $lng === 0.0);
}

function deliveryCoordinateNearStore($lat, $lng, $store)
{
    if (!validCoordinate($lat, $lng))
        return false;
    $earthRadius = 6371;
    $latDelta = ((float) $lat - $store['latitude']) * M_PI / 180;
    $lngDelta = ((float) $lng - $store['longitude']) * M_PI / 180;
    $a = sin($latDelta / 2) ** 2 + cos($store['latitude'] * M_PI / 180) * cos((float) $lat * M_PI / 180) * sin($lngDelta / 2) ** 2;
    $distance = 2 * $earthRadius * atan2(sqrt($a), sqrt(1 - $a));
    return $distance <= 100;
}

function trackingSettings()
{
    $file = __DIR__ . '/../data/settings.json';
    $settings = file_exists($file) ? (json_decode(file_get_contents($file), true) ?: []) : [];
    return [
        'latitude' => (float) ($settings['storeLatitude'] ?? 24.580164),
        'longitude' => (float) ($settings['storeLongitude'] ?? 84.114194),
        'name' => '4A Store',
        'address' => $settings['storeAddress'] ?? 'Gajna Road, Chandargarh, Nabinagar, Aurangabad, Bihar - 824301'
    ];
}

function roadRoute($originLat, $originLng, $destinationLat, $destinationLng)
{
    if (!validCoordinate($originLat, $originLng) || !validCoordinate($destinationLat, $destinationLng))
        return null;
    $url = 'https://router.project-osrm.org/route/v1/driving/'
        . rawurlencode((float) $originLng . ',' . (float) $originLat) . ';'
        . rawurlencode((float) $destinationLng . ',' . (float) $destinationLat)
        . '?overview=full&geometries=geojson&steps=false';
    $response = false;
    if (function_exists('curl_init')) {
        $curl = curl_init($url);
        curl_setopt_array($curl, [CURLOPT_RETURNTRANSFER => true, CURLOPT_CONNECTTIMEOUT => 3, CURLOPT_TIMEOUT => 5, CURLOPT_HTTPHEADER => ['Accept: application/json']]);
        $response = curl_exec($curl);
        curl_close($curl);
    } else {
        $context = stream_context_create(['http' => ['timeout' => 5, 'header' => "Accept: application/json\r\n"]]);
        $response = @file_get_contents($url, false, $context);
    }
    if ($response === false)
        return null;
    $data = json_decode($response, true);
    $route = $data['routes'][0] ?? null;
    if (!$route || !isset($route['distance'], $route['duration'], $route['geometry']['coordinates']))
        return null;
    return [
        'distance' => round(((float) $route['distance']) / 1000, 2),
        'eta' => max(1, (int) round(((float) $route['duration']) / 60)),
        'polyline' => $route['geometry']
    ];
}

function trackingPayload($order, $tracking, $store)
{
    $customer = $order['customer'] ?? [];
    $snapshot = $order['deliveryAddress'] ?? [];
    $customerLat = $snapshot['latitude'] ?? ($order['delivery_latitude'] ?? ($customer['deliveryLat'] ?? null));
    $customerLng = $snapshot['longitude'] ?? ($order['delivery_longitude'] ?? ($customer['deliveryLng'] ?? null));
    if (!deliveryCoordinateNearStore($customerLat, $customerLng, $store)) {
        $customerLat = null;
        $customerLng = null;
    }
    $riderLat = $tracking['lat'] ?? null;
    $riderLng = $tracking['lng'] ?? null;
    $hasDeviceGps = ($tracking['source'] ?? '') === 'device_gps';
    $riderLocation = $hasDeviceGps && validCoordinate($riderLat, $riderLng) ? [
        'latitude' => (float) $riderLat,
        'longitude' => (float) $riderLng,
        'heading' => isset($tracking['heading']) ? (float) $tracking['heading'] : null,
        'speed' => isset($tracking['speed']) ? (float) $tracking['speed'] : null,
        'accuracy' => isset($tracking['accuracy']) ? (float) $tracking['accuracy'] : null,
        'updated_at' => $tracking['updatedAt'] ?? null
    ] : null;
    $routeOrigin = $riderLocation ?: ['latitude' => $store['latitude'], 'longitude' => $store['longitude']];
    $route = $riderLocation ? roadRoute($routeOrigin['latitude'], $routeOrigin['longitude'], $customerLat, $customerLng) : null;
    return [
        'order_id' => $order['orderId'],
        'status' => $tracking['status'] ?? ($order['orderStatus'] ?? ($order['status'] ?? 'Order Placed')),
        'rider' => [
            'id' => $order['rider_id'] ?? null,
            'name' => $tracking['riderName'] ?? ($order['rider_name'] ?? ''),
            'phone' => $tracking['riderMobile'] ?? ($order['rider_mobile'] ?? ''),
            'location' => $riderLocation
        ],
        'customer' => [
            'latitude' => validCoordinate($customerLat, $customerLng) ? (float) $customerLat : null,
            'longitude' => validCoordinate($customerLat, $customerLng) ? (float) $customerLng : null
        ],
        'store' => $store,
        'route' => $route,
        // Legacy fields retained for the existing customer/admin pages.
        'orderId' => $order['orderId'],
        'lat' => $riderLocation['latitude'] ?? null,
        'lng' => $riderLocation['longitude'] ?? null,
        'heading' => $riderLocation['heading'] ?? null,
        'speed' => $riderLocation['speed'] ?? null,
        'accuracy' => $riderLocation['accuracy'] ?? null,
        'riderName' => $tracking['riderName'] ?? ($order['rider_name'] ?? ''),
        'riderMobile' => $tracking['riderMobile'] ?? ($order['rider_mobile'] ?? ''),
        'destLat' => $customerLat !== null ? (float) $customerLat : null,
        'destLng' => $customerLng !== null ? (float) $customerLng : null,
        'updatedAt' => $tracking['updatedAt'] ?? ($order['assigned_at'] ?? null)
    ];
}

// GET ?orderId=XXX  -> current tracking info for one order
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $all = readTracking();
    $orderId = isset($_GET['orderId']) ? trim($_GET['orderId']) : '';
    if ($orderId !== '') {
        $viewer = requireSessionUser();
        $ordersFile = __DIR__ . '/../data/orders.json';
        $orders = file_exists($ordersFile) ? (json_decode(file_get_contents($ordersFile), true) ?: []) : [];
        $trackedOrder = null;
        foreach ($orders as $candidate) {
            if (($candidate['orderId'] ?? '') === $orderId) {
                $trackedOrder = $candidate;
                break;
            }
        }
        if (!$trackedOrder)
            apiJson(['success' => false, 'message' => 'Order not found'], 404);
        $staffMode = hasPermission($viewer, 'riderTracking')
            || (($viewer['role'] ?? '') === 'rider' && ($viewer['mode'] ?? 'rider') === 'rider');
        if (!$staffMode) {
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
        $t = trackingPayload($trackedOrder, $all[$orderId] ?? [], trackingSettings());
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

    $ordersFile = __DIR__ . '/../data/orders.json';
    $orders = file_exists($ordersFile) ? (json_decode(file_get_contents($ordersFile), true) ?: []) : [];
    $trackedOrder = null;
    foreach ($orders as $candidate) {
        if (($candidate['orderId'] ?? '') === $orderId) {
            $trackedOrder = $candidate;
            break;
        }
    }
    if (!$trackedOrder)
        apiJson(['success' => false, 'message' => 'Order not found'], 404);
    $riderKey = (string) ($viewer['id'] ?? $viewer['mobile'] ?? '');
    if ((string) ($trackedOrder['rider_id'] ?? '') !== $riderKey) {
        apiJson(['success' => false, 'message' => 'This order is not assigned to you'], 403);
    }

    $all = readTracking();
    if (!isset($all[$orderId])) {
        // Older/admin-created orders may not have a tracking row yet. Create it
        // only when the order really exists, so riders cannot invent IDs.
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
        $snapshot = $order['deliveryAddress'] ?? [];
        $all[$orderId] = [
            'orderId' => $orderId,
            'status' => $orderStatus,
            'destLat' => isset($snapshot['latitude']) ? (float) $snapshot['latitude'] : (isset($customer['deliveryLat']) ? (float) $customer['deliveryLat'] : null),
            'destLng' => isset($snapshot['longitude']) ? (float) $snapshot['longitude'] : (isset($customer['deliveryLng']) ? (float) $customer['deliveryLng'] : null),
            'createdAt' => date('c')
        ];
    }

    if ($action === 'updateLocation') {
        $lat = $in['latitude'] ?? $in['lat'] ?? null;
        $lng = $in['longitude'] ?? $in['lng'] ?? null;
        if (!validCoordinate($lat, $lng)) {
            echo json_encode(['success' => false, 'message' => 'Valid non-zero lat/lng required']);
            exit;
        }
        $accuracy = isset($in['accuracy']) && is_numeric($in['accuracy']) ? (float) $in['accuracy'] : null;
        if ($accuracy !== null && ($accuracy < 0 || $accuracy > 1000)) {
            echo json_encode(['success' => false, 'message' => 'Invalid GPS accuracy']);
            exit;
        }
        $all[$orderId]['lat'] = (float) $lat;
        $all[$orderId]['lng'] = (float) $lng;
        $all[$orderId]['accuracy'] = $accuracy;
        $all[$orderId]['heading'] = isset($in['heading']) && is_numeric($in['heading']) ? (float) $in['heading'] : null;
        $all[$orderId]['speed'] = isset($in['speed']) && is_numeric($in['speed']) ? max(0, (float) $in['speed']) : null;
        $all[$orderId]['source'] = 'device_gps';
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