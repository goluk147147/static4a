<?php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

$usersFile = __DIR__ . '/../data/users.json';

// Read users
function getUsers() {
    global $usersFile;
    if (!file_exists($usersFile)) {
        return [];
    }
    $data = file_get_contents($usersFile);
    return json_decode($data, true) ?: [];
}

// Save users
function saveUsers($users) {
    global $usersFile;
    file_put_contents($usersFile, json_encode($users, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
}

// GET - Fetch all users
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $action = $_GET['action'] ?? 'list';
    
    if ($action === 'list') {
        echo json_encode(['success' => true, 'users' => getUsers()]);
    }
    exit;
}

// POST - Register or Login
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $input = json_decode(file_get_contents('php://input'), true);
    $action = $input['action'] ?? '';
    
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
            if ($user['username'] === $username) {
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
            'password' => $password,
            'registeredAt' => date('c'),
            'lastLogin' => date('c')
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
            if ($user['username'] === $username || $user['mobile'] === $username) {
                $exists = true;
                if ($user['password'] === $password) {
                    $user['lastLogin'] = date('c');
                    $found = $user;
                    break;
                }
            }
        }
        unset($user);
        
        if ($found) {
            saveUsers($users);
            echo json_encode(['success' => true, 'user' => $found]);
        } elseif ($exists) {
            echo json_encode(['success' => false, 'message' => 'Incorrect password. Please try again.']);
        } else {
            echo json_encode(['success' => false, 'message' => 'Account not found. Please sign up first.']);
        }
        exit;
    }
    
    if ($action === 'setDelivery') {
        $mobile = trim($input['mobile'] ?? '');
        // customDelivery: number for a fixed fee, or null/'' to clear (use global)
        $hasVal = array_key_exists('customDelivery', $input) && $input['customDelivery'] !== '' && $input['customDelivery'] !== null;
        $val = $hasVal ? (int)$input['customDelivery'] : null;

        if (!$mobile) {
            echo json_encode(['success' => false, 'message' => 'Mobile required']);
            exit;
        }
        $users = getUsers();
        $found = false;
        foreach ($users as &$u) {
            if ($u['mobile'] === $mobile) {
                if ($val === null) { unset($u['customDelivery']); }
                else { $u['customDelivery'] = $val; }
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

    if ($action === 'delete') {
        $mobile = trim($input['mobile'] ?? '');
        if (!$mobile) {
            echo json_encode(['success' => false, 'message' => 'Mobile number required']);
            exit;
        }
        
        $users = getUsers();
        $filtered = array_values(array_filter($users, function($u) use ($mobile) {
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
