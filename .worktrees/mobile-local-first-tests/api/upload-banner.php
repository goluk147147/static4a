<?php
require_once __DIR__ . '/security.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    echo json_encode(['success' => false, 'message' => 'POST required']);
    exit;
}

requirePermission('banners');
$contentType = strtolower($_SERVER['CONTENT_TYPE'] ?? '');
if (strpos($contentType, 'multipart/form-data') === 0 && (int) ($_SERVER['CONTENT_LENGTH'] ?? 0) > 0 && empty($_FILES)) {
    echo json_encode(['success' => false, 'message' => 'Upload exceeds the server request limit. Try a smaller image.']);
    exit;
}

$isUploadedFile = isset($_FILES['image']);
if ($isUploadedFile) {
    $upload = $_FILES['image'];
    if ($upload['error'] !== UPLOAD_ERR_OK) {
        $message = $upload['error'] === UPLOAD_ERR_INI_SIZE || $upload['error'] === UPLOAD_ERR_FORM_SIZE
            ? 'Image exceeds the server upload limit'
            : 'Image upload failed';
        echo json_encode(['success' => false, 'message' => $message]);
        exit;
    }
    if ($upload['size'] > 8 * 1024 * 1024) {
        echo json_encode(['success' => false, 'message' => 'Image is larger than 8 MB']);
        exit;
    }
    $temporaryFile = $upload['tmp_name'];
    $data = file_get_contents($temporaryFile);
} else {
    $input = json_decode(file_get_contents('php://input'), true) ?: [];
    $image = (string) ($input['image'] ?? '');
    if (!preg_match('/^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+\/=\s]+)$/', $image, $matches)) {
        echo json_encode(['success' => false, 'message' => 'Valid PNG, JPG or WEBP image required']);
        exit;
    }
    $data = base64_decode(str_replace(' ', '+', $matches[2]), true);
}

if ($data === false || strlen($data) > 8 * 1024 * 1024) {
    echo json_encode(['success' => false, 'message' => 'Image is invalid or larger than 8 MB']);
    exit;
}

$info = @getimagesizefromstring($data);
if (!$info || !in_array($info['mime'], ['image/png', 'image/jpeg', 'image/webp'], true)) {
    echo json_encode(['success' => false, 'message' => 'Unsupported image format']);
    exit;
}

$mimeExtensions = ['image/png' => 'png', 'image/jpeg' => 'jpg', 'image/webp' => 'webp'];
$extension = $mimeExtensions[$info['mime']];

$directory = __DIR__ . '/../data/banners';
if (!is_dir($directory) && !@mkdir($directory, 0775, true)) {
    echo json_encode(['success' => false, 'message' => 'Could not create banner storage folder']);
    exit;
}

$filename = 'banner_' . date('Ymd_His') . '_' . bin2hex(random_bytes(4)) . '.' . $extension;
$path = $directory . '/' . $filename;
$saved = $isUploadedFile
    ? move_uploaded_file($temporaryFile, $path)
    : file_put_contents($path, $data) !== false;
if (!$saved) {
    echo json_encode(['success' => false, 'message' => 'Could not save banner image']);
    exit;
}

echo json_encode(['success' => true, 'url' => 'data/banners/' . $filename]);
?>