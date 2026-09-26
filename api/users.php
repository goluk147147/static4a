<?php
require_once __DIR__ . '/security.php';

$usersFile = __DIR__ . '/../data/users.json';

// Read users
function getUsers()
{
    global $usersFile;
    if (!file_exists($usersFile)) {
        return [];
    }
    $data = file_get_contents($usersFile);
    return json_decode($data, true) ?: [];
}

// Save users
function saveUsers($users)
{
    global $usersFile;
    file_put_contents($usersFile, json_encode($users, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
}

function getAdminUsers()
{
    $file = __DIR__ . '/../data/admin-users.json';
    if (!file_exists($file))
        return [];
    $data = json_decode(file_get_contents($file), true);
    return is_array($data) ? $data : [];
}

function saveAdminUsers($admins)
{
    $file = __DIR__ . '/../data/admin-users.json';
    file_put_contents($file, json_encode(array_values($admins), JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE), LOCK_EX);
}

function safeAdmin($admin)
{
    unset($admin['password'], $admin['passwordHash']);
    return $admin;
}

// GET - Fetch all users
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $action = $_GET['action'] ?? 'list';

    if ($action === 'session') {
        apiJson(['success' => true, 'user' => sessionUser() ? safeUser(sessionUser()) : null]);
    }

    if ($action === 'list') {
        requirePermission('users');
        echo json_encode([
            'success' => true,
            'users' => array_map('adminListUser', getUsers())
        ]);
    }
    if ($action === 'adminList') {
        requirePermission('team');
        echo json_encode(['success' => true, 'admins' => array_map('safeAdmin', getAdminUsers())]);
    }
    exit;
}

// POST - Register or Login
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $input = json_decode(file_get_contents('php://input'), true);
    $action = $input['action'] ?? '';

    if ($action === 'adminLogin') {
        $username = strtolower(trim((string) ($input['username'] ?? '')));
        $password = (string) ($input['password'] ?? '');
        $admins = getAdminUsers();
        $admin = null;
        foreach ($admins as $candidate) {
            if (strtolower((string) ($candidate['username'] ?? '')) === $username) {
                $admin = $candidate;
                break;
            }
        }
        $storedHash = (string) ($admin['passwordHash'] ?? '');
        $valid = $admin && $storedHash !== '' && password_verify($password, $storedHash);
        if (!$valid)
            apiJson(['success' => false, 'message' => 'Incorrect password'], 401);
        $_SESSION['user'] = ['id' => $admin['id'], 'username' => $admin['username'], 'name' => $admin['name'] ?? 'Admin', 'mobile' => $admin['mobile'] ?? '', 'role' => $admin['role'] ?? 'admin', 'permissions' => $admin['permissions'] ?? []];
        apiJson(['success' => true, 'user' => $_SESSION['user']]);
    }

    if ($action === 'adminCreate') {
        requirePermission('team');
        $username = strtolower(trim((string) ($input['username'] ?? '')));
        $name = trim((string) ($input['name'] ?? ''));
        $password = (string) ($input['password'] ?? '');
        $permissions = is_array($input['permissions'] ?? null) ? array_values(array_unique(array_map('strval', $input['permissions']))) : [];
        if (!preg_match('/^[a-z0-9._-]{3,32}$/', $username) || $name === '' || strlen($password) < 8 || !$permissions) {
            apiJson(['success' => false, 'message' => 'Username, name, 8+ character password and permission required'], 422);
        }
        $admins = getAdminUsers();
        foreach ($admins as $existing)
            if (strtolower($existing['username'] ?? '') === $username)
                apiJson(['success' => false, 'message' => 'Username already exists'], 409);
        $maxId = 0;
        foreach ($admins as $existing)
            $maxId = max($maxId, (int) ($existing['id'] ?? 0));
        $newAdmin = ['id' => $maxId + 1, 'username' => $username, 'name' => $name, 'passwordHash' => password_hash($password, PASSWORD_DEFAULT), 'role' => 'admin', 'permissions' => $permissions];
        $admins[] = $newAdmin;
        saveAdminUsers($admins);
        apiJson(['success' => true, 'admin' => safeAdmin($newAdmin)]);
    }

    if ($action === 'adminDelete') {
        requirePermission('team');
        $id = (int) ($input['id'] ?? 0);
        $current = sessionUser();
        $admins = getAdminUsers();
        $filtered = [];
        foreach ($admins as $admin) {
            if ((int) ($admin['id'] ?? 0) === $id && ($admin['username'] ?? '') === ($current['username'] ?? ''))
                apiJson(['success' => false, 'message' => 'You cannot delete your own account'], 422);
            if ((int) ($admin['id'] ?? 0) !== $id)
                $filtered[] = $admin;
        }
        saveAdminUsers($filtered);
        apiJson(['success' => true]);
    }

    if ($action === 'adminUpdate') {
        requirePermission('team');
        $id = (int) ($input['id'] ?? 0);
        $name = trim((string) ($input['name'] ?? ''));
        $password = (string) ($input['password'] ?? '');
        $permissions = is_array($input['permissions'] ?? null) ? array_values(array_unique(array_map('strval', $input['permissions']))) : [];
        $allowedPermissions = ['dashboard', 'orders', 'riderTracking', 'products', 'categories', 'banners', 'ads', 'users', 'earnings', 'settings', 'team'];
        $permissions = array_values(array_intersect($permissions, $allowedPermissions));
        if (!$id || $name === '' || !$permissions)
            apiJson(['success' => false, 'message' => 'Name and at least one permission required'], 422);
        $admins = getAdminUsers();
        $found = false;
        foreach ($admins as $index => $admin) {
            if ((int) ($admin['id'] ?? 0) !== $id)
                continue;
            if (($admin['role'] ?? '') === 'owner')
                apiJson(['success' => false, 'message' => 'Owner account permissions are fixed'], 403);
            $admins[$index]['name'] = $name;
            $admins[$index]['permissions'] = $permissions;
            if ($password !== '') {
                if (strlen($password) < 8)
                    apiJson(['success' => false, 'message' => 'Password must be at least 8 characters'], 422);
                $admins[$index]['passwordHash'] = password_hash($password, PASSWORD_DEFAULT);
            }
            $found = true;
            break;
        }
        if (!$found)
            apiJson(['success' => false, 'message' => 'Admin account not found'], 404);
        saveAdminUsers($admins);
        apiJson(['success' => true, 'admin' => safeAdmin($admins[$index])]);
    }

    if ($action === 'session') {
        apiJson(['success' => true, 'user' => sessionUser() ? safeUser(sessionUser()) : null]);
    }

    if ($action === 'logout') {
        $_SESSION = [];
        if (ini_get('session.use_cookies')) {
            $params = session_get_cookie_params();
            setcookie(session_name(), '', time() - 42000, $params['path'], $params['domain'], $params['secure'], $params['httponly']);
        }
        session_destroy();
        apiJson(['success' => true]);
    }

    if ($action === 'deleteSelf') {
        $current = requireSessionUser();
        $mobile = trim((string) ($current['mobile'] ?? ''));
        if ($mobile === '') {
            apiJson(['success' => false, 'message' => 'Account identity could not be verified'], 422);
        }

        $users = getUsers();
        $filtered = array_values(array_filter($users, function ($user) use ($mobile) {
            return (string) ($user['mobile'] ?? '') !== $mobile;
        }));

        if (count($filtered) === count($users)) {
            apiJson(['success' => false, 'message' => 'Account not found'], 404);
        }

        saveUsers($filtered);
        $_SESSION = [];
        if (ini_get('session.use_cookies')) {
            $params = session_get_cookie_params();
            setcookie(session_name(), '', time() - 42000, $params['path'], $params['domain'], $params['secure'], $params['httponly']);
        }
        session_destroy();
        apiJson(['success' => true, 'message' => 'Account deleted']);
    }

    if ($action === 'register') {
        $name = trim($input['name'] ?? '');
        $mobile = trim($input['mobile'] ?? '');
        $username = strtolower(trim($input['username'] ?? ''));
        $password = $input['password'] ?? '';

        // Validation
        if (!$name || !$mobile || !$username || !$password) {
            echo json_encode(['success' => false, 'message' => 'All fields are required']);
            exit;
        }

        $users = getUsers();

        // Check duplicates
        foreach ($users as $user) {
            if (strtolower((string) ($user['username'] ?? '')) === $username) {
                echo json_encode(['success' => false, 'message' => 'Username already taken']);
                exit;
            }
            if ($user['mobile'] === $mobile) {
                echo json_encode(['success' => false, 'message' => 'Mobile number already registered']);
                exit;
            }
        }

        // Create new user
        $maxId = 0;
        foreach ($users as $user) {
            if (isset($user['id']) && $user['id'] > $maxId) {
                $maxId = $user['id'];
            }
        }

        $newUser = [
            'id' => $maxId + 1,
            'name' => $name,
            'mobile' => $mobile,
            'username' => $username,
            'passwordHash' => password_hash($password, PASSWORD_DEFAULT),
            'registeredAt' => date('c'),
            'lastLogin' => date('c')
        ];

        $users[] = $newUser;
        saveUsers($users);

        $sessionUser = safeUser($newUser);
        $sessionUser['mode'] = 'customer';
        $_SESSION['user'] = $sessionUser;
        echo json_encode(['success' => true, 'user' => $sessionUser]);
        exit;
    }

    if ($action === 'createRider') {
        requirePermission('users');
        $name = trim($input['name'] ?? '');
        $mobile = preg_replace('/\D+/', '', (string) ($input['mobile'] ?? ''));
        $username = strtolower(trim($input['username'] ?? ''));
        $password = (string) ($input['password'] ?? '');
        if (!$name || !preg_match('/^[6-9][0-9]{9}$/', $mobile) || strlen($username) < 3 || strlen($password) < 4) {
            echo json_encode(['success' => false, 'message' => 'Enter valid name, 10-digit mobile, username and password']);
            exit;
        }
        $users = getUsers();
        $mobileIndex = null;
        foreach ($users as $index => $user) {
            // The selected username may belong to the same customer being converted,
            // but it cannot belong to a different account.
            if (($user['username'] ?? '') === $username && ($user['mobile'] ?? '') !== $mobile) {
                $existingRole = (($user['role'] ?? 'customer') === 'rider') ? 'delivery boy' : 'customer';
                echo json_encode(['success' => false, 'message' => 'This username is already registered as a ' . $existingRole]);
                exit;
            }
            if (($user['mobile'] ?? '') === $mobile)
                $mobileIndex = $index;
        }
        // A normal customer with this number is promoted to Delivery Boy. A rider
        // cannot be created twice with the same number.
        if ($mobileIndex !== null) {
            if (($users[$mobileIndex]['role'] ?? 'customer') === 'rider') {
                echo json_encode(['success' => false, 'message' => 'This mobile number is already registered as a delivery boy']);
                exit;
            }
            $users[$mobileIndex]['name'] = $name;
            $users[$mobileIndex]['username'] = $username;
            $users[$mobileIndex]['passwordHash'] = password_hash($password, PASSWORD_DEFAULT);
            unset($users[$mobileIndex]['password']);
            $users[$mobileIndex]['role'] = 'rider';
            $users[$mobileIndex]['backendRider'] = true;
            saveUsers($users);
            echo json_encode(['success' => true, 'user' => $users[$mobileIndex], 'message' => 'Customer account converted to delivery boy']);
            exit;
        }
        $maxId = 0;
        foreach ($users as $user)
            if (isset($user['id']) && $user['id'] > $maxId)
                $maxId = $user['id'];
        $newUser = [
            'id' => $maxId + 1,
            'name' => $name,
            'mobile' => $mobile,
            'username' => $username,
            'passwordHash' => password_hash($password, PASSWORD_DEFAULT),
            'role' => 'rider',
            'backendRider' => true,
            'registeredAt' => date('c'),
            'lastLogin' => null
        ];
        $users[] = $newUser;
        saveUsers($users);
        echo json_encode(['success' => true, 'user' => $newUser]);
        exit;
    }

    if ($action === 'login') {
        $username = trim($input['username'] ?? '');
        $password = $input['password'] ?? '';

        $users = getUsers();
        $found = null;
        $exists = false;

        foreach ($users as &$user) {
            $storedUsername = strtolower((string) ($user['username'] ?? ''));
            if ($storedUsername === strtolower($username) || (string) ($user['mobile'] ?? '') === $username) {
                $exists = true;
                $passwordValid = isset($user['passwordHash'])
                    ? password_verify($password, $user['passwordHash'])
                    : isset($user['password']) && hash_equals((string) $user['password'], $password);
                if ($passwordValid) {
                    if (($user['role'] ?? 'customer') === 'rider' && ($user['backendRider'] ?? false) !== true) {
                        echo json_encode(['success' => false, 'message' => 'Rider account must be created by admin']);
                        exit;
                    }
                    $user['lastLogin'] = date('c');
                    if (!isset($user['passwordHash'])) {
                        $user['passwordHash'] = password_hash($password, PASSWORD_DEFAULT);
                        unset($user['password']);
                    }
                    $found = $user;
                    break;
                }
            }
        }
        unset($user);

        if ($found) {
            saveUsers($users);
            unset($found['password']);
            $found['mode'] = (($found['role'] ?? '') === 'rider' && ($found['backendRider'] ?? false) === true) ? 'rider' : 'customer';
            $_SESSION['user'] = $found;
            echo json_encode(['success' => true, 'user' => $found]);
        } elseif ($exists) {
            echo json_encode(['success' => false, 'message' => 'Incorrect password. Please try again.']);
        } else {
            echo json_encode(['success' => false, 'message' => 'Account not found. Please sign up first.']);
        }
        exit;
    }

    if ($action === 'setDelivery') {
        requirePermission('users');
        $mobile = trim($input['mobile'] ?? '');
        // customDelivery: number for a fixed fee, or null/'' to clear (use global)
        $hasVal = array_key_exists('customDelivery', $input) && $input['customDelivery'] !== '' && $input['customDelivery'] !== null;
        $val = $hasVal ? (int) $input['customDelivery'] : null;

        if (!$mobile) {
            echo json_encode(['success' => false, 'message' => 'Mobile required']);
            exit;
        }
        $users = getUsers();
        $found = false;
        foreach ($users as &$u) {
            if ($u['mobile'] === $mobile) {
                if ($val === null) {
                    unset($u['customDelivery']);
                } else {
                    $u['customDelivery'] = $val;
                }
                $found = true;
                break;
            }
        }
        unset($u);
        if ($found) {
            saveUsers($users);
            echo json_encode(['success' => true, 'message' => 'Delivery updated']);
        } else {
            echo json_encode(['success' => false, 'message' => 'User not found']);
        }
        exit;
    }

    if ($action === 'updateUser') {
        requirePermission('users');
        $id = (int) ($input['id'] ?? 0);
        $name = trim((string) ($input['name'] ?? ''));
        $mobile = preg_replace('/\D+/', '', (string) ($input['mobile'] ?? ''));
        $username = strtolower(trim((string) ($input['username'] ?? '')));
        $role = ($input['role'] ?? 'customer') === 'rider' ? 'rider' : 'customer';
        $password = (string) ($input['password'] ?? '');
        if (!$id || $name === '' || !preg_match('/^[6-9][0-9]{9}$/', $mobile) || !preg_match('/^[a-z0-9._-]{3,32}$/', $username)) {
            apiJson(['success' => false, 'message' => 'Valid name, mobile and username required'], 422);
        }
        $users = getUsers();
        $found = false;
        foreach ($users as $index => $user) {
            if ((int) ($user['id'] ?? 0) === $id) {
                foreach ($users as $otherIndex => $other) {
                    if ($otherIndex !== $index && (($other['mobile'] ?? '') === $mobile || ($other['username'] ?? '') === $username)) {
                        apiJson(['success' => false, 'message' => 'Mobile or username already used'], 409);
                    }
                }
                $users[$index]['name'] = $name;
                $users[$index]['mobile'] = $mobile;
                $users[$index]['username'] = $username;
                $users[$index]['role'] = $role;
                if ($role === 'rider')
                    $users[$index]['backendRider'] = true;
                else
                    unset($users[$index]['backendRider']);
                if ($password !== '') {
                    if (strlen($password) < 4)
                        apiJson(['success' => false, 'message' => 'Password must be at least 4 characters'], 422);
                    $users[$index]['passwordHash'] = password_hash($password, PASSWORD_DEFAULT);
                    unset($users[$index]['password']);
                }
                $found = true;
                $updated = safeUser($users[$index]);
                break;
            }
        }
        if (!$found)
            apiJson(['success' => false, 'message' => 'User not found'], 404);
        saveUsers($users);
        apiJson(['success' => true, 'user' => $updated]);
    }

    if ($action === 'switchRiderToCustomer') {
        $current = requireSessionUser();
        $mobile = preg_replace('/\D+/', '', (string) ($current['mobile'] ?? ''));
        if (!preg_match('/^[6-9][0-9]{9}$/', $mobile)) {
            echo json_encode(['success' => false, 'message' => 'Valid mobile required']);
            exit;
        }
        $users = getUsers();
        foreach ($users as &$user) {
            if (($user['mobile'] ?? '') === $mobile) {
                if (($user['role'] ?? 'customer') !== 'rider' || ($user['backendRider'] ?? false) !== true) {
                    unset($user);
                    echo json_encode(['success' => false, 'message' => 'Only an admin-created rider can be switched']);
                    exit;
                }
                $updated = safeUser($user);
                $updated['role'] = 'customer';
                $_SESSION['user']['mode'] = 'customer';
                unset($user);
                echo json_encode(['success' => true, 'user' => $updated]);
                exit;
            }
        }
        unset($user);
        echo json_encode(['success' => false, 'message' => 'User not found']);
        exit;
    }

    if ($action === 'switchMode') {
        $current = requireSessionUser();
        $mode = ($input['mode'] ?? '') === 'rider' ? 'rider' : (($input['mode'] ?? '') === 'customer' ? 'customer' : '');
        if ($mode === '' || ($current['role'] ?? '') !== 'rider' || ($current['backendRider'] ?? false) !== true) {
            apiJson(['success' => false, 'message' => 'Mode switch is not allowed'], 403);
        }
        $_SESSION['user']['mode'] = $mode;
        apiJson(['success' => true, 'user' => safeUser($_SESSION['user'])]);
    }

    if ($action === 'delete') {
        requirePermission('users');
        $mobile = trim($input['mobile'] ?? '');
        if (!$mobile) {
            echo json_encode(['success' => false, 'message' => 'Mobile number required']);
            exit;
        }

        $users = getUsers();
        $filtered = array_values(array_filter($users, function ($u) use ($mobile) {
            return $u['mobile'] !== $mobile;
        }));

        if (count($filtered) < count($users)) {
            saveUsers($filtered);
            echo json_encode(['success' => true, 'message' => 'User deleted']);
        } else {
            echo json_encode(['success' => false, 'message' => 'User not found']);
        }
        exit;
    }

    if ($action === 'deleteInactive') {
        requirePermission('users');
        $days = intval($input['days'] ?? 30);
        $cutoffDate = date('c', strtotime("-{$days} days"));

        $users = getUsers();
        $activeUsers = [];
        $deletedCount = 0;

        foreach ($users as $user) {
            $lastLogin = $user['lastLogin'] ?? null;
            if ($lastLogin && $lastLogin >= $cutoffDate) {
                $activeUsers[] = $user;
            } else {
                $deletedCount++;
            }
        }

        saveUsers($activeUsers);
        echo json_encode(['success' => true, 'deleted' => $deletedCount, 'remaining' => count($activeUsers)]);
        exit;
    }

    echo json_encode(['success' => false, 'message' => 'Invalid action']);
}
?>