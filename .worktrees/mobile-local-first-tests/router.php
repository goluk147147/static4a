<?php
$root = realpath(__DIR__);
$path = rawurldecode(parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/');

if (preg_match('#(?:^|/)\.#', $path) || preg_match('#^/data(?:/|$)#i', $path)) {
    http_response_code(404);
    echo 'Not Found';
    return true;
}

if ($path === '/') {
    require $root . DIRECTORY_SEPARATOR . 'index.html';
    return true;
}

$file = realpath($root . $path);
if ($file !== false && str_starts_with($file, $root . DIRECTORY_SEPARATOR) && is_file($file)) {
    return false;
}

$html = realpath($root . $path . '.html');
if ($html !== false && str_starts_with($html, $root . DIRECTORY_SEPARATOR) && is_file($html)) {
    require $html;
    return true;
}

return false;