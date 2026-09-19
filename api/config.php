<?php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

$file = __DIR__ . '/../data/config.json';

function readConfig($file) {
    if (!file_exists($file)) return [];
    $d = json_decode(file_get_contents($file), true);
    return is_array($d) ? $d : [];
}

// GET -> full config
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    echo json_encode(['success' => true, 'config' => readConfig($file)]);
    exit;
}

// POST { banners: [...] } -> replace banners array only, keep rest of config
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $input = json_decode(file_get_contents('php://input'), true) ?: [];
    if (!isset($input['banners']) || !is_array($input['banners'])) {
        echo json_encode(['success' => false, 'message' => 'banners array required']);
        exit;
    }
    $config = readConfig($file);
    $config['banners'] = $input['banners'];
    if (file_put_contents($file, json_encode($config, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)) === false) {
        echo json_encode(['success' => false, 'message' => 'Could not save (check data/ folder is writable)']);
        exit;
    }
    echo json_encode(['success' => true, 'count' => count($input['banners'])]);
    exit;
}

echo json_encode(['success' => false, 'message' => 'Invalid request']);
?>
