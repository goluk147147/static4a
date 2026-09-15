<?php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

$productsFile = __DIR__ . '/../data/products.json';

// Read products
function getProducts() {
    global $productsFile;
    if (!file_exists($productsFile)) {
        return [];
    }
    $data = file_get_contents($productsFile);
    return json_decode($data, true) ?: [];
}

// Save products
function saveProducts($products) {
    global $productsFile;
    file_put_contents($productsFile, json_encode(array_values($products), JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
}

// Compute next numeric id
function nextProductId($products) {
    $max = 0;
    foreach ($products as $p) {
        if (isset($p['id']) && (int)$p['id'] > $max) {
            $max = (int)$p['id'];
        }
    }
    return $max + 1;
}

// Normalize a product payload into the stored shape
function normalizeProduct($p, $existing = null) {
    $mrp   = isset($p['mrp']) ? (float)$p['mrp'] : (isset($existing['mrp']) ? $existing['mrp'] : 0);
    $price = isset($p['price']) ? (float)$p['price'] : (isset($existing['price']) ? $existing['price'] : 0);

    // Auto-calculate discount % when not supplied
    if (isset($p['discount']) && $p['discount'] !== '') {
        $discount = (int)$p['discount'];
    } elseif ($mrp > 0 && $price >= 0 && $price <= $mrp) {
        $discount = (int)round((($mrp - $price) / $mrp) * 100);
    } else {
        $discount = isset($existing['discount']) ? $existing['discount'] : 0;
    }

    // features can arrive as an array or newline/comma separated string
    $features = [];
    if (isset($p['features'])) {
        if (is_array($p['features'])) {
            $features = $p['features'];
        } elseif (is_string($p['features']) && trim($p['features']) !== '') {
            $features = preg_split('/[\r\n,]+/', $p['features']);
        }
        $features = array_values(array_filter(array_map('trim', $features), function ($f) {
            return $f !== '';
        }));
    } elseif (isset($existing['features'])) {
        $features = $existing['features'];
    }

    return [
        'id'          => isset($existing['id']) ? $existing['id'] : ($p['id'] ?? null),
        'name'        => $p['name'] ?? ($existing['name'] ?? ''),
        'brand'       => $p['brand'] ?? ($existing['brand'] ?? ''),
        'category'    => $p['category'] ?? ($existing['category'] ?? ''),
        'weight'      => $p['weight'] ?? ($existing['weight'] ?? ''),
        'mrp'         => $mrp,
        'price'       => $price,
        'discount'    => $discount,
        'image'       => $p['image'] ?? ($existing['image'] ?? ''),
        'description' => $p['description'] ?? ($existing['description'] ?? ''),
        'features'    => $features,
        'inStock'     => isset($p['inStock']) ? (bool)$p['inStock'] : ($existing['inStock'] ?? true),
    ];
}

// GET - Fetch all products
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    echo json_encode(['success' => true, 'products' => getProducts()]);
    exit;
}

// POST - add / update / delete
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $input = json_decode(file_get_contents('php://input'), true) ?: [];
    $action = $input['action'] ?? '';

    if ($action === 'add') {
        $payload = $input['product'] ?? null;
        if (!$payload || empty($payload['name'])) {
            echo json_encode(['success' => false, 'message' => 'Product name is required']);
            exit;
        }
        $products = getProducts();
        $product = normalizeProduct($payload);
        $product['id'] = nextProductId($products);
        $products[] = $product;
        saveProducts($products);
        echo json_encode(['success' => true, 'message' => 'Product added', 'product' => $product]);
        exit;
    }

    if ($action === 'update') {
        $payload = $input['product'] ?? null;
        $id = isset($payload['id']) ? (int)$payload['id'] : (int)($input['id'] ?? 0);
        if (!$payload || !$id) {
            echo json_encode(['success' => false, 'message' => 'Product id is required']);
            exit;
        }
        $products = getProducts();
        $found = false;
        foreach ($products as $key => $existing) {
            if ((int)$existing['id'] === $id) {
                $products[$key] = normalizeProduct($payload, $existing);
                $found = true;
                break;
            }
        }
        if ($found) {
            saveProducts($products);
            echo json_encode(['success' => true, 'message' => 'Product updated']);
        } else {
            echo json_encode(['success' => false, 'message' => 'Product not found']);
        }
        exit;
    }

    if ($action === 'delete') {
        $id = (int)($input['id'] ?? 0);
        if (!$id) {
            echo json_encode(['success' => false, 'message' => 'Product id is required']);
            exit;
        }
        $products = getProducts();
        $before = count($products);
        $products = array_values(array_filter($products, function ($p) use ($id) {
            return (int)$p['id'] !== $id;
        }));
        saveProducts($products);
        echo json_encode(['success' => $before !== count($products), 'message' => 'Product deleted']);
        exit;
    }

    if ($action === 'saveAll') {
        // Bulk replace (used for import/sync)
        $list = $input['products'] ?? null;
        if (!is_array($list)) {
            echo json_encode(['success' => false, 'message' => 'products array required']);
            exit;
        }
        $normalized = [];
        foreach ($list as $p) {
            $item = normalizeProduct($p, $p);
            if ($item['id'] === null) {
                $item['id'] = nextProductId($normalized);
            }
            $normalized[] = $item;
        }
        saveProducts($normalized);
        echo json_encode(['success' => true, 'message' => 'Products saved', 'count' => count($normalized)]);
        exit;
    }

    echo json_encode(['success' => false, 'message' => 'Invalid action']);
    exit;
}
?>
