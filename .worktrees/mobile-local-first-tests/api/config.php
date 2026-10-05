<?php
require_once __DIR__ . '/security.php';

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
    requirePermission('banners');
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
