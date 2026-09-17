<?php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, GET, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

$dir = __DIR__ . '/../data/screenshots';
if (!is_dir($dir)) {
    @mkdir($dir, 0775, true);
}

// GET ?orderId=XXX  -> returns the saved screenshot URL if it exists
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $orderId = preg_replace('/[^A-Za-z0-9_-]/', '', $_GET['orderId'] ?? '');
    if ($orderId === '') { echo json_encode(['success' => false, 'message' => 'orderId required']); exit; }
    foreach (['jpg', 'png', 'jpeg', 'webp'] as $ext) {
        $f = $dir . '/' . $orderId . '.' . $ext;
        if (file_exists($f)) {
            echo json_encode(['success' => true, 'url' => 'data/screenshots/' . $orderId . '.' . $ext]);
            exit;
        }
    }
    echo json_encode(['success' => false, 'message' => 'not found']);
    exit;
}

// POST { orderId, image (data URI base64) } -> saves the screenshot to disk
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $input = json_decode(file_get_contents('php://input'), true) ?: [];
    $orderId = preg_replace('/[^A-Za-z0-9_-]/', '', $input['orderId'] ?? '');
    $image = $input['image'] ?? '';

    if ($orderId === '' || $image === '') {
        echo json_encode(['success' => false, 'message' => 'orderId and image required']);
        exit;
    }

    // Parse the data URI: data:image/jpeg;base64,....
    $ext = 'jpg';
    if (preg_match('/^data:image\/(png|jpe?g|webp);base64,/', $image, $m)) {
        $ext = strtolower($m[1]) === 'jpeg' ? 'jpg' : strtolower($m[1]);
        $image = substr($image, strpos($image, ',') + 1);
    }
    $image = str_replace(' ', '+', $image);
    $data = base64_decode($image, true);

    if ($data === false) {
        echo json_encode(['success' => false, 'message' => 'Invalid image data']);
        exit;
    }
    // Basic size guard (max ~6 MB)
    if (strlen($data) > 6 * 1024 * 1024) {
        echo json_encode(['success' => false, 'message' => 'Image too large']);
        exit;
    }

    // Remove any older screenshot for this order (different extension)
    foreach (['jpg', 'png', 'jpeg', 'webp'] as $e) {
        $old = $dir . '/' . $orderId . '.' . $e;
        if (file_exists($old)) @unlink($old);
    }

    $file = $dir . '/' . $orderId . '.' . $ext;
    if (file_put_contents($file, $data) === false) {
        echo json_encode(['success' => false, 'message' => 'Could not save file (check folder permissions)']);
        exit;
    }

    echo json_encode(['success' => true, 'url' => 'data/screenshots/' . $orderId . '.' . $ext]);
    exit;
}

echo json_encode(['success' => false, 'message' => 'Invalid request']);
?>
