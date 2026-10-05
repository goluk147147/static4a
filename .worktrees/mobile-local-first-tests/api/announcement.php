<?php
require_once __DIR__ . '/security.php';

$file = __DIR__ . '/../data/announcement.json';

function readAnn($file) {
    $def = ['id' => 0, 'text' => '', 'image' => '', 'target' => 'all', 'ctaText' => '', 'ctaLink' => '', 'enabled' => false];
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
    requirePermission('ads');
    $input = json_decode(file_get_contents('php://input'), true) ?: [];
    $current = readAnn($file);

    $text = isset($input['text']) ? trim((string)$input['text']) : $current['text'];
    $image = isset($input['image']) ? trim((string)$input['image']) : $current['image'];
    $target = isset($input['target']) ? trim((string)$input['target']) : $current['target'];
    if ($target === '') $target = 'all';
    $ctaText = isset($input['ctaText']) ? trim((string)$input['ctaText']) : $current['ctaText'];
    $ctaLink = isset($input['ctaLink']) ? trim((string)$input['ctaLink']) : $current['ctaLink'];
    $enabled = isset($input['enabled']) ? (bool)$input['enabled'] : $current['enabled'];

    // Bump the id whenever any field changes, so clients treat it as a
    // NEW message and show it (once).
    $id = (int)$current['id'];
    if ($text !== $current['text'] || $image !== $current['image'] || $target !== $current['target']
        || $ctaText !== $current['ctaText'] || $ctaLink !== $current['ctaLink']) {
        $id = $id + 1;
    }

    $data = ['id' => $id, 'text' => $text, 'image' => $image, 'target' => $target,
             'ctaText' => $ctaText, 'ctaLink' => $ctaLink, 'enabled' => $enabled];
    file_put_contents($file, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
    echo json_encode(['success' => true, 'announcement' => $data]);
    exit;
}

echo json_encode(['success' => false, 'message' => 'Invalid request']);
?>
