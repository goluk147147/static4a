<?php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

$settingsFile = __DIR__ . '/../data/settings.json';

$defaults = [
    'storeEmail'        => '4astorewale@gmail.com',
    'deliveryCharge'    => 30,
    'freeDeliveryAbove' => 500,
    'upiId'             => 'goluk147147@ybl',
    'upiName'           => '4astore',
];

function readSettings($file, $defaults) {
    if (!file_exists($file)) return $defaults;
    $data = json_decode(file_get_contents($file), true);
    if (!is_array($data)) return $defaults;
    return array_merge($defaults, $data);
}

// GET - return current settings
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    echo json_encode(['success' => true, 'settings' => readSettings($settingsFile, $defaults)]);
    exit;
}

// POST - save settings
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $input = json_decode(file_get_contents('php://input'), true) ?: [];
    $current = readSettings($settingsFile, $defaults);

    if (isset($input['storeEmail'])) {
        $email = trim((string)$input['storeEmail']);
        if ($email === '' || filter_var($email, FILTER_VALIDATE_EMAIL)) {
            $current['storeEmail'] = $email;
        } else {
            echo json_encode(['success' => false, 'message' => 'Invalid email address']);
            exit;
        }
    }
    if (isset($input['deliveryCharge']) && is_numeric($input['deliveryCharge'])) {
        $current['deliveryCharge'] = (int)$input['deliveryCharge'];
    }
    if (isset($input['freeDeliveryAbove']) && is_numeric($input['freeDeliveryAbove'])) {
        $current['freeDeliveryAbove'] = (int)$input['freeDeliveryAbove'];
    }
    if (isset($input['upiId'])) {
        $current['upiId'] = trim((string)$input['upiId']);
    }
    if (isset($input['upiName'])) {
        $current['upiName'] = trim((string)$input['upiName']);
    }

    file_put_contents($settingsFile, json_encode($current, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
    echo json_encode(['success' => true, 'message' => 'Settings saved', 'settings' => $current]);
    exit;
}

echo json_encode(['success' => false, 'message' => 'Invalid request']);
?>
