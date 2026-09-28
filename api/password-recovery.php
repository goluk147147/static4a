<?php
require_once __DIR__ . '/security.php';
require_once __DIR__ . '/email-helper.php';

$usersFile = __DIR__ . '/../data/users.json';
$input = json_decode(file_get_contents('php://input'), true) ?: [];
$action = (string) ($input['action'] ?? '');

function recoveryUsers()
{
    global $usersFile;
    $users = is_file($usersFile) ? json_decode(file_get_contents($usersFile), true) : [];
    return is_array($users) ? $users : [];
}

function saveRecoveryUsers($users)
{
    global $usersFile;
    return file_put_contents($usersFile, json_encode(array_values($users), JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE), LOCK_EX) !== false;
}

function normalizeRecoveryMobile($mobile)
{
    return preg_replace('/\D+/', '', (string) $mobile);
}

function recoverySendAllowed($identity)
{
    $ip = (string) ($_SERVER['REMOTE_ADDR'] ?? 'unknown');
    $path = rtrim(sys_get_temp_dir(), DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR
        . '4astore-recovery-' . hash('sha256', $ip . '|' . strtolower((string) $identity)) . '.json';
    $handle = @fopen($path, 'c+');
    if (!$handle || !flock($handle, LOCK_EX)) {
        if (is_resource($handle))
            fclose($handle);
        return false;
    }
    $stored = json_decode(stream_get_contents($handle), true);
    $timestamps = is_array($stored) ? array_values(array_filter($stored, function ($time) {
        return is_numeric($time) && (int) $time > time() - 3600;
    })) : [];
    $allowed = count($timestamps) < 5 && (!$timestamps || time() - (int) end($timestamps) >= 60);
    if ($allowed)
        $timestamps[] = time();
    ftruncate($handle, 0);
    rewind($handle);
    fwrite($handle, json_encode($timestamps));
    fflush($handle);
    flock($handle, LOCK_UN);
    fclose($handle);
    return $allowed;
}

function issueEmailCode($key, $email, $subject, $purpose, $rateLimit = true, $genericFailure = false)
{
    if ($rateLimit && !recoverySendAllowed($key . ':' . $email)) {
        apiJson(['success' => false, 'message' => 'Please wait before requesting another code.'], 429);
    }
    $otp = (string) random_int(100000, 999999);
    $message = "Your 4A Store {$purpose} code is {$otp}. It expires in 10 minutes. Do not share this code with anyone.";
    $result = sendAppEmail($email, $subject, $message);
    if (!$result['ok']) {
        error_log('4A Store OTP email failed: ' . ($result['error'] ?? 'unknown error'));
        if ($genericFailure)
            return false;
        apiJson(['success' => false, 'message' => 'Email could not be sent right now. Please try again later.'], 503);
    }
    $_SESSION[$key] = [
        'otpHash' => password_hash($otp, PASSWORD_DEFAULT),
        'email' => $email,
        'expiresAt' => time() + 600,
        'sentAt' => time(),
        'attempts' => 0
    ];
    return true;
}

function checkEmailCode($key, $otp)
{
    $challenge = $_SESSION[$key] ?? null;
    if (!is_array($challenge) || (int) ($challenge['expiresAt'] ?? 0) < time()) {
        unset($_SESSION[$key]);
        apiJson(['success' => false, 'message' => 'Code expired. Request a new code.'], 400);
    }
    if ((int) ($challenge['attempts'] ?? 0) >= 5) {
        unset($_SESSION[$key]);
        apiJson(['success' => false, 'message' => 'Too many incorrect attempts. Request a new code.'], 429);
    }
    $challenge['attempts'] = (int) ($challenge['attempts'] ?? 0) + 1;
    $_SESSION[$key] = $challenge;
    if (!password_verify((string) $otp, (string) ($challenge['otpHash'] ?? ''))) {
        apiJson(['success' => false, 'message' => 'Incorrect code. Please try again.'], 400);
    }
    return $challenge;
}

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    if (($_GET['action'] ?? '') !== 'profileEmail')
        apiJson(['success' => false, 'message' => 'Invalid action.'], 400);
    $current = requireSessionUser();
    $email = '';
    $verified = false;
    foreach (recoveryUsers() as $user) {
        $sameUser = isset($current['id'], $user['id'])
            ? (string) $current['id'] === (string) $user['id']
            : (string) ($user['mobile'] ?? '') === (string) ($current['mobile'] ?? '');
        if ($sameUser) {
            $email = (string) ($user['recoveryEmail'] ?? '');
            $verified = !empty($user['recoveryEmailVerified']);
            break;
        }
    }
    apiJson(['success' => true, 'email' => $email, 'verified' => $verified]);
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST')
    apiJson(['success' => false, 'message' => 'POST required.'], 405);

if ($action === 'sendSignupEmailCode') {
    $email = strtolower(trim((string) ($input['email'] ?? '')));
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
        apiJson(['success' => false, 'message' => 'Enter a valid email address.'], 422);
    }
    foreach (recoveryUsers() as $user) {
        $registeredEmails = [
            strtolower((string) ($user['recoveryEmail'] ?? '')),
            strtolower((string) ($user['email'] ?? ''))
        ];
        if (in_array($email, $registeredEmails, true)) {
            apiJson(['success' => false, 'message' => 'This email is already linked to an account.'], 409);
        }
    }
    issueEmailCode('signupEmailOtp', $email, 'Verify your 4A Store email', 'signup verification');
    apiJson(['success' => true, 'message' => 'A verification code was sent to your email.']);
}

