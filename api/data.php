<?php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');

$type = $_GET['type'] ?? '';
$allowed = ['products', 'categories', 'config', 'admin'];

if (!in_array($type, $allowed)) {
    http_response_code(400);
    echo json_encode(['error' => 'Invalid data type']);
    exit;
}

$file = __DIR__ . '/../data/' . $type . '.json';

if (!file_exists($file)) {
    http_response_code(404);
    echo json_encode(['error' => 'File not found']);
    exit;
}

echo file_get_contents($file);
?>
