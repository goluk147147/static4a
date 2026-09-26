<?php
require_once __DIR__ . '/security.php';

$settingsFile = __DIR__ . '/../data/settings.json';

$defaults = [
    'storeEmail' => '4astorewale@gmail.com',
    'deliveryCharge' => 30,
    'freeDeliveryAbove' => 500,
    'upiId' => 'goluk147147@ybl',
    'upiName' => '4astore',
    'hideMrp' => false,
    'storePhone' => '8210874123',
    'storeAddress' => 'Gajna Road, Chandargarh, Nabinagar, Aurangabad, Bihar - 824301',
    'storeLatitude' => 24.580164,
    'storeLongitude' => 84.114194,
    'serviceableVillages' => 'Chandargarh(चंद्रगढ़), Mayapur(मायापुर), Sankarpur(शंकरपुर), Mishirbigha(मिशिरबिगहा), Sinpur(सिनपुर), Kharundha(खरौंधा), Simiri(सिमरी), Bilaspur(बिलासपुर), Bighapar(बिघापर)',
];

function readSettings($file, $defaults)
{
    if (!file_exists($file))
        return $defaults;
    $data = json_decode(file_get_contents($file), true);
    if (!is_array($data))
        return $defaults;
    return array_merge($defaults, $data);
}

// GET - return current settings
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    echo json_encode(['success' => true, 'settings' => readSettings($settingsFile, $defaults)]);
    exit;
}

// POST - save settings
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    requirePermission('settings');
    $input = json_decode(file_get_contents('php://input'), true) ?: [];
    $current = readSettings($settingsFile, $defaults);

    if (isset($input['storeEmail'])) {
        $email = trim((string) $input['storeEmail']);
        if ($email === '' || filter_var($email, FILTER_VALIDATE_EMAIL)) {
            $current['storeEmail'] = $email;
        } else {
            echo json_encode(['success' => false, 'message' => 'Invalid email address']);
            exit;
        }
    }
    if (isset($input['deliveryCharge']) && is_numeric($input['deliveryCharge'])) {
        $current['deliveryCharge'] = (int) $input['deliveryCharge'];
    }
    if (isset($input['freeDeliveryAbove']) && is_numeric($input['freeDeliveryAbove'])) {
        $current['freeDeliveryAbove'] = (int) $input['freeDeliveryAbove'];
    }
    if (isset($input['upiId'])) {
        $current['upiId'] = trim((string) $input['upiId']);
    }
    if (isset($input['upiName'])) {
        $current['upiName'] = trim((string) $input['upiName']);
    }
    if (isset($input['hideMrp'])) {
        $current['hideMrp'] = (bool) $input['hideMrp'];
    }
    if (isset($input['storePhone'])) {
        $current['storePhone'] = trim((string) $input['storePhone']);
    }
    if (isset($input['storeAddress'])) {
        $current['storeAddress'] = trim((string) $input['storeAddress']);
    }
    if (isset($input['storeLatitude']) && is_numeric($input['storeLatitude'])) {
        $latitude = (float) $input['storeLatitude'];
        if ($latitude < -90 || $latitude > 90)
            apiJson(['success' => false, 'message' => 'Invalid store latitude'], 422);
        $current['storeLatitude'] = $latitude;
    }
    if (isset($input['storeLongitude']) && is_numeric($input['storeLongitude'])) {
        $longitude = (float) $input['storeLongitude'];
        if ($longitude < -180 || $longitude > 180)
            apiJson(['success' => false, 'message' => 'Invalid store longitude'], 422);
        $current['storeLongitude'] = $longitude;
    }
    if (isset($input['serviceableVillages'])) {
        $current['serviceableVillages'] = trim((string) $input['serviceableVillages']);
    }

    file_put_contents($settingsFile, json_encode($current, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
    echo json_encode(['success' => true, 'message' => 'Settings saved', 'settings' => $current]);
    exit;
}

echo json_encode(['success' => false, 'message' => 'Invalid request']);
?>