<?php
require_once __DIR__ . '/security.php';

$adsFile = __DIR__ . '/../data/ads.json';

function getAds() {
    global $adsFile;
    if (!file_exists($adsFile)) return [];
    $data = file_get_contents($adsFile);
    return json_decode($data, true) ?: [];
}

function saveAds($ads) {
    global $adsFile;
    file_put_contents($adsFile, json_encode(array_values($ads), JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
}

function nextAdId($ads) {
    $max = 0;
    foreach ($ads as $a) {
        if (isset($a['id']) && (int)$a['id'] > $max) $max = (int)$a['id'];
    }
    return $max + 1;
}

// Normalize an ad payload. The full creative editor state is kept as-is under
// "creative" (structured JSON) so a design can be reopened and edited later.
function normalizeAd($a, $existing = null) {
    $now = date('c');
    return [
        'id'          => isset($existing['id']) ? $existing['id'] : ($a['id'] ?? null),
        'name'        => $a['name'] ?? ($existing['name'] ?? 'Untitled Ad'),
        'campaign'    => $a['campaign'] ?? ($existing['campaign'] ?? ''),
        'offerTitle'  => $a['offerTitle'] ?? ($existing['offerTitle'] ?? ''),
        'productId'   => isset($a['productId']) ? $a['productId'] : ($existing['productId'] ?? null),
        'productName' => $a['productName'] ?? ($existing['productName'] ?? ''),
        'format'      => $a['format'] ?? ($existing['format'] ?? '1:1'),
        'platform'    => $a['platform'] ?? ($existing['platform'] ?? 'all'),
        'status'      => $a['status'] ?? ($existing['status'] ?? 'draft'),
        'template'    => $a['template'] ?? ($existing['template'] ?? 'todays-offer'),
        'creative'    => isset($a['creative']) ? $a['creative'] : ($existing['creative'] ?? new stdClass()),
        'caption'     => $a['caption'] ?? ($existing['caption'] ?? ''),
        'hashtags'    => $a['hashtags'] ?? ($existing['hashtags'] ?? ''),
        'image'       => $a['image'] ?? ($existing['image'] ?? ''),   // optional saved PNG data-url/URL
        'createdAt'   => $existing['createdAt'] ?? $now,
        'updatedAt'   => $now,
    ];
}

// GET - list all ads (optionally ?id=N for one)
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $ads = getAds();
    if (isset($_GET['id'])) {
        $id = (int)$_GET['id'];
        foreach ($ads as $a) {
            if ((int)$a['id'] === $id) { echo json_encode(['success' => true, 'ad' => $a]); exit; }
        }
        echo json_encode(['success' => false, 'message' => 'Ad not found']);
        exit;
    }
    echo json_encode(['success' => true, 'ads' => $ads]);
    exit;
}

// POST - add / update / delete / duplicate
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    requirePermission('ads');
    $input = json_decode(file_get_contents('php://input'), true) ?: [];
    $action = $input['action'] ?? '';

    if ($action === 'add') {
        $payload = $input['ad'] ?? null;
        if (!$payload) { echo json_encode(['success' => false, 'message' => 'Ad data required']); exit; }
        $ads = getAds();
        $ad = normalizeAd($payload);
        $ad['id'] = nextAdId($ads);
        $ads[] = $ad;
        saveAds($ads);
        echo json_encode(['success' => true, 'message' => 'Ad saved', 'ad' => $ad]);
        exit;
    }

    if ($action === 'update') {
        $payload = $input['ad'] ?? null;
        $id = isset($payload['id']) ? (int)$payload['id'] : (int)($input['id'] ?? 0);
        if (!$payload || !$id) { echo json_encode(['success' => false, 'message' => 'Ad id required']); exit; }
        $ads = getAds();
        $found = false;
        foreach ($ads as $k => $ex) {
            if ((int)$ex['id'] === $id) { $ads[$k] = normalizeAd($payload, $ex); $found = true; break; }
        }
        if ($found) { saveAds($ads); echo json_encode(['success' => true, 'message' => 'Ad updated']); }
        else { echo json_encode(['success' => false, 'message' => 'Ad not found']); }
        exit;
    }

    if ($action === 'delete') {
        $id = (int)($input['id'] ?? 0);
        if (!$id) { echo json_encode(['success' => false, 'message' => 'Ad id required']); exit; }
        $ads = getAds();
        $before = count($ads);
        $ads = array_values(array_filter($ads, function ($a) use ($id) { return (int)$a['id'] !== $id; }));
        saveAds($ads);
        echo json_encode(['success' => $before !== count($ads), 'message' => 'Ad deleted']);
        exit;
    }

    if ($action === 'duplicate') {
        $id = (int)($input['id'] ?? 0);
        if (!$id) { echo json_encode(['success' => false, 'message' => 'Ad id required']); exit; }
        $ads = getAds();
        $orig = null;
        foreach ($ads as $a) { if ((int)$a['id'] === $id) { $orig = $a; break; } }
        if (!$orig) { echo json_encode(['success' => false, 'message' => 'Ad not found']); exit; }
        $copy = normalizeAd($orig);
        $copy['id'] = nextAdId($ads);
        $copy['name'] = ($orig['name'] ?? 'Ad') . ' (Copy)';
        $copy['status'] = 'draft';
        $copy['createdAt'] = date('c');
        $ads[] = $copy;
        saveAds($ads);
        echo json_encode(['success' => true, 'message' => 'Ad duplicated', 'ad' => $copy]);
        exit;
    }

    echo json_encode(['success' => false, 'message' => 'Invalid action']);
    exit;
}
?>
