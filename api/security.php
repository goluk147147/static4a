<?php
// Shared API security helpers. Sessions are the source of truth for identity and role.
if (session_status() !== PHP_SESSION_ACTIVE) {
    // Keep the authenticated API session alive for 1 year (unless explicitly logged out)
    // This ensures user stays logged in across browser restarts and device reboots.
    ini_set('session.gc_maxlifetime', '31536000');
    ini_set('session.gc_probability', '0');  // Disable automatic garbage collection to preserve sessions
    ini_set('session.cookie_lifetime', '31536000');  // 1 year cookie lifetime
    
    session_name('4astore_session');
    session_set_cookie_params([
        'lifetime' => 31536000,  // 1 year
        'path' => '/',
        'domain' => '',  // Use default domain
        'httponly' => true,
        'secure' => !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off',
        'samesite' => 'Lax'
    ]);
    session_start();
}

// Extend session cookie lifetime on every request
if (!empty($_SESSION['user'])) {
    setcookie(session_name(), session_id(), [
        'expires' => time() + 31536000,  // 1 year
        'path' => '/',
        'secure' => !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off',
        'httponly' => true,
        'samesite' => 'Lax'
    ]);
    
    // Touch the session file to update its modification time (for garbage collection)
    // This prevents the session from being garbage collected even if gc_probability is > 0
    $_SESSION['_lastActivity'] = time();
}

header('Content-Type: application/json');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

function apiJson($payload, $status = 200)
{
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function sessionUser()
{
    return isset($_SESSION['user']) && is_array($_SESSION['user']) ? $_SESSION['user'] : null;
}

function requireSessionUser()
{
    $user = sessionUser();
    if (!$user)
        apiJson(['success' => false, 'message' => 'Login required'], 401);
    return $user;
}

function requireAdmin()
{
    $user = requireSessionUser();
    if (!in_array(($user['role'] ?? ''), ['owner', 'superadmin', 'admin'], true)) {
        apiJson(['success' => false, 'message' => 'Admin access required'], 403);
    }
    return $user;
}

function requirePermission($permission)
{
    $user = requireAdmin();
    if (in_array(($user['role'] ?? ''), ['owner', 'superadmin'], true)) {
        return $user;
    }
    $permissions = $user['permissions'] ?? [];
    if (!in_array('*', $permissions, true) && !in_array($permission, $permissions, true)) {
        apiJson(['success' => false, 'message' => 'Permission required: ' . $permission], 403);
    }
    return $user;
}

function requireRiderMode()
{
    $user = requireSessionUser();
    if (($user['role'] ?? '') !== 'rider' || ($user['backendRider'] ?? false) !== true || ($user['mode'] ?? 'rider') !== 'rider') {
        apiJson(['success' => false, 'message' => 'Delivery mode required'], 403);
    }
    return $user;
}

function hasPermission($user, $permission)
{
    return in_array(($user['role'] ?? ''), ['owner', 'superadmin'], true)
        || (($user['role'] ?? '') === 'admin' && (in_array('*', $user['permissions'] ?? [], true) || in_array($permission, $user['permissions'] ?? [], true)));
}

function safeUser($user, $includeSensitive = false)
{
    if (!$includeSensitive) {
        unset($user['password'], $user['passwordHash']);
    }
    return $user;
}

function adminListUser($user)
{
    $user['passwordHashed'] = !empty($user['passwordHash']);
    unset($user['passwordHash']);
    return $user;
}
?>