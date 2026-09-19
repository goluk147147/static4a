<?php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

$categoriesFile = __DIR__ . '/../data/categories.json';

function getCategories() {
    global $categoriesFile;
    if (!file_exists($categoriesFile)) {
        return [];
    }
    $data = file_get_contents($categoriesFile);
    return json_decode($data, true) ?: [];
}

function saveCategories($categories) {
    global $categoriesFile;
    file_put_contents($categoriesFile, json_encode(array_values($categories), JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
}

function nextCategoryId($categories) {
    $max = 0;
    foreach ($categories as $c) {
        if (isset($c['id']) && (int)$c['id'] > $max) {
            $max = (int)$c['id'];
        }
    }
    return $max + 1;
}

// Build a URL-safe slug from a name
function makeSlug($name) {
    $slug = strtolower(trim($name));
    $slug = preg_replace('/[^a-z0-9]+/', '-', $slug);
    $slug = trim($slug, '-');
    return $slug ?: 'category';
}

// Ensure slug is unique (ignoring the category currently being edited)
function uniqueSlug($slug, $categories, $ignoreId = null) {
    $base = $slug;
    $n = 2;
    $exists = function ($s) use ($categories, $ignoreId) {
        foreach ($categories as $c) {
            if (isset($c['id']) && $ignoreId !== null && (int)$c['id'] === (int)$ignoreId) continue;
            if (($c['slug'] ?? '') === $s) return true;
        }
        return false;
    };
    while ($exists($slug)) {
        $slug = $base . '-' . $n;
        $n++;
    }
    return $slug;
}

// Normalize a category payload into the stored shape
function normalizeCategory($c, $existing = null, $categories = [], $ignoreId = null) {
    $name = trim($c['name'] ?? ($existing['name'] ?? ''));

    // Slug: use provided, else keep existing, else derive from name
    if (!empty($c['slug'])) {
        $slug = makeSlug($c['slug']);
    } elseif (!empty($existing['slug'])) {
        $slug = $existing['slug'];
    } else {
        $slug = makeSlug($name);
    }
    $slug = uniqueSlug($slug, $categories, $ignoreId);

    $out = [
        'id'    => isset($existing['id']) ? $existing['id'] : ($c['id'] ?? null),
        'name'  => $name,
        'slug'  => $slug,
        'icon'  => $c['icon'] ?? ($existing['icon'] ?? '📦'),
        'image' => $c['image'] ?? ($existing['image'] ?? ''),
    ];

    // Optional flags — only store when true / present
    $hidden = isset($c['hidden']) ? (bool)$c['hidden'] : (bool)($existing['hidden'] ?? false);
    $ageRestricted = isset($c['ageRestricted']) ? (bool)$c['ageRestricted'] : (bool)($existing['ageRestricted'] ?? false);
    $warning = isset($c['warning']) ? trim($c['warning']) : trim($existing['warning'] ?? '');

    if ($hidden) $out['hidden'] = true;
    if ($ageRestricted) $out['ageRestricted'] = true;
    if ($warning !== '') $out['warning'] = $warning;

    return $out;
}

// GET - Fetch all categories
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    echo json_encode(['success' => true, 'categories' => getCategories()]);
    exit;
}

// POST - add / update / delete / saveAll
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $input = json_decode(file_get_contents('php://input'), true) ?: [];
    $action = $input['action'] ?? '';

    if ($action === 'add') {
        $payload = $input['category'] ?? null;
        if (!$payload || empty($payload['name'])) {
            echo json_encode(['success' => false, 'message' => 'Category name is required']);
            exit;
        }
        $categories = getCategories();
        $category = normalizeCategory($payload, null, $categories);
        $category['id'] = nextCategoryId($categories);
        $categories[] = $category;
        saveCategories($categories);
        echo json_encode(['success' => true, 'message' => 'Category added', 'category' => $category]);
        exit;
    }

    if ($action === 'update') {
        $payload = $input['category'] ?? null;
        $id = isset($payload['id']) ? (int)$payload['id'] : (int)($input['id'] ?? 0);
        if (!$payload || !$id) {
            echo json_encode(['success' => false, 'message' => 'Category id is required']);
            exit;
        }
        $categories = getCategories();
        $found = false;
        foreach ($categories as $key => $existing) {
            if ((int)$existing['id'] === $id) {
                $categories[$key] = normalizeCategory($payload, $existing, $categories, $id);
                $found = true;
                break;
            }
        }
        if ($found) {
            saveCategories($categories);
            echo json_encode(['success' => true, 'message' => 'Category updated']);
        } else {
            echo json_encode(['success' => false, 'message' => 'Category not found']);
        }
        exit;
    }

    if ($action === 'delete') {
        $id = (int)($input['id'] ?? 0);
        if (!$id) {
            echo json_encode(['success' => false, 'message' => 'Category id is required']);
            exit;
        }
        $categories = getCategories();
        $before = count($categories);
        $categories = array_values(array_filter($categories, function ($c) use ($id) {
            return (int)$c['id'] !== $id;
        }));
        saveCategories($categories);
        echo json_encode(['success' => $before !== count($categories), 'message' => 'Category deleted']);
        exit;
    }

    if ($action === 'saveAll') {
        $list = $input['categories'] ?? null;
        if (!is_array($list)) {
            echo json_encode(['success' => false, 'message' => 'categories array required']);
            exit;
        }
        $normalized = [];
        foreach ($list as $c) {
            $item = normalizeCategory($c, $c, $normalized);
            if ($item['id'] === null) {
                $item['id'] = nextCategoryId($normalized);
            }
            $normalized[] = $item;
        }
        saveCategories($normalized);
        echo json_encode(['success' => true, 'message' => 'Categories saved', 'count' => count($normalized)]);
        exit;
    }

    echo json_encode(['success' => false, 'message' => 'Invalid action']);
    exit;
}
?>
