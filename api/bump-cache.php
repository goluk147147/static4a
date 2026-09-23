<?php
require_once __DIR__ . '/security.php';
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

$file = __DIR__ . '/../data/version.json';

function readVer($file) {
    $def = ['versionCode'=>1,'versionName'=>'1.0','url'=>'','message'=>'','forceUpdate'=>false,'assetVersion'=>1];
    if (!file_exists($file)) return $def;
    $d = json_decode(file_get_contents($file), true);
    return is_array($d) ? array_merge($def, $d) : $def;
}

// GET -> return current assetVersion (used by pages to detect a new build)
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $v = readVer($file);
    echo json_encode(['success' => true, 'assetVersion' => (int)$v['assetVersion']]);
    exit;
}

// POST -> increment assetVersion (admin "Clear Cache & Update" button)
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    requirePermission('settings');
    $v = readVer($file);
    $v['assetVersion'] = (int)$v['assetVersion'] + 1;
    file_put_contents($file, json_encode($v, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
    echo json_encode(['success' => true, 'assetVersion' => (int)$v['assetVersion']]);
    exit;
}

echo json_encode(['success' => false, 'message' => 'Invalid request']);
?>