if ($action === 'verifySignupEmailCode') {
    $otp = preg_replace('/\D+/', '', (string) ($input['otp'] ?? ''));
    if (!preg_match('/^\d{6}$/', $otp)) {
        apiJson(['success' => false, 'message' => 'Enter the 6-digit code.'], 422);
    }
    $challenge = checkEmailCode('signupEmailOtp', $otp);
    foreach (recoveryUsers() as $user) {
        $registeredEmails = [
            strtolower((string) ($user['recoveryEmail'] ?? '')),
            strtolower((string) ($user['email'] ?? ''))
        ];
        if (in_array(strtolower((string) ($challenge['email'] ?? '')), $registeredEmails, true)) {
            unset($_SESSION['signupEmailOtp']);
            apiJson(['success' => false, 'message' => 'This email is already linked to an account.'], 409);
        }
    }
    $_SESSION['signupEmailVerified'] = [
        'email' => strtolower((string) $challenge['email']),
        'verifiedAt' => time(),
        'expiresAt' => time() + 900
    ];
    unset($_SESSION['signupEmailOtp']);
    apiJson(['success' => true, 'message' => 'Email verified. Complete your account details.']);
}

if ($action === 'cancelPasswordReset') {
    unset($_SESSION['passwordResetOtp']);
    apiJson(['success' => true]);
}

if ($action === 'sendProfileEmailCode') {
    $current = requireSessionUser();
    $email = strtolower(trim((string) ($input['email'] ?? '')));
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
        apiJson(['success' => false, 'message' => 'Enter a valid email address.'], 422);
    }
    $users = recoveryUsers();
    $userIndex = null;
    foreach ($users as $index => $user) {
        $sameUser = isset($current['id'], $user['id'])
            ? (string) $current['id'] === (string) $user['id']
            : (string) ($user['mobile'] ?? '') === (string) ($current['mobile'] ?? '');
        if (!$sameUser) {
            $registeredEmails = [
                strtolower((string) ($user['recoveryEmail'] ?? '')),
                strtolower((string) ($user['email'] ?? ''))
            ];
            if (in_array($email, $registeredEmails, true)) {
                apiJson(['success' => false, 'message' => 'This email is already used for another account.'], 409);
            }
            continue;
        }
        $userIndex = $index;
    }
    if ($userIndex === null) {
        apiJson(['success' => false, 'message' => 'Account could not be verified. Please sign in again.'], 401);
    }
    if (
        !empty($users[$userIndex]['recoveryEmailVerified'])
        && strtolower((string) ($users[$userIndex]['recoveryEmail'] ?? '')) === $email
    ) {
        apiJson(['success' => true, 'alreadyVerified' => true, 'message' => 'This recovery email is already verified.']);
    }
    issueEmailCode('profileEmailOtp', $email, 'Verify your 4A Store recovery email', 'email verification');
    $_SESSION['profileEmailOtp']['userMobile'] = (string) ($current['mobile'] ?? '');
    apiJson(['success' => true, 'message' => 'A verification code was sent to your email.']);
}

