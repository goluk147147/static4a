<?php
// Simple image proxy so remotely-hosted product images can be drawn on a
// <canvas> and exported (toDataURL/toBlob) without tainting the canvas.
// Usage: api/img-proxy.php?url=<encoded https image url>

header('Access-Control-Allow-Origin: *');
header('X-Content-Type-Options: nosniff');

$url = isset($_GET['url']) ? trim($_GET['url']) : '';
if ($url === '') {
    http_response_code(400);
    echo 'missing url';
    exit;
}

// Only allow http/https image URLs
if (!preg_match('#^https?://#i', $url)) {
    http_response_code(400);
    echo 'bad url';
    exit;
}

// Basic SSRF guard: block obvious local/private hosts
$host = parse_url($url, PHP_URL_HOST);
if (!$host) {
    http_response_code(400);
    echo 'bad host';
    exit;
}
$hostLower = strtolower($host);
if (in_array($hostLower, ['localhost', '127.0.0.1', '0.0.0.0', '::1'], true)) {
    http_response_code(403);
    echo 'blocked host';
    exit;
}

$resolvedIps = filter_var($host, FILTER_VALIDATE_IP) ? [$host] : (gethostbynamel($host) ?: []);
if (!$resolvedIps) {
    http_response_code(400);
    echo 'host resolution failed';
    exit;
}
foreach ($resolvedIps as $ip) {
    if (!filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE)) {
        http_response_code(403);
        echo 'blocked host';
        exit;
    }
}

$ctx = stream_context_create([
    'http' => [
        'method' => 'GET',
        'timeout' => 12,
        'header' => "User-Agent: 4AStore-ImgProxy/1.0\r\n",
        'follow_location' => 0,
        'max_redirects' => 0,
    ],
    'ssl' => [
        'verify_peer' => false,
        'verify_peer_name' => false,
        'allow_self_signed' => true,
    ],
]);

$data = @file_get_contents($url, false, $ctx);

// Some live CDNs and older XAMPP/PHP setups reject default certificate checks.
// Retry with cURL when the stream wrapper fails so the proxy remains usable.
if ($data === false && function_exists('curl_init')) {
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_CONNECTTIMEOUT => 12,
        CURLOPT_TIMEOUT => 20,
        CURLOPT_USERAGENT => '4AStore-ImgProxy/1.0',
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_SSL_VERIFYHOST => false,
        CURLOPT_HEADER => false,
    ]);
    $data = curl_exec($ch);
    $curlErr = curl_errno($ch);
    curl_close($ch);
    if ($data === false || $curlErr) {
        $data = false;
    }
}

if ($data === false) {
    http_response_code(502);
    echo 'fetch failed';
    exit;
}

// Detect content type
$ctype = 'image/jpeg';
if (isset($http_response_header) && is_array($http_response_header)) {
    foreach ($http_response_header as $h) {
        if (stripos($h, 'Content-Type:') === 0) {
            $ctype = trim(substr($h, strlen('Content-Type:')));
            break;
        }
    }
}
// Only serve images
if (stripos($ctype, 'image/') !== 0) {
    $ctype = 'image/jpeg';
}

header('Content-Type: ' . $ctype);
header('Cache-Control: public, max-age=86400');
echo $data;
?>