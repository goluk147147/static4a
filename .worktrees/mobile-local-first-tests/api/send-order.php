<?php
require_once __DIR__ . '/security.php';

// ==========================================================
// ORDER EMAIL NOTIFICATION
// Sends an automatic email to the store when an order is placed.
// ==========================================================

// Where the order notification should be delivered.
// Read from settings.json (admin-configurable), fall back to a default.
$STORE_EMAIL = '4astorewale@gmail.com';
$settingsFile = __DIR__ . '/../data/settings.json';
if (file_exists($settingsFile)) {
    $s = json_decode(file_get_contents($settingsFile), true);
    if (is_array($s) && !empty($s['storeEmail']) && filter_var($s['storeEmail'], FILTER_VALIDATE_EMAIL)) {
        $STORE_EMAIL = $s['storeEmail'];
    }
}

// The "From" address. Use an address on your own domain so mail
// providers don't reject it (e.g. orders@4astore.com).
$FROM_EMAIL  = 'orders@4astore.com';
$FROM_NAME   = '4A Store Orders';

// Load SMTP config (if provided) for reliable delivery.
$mailCfg = [];
$mailCfgFile = __DIR__ . '/../data/mail-config.php';
if (file_exists($mailCfgFile)) {
    $mailCfg = include $mailCfgFile;
    if (!is_array($mailCfg)) $mailCfg = [];
    if (!empty($mailCfg['from_email'])) $FROM_EMAIL = $mailCfg['from_email'];
    if (!empty($mailCfg['from_name']))  $FROM_NAME  = $mailCfg['from_name'];
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    echo json_encode(['success' => false, 'message' => 'POST required']);
    exit;
}

$input = json_decode(file_get_contents('php://input'), true) ?: [];
$order = $input['order'] ?? null;

$viewer = requireSessionUser();

if (!$order || empty($order['orderId'])) {
    echo json_encode(['success' => false, 'message' => 'Invalid order data']);
    exit;
}

if (($viewer['role'] ?? '') !== 'superadmin' && ($order['customer']['mobile'] ?? '') !== ($viewer['mobile'] ?? '')) {
    apiJson(['success' => false, 'message' => 'Order owner mismatch'], 403);
}

// ---- Helpers -------------------------------------------------
function e($v) { return htmlspecialchars((string)($v ?? ''), ENT_QUOTES, 'UTF-8'); }

$orderId   = e($order['orderId']);
$customer  = $order['customer'] ?? [];
$name      = e($customer['name'] ?? '');
$mobile    = e($customer['mobile'] ?? '');
$address   = e($customer['address'] ?? '');
$city      = e($customer['city'] ?? '');
$pincode   = e($customer['pincode'] ?? '');
$landmark  = e($customer['landmark'] ?? '');
$payment   = e($order['paymentMethod'] ?? 'UPI');
$total     = e($order['totalAmount'] ?? 0);
$subtotal  = e($order['subtotal'] ?? 0);
$discount  = e($order['discount'] ?? 0);
$delivery  = e($order['deliveryCharge'] ?? 0);
$items     = is_array($order['items'] ?? null) ? $order['items'] : [];

// ---- Build item rows ----------------------------------------
$rowsHtml = '';
$rowsText = '';
foreach ($items as $i => $it) {
    $iname = e($it['name'] ?? '');
    $qty   = (int)($it['quantity'] ?? 0);
    $price = (float)($it['price'] ?? 0);
    $line  = $price * $qty;
    $rowsHtml .= "<tr>
        <td style='padding:6px 10px;border-bottom:1px solid #eee;'>{$iname}</td>
        <td style='padding:6px 10px;border-bottom:1px solid #eee;text-align:center;'>{$qty}</td>
        <td style='padding:6px 10px;border-bottom:1px solid #eee;text-align:right;'>&#8377;{$line}</td>
    </tr>";
    $n = $i + 1;
    $rowsText .= "{$n}. {$iname} x {$qty} = Rs.{$line}\n";
}

