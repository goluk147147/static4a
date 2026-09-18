<?php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

$file = __DIR__ . '/../data/announcement.json';

function readAnn($file) {
    $def = ['id' => 0, 'text' => '', 'enabled' => false];
    if (!file_exists($file)) return $def;
    $d = json_decode(file_get_contents($file), true);
    return is_array($d) ? array_merge($def, $d) : $def;
}

// GET - current announcement
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    echo json_encode(['success' => true, 'announcement' => readAnn($file)]);
    exit;
}

// POST - save/update announcement
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $input = json_decode(file_get_contents('php://input'), true) ?: [];
    $current = readAnn($file);

    $text = isset($input['text']) ? trim((string)$input['text']) : $current['text'];
    $enabled = isset($input['enabled']) ? (bool)$input['enabled'] : $current['enabled'];

    // Bump the id whenever the text changes, so clients know it's a NEW message
    // and play it again (once).
    $id = (int)$current['id'];
    if ($text !== $current['text']) {
        $id = $id + 1;
    }

    $data = ['id' => $id, 'text' => $text, 'enabled' => $enabled];
    file_put_contents($file, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
    echo json_encode(['success' => true, 'announcement' => $data]);
    exit;
}

echo json_encode(['success' => false, 'message' => 'Invalid request']);
?>