if ($action === 'verifyProfileEmailCode') {
    $current = requireSessionUser();
    $otp = preg_replace('/\D+/', '', (string) ($input['otp'] ?? ''));
    if (!preg_match('/^\d{6}$/', $otp))
        apiJson(['success' => false, 'message' => 'Enter the 6-digit code.'], 422);
    $challenge = checkEmailCode('profileEmailOtp', $otp);
    if ((string) ($challenge['userMobile'] ?? '') !== (string) ($current['mobile'] ?? '')) {
        unset($_SESSION['profileEmailOtp']);
        apiJson(['success' => false, 'message' => 'Verification expired. Request a new code.'], 400);
    }
    $users = recoveryUsers();
    $userIndex = null;
    foreach ($users as $index => $user) {
        if ((string) ($user['mobile'] ?? '') === (string) ($current['mobile'] ?? ''))
            $userIndex = $index;
        else {
            $registeredEmails = [
                strtolower((string) ($user['recoveryEmail'] ?? '')),
                strtolower((string) ($user['email'] ?? ''))
            ];
            if (in_array(strtolower((string) $challenge['email']), $registeredEmails, true)) {
                apiJson(['success' => false, 'message' => 'This email is already used for another account.'], 409);
            }
        }
    }
    if ($userIndex === null)
        apiJson(['success' => false, 'message' => 'Account could not be found.'], 404);
    $users[$userIndex]['recoveryEmail'] = strtolower((string) $challenge['email']);
    $users[$userIndex]['recoveryEmailVerified'] = true;
    $users[$userIndex]['recoveryEmailVerifiedAt'] = date('c');
    if (!saveRecoveryUsers($users))
        apiJson(['success' => false, 'message' => 'Could not save recovery email.'], 500);
    $_SESSION['user']['recoveryEmail'] = $users[$userIndex]['recoveryEmail'];
    $_SESSION['user']['recoveryEmailVerified'] = true;
    unset($_SESSION['profileEmailOtp']);
    apiJson(['success' => true, 'email' => $users[$userIndex]['recoveryEmail'], 'message' => 'Recovery email verified and saved.']);
}

if ($action === 'sendPasswordResetCode') {
    $mobile = normalizeRecoveryMobile($input['mobile'] ?? '');
    if (!preg_match('/^[6-9]\d{9}$/', $mobile)) {
        apiJson(['success' => false, 'message' => 'Enter a valid 10-digit mobile number.'], 422);
    }
    $users = recoveryUsers();
    $accountIndex = null;
    foreach ($users as $index => $user) {
        if ((string) ($user['mobile'] ?? '') === $mobile) {
            $accountIndex = $index;
            break;
        }
    }
    $account = $accountIndex === null ? null : $users[$accountIndex];
    $storedEmail = strtolower((string) ($account['recoveryEmail'] ?? ''));
    $hasVerifiedEmail = $account && !empty($account['recoveryEmailVerified']) && filter_var($storedEmail, FILTER_VALIDATE_EMAIL);
    if ($hasVerifiedEmail) {
        $email = $storedEmail;
        $flow = 'registered_email';
    } else {
        $email = strtolower(trim((string) ($input['email'] ?? '')));
        if ($email === '') {
            unset($_SESSION['passwordResetOtp']);
            apiJson(['success' => true, 'mode' => 'add_email', 'message' => 'Enter an email address to receive a verification code.']);
        }
        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
            apiJson(['success' => false, 'message' => 'Enter a valid email address.'], 422);
        }
        foreach ($users as $index => $user) {
            if ($index === $accountIndex)
                continue;
            $registeredEmails = [
                strtolower((string) ($user['recoveryEmail'] ?? '')),
                strtolower((string) ($user['email'] ?? ''))
            ];
            if (in_array($email, $registeredEmails, true)) {
                apiJson(['success' => false, 'message' => 'This email is already linked to another account.'], 409);
            }
        }
        $flow = 'new_email';
        if (!recoverySendAllowed('reset-email:' . $email)) {
            apiJson(['success' => false, 'message' => 'Please wait before requesting another code.'], 429);
        }
    }
    if (!recoverySendAllowed('reset:' . $mobile)) {
        apiJson(['success' => false, 'message' => 'Please wait before requesting another code.'], 429);
    }
    unset($_SESSION['passwordResetOtp']);
    if (issueEmailCode('passwordResetOtp', $email, 'Your 4A Store password reset code', 'password reset', false, true)) {
        $_SESSION['passwordResetOtp']['mobile'] = $mobile;
        $_SESSION['passwordResetOtp']['flow'] = $flow;
        $_SESSION['passwordResetOtp']['accountExists'] = $accountIndex !== null;
    }
    apiJson(['success' => true, 'mode' => $flow, 'message' => 'If the account can be recovered, a code has been sent to the appropriate email address.']);
}