// ---- HTML email body ----------------------------------------
$html = "
<div style='font-family:Arial,sans-serif;max-width:600px;margin:auto;border:1px solid #eee;border-radius:10px;overflow:hidden;'>
  <div style='background:#2C6FAD;color:#fff;padding:16px 20px;'>
    <h2 style='margin:0;'>&#128722; New Order &ndash; 4A Store</h2>
    <p style='margin:4px 0 0;font-size:13px;'>Order ID: <strong>#{$orderId}</strong></p>
  </div>
  <div style='padding:20px;'>
    <h3 style='margin:0 0 8px;color:#2C6FAD;'>Customer</h3>
    <p style='margin:0;line-height:1.6;'>
      <strong>{$name}</strong><br>
      &#128241; {$mobile}<br>
      &#128205; {$address}, {$city} &ndash; {$pincode}" . ($landmark ? "<br>&#127991; {$landmark}" : "") . "
    </p>

    <h3 style='margin:18px 0 8px;color:#2C6FAD;'>Items</h3>
    <table style='width:100%;border-collapse:collapse;font-size:14px;'>
      <tr style='background:#f5f5f5;'>
        <th style='padding:6px 10px;text-align:left;'>Item</th>
        <th style='padding:6px 10px;text-align:center;'>Qty</th>
        <th style='padding:6px 10px;text-align:right;'>Amount</th>
      </tr>
      {$rowsHtml}
    </table>

    <div style='margin-top:14px;font-size:14px;'>
      <p style='margin:2px 0;'>Subtotal: &#8377;{$subtotal}</p>
      <p style='margin:2px 0;color:#2e7d32;'>Discount: -&#8377;{$discount}</p>
      <p style='margin:2px 0;'>Delivery: &#8377;{$delivery}</p>
      <p style='margin:8px 0 0;font-size:18px;font-weight:bold;color:#2C6FAD;'>Total: &#8377;{$total}</p>
      <p style='margin:6px 0 0;'>Payment: {$payment}</p>
    </div>
  </div>
  <div style='background:#f5f5f5;padding:12px 20px;font-size:12px;color:#888;text-align:center;'>
    4A Store | Chandargarh, Nabinagar, Bihar
  </div>
</div>";

// ---- Plain-text fallback ------------------------------------
$text = "NEW ORDER - 4A Store\n"
      . "Order ID: #{$orderId}\n\n"
      . "Customer: {$name}\n"
      . "Mobile: {$mobile}\n"
      . "Address: {$address}, {$city} - {$pincode}\n"
      . ($landmark ? "Landmark: {$landmark}\n" : "")
      . "\nItems:\n{$rowsText}\n"
      . "Subtotal: Rs.{$subtotal}\n"
      . "Discount: -Rs.{$discount}\n"
      . "Delivery: Rs.{$delivery}\n"
      . "TOTAL: Rs.{$total}\n"
      . "Payment: {$payment}\n";

// ---- Send ----------------------------------------------------
$subject = "New Order #{$orderId} - Rs.{$total} - {$name}";

$boundary = 'bnd_' . md5(uniqid((string)time(), true));
$headers  = "From: {$FROM_NAME} <{$FROM_EMAIL}>\r\n";
$headers .= "Reply-To: {$FROM_EMAIL}\r\n";
$headers .= "MIME-Version: 1.0\r\n";
$headers .= "Content-Type: multipart/alternative; boundary=\"{$boundary}\"\r\n";

$body  = "--{$boundary}\r\n";
$body .= "Content-Type: text/plain; charset=UTF-8\r\n\r\n";
$body .= $text . "\r\n";
$body .= "--{$boundary}\r\n";
$body .= "Content-Type: text/html; charset=UTF-8\r\n\r\n";
$body .= $html . "\r\n";
$body .= "--{$boundary}--";

// ---- Try SMTP first (reliable), fall back to mail() ---------
$useSmtp = !empty($mailCfg['host']);
$sent = false;
$errorDetail = '';

if ($useSmtp) {
    $res = smtpSend($mailCfg, $STORE_EMAIL, $FROM_EMAIL, $FROM_NAME, $subject, $text, $html);
    $sent = $res['ok'];
    $errorDetail = $res['error'];
} else {
    $sent = @mail($STORE_EMAIL, $subject, $body, $headers);
    if (!$sent) $errorDetail = 'PHP mail() was rejected by the server. Configure SMTP in data/mail-config.php for reliable delivery.';
}

if ($sent) {
    echo json_encode(['success' => true, 'message' => 'Order email sent to ' . $STORE_EMAIL]);
} else {
    echo json_encode(['success' => false, 'message' => 'Email not sent', 'detail' => $errorDetail]);
}

