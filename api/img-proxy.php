<?php
// Simple image proxy so remotely-hosted product images can be drawn on a
// <canvas> and exported (toDataURL/toBlob) without tainting the canvas.
// Usage: api/img-proxy.php?url=<encoded https image url>

header('Access-Control-Allow-Origin: *');

$url = isset($_GET['url']) ? trim($_GET['url']) : '';
if ($url === '') { http_response_code(400); echo 'missing url'; exit; }

// Only allow http/https image URLs
if (!preg_match('#^https?://#i', $url)) { http_response_code(400); echo 'bad url'; exit; }

// Basic SSRF guard: block obvious local/private hosts
$host = parse_url($url, PHP_URL_HOST);
if (!$host) { http_response_code(400); echo 'bad host'; exit; }
$hostLower = strtolower($host);
if (in_array($hostLower, ['localhost', '127.0.0.1', '0.0.0.0', '::1'])
    || preg_match('#^(10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)#', $hostLower)) {
    http_response_code(403); echo 'blocked host'; exit;
}

$ctx = stream_context_create([
    'http' => [
        'method'  => 'GET',
        'timeout' => 12,
        'header'  => "User-Agent: 4AStore-ImgProxy/1.0\r\n",
        'follow_location' => 1,
        'max_redirects' => 3,
    ],
    'ssl' => [ 'verify_peer' => false, 'verify_peer_name' => false ],
]);

$data = @file_get_contents($url, false, $ctx);
if ($data === false) { http_response_code(502); echo 'fetch failed'; exit; }

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
if (stripos($ctype, 'image/') !== 0) { $ctype = 'image/jpeg'; }

header('Content-Type: ' . $ctype);
header('Cache-Control: public, max-age=86400');
echo $data;
?>