if ($action === 'verifyPasswordResetCode') {
    $mobile = normalizeRecoveryMobile($input['mobile'] ?? '');
    $otp = preg_replace('/\D+/', '', (string) ($input['otp'] ?? ''));
    if (!preg_match('/^[6-9]\d{9}$/', $mobile) || !preg_match('/^\d{6}$/', $otp)) {
        apiJson(['success' => false, 'message' => 'Enter the registered mobile and 6-digit code.'], 422);
    }
    $challenge = checkEmailCode('passwordResetOtp', $otp);
    if ((string) ($challenge['mobile'] ?? '') !== $mobile || empty($challenge['flow'])) {
        apiJson(['success' => false, 'message' => 'Incorrect code. Please try again.'], 400);
    }
    $users = recoveryUsers();
    $accountIndex = null;
    foreach ($users as $index => $user) {
        if ((string) ($user['mobile'] ?? '') === $mobile) {
            $accountIndex = $index;
            break;
        }
    }
    if ($accountIndex === null || empty($challenge['accountExists'])) {
        unset($_SESSION['passwordResetOtp']);
        apiJson(['success' => false, 'message' => 'This recovery request is no longer valid.'], 400);
    }
    $account = $users[$accountIndex];
    if (
        $challenge['flow'] === 'registered_email'
        && (empty($account['recoveryEmailVerified']) || strtolower((string) ($account['recoveryEmail'] ?? '')) !== strtolower((string) $challenge['email']))
    ) {
        unset($_SESSION['passwordResetOtp']);
        apiJson(['success' => false, 'message' => 'This recovery request is no longer valid.'], 400);
    }
    if ($challenge['flow'] === 'new_email' && !empty($account['recoveryEmailVerified'])) {
        unset($_SESSION['passwordResetOtp']);
        apiJson(['success' => false, 'message' => 'A verified email is already linked. Request a code at that email.'], 409);
    }
    $_SESSION['passwordResetOtp']['verifiedAt'] = time();
    unset($_SESSION['passwordResetOtp']['otpHash']);
    apiJson(['success' => true, 'message' => 'Code verified. Set your new password.']);
}

if ($action === 'resetPassword') {
    $mobile = normalizeRecoveryMobile($input['mobile'] ?? '');
    $password = (string) ($input['password'] ?? '');
    $confirm = (string) ($input['confirmPassword'] ?? '');
    $challenge = $_SESSION['passwordResetOtp'] ?? [];
    if ((string) ($challenge['mobile'] ?? '') !== $mobile || empty($challenge['verifiedAt']) || time() - (int) $challenge['verifiedAt'] > 300) {
        unset($_SESSION['passwordResetOtp']);
        apiJson(['success' => false, 'message' => 'Please verify a new code before resetting your password.'], 401);
    }
    if (!preg_match('/^[6-9]\d{9}$/', $mobile) || strlen($password) < 8 || $password !== $confirm) {
        apiJson(['success' => false, 'message' => 'Passwords must match and contain at least 8 characters.'], 422);
    }
    $users = recoveryUsers();
    $found = false;
    foreach ($users as $index => $user) {
        if ((string) ($user['mobile'] ?? '') !== $mobile)
            continue;
        if (empty($challenge['accountExists']))
            break;
        if (($challenge['flow'] ?? '') === 'registered_email') {
            if (empty($user['recoveryEmailVerified']) || strtolower((string) ($user['recoveryEmail'] ?? '')) !== strtolower((string) ($challenge['email'] ?? '')))
                break;
        } elseif (($challenge['flow'] ?? '') === 'new_email') {
            if (!empty($user['recoveryEmailVerified']) || !filter_var((string) ($challenge['email'] ?? ''), FILTER_VALIDATE_EMAIL))
                break;
            foreach ($users as $otherIndex => $otherUser) {
                if ($otherIndex === $index)
                    continue;
                if (
                    strtolower((string) ($otherUser['recoveryEmail'] ?? '')) === strtolower((string) $challenge['email'])
                    || strtolower((string) ($otherUser['email'] ?? '')) === strtolower((string) $challenge['email'])
                ) {
                    unset($_SESSION['passwordResetOtp']);
                    apiJson(['success' => false, 'message' => 'This email is already linked to another account.'], 409);
                }
            }
            $users[$index]['recoveryEmail'] = strtolower((string) $challenge['email']);
            $users[$index]['recoveryEmailVerified'] = true;
            $users[$index]['recoveryEmailVerifiedAt'] = date('c');
        } else {
            break;
        }
        $users[$index]['passwordHash'] = password_hash($password, PASSWORD_DEFAULT);
        unset($users[$index]['password']);
        $users[$index]['passwordResetAt'] = date('c');
        $found = true;
        break;
    }
    if (!$found) {
        unset($_SESSION['passwordResetOtp']);
        apiJson(['success' => false, 'message' => 'This recovery request is no longer valid.'], 400);
    }
    if (!saveRecoveryUsers($users))
        apiJson(['success' => false, 'message' => 'Password could not be saved. Please try again.'], 500);
    unset($_SESSION['passwordResetOtp']);
    apiJson(['success' => true, 'message' => 'Password updated. You can now sign in with your new password.']);
}

apiJson(['success' => false, 'message' => 'Invalid action.'], 400);
?>