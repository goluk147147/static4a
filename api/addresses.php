<?php
require_once __DIR__ . '/security.php';

$addressesFile = __DIR__ . '/../data/addresses.json';

function readAddresses()
{
    global $addressesFile;
    if (!file_exists($addressesFile))
        return [];
    $data = json_decode(file_get_contents($addressesFile), true);
    return is_array($data) ? $data : [];
}

function writeAddresses($addresses)
{
    global $addressesFile;
    return file_put_contents($addressesFile, json_encode(array_values($addresses), JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE), LOCK_EX) !== false;
}

function addressOwner($user)
{
    return (string) ($user['id'] ?? $user['mobile'] ?? '');
}

function cleanAddress($input, $user, $id = null)
{
    $label = trim((string) ($input['label'] ?? 'Other'));
    if (!in_array($label, ['Home', 'Work', 'Other'], true))
        $label = 'Other';
    $phone = preg_replace('/\D+/', '', (string) ($input['phone'] ?? $user['mobile'] ?? ''));
    $fields = [
        'label' => $label,
        'receiver_name' => trim((string) ($input['receiver_name'] ?? $input['receiverName'] ?? '')),
        'phone' => $phone,
        'house_no' => trim((string) ($input['house_no'] ?? $input['houseNo'] ?? '')),
        'street' => trim((string) ($input['street'] ?? '')),
        'area' => trim((string) ($input['area'] ?? '')),
        'landmark' => trim((string) ($input['landmark'] ?? '')),
        'city' => trim((string) ($input['city'] ?? '')),
        'district' => trim((string) ($input['district'] ?? '')),
        'state' => trim((string) ($input['state'] ?? 'Bihar')),
        'pincode' => preg_replace('/\D+/', '', (string) ($input['pincode'] ?? '')),
        'latitude' => is_numeric($input['latitude'] ?? null) ? (float) $input['latitude'] : null,
        'longitude' => is_numeric($input['longitude'] ?? null) ? (float) $input['longitude'] : null,
        'full_address' => trim((string) ($input['full_address'] ?? $input['fullAddress'] ?? '')),
        'status' => 'active'
    ];
    if ($fields['full_address'] === '') {
        $fields['full_address'] = trim(implode(', ', array_filter([$fields['house_no'], $fields['street'], $fields['area'], $fields['city'], $fields['district'], $fields['state'], $fields['pincode']])));
    }
    if ($id !== null)
        $fields['id'] = $id;
    return $fields;
}

$user = requireSessionUser();
$owner = addressOwner($user);

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $mine = array_values(array_filter(readAddresses(), function ($address) use ($owner) {
        return (string) ($address['user_id'] ?? '') === $owner && ($address['status'] ?? 'active') === 'active';
    }));
    usort($mine, function ($a, $b) {
        return ((int) ($b['is_default'] ?? 0)) <=> ((int) ($a['is_default'] ?? 0)); });
    apiJson(['success' => true, 'addresses' => $mine]);
}

$input = json_decode(file_get_contents('php://input'), true) ?: [];
$action = $input['action'] ?? 'create';
$addresses = readAddresses();

if ($action === 'create' || $action === 'update') {
    $address = cleanAddress($input, $user, $action === 'update' ? (int) ($input['id'] ?? 0) : null);
    if ($address['receiver_name'] === '' || !preg_match('/^[6-9][0-9]{9}$/', $address['phone']) || $address['house_no'] === '' || $address['area'] === '' || $address['city'] === '' || $address['pincode'] !== '824301') {
        apiJson(['success' => false, 'message' => 'Complete address and serviceable pincode are required'], 422);
    }
    if ($address['latitude'] !== null && ($address['latitude'] < -90 || $address['latitude'] > 90 || $address['longitude'] < -180 || $address['longitude'] > 180)) {
        apiJson(['success' => false, 'message' => 'Invalid map coordinates'], 422);
    }
    if ($action === 'update') {
        $found = false;
        foreach ($addresses as $index => $existing) {
            if ((string) ($existing['user_id'] ?? '') === $owner && (int) ($existing['id'] ?? 0) === $address['id']) {
                $address['user_id'] = $owner;
                $address['created_at'] = $existing['created_at'] ?? date('c');
                $address['updated_at'] = date('c');
                $address['is_default'] = !empty($existing['is_default']) ? 1 : 0;
                $addresses[$index] = $address;
                $found = true;
                break;
            }
        }
        if (!$found)
            apiJson(['success' => false, 'message' => 'Address not found'], 404);
    } else {
        $maxId = 0;
        foreach ($addresses as $existing)
            $maxId = max($maxId, (int) ($existing['id'] ?? 0));
        $address['id'] = $maxId + 1;
        $address['user_id'] = $owner;
        $address['is_default'] = 0;
        $address['created_at'] = date('c');
        $address['updated_at'] = date('c');
        $addresses[] = $address;
    }
    $makeDefault = !empty($input['is_default']) || count(array_filter($addresses, function ($a) use ($owner) {
        return (string) ($a['user_id'] ?? '') === $owner && !empty($a['is_default']); })) === 0;
    if ($makeDefault)
        foreach ($addresses as &$candidate)
            if ((string) ($candidate['user_id'] ?? '') === $owner)
                $candidate['is_default'] = ((int) $candidate['id'] === (int) $address['id']) ? 1 : 0;
    unset($candidate);
    if (!writeAddresses($addresses))
        apiJson(['success' => false, 'message' => 'Address storage is not writable'], 500);
    apiJson(['success' => true, 'address' => $address]);
}

if ($action === 'delete') {
    $id = (int) ($input['id'] ?? 0);
    $filtered = array_values(array_filter($addresses, function ($address) use ($owner, $id) {
        return !((string) ($address['user_id'] ?? '') === $owner && (int) ($address['id'] ?? 0) === $id); }));
    if (count($filtered) === count($addresses))
        apiJson(['success' => false, 'message' => 'Address not found'], 404);
    writeAddresses($filtered);
    apiJson(['success' => true]);
}

apiJson(['success' => false, 'message' => 'Invalid action'], 400);
?>