// ==========================================================
// Minimal SMTP sender (no external libraries).
// Supports SSL (port 465) and STARTTLS (port 587).
// ==========================================================
function smtpSend($cfg, $to, $fromEmail, $fromName, $subject, $textBody, $htmlBody) {
    $host   = $cfg['host'];
    $port   = (int)($cfg['port'] ?? 465);
    $secure = strtolower($cfg['secure'] ?? 'ssl');
    $user   = $cfg['username'] ?? '';
    $pass   = $cfg['password'] ?? '';

    $remote = ($secure === 'ssl') ? "ssl://{$host}:{$port}" : "{$host}:{$port}";
    $errno = 0; $errstr = '';
    $fp = @stream_socket_client($remote, $errno, $errstr, 20);
    if (!$fp) return ['ok' => false, 'error' => "Connect failed: {$errstr} ({$errno})"];

    stream_set_timeout($fp, 20);

    $read = function () use ($fp) {
        $data = '';
        while ($line = fgets($fp, 515)) {
            $data .= $line;
            if (isset($line[3]) && $line[3] === ' ') break;
        }
        return $data;
    };
    $cmd = function ($c) use ($fp, $read) {
        fwrite($fp, $c . "\r\n");
        return $read();
    };
    $code = function ($resp) { return (int)substr(trim($resp), 0, 3); };

    $resp = $read();
    if ($code($resp) !== 220) { fclose($fp); return ['ok' => false, 'error' => 'Bad greeting: ' . trim($resp)]; }

    $host_name = $_SERVER['SERVER_NAME'] ?? 'localhost';
    $resp = $cmd("EHLO {$host_name}");
    if ($code($resp) !== 250) {
        $resp = $cmd("HELO {$host_name}");
        if ($code($resp) !== 250) { fclose($fp); return ['ok' => false, 'error' => 'EHLO failed: ' . trim($resp)]; }
    }

    if ($secure === 'tls') {
        $resp = $cmd('STARTTLS');
        if ($code($resp) !== 220) { fclose($fp); return ['ok' => false, 'error' => 'STARTTLS failed: ' . trim($resp)]; }
        if (!stream_socket_enable_crypto($fp, true, STREAM_CRYPTO_METHOD_TLS_CLIENT | STREAM_CRYPTO_METHOD_TLSv1_1_CLIENT | STREAM_CRYPTO_METHOD_TLSv1_2_CLIENT)) {
            fclose($fp); return ['ok' => false, 'error' => 'TLS negotiation failed'];
        }
        $cmd("EHLO {$host_name}");
    }

    // AUTH LOGIN
    $resp = $cmd('AUTH LOGIN');
    if ($code($resp) !== 334) { fclose($fp); return ['ok' => false, 'error' => 'AUTH not accepted: ' . trim($resp)]; }
    $resp = $cmd(base64_encode($user));
    if ($code($resp) !== 334) { fclose($fp); return ['ok' => false, 'error' => 'Username rejected: ' . trim($resp)]; }
    $resp = $cmd(base64_encode($pass));
    if ($code($resp) !== 235) { fclose($fp); return ['ok' => false, 'error' => 'Login failed (check username/password): ' . trim($resp)]; }

    $resp = $cmd("MAIL FROM:<{$fromEmail}>");
    if ($code($resp) !== 250) { fclose($fp); return ['ok' => false, 'error' => 'MAIL FROM rejected: ' . trim($resp)]; }
    $resp = $cmd("RCPT TO:<{$to}>");
    if ($code($resp) !== 250 && $code($resp) !== 251) { fclose($fp); return ['ok' => false, 'error' => 'RCPT TO rejected: ' . trim($resp)]; }

    $resp = $cmd('DATA');
    if ($code($resp) !== 354) { fclose($fp); return ['ok' => false, 'error' => 'DATA rejected: ' . trim($resp)]; }

    $boundary = 'bnd_' . md5(uniqid((string)time(), true));
    $eol = "\r\n";
    $message  = 'From: ' . $fromName . ' <' . $fromEmail . '>' . $eol;
    $message .= 'To: <' . $to . '>' . $eol;
    $message .= 'Reply-To: ' . $fromEmail . $eol;
    $message .= 'Subject: ' . $subject . $eol;
    $message .= 'MIME-Version: 1.0' . $eol;
    $message .= 'Content-Type: multipart/alternative; boundary="' . $boundary . '"' . $eol . $eol;
    $message .= '--' . $boundary . $eol;
    $message .= 'Content-Type: text/plain; charset=UTF-8' . $eol . $eol;
    $message .= $textBody . $eol . $eol;
    $message .= '--' . $boundary . $eol;
    $message .= 'Content-Type: text/html; charset=UTF-8' . $eol . $eol;
    $message .= $htmlBody . $eol . $eol;
    $message .= '--' . $boundary . '--' . $eol;

    // Dot-stuffing for lines starting with a dot
    $message = preg_replace('/^\./m', '..', $message);

    fwrite($fp, $message . $eol . '.' . $eol);
    $resp = $read();
    $cmd('QUIT');
    fclose($fp);

    if ($code($resp) !== 250) return ['ok' => false, 'error' => 'Message not accepted: ' . trim($resp)];
    return ['ok' => true, 'error' => ''];
}
?>